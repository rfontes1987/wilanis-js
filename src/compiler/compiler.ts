/**
 * The compiler: a checked tree in, kernel specs out. Every path#operation becomes a handler -- a plugin's
 * native function, or a nested spec for a domain port's binding (delegation or data graph). Resolver
 * templates become edges from resolver nodes, constants are baked, secret paths are marked.
 *
 * Only run this on a tree `checkTree` accepted; the compiler assumes every rule held.
 */
import { Kernel, readPath } from '../kernel/kernel.js';
import type { Handler, Handlers, KernelSpec, KNode, KSource, Redact, Report, RunOptions } from '../kernel/spec.js';
import { isMap, isRun, isSwitch, type BindingDoc, type GraphDoc, type Loaded, type Operation, type Params, type Resolvers, type Source } from '../model.js';
import type { PluginModule } from '../plugins/plugin.js';
import { compilePredicate } from '../expr/expr.js';
import { Scope, TEMPLATE, WHOLE_TEMPLATE } from '../check/scope.js';
import { substitute, hasVars, type Type } from '../types/type.js';

export interface EffectInfo { path: string; opName: string; op: Operation; returns: Type | undefined }

export interface CompileOptions {
  profile?: string;
  /** When set, every effectful native operation runs this instead of the plugin (rehearse, fuzz). */
  stubEffects?: (info: EffectInfo) => Handler;
}

export interface Compiled { spec: KernelSpec; handlers: Handlers }

export class Compiler {
  private handlers: Handlers = {};
  private bindingSpecs = new Map<string, KernelSpec>();

  constructor(readonly scope: Scope, private plugins: PluginModule[], private opts: CompileOptions = {}) {}

  /** Compile a graph by path. Handlers accumulate across calls so one Kernel can run any compiled spec. */
  graph(ref: string): Compiled {
    const g = this.scope.get('graph', ref);
    if (!g) throw new Error(`unknown graph '${ref}'`);
    return { spec: this.lowerGraph(g), handlers: this.handlers };
  }

  private nativeHandler(path: string, opName: string, op: Operation): string {
    const key = `${path}#${opName}`;
    if (this.handlers[key]) return key;
    const stub = op.pure !== true ? this.opts.stubEffects : undefined;
    if (stub) {
      let returns: Type | undefined;
      try { returns = op.returns ? this.scope.types.spec(op.returns) : undefined; } catch { returns = undefined; }
      this.handlers[key] = stub({ path, opName, op, returns });
      return key;
    }
    for (const p of this.plugins) if (p.handlers[key]) { this.handlers[key] = p.handlers[key]; return key; }
    throw new Error(`no plugin implements '${key}'`);
  }

  /** The handler behind path#operation. Domain ports become nested specs through their binding. */
  private handlerFor(opRef: string): { handler: string; op: Operation } {
    const o = this.scope.op(opRef);
    if (typeof o === 'string') throw new Error(o);
    if (o.port.native) return { handler: this.nativeHandler(o.path, o.opName, o.op), op: o.op };
    const b = this.scope.bindingFor(o.path, this.opts.profile);
    if (typeof b === 'string') throw new Error(b);
    const key = `${b.path}#${o.opName}`;
    if (!this.handlers[key]) this.handlers[key] = this.nestedRunner(this.lowerBindingOp(b, o.opName, o.op));
    return { handler: key, op: o.op };
  }

  /** A handler that runs a nested spec with the caller's `in` and forwards request, stubs and env. */
  private nestedRunner(spec: KernelSpec): Handler {
    return async ({ in: input, ctx }) => {
      const report = await new Kernel(this.handlers).run(spec, {
        initial: { in: input, ...(ctx.request !== undefined ? { request: ctx.request } : {}) },
        stubs: ctx.stubs, signal: ctx.signal, env: ctx.env, nodePath: ctx.nodePath,
      });
      ctx.attach(report);
      if (report.status === 'failed') {
        const failed = Object.entries(report.nodes).find(([, n]) => n.status === 'failed');
        throw new Error(`${spec.name}: ${failed ? `${failed[0]}: ${failed[1].error}` : 'failed'}`);
      }
      if (report.status === 'blocked') throw new Error(`${spec.name}: blocked, needs ${report.needs?.join(', ')}`);
      return report.output;
    };
  }

  // ---- lowering -----------------------------------------------------------------------------------

