/**
 * The embedder: what every trigger kind calls to fire a graph. Compiles once per graph, supplies `in`
 * and `request`, runs the kernel, then judges the answer against the trigger's out type and prunes keys
 * a closed shape does not declare -- the trigger is where the domain's value becomes the edge's.
 */
import { buildEnv, type Compiled, type CompileOptions, Compiler, runGraph } from '@wilanis/compiler';
import type { Codecs, Hold, PluginModule, Scope, Serving } from '@wilanis/core';
import {
  type BlobStore,
  conforms,
  type GuardArgs,
  policyPath,
  type StartupStep,
  splitPath,
  TEMPLATE,
  type TriggerDoc,
  type Type,
  WHOLE_TEMPLATE,
} from '@wilanis/core';
import type { Report } from '@wilanis/engine';
import { readPath, refusalOf } from '@wilanis/engine';
import { FileBlobStore } from './blobs.js';

/** Fill a templated literal from roots (request, ...). Whole templates take the value; embedded ones interpolate. */
export function fillTemplates(value: unknown, roots: Record<string, unknown>): unknown {
  const read = (t: string) => {
    const [root, ...path] = splitPath(t);
    return readPath(roots[root], path);
  };
  if (typeof value === 'string') {
    const whole = WHOLE_TEMPLATE.exec(value);
    if (whole) return read(whole[1]);
    return value.replace(TEMPLATE, (_, t: string) => {
      const v = read(t);
      return v === undefined ? '' : String(v);
    });
  }
  if (Array.isArray(value)) return value.map(v => fillTemplates(v, roots));
  if (value && typeof value === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const x = fillTemplates(v, roots);
      if (x !== undefined) o[k] = x;
    }
    return o;
  }
  return value;
}

export interface FireOptions {
  stubs?: Record<string, unknown>;
  signal?: AbortSignal /** The blob scope of this run; handlers see it as env.blobs. Absent: the tree's store itself. */;
  blobs?: BlobStore;
}

export class Embedder {
  private compiler: Compiler;
  private compiled = new Map<string, Compiled>();
  readonly env: Record<string, unknown>;
  readonly missingSecrets: string[];
  /** The tree's blob registry: where every blob's bytes live. Handlers reach it as env.blobs. */
  readonly blobs: BlobStore;
  /** Declared secret key -> its value in the environment, for the one place a document reads one outside a connection: a startup step's in. */
  readonly secrets: Record<string, string>;
  /** What `holds` operations have started, in the order they started it: the runtime stops them in reverse. */
  readonly held: { label: string; stop: () => Promise<void> }[] = [];
  /** A run whose effects are stubbed (rehearse, fuzz, regress): nothing leaves the process, and nothing gates it. */
  readonly stubbed: boolean;
  /** The one plugin that identifies callers, when the project names one. */
  private readonly guard: PluginModule | undefined;

  constructor(
    readonly scope: Scope,
    readonly plugins: PluginModule[],
    opts: CompileOptions & { env?: NodeJS.ProcessEnv; blobs?: BlobStore; root?: string } = {},
  ) {
    this.compiler = new Compiler(scope, plugins, opts);
    const processEnv = opts.env ?? process.env;
    const built = buildEnv(scope, processEnv);
    this.secrets = Object.fromEntries(
      Object.entries(scope.project?.secrets ?? {}).map(([k, v]) => [k, processEnv[v] ?? '']),
    );
    const root = opts.root ?? process.cwd();
    this.blobs = opts.blobs ?? new FileBlobStore(root, scope.project?.blobs?.dir);
    const hold: Hold = what => {
      this.held.push(what);
    };
    this.env = { ...built.env, blobs: this.blobs, hold, root };
    this.missingSecrets = built.missing;
    this.stubbed = Boolean(opts.stubEffects);
    this.guard = plugins.find(p => p.guard);
  }

  /** Give `holds` operations the tree being served, as env.serving. Only `start` calls this: a stubbed run holds nothing. */
  serve(served: { serving(): Serving }) {
    (this.env as Record<string, unknown>).serving = served.serving();
  }

  graph(ref: string): Compiled {
    const path = this.scope.canon(ref);
    let c = this.compiled.get(path);
    if (!c) {
      c = this.compiler.graph(path);
      this.compiled.set(path, c);
    }
    return c;
  }

  /** The compiled binding behind a trigger's port operation. Compiled once per operation, like a graph. */
  operation(opRef: string): Compiled {
    const key = `op:${this.scope.canon(opRef.split('#')[0])}#${opRef.split('#')[1] ?? ''}`;
    let c = this.compiled.get(key);
    if (!c) {
      c = this.compiler.operation(opRef);
      this.compiled.set(key, c);
    }
    return c;
  }

