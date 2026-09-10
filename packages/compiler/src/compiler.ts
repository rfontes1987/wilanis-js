/**
 * The compiler: a checked tree in, kernel specs out. Every path#operation becomes a handler -- a plugin's
 * native function, or a nested spec for a domain port's binding (delegation or data graph). A node's `in`
 * lowers to kernel sources (lower.ts). Secret paths are marked.
 *
 * Only run this on a tree `checkTree` accepted; the compiler assumes every rule held.
 */
import {
  type BindingDoc,
  type BindingOp,
  expr,
  type GraphDoc,
  hasVars,
  isRun,
  isSwitch,
  type Loaded,
  type Node,
  type Operation,
  type OpHit,
  type PluginModule,
  type Scope,
  splitPath,
  substitute,
  type Type,
  type TypeSpec,
  type Values,
} from '@wilanis/core';
import {
  type Handler,
  type Handlers,
  type KCall,
  Kernel,
  type KernelSpec,
  type KNode,
  type Redact,
  Refusal,
  type Report,
  refusalOf,
} from '@wilanis/engine';
import { bindings, outputCandidates, passedInputs } from './documents.js';
import { bindPaths, inputsByName, lowerValue, lowerValues, type Roots, secretPaths } from './lower.js';

export interface EffectInfo {
  path: string;
  opName: string;
  op: Operation;
  returns: Type | undefined;
}

export interface CompileOptions {
  profile?: string;
  /** When set, every effectful native operation runs this instead of the plugin (rehearse, fuzz). */
  stubEffects?: (info: EffectInfo) => Handler;
}

export interface Compiled {
  spec: KernelSpec;
  handlers: Handlers;
}

/**
 * Why a nested run did not answer. A refusal is the nested graph's declared outcome: it passes up as it is,
 * reason and message, so the trigger can answer it; a fault is named by the graph and node it broke in; a
 * blocked run names what it needed.
 */
function nestedFailure(spec: KernelSpec, report: Report): Error {
  if (report.status === 'blocked') return new Error(`${spec.name}: blocked, needs ${report.needs?.join(', ')}`);
  const refused = refusalOf(report);
  if (refused) return new Refusal(refused.reason, refused.message, refused.detail);
  const failed = Object.entries(report.nodes).find(([, node]) => node.status === 'failed');
  return new Error(`${spec.name}: ${failed ? `${failed[0]}: ${failed[1].error}` : 'failed'}`);
}

/**
 * Lowers a checked tree to what the kernel runs: the spec of a graph, or of the binding that meets a domain
 * port operation under the chosen profile, with every path#operation resolved to a handler. Handlers
 * accumulate across calls, so one Kernel runs any spec it compiled. It assumes `checkTree` already accepted.
 */
export class Compiler {
  private readonly handlers: Handlers = {};
  private readonly bindingSpecs = new Map<string, KernelSpec>();

  constructor(
    readonly scope: Scope,
    private readonly plugins: PluginModule[],
    private readonly opts: CompileOptions = {},
  ) {}

  /** Compile a graph by path. Handlers accumulate across calls so one Kernel can run any compiled spec. */
  graph(ref: string): Compiled {
    const graph = this.scope.get('graph', ref);
    if (!graph) throw new Error(`unknown graph '${ref}'`);
    return { spec: this.lowerGraph(graph), handlers: this.handlers };
  }

  /**
   * Compile a domain port operation by path#operation: the spec of the binding that meets it under the
   * chosen profile. This is what a trigger fires -- it names what it wants done, never how.
   */
  operation(opRef: string): Compiled {
    const hit = this.scope.op(opRef);
    if (typeof hit === 'string') throw new Error(hit);
    if (hit.port.native && hit.op.holds) return { spec: this.holdsSpec(hit), handlers: this.handlers };
    if (hit.port.native) throw new Error(`'${opRef}' is a native operation; a trigger fires a domain port`);
    const binding = this.scope.bindingFor(hit.path, this.opts.profile);
    if (typeof binding === 'string') throw new Error(binding);
    return { spec: this.lowerBindingOp(binding, hit), handlers: this.handlers };
  }