  private lowerGraph(g: Loaded<GraphDoc>): KernelSpec {
    const doc = g.doc;
    const nodes: Record<string, KNode> = {};
    const consts: Record<string, unknown> = {};
    for (const [k, c] of Object.entries(doc.constants ?? {})) consts[k] = c.value;
    const roots = this.resolverRoots(doc.resolvers, nodes);
    const src = (s: Source): KSource => this.lowerSource(s, consts);
    const srcs = (m: Record<string, Source> | undefined) => Object.fromEntries(Object.entries(m ?? {}).map(([k, s]) => [k, src(s)]));
    for (const n of doc.nodes) {
      if (isSwitch(n)) {
        nodes[n.id] = { kind: 'switch', in: srcs(n.in), rules: n.rules.map(r => ({ when: compilePredicate(r.when), to: r.to, label: r.when })), else: n.else };
        continue;
      }
      const { handler, op } = this.handlerFor(n.run);
      const params = this.lowerParams(n.params, roots);
      const redact = this.redactFor(op, n.params);
      if (isRun(n)) nodes[n.id] = { kind: 'call', handler, in: srcs(n.in), params, redact };
      else if (isMap(n)) nodes[n.id] = {
        kind: 'map', handler, over: src(n.over), in: srcs(n.in), params, onItemFailure: n.onItemFailure ?? 'fail', redact,
        bind: n.bind ? Object.fromEntries(Object.entries(n.bind).map(([k, p]) => [k, p ? p.split('.') : []])) : undefined,
      };
    }
    const output = doc.out ? (Array.isArray(doc.out.from) ? doc.out.from : [doc.out.from]) : undefined;
    return { name: g.path, nodes, output };
  }

  /** A binding operation as a nested spec: its resolvers, then the delegate call or the bound graph. */
  private lowerBindingOp(b: Loaded<BindingDoc>, opName: string, op: Operation): KernelSpec {
    const key = `${b.path}#${opName}`;
    const hit = this.bindingSpecs.get(key); if (hit) return hit;
    const bop = b.doc.operations[opName];
    const nodes: Record<string, KNode> = {};
    if (bop.graph) {
      const g = this.scope.get('graph', bop.graph)!;
      const handlerKey = `graph:${g.path}`;
      this.handlers[handlerKey] ??= this.nestedRunner(this.lowerGraph(g));
      const passIn: Record<string, KSource> = {};
      for (const k of Object.keys(op.accepts ?? {})) passIn[k] = { ref: 'in', path: [k] };
      nodes.op = { kind: 'call', handler: handlerKey, in: passIn, params: {} };
    } else {
      const roots = this.resolverRoots(b.doc.resolvers, nodes);
      const { handler, op: target } = this.handlerFor(bop.run!);
      const passIn: Record<string, KSource> = {};
      for (const k of Object.keys(target.accepts ?? {})) passIn[k] = { ref: 'in', path: [k] };
      nodes.op = { kind: 'call', handler, in: passIn, params: this.lowerParams(bop.params, roots), redact: this.redactFor(target, bop.params) };
    }
    const spec: KernelSpec = { name: key, nodes, output: op.returns ? ['op'] : undefined };
    this.bindingSpecs.set(key, spec);
    return spec;
  }

  /** Resolver nodes: name -> node id. Their inputs may read request.* and each other. */
  private resolverRoots(resolvers: Resolvers | undefined, nodes: Record<string, KNode>): Record<string, string> {
    const roots: Record<string, string> = {};
    for (const name of Object.keys(resolvers ?? {})) roots[name] = `resolver:${name}`;
    for (const [name, r] of Object.entries(resolvers ?? {})) {
      const { handler, op } = this.handlerFor(r.run);
      nodes[roots[name]] = { kind: 'call', handler, in: this.lowerParams(r.in, roots, true), params: this.lowerParams(r.params, roots, true), redact: this.redactFor(op, r.params) };
    }
    return roots;
  }

  private lowerSource(s: Source, consts: Record<string, unknown>): KSource {
    if (typeof s === 'string') {
      const [root, ...path] = s.split('.');
      if (root === 'const') return { value: readPath(consts[path[0]], path.slice(1)) };
      return { ref: root, path };
    }
    if (Array.isArray(s)) return { list: s.map(x => this.lowerSource(x, consts)) };
    return { object: Object.fromEntries(Object.entries(s).map(([k, x]) => [k, this.lowerSource(x, consts)])) };
  }