  /**
   * Run one of the project's startup steps: the domain port operation it names, with its `in` written as
   * literals and {{secrets.*}}. Nothing has been received, so the run is given no request -- the checker
   * has already refused any step that reaches a read of one.
   */
  async startup(step: StartupStep, opts: FireOptions = {}): Promise<Report> {
    const compiled = this.operation(step.run);
    const input = fillTemplates(step.in ?? {}, { secrets: this.secrets }) as Record<string, unknown>;
    return runGraph(compiled, {
      initial: { in: input },
      signal: opts.signal,
      env: opts.blobs ? { ...this.env, blobs: opts.blobs } : this.env,
    });
  }

  /**
   * The trigger's in/out types, resolved. A policy rehearsed as a trigger declares no `in` and writes `fire.in`
   * all the same; its input is then what the decision accepts.
   */
  types(trigger: TriggerDoc): { in?: Type; out?: Type } {
    const accepts = () => {
      const o = this.scope.op(trigger.fire.run);
      return typeof o === 'string' || !Object.keys(o.op.accepts ?? {}).length
        ? undefined
        : this.scope.types.fields(o.op.accepts);
    };
    return {
      in: trigger.in ? this.scope.types.ref(trigger.in) : trigger.fire.in !== undefined ? accepts() : undefined,
      out: trigger.out ? this.scope.types.ref(trigger.out) : undefined,
    };
  }

  /**
   * The gate before a run. The guard verifies the credentials the trigger's policy attachments give, and what it
   * establishes joins the request; then every policy decides, in order. Answers the report that ends the run
   * -- the guard's refusal, a policy's denial, a challenge carrying its detail -- or nothing when the trigger
   * may fire. A stubbed run is never gated: its generated context already carries a principal, and the
   * policies are rehearsed as roots of their own.
   */
  private async gate(
    trigger: TriggerDoc,
    request: Record<string, unknown>,
    opts: FireOptions,
  ): Promise<Report | undefined> {
    if (this.stubbed || !trigger.policies?.length) return undefined;
    const args = this.guardArgs(trigger, request);
    if (this.guard) {
      const id = await this.guard.guard!.identify(args);
      if ('refuse' in id)
        return refused(`${this.guard.root} guard`, 'identify', id.refuse.reason, id.refuse.message, id.refuse.detail);
      Object.assign(request, id.context);
    }
    for (const use of trigger.policies) {
      const ref = policyPath(use);
      const p = this.scope.get('policy', ref);
      if (!p) throw new Error(`unknown policy '${ref}'`);
      const compiled = this.operation(p.doc.decide.run);
      const input = fillTemplates(p.doc.decide.in ?? {}, { request });
      const report = await runGraph(compiled, {
        initial: { in: input, request },
        signal: opts.signal,
        env: opts.blobs ? { ...this.env, blobs: opts.blobs } : this.env,
      });
      if (report.status === 'done') continue;
      const decided: Report = { ...report, graph: p.path };
      const outcome = refusalOf(report);
      if (!outcome) return decided; // the decision broke: a fault, answered as one
      const effect = p.doc.outcomes[outcome.reason];
      if (effect?.effect === 'challenge' && this.guard) {
        const ch = await this.guard.guard!.challenge({
          ...args,
          policy: p.path,
          reason: outcome.reason,
          message: outcome.message,
          method: effect.method,
        });
        const [id, node] = Object.entries(decided.nodes).find(([, n]) => n.status === 'failed')!;
        decided.nodes = { ...decided.nodes, [id]: { ...node, error: ch.message, detail: ch.detail } };
      }
      return decided;
    }
    return undefined;
  }

  /**
   * What the guard is handed: the credentials the trigger's policy attachments give, read from the context -- a list is
   * the places one may sit, the first present wins; a value with nothing in it is no credential -- and the reads as
   * written, so the guard can say where an answer goes.
   */
  private guardArgs(trigger: TriggerDoc, request: Record<string, unknown>): GuardArgs {
    const settings = this.guard
      ? ((this.env.plugins as Record<string, Record<string, unknown>>)[this.guard.root] ?? {})
      : {};
    const credentials: Record<string, unknown> = {},
      reads: Record<string, unknown> = {};
    const present = (v: unknown): boolean =>
      v !== undefined &&
      v !== '' &&
      !(v && typeof v === 'object' && !Array.isArray(v) && !Object.values(v as Record<string, unknown>).some(present));
    for (const use of trigger.policies ?? []) {
      if (typeof use === 'string') continue;
      for (const [name, raw] of Object.entries(use.in ?? {})) {
        reads[name] ??= raw;
        if (credentials[name] !== undefined) continue;
        const filled = fillTemplates(raw, { request });
        const value = Array.isArray(raw) ? (filled as unknown[]).find(present) : filled;
        if (present(value)) credentials[name] = value;
      }
    }
    return { trigger, kind: this.scope.canon(trigger.kind), request, credentials, reads, settings, env: this.env };
  }

