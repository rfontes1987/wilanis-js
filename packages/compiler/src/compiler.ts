/**
 * The compiler: a checked tree in, kernel specs out. Every path#operation becomes a handler -- a plugin's
 * native function, or a nested spec for a domain port's binding (delegation or data graph). A node's `in`
 * lowers to kernel sources: literals baked, {{templates}} as reads of nodes, the input, resolvers or
 * constants. Secret paths are marked.
 *
 * Only run this on a tree `checkTree` accepted; the compiler assumes every rule held.
 */
import { Kernel, readPath } from '@wilanis/engine';
import type { Handler, Handlers, KernelSpec, KNode, KSource, Redact, Report, RunOptions } from '@wilanis/engine';
import { isMap, isRun, isSwitch, type BindingDoc, type GraphDoc, type Loaded, type Operation, type Values } from '@wilanis/core';
import type { PluginModule } from '@wilanis/core';
import { expr } from '@wilanis/core';
import { Scope, TEMPLATE, WHOLE_TEMPLATE, splitPath } from '@wilanis/core';
import { substitute, hasVars, type Type } from '@wilanis/core';

export interface EffectInfo { path: string; opName: string; op: Operation; returns: Type | undefined }

export interface CompileOptions {
  profile?: string;
  /** When set, every effectful native operation runs this instead of the plugin (rehearse, fuzz). */
  stubEffects?: (info: EffectInfo) => Handler;
}

export interface Compiled { spec: KernelSpec; handlers: Handlers }