  private lowerParams(params: Params | undefined, roots: Record<string, string>, resolverInput = false): Record<string, KSource> {
    const out: Record<string, KSource> = {};
    for (const [k, v] of Object.entries(params ?? {})) out[k] = this.lowerValue(v, roots, resolverInput);
    return out;
  }

  /** Template roots: a resolver node, `in`, and (in a resolver's own inputs) `request`. */
  private lowerValue(v: unknown, roots: Record<string, string>, resolverInput: boolean): KSource {
    const refFor = (t: string): KSource => {
      const [root, ...path] = t.split('.');
      if (roots[root]) return { ref: roots[root], path };
      if (root === 'in' || (root === 'request' && resolverInput)) return { ref: root, path };
      throw new Error(`unresolvable template {{${t}}}`);
    };
    if (typeof v === 'string') {
      const whole = WHOLE_TEMPLATE.exec(v);
      if (whole) return refFor(whole[1]);
      if (!v.includes('{{')) return { value: v };
      const parts: (string | KSource)[] = [];
      let last = 0;
      for (const m of v.matchAll(TEMPLATE)) {
        if (m.index! > last) parts.push(v.slice(last, m.index));
        parts.push(refFor(m[1]));
        last = m.index! + m[0].length;
      }
      if (last < v.length) parts.push(v.slice(last));
      return { concat: parts };
    }
    if (Array.isArray(v)) return { list: v.map(x => this.lowerValue(x, roots, resolverInput)) };
    if (v && typeof v === 'object') return { object: Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, this.lowerValue(x, roots, resolverInput)])) };
    return { value: v };
  }

  /** Secret paths of an operation's inputs and result (result substituted through its type params). */
  private redactFor(op: Operation, params: Params | undefined): Redact | undefined {
    const paths = (t: Type | undefined, prefix: string[] = [], out: string[][] = [], depth = 0): string[][] => {
      if (!t || depth > 6) return out;
      if (t.kind === 'object') for (const [k, f] of Object.entries(t.fields)) { if (f.secret) out.push([...prefix, k]); else paths(f.type, [...prefix, k], out, depth + 1); }
      if (t.kind === 'list') paths(t.of, prefix, out, depth + 1);
      return out;
    };
    let inT: Type | undefined, outT: Type | undefined;
    try {
      inT = this.scope.types.fields(op.accepts);
      outT = op.returns ? this.scope.types.spec(op.returns) : undefined;
      if (outT && hasVars(outT)) {
        const subst: Record<string, Type> = {};
        for (const [k, f] of Object.entries(op.params ?? {})) if (f.binds && typeof params?.[k] === 'string') subst[f.binds] = this.scope.types.spec(params[k] as string);
        outT = substitute(outT, subst);
      }
    } catch { return undefined; }
    const i = paths(inT), o = paths(outT);
    return i.length || o.length ? { in: i, out: o } : undefined;
  }
}

/** The environment handlers see: connections with secrets substituted, plugin settings, a type resolver. */
export function buildEnv(scope: Scope, env: NodeJS.ProcessEnv = process.env): { env: Record<string, unknown>; missing: string[] } {
  const project = scope.project!;
  const missing: string[] = [];
  const secret = (key: string): string => {
    const varName = project.secrets?.[key];
    const v = varName ? env[varName] : undefined;
    if (v === undefined) { missing.push(`${key} (${varName ?? 'undeclared'})`); return ''; }
    return v;
  };
  const substitute = (v: unknown): unknown => {
    if (typeof v === 'string') return v.replace(TEMPLATE, (_, t: string) => { const [root, key] = t.split('.'); return root === 'secrets' ? secret(key) : `{{${t}}}`; });
    if (Array.isArray(v)) return v.map(substitute);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, substitute(x)]));
    return v;
  };
  const connections: Record<string, { kind: string; settings: Record<string, unknown> }> = {};
  for (const c of scope.registry.all('connection')) connections[c.path] = { kind: scope.canon(c.doc.kind), settings: substitute(c.doc.settings) as Record<string, unknown> };
  const plugins: Record<string, Record<string, unknown>> = {};
  for (const p of project.plugins) plugins[p.use] = substitute(p.settings ?? {}) as Record<string, unknown>;
  return { env: { connections, plugins, canon: scope.canon, resolveType: (ref: string) => scope.types.spec(ref) }, missing: [...new Set(missing)] };
}

/** Run a compiled graph once. */
export async function runGraph(compiled: Compiled, opts: RunOptions): Promise<Report> {
  return new Kernel(compiled.handlers).run(compiled.spec, opts);
}