  /**
   * A `holds` operation starts something that outlives the run: it is a plugin's own, has no binding to choose
   * between, and only a project's startup list names it. It compiles to the one call it is.
   */
  private holdsSpec(hit: OpHit): KernelSpec {
    const op: KCall = {
      kind: 'call',
      handler: this.nativeHandler(hit),
      in: inputsByName(Object.keys(hit.op.accepts ?? {})),
    };
    return { name: `${hit.path}#${hit.opName}`, nodes: { op }, output: hit.op.returns ? ['op'] : undefined };
  }

  // ---- handlers -----------------------------------------------------------------------------------

  /** The handler of a native operation: the plugin's function, or the effect stub when one is set and the operation is effectful. */
  private nativeHandler(hit: OpHit): string {
    const key = `${hit.path}#${hit.opName}`;
    if (this.handlers[key]) return key;
    const stub = hit.op.pure !== true ? this.opts.stubEffects : undefined;
    if (stub) {
      this.handlers[key] = stub({
        path: hit.path,
        opName: hit.opName,
        op: hit.op,
        returns: this.quietType(hit.op.returns),
      });
      return key;
    }
    const plugin = this.plugins.find(candidate => candidate.handlers[key]);
    if (!plugin) throw new Error(`no plugin implements '${key}'`);
    this.handlers[key] = plugin.handlers[key];
    return key;
  }

  private quietType(spec: TypeSpec | undefined): Type | undefined {
    try {
      return spec ? this.scope.types.spec(spec) : undefined;
    } catch {
      return undefined;
    }
  }

  /** The handler behind path#operation. Domain ports become nested specs through their binding. */
  private handlerFor(opRef: string): { handler: string; op: Operation } {
    const hit = this.scope.op(opRef);
    if (typeof hit === 'string') throw new Error(hit);
    if (hit.port.native) return { handler: this.nativeHandler(hit), op: hit.op };
    const binding = this.scope.bindingFor(hit.path, this.opts.profile);
    if (typeof binding === 'string') throw new Error(binding);
    const key = `${binding.path}#${hit.opName}`;
    this.handlers[key] ??= this.nestedRunner(this.lowerBindingOp(binding, hit));
    return { handler: key, op: hit.op };
  }

  /**
   * A handler that runs a nested spec with the caller's `in` and forwards request, stubs and env. A graph that
   * takes its input whole (an `in` that is not a shape) is handed it under the one key `in`, and unwraps it.
   */
  private nestedRunner(spec: KernelSpec, whole = false): Handler {
    return async ({ in: input, ctx }) => {
      const report = await new Kernel(this.handlers).run(spec, {
        initial: { in: whole ? input.in : input, ...(ctx.request !== undefined ? { request: ctx.request } : {}) },
        stubs: ctx.stubs,
        signal: ctx.signal,
        env: ctx.env,
        nodePath: ctx.nodePath,
      });
      ctx.attach(report);
      if (report.status !== 'done') throw nestedFailure(spec, report);
      return report.output;
    };
  }

  // ---- lowering -----------------------------------------------------------------------------------

  private lowerGraph(graph: Loaded<GraphDoc>): KernelSpec {
    const doc = graph.doc;
    const consts = Object.fromEntries(
      Object.entries(doc.constants ?? {}).map(([name, constant]) => [name, constant.value]),
    );
    const roots: Roots = { resolvers: this.resolverRoots(doc.resolvers), consts, nodes: true };
    const nodes: Record<string, KNode> = {};
    for (const node of doc.nodes) nodes[node.id] = this.lowerNode(node, roots);
    return { name: graph.path, nodes, output: outputCandidates(doc) };
  }