  /** The codec table of a plugin's settings, resolved to implementations: content type -> codec. */
  codecsOf(root: string): Codecs {
    const settings = (this.env.plugins as Record<string, Record<string, unknown>>)[root] ?? {};
    const table = (settings.codecs ?? {}) as Record<string, string>;
    const out: Codecs = {};
    for (const [ct, path] of Object.entries(table)) {
      for (const p of this.plugins) {
        const c = p.codecs?.[path];
        if (c) out[ct.toLowerCase()] = c;
      }
    }
    return out;
  }

  /**
   * Build the trigger's input from its context: the `input` mapping when declared, else the decoded body.
   * Answers the input, or the reason it does not conform to the trigger's in type.
   */
  inputFor(trigger: TriggerDoc, request: Record<string, unknown>): { input: unknown } | { error: string } {
    const t = this.types(trigger).in;
    if (!t) return { input: undefined };
    const raw = trigger.fire.in !== undefined ? fillTemplates(trigger.fire.in, { request }) : request.body;
    const input =
      t.kind === 'object' && raw && typeof raw === 'object' && !Array.isArray(raw)
        ? Object.fromEntries(
            Object.entries(raw as Record<string, unknown>).map(([k, v]) => [
              k,
              t.fields[k] ? coerceWire(v, t.fields[k].type) : v,
            ]),
          )
        : raw;
    const bad = conforms(input, t);
    return bad ? { error: bad } : { input };
  }

  async fire(
    trigger: TriggerDoc,
    input: unknown,
    request: Record<string, unknown>,
    opts: FireOptions = {},
  ): Promise<Report> {
    const gated = await this.gate(trigger, request, opts);
    if (gated) return gated;
    const compiled = this.operation(trigger.fire.run);
    const initial: Record<string, unknown> = { request };
    if (input !== undefined) initial.in = input;
    const report = await runGraph(compiled, {
      initial,
      stubs: opts.stubs,
      signal: opts.signal,
      env: opts.blobs ? { ...this.env, blobs: opts.blobs } : this.env,
    });
    const guard = this.guard?.guard;
    if (guard?.settle && !this.stubbed && trigger.policies?.length)
      await guard.settle({ ...this.guardArgs(trigger, request), report });
    if (report.status === 'done' && trigger.out) {
      const t = this.types(trigger).out!;
      const output = prune(report.output, t); // a closed out shape keeps only what it declares
      const bad = conforms(output, t);
      if (bad)
        return {
          ...report,
          status: 'failed',
          nodes: {
            ...report.nodes,
            out: { status: 'failed', error: `the answer does not conform to ${trigger.out}: ${bad}` },
          },
        };
      return { ...report, output };
    }
    return report;
  }
}

/** A report of a run that ended before any graph ran: the guard refused the credential. */
function refused(
  graph: string,
  node: string,
  reason: string,
  message: string,
  detail?: Record<string, unknown>,
): Report {
  const now = Date.now();
  return {
    graph,
    status: 'failed',
    nodes: { [node]: { status: 'failed', handler: graph, reason, error: message, ...(detail ? { detail } : {}) } },
    startedAt: now,
    endedAt: now,
  };
}

/** Drop keys a closed object type does not declare, recursively. Open objects and unknown pass through. */
export function prune(v: unknown, t: Type): unknown {
  if (t.kind === 'list' && Array.isArray(v)) return v.map(x => prune(x, t.of));
  if (t.kind === 'object' && v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(o)) {
      const f = t.fields[k];
      if (f) out[k] = prune(x, f.type);
      else if (t.open) out[k] = x;
    }
    return out;
  }
  return v;
}

/** Coerce wire strings (query, path, headers, form fields) toward the declared field types. */
export function coerceWire(v: unknown, t: Type): unknown {
  if (typeof v !== 'string') return v;
  if (t.kind === 'number' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  if (t.kind === 'boolean' && (v === 'true' || v === 'false')) return v === 'true';
  return v;
}