/** The roots a value may read where it is written, and how each lowers. */
interface Roots {
  /** resolver name -> the segments it reads below request */
  resolvers: Record<string, string[]>;
  /** constant name -> baked value */
  consts?: Record<string, unknown>;
  /** may read request.* (a resolver's own in) */
  request?: boolean;
  /** may read other nodes by id (a graph node's in) */
  nodes?: boolean;
}

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

  /**
   * Compile a domain port operation by path#operation: the spec of the binding that meets it under the
   * chosen profile. This is what a trigger fires -- it names what it wants done, never how.
   */
  operation(opRef: string): Compiled {
    const o = this.scope.op(opRef);
    if (typeof o === 'string') throw new Error(o);
    if (o.port.native) throw new Error(`'${opRef}' is a native operation; a trigger fires a domain port`);
    const b = this.scope.bindingFor(o.path, this.opts.profile);
    if (typeof b === 'string') throw new Error(b);
    return { spec: this.lowerBindingOp(b, o.opName, o.op), handlers: this.handlers };
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

  /**
   * A handler that runs a nested spec with the caller's `in` and forwards request, stubs and env. A graph that
   * takes its input whole (an `in` that is not a shape) is handed it under the one key `in`, and unwraps it.
   */
  private nestedRunner(spec: KernelSpec, whole = false): Handler {
    return async ({ in: input, ctx }) => {
      const report = await new Kernel(this.handlers).run(spec, {
        initial: { in: whole ? input.in : input, ...(ctx.request !== undefined ? { request: ctx.request } : {}) },
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
    const resolvers = this.resolverRoots(doc.resolvers);
    const roots: Roots = { resolvers, consts, nodes: true };
    for (const n of doc.nodes) {
      if (isSwitch(n)) {
        nodes[n.id] = { kind: 'switch', in: this.lowerValues(n.in, roots), rules: n.rules.map(r => ({ when: expr.compilePredicate(r.when), to: r.to, label: r.when })), else: n.else };
        continue;
      }
      const { handler, op } = this.handlerFor(n.run);
      const redact = this.redactFor(op, n.in);
      if (isRun(n)) nodes[n.id] = { kind: 'call', handler, in: this.lowerValues(n.in, roots), redact };
      else if (isMap(n)) nodes[n.id] = {
        kind: 'map', handler, over: this.lowerValue(n.over, roots), in: this.lowerValues(n.in, roots), onItemFailure: n.onItemFailure ?? 'fail', redact,
        bind: n.bind ? Object.fromEntries(Object.entries(n.bind).map(([k, p]) => [k, p ? p.split('.') : []])) : undefined,
      };
    }
    const output = doc.out ? (Array.isArray(doc.out.from) ? doc.out.from : [doc.out.from]) : undefined;
    return { name: g.path, nodes, output };
  }

  /**
   * A binding operation as a nested spec: its resolvers, then the delegate call or the bound graph. A
   * delegation gives values in its `in`; every input it does not give is passed from the caller's by name.
   */
  private lowerBindingOp(b: Loaded<BindingDoc>, opName: string, op: Operation): KernelSpec {
    const key = `${b.path}#${opName}`;
    const hit = this.bindingSpecs.get(key); if (hit) return hit;
    const bop = b.doc.operations[opName];
    const nodes: Record<string, KNode> = {};
    if (bop.graph) {
      const g = this.scope.get('graph', bop.graph)!;
      const handlerKey = `graph:${g.path}`;
      const whole = this.takesWhole(g);
      this.handlers[handlerKey] ??= this.nestedRunner(this.lowerGraph(g), whole);
      const passIn: Record<string, KSource> = {};
      // a graph whose in is a shape gets the operation's fields by name; one that takes a value whole gets the one field the operation accepts
      if (whole) passIn.in = { ref: 'in', path: [Object.keys(op.accepts ?? {})[0]] };
      else for (const k of Object.keys(op.accepts ?? {})) passIn[k] = { ref: 'in', path: [k] };
      nodes.op = { kind: 'call', handler: handlerKey, in: passIn };
    } else {
      const resolvers = this.resolverRoots(b.doc.resolvers);
      const { handler, op: target } = this.handlerFor(bop.run!);
      const given: Values = { ...(bop.in ?? {}) };
      for (const k of Object.keys(target.accepts ?? {})) if (!(k in given) && op.accepts?.[k]) given[k] = `{{in.${k}}}`;
      nodes.op = { kind: 'call', handler, in: this.lowerValues(given, { resolvers }), redact: this.redactFor(target, given) };
    }
    const spec: KernelSpec = { name: key, nodes, output: op.returns ? ['op'] : undefined };
    this.bindingSpecs.set(key, spec);
    return spec;
  }

  /** Whether a graph takes its input whole: it declares an `in` that is not a shape (a list, a scalar), read as {{in}}. */
  private takesWhole(g: Loaded<GraphDoc>): boolean {
    if (!g.doc.in) return false;
    try { return this.scope.types.ref(g.doc.in).kind !== 'object'; } catch { return false; }
  }

  /** The resolvers a document names: name -> the segments read below request. A resolver is a read, so it lowers to no node. */
  private resolverRoots(ref: string | undefined): Record<string, string[]> {
    if (!ref) return {};
    const d = this.scope.get('resolvers', ref);
    if (!d) throw new Error(`unknown resolvers document '${ref}'`);
    return Object.fromEntries(Object.entries(d.doc.resolvers).map(([name, r]) => [name, splitPath(r.read).slice(1)]));
  }

  private lowerValues(values: Values | undefined, roots: Roots): Record<string, KSource> {
    const out: Record<string, KSource> = {};
    for (const [k, v] of Object.entries(values ?? {})) out[k] = this.lowerValue(v, roots);
    return out;
  }

  /** One value: a literal bakes, a whole template reads, text with templates concatenates. */
  private lowerValue(v: unknown, roots: Roots): KSource {
    const refFor = (t: string): KSource => {
      const [root, ...path] = splitPath(t);
      if (roots.resolvers[root]) return { ref: 'request', path: [...roots.resolvers[root], ...path] };
      if (root === 'in') return { ref: root, path };
      if (root === 'const' && roots.consts) return { value: readPath(roots.consts[path[0]], path.slice(1)) };
      if (root === 'request' && roots.request) return { ref: root, path };
      if (roots.nodes) return { ref: root, path };
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
    if (Array.isArray(v)) return { list: v.map(x => this.lowerValue(x, roots)) };
    if (v && typeof v === 'object') return { object: Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, this.lowerValue(x, roots)])) };
    return { value: v };
  }

  /** Secret paths of an operation's inputs and result (result substituted through its type fields). */
  private redactFor(op: Operation, given: Values | undefined): Redact | undefined {
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
      if (outT && hasVars(outT)) outT = substitute(outT, bindings(this.scope, op, given));
    } catch { return undefined; }
    const i = paths(inT), o = paths(outT);
    return i.length || o.length ? { in: i, out: o } : undefined;
  }
}

/** The variables an operation's `type` fields bind at one call site: each is a literal type reference in `given`. */
export function bindings(scope: Scope, op: Operation, given: Values | undefined): Record<string, Type> {
  const subst: Record<string, Type> = {};
  for (const [k, f] of Object.entries(op.accepts ?? {})) {
    if (!f.binds || f.type !== 'type') continue;
    const v = given?.[k];
    if (typeof v === 'string') { try { subst[f.binds] = scope.types.spec(v); } catch { /* unknown type: R001 elsewhere */ } }
  }
  return subst;
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
    if (typeof v === 'string') return v.replace(TEMPLATE, (_, t: string) => { const [root, key] = splitPath(t); return root === 'secrets' ? secret(key) : `{{${t}}}`; });
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