  private lowerNode(node: Node, roots: Roots): KNode {
    if (isSwitch(node)) {
      const rules = node.rules.map(rule => ({ when: expr.compilePredicate(rule.when), to: rule.to, label: rule.when }));
      return { kind: 'switch', in: lowerValues(node.in, roots), rules, else: node.else };
    }
    const { handler, op } = this.handlerFor(node.run);
    const inputs = lowerValues(node.in, roots);
    const redact = this.redactFor(op, node.in);
    if (isRun(node)) return { kind: 'call', handler, in: inputs, redact };
    const over = lowerValue(node.over, roots);
    return {
      kind: 'map',
      handler,
      over,
      in: inputs,
      onItemFailure: node.onItemFailure ?? 'fail',
      redact,
      bind: bindPaths(node.bind),
    };
  }

  /** A binding operation as a nested spec: one call, of the bound graph or of the delegate. */
  private lowerBindingOp(binding: Loaded<BindingDoc>, hit: OpHit): KernelSpec {
    const key = `${binding.path}#${hit.opName}`;
    const cached = this.bindingSpecs.get(key);
    if (cached) return cached;
    const bound = binding.doc.operations[hit.opName];
    const op = bound.graph ? this.graphCall(bound.graph, hit.op) : this.delegateCall(binding, bound, hit.op);
    const spec: KernelSpec = { name: key, nodes: { op }, output: hit.op.returns ? ['op'] : undefined };
    this.bindingSpecs.set(key, spec);
    return spec;
  }

  /**
   * The bound graph as one call. A graph whose in is a shape gets the operation's fields by name; one that
   * takes a value whole gets the one field the operation accepts.
   */
  private graphCall(graphRef: string, op: Operation): KCall {
    const graph = this.scope.get('graph', graphRef);
    if (!graph) throw new Error(`unknown graph '${graphRef}'`);
    const handler = `graph:${graph.path}`;
    const whole = this.takesWhole(graph);
    this.handlers[handler] ??= this.nestedRunner(this.lowerGraph(graph), whole);
    const names = Object.keys(op.accepts ?? {});
    const passIn = whole ? { in: { ref: 'in', path: [names[0]] } } : inputsByName(names);
    return { kind: 'call', handler, in: passIn };
  }

  /** A delegation as one call: the statement's own values, the caller's by name for the rest, resolvers read below request. */
  private delegateCall(binding: Loaded<BindingDoc>, bound: BindingOp, op: Operation): KCall {
    if (!bound.run) throw new Error(`${binding.path}: an operation binds a graph or a run`);
    const { handler, op: target } = this.handlerFor(bound.run);
    const given = passedInputs(target, op, bound.in);
    const roots: Roots = { resolvers: this.resolverRoots(binding.doc.resolvers) };
    return { kind: 'call', handler, in: lowerValues(given, roots), redact: this.redactFor(target, given) };
  }

  /** Whether a graph takes its input whole: it declares an `in` that is not a shape (a list, a scalar), read as {{in}}. */
  private takesWhole(graph: Loaded<GraphDoc>): boolean {
    if (!graph.doc.in) return false;
    try {
      return this.scope.types.ref(graph.doc.in).kind !== 'object';
    } catch {
      return false;
    }
  }

  /** The resolvers a document names: name -> the segments read below request. A resolver is a read, so it lowers to no node. */
  private resolverRoots(ref: string | undefined): Record<string, string[]> {
    if (!ref) return {};
    const doc = this.scope.get('resolvers', ref);
    if (!doc) throw new Error(`unknown resolvers document '${ref}'`);
    return Object.fromEntries(
      Object.entries(doc.doc.resolvers).map(([name, resolver]) => [name, splitPath(resolver.read).slice(1)]),
    );
  }

  /** Secret paths of an operation's inputs and result (result substituted through its type fields). */
  private redactFor(op: Operation, given: Values | undefined): Redact | undefined {
    let inType: Type | undefined;
    let outType: Type | undefined;
    try {
      inType = this.scope.types.fields(op.accepts);
      outType = op.returns ? this.scope.types.spec(op.returns) : undefined;
      if (outType && hasVars(outType)) outType = substitute(outType, bindings(this.scope, op, given));
    } catch {
      return undefined;
    }
    const inPaths = secretPaths(inType);
    const outPaths = secretPaths(outType);
    return inPaths.length || outPaths.length ? { in: inPaths, out: outPaths } : undefined;
  }
}
