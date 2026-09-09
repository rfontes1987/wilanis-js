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
  type TriggerDoc,
  type Type,
} from '@wilanis/core';
import type { Report } from '@wilanis/engine';
import { refusalOf } from '@wilanis/engine';
import { FileBlobStore } from './blobs.js';
import { coerceWire, fillTemplates, prune, refused } from './values.js';

export { coerceWire, fillTemplates, prune } from './values.js';

export interface FireOptions {
  stubs?: Record<string, unknown>;
  signal?: AbortSignal /** The blob scope of this run; handlers see it as env.blobs. Absent: the tree's store itself. */;
  blobs?: BlobStore;
}

/** Whether a value is a credential at all: a value with nothing in it is none. */
function present(value: unknown): boolean {
  if (value === undefined || value === '') return false;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return true;
  return Object.values(value as Record<string, unknown>).some(present);
}

/**
 * The credential one read gives: a list is the places it may sit, the first present wins; anything else is the value
 * where it is present, and undefined where it is not.
 */
function credentialFrom(written: unknown, request: Record<string, unknown>): unknown {
  const filled = fillTemplates(written, { request });
  const value = Array.isArray(written) ? (filled as unknown[]).find(present) : filled;
  return present(value) ? value : undefined;
}

/** The credentials every attachment of a trigger gives, and the reads as written; the first attachment to give one wins. */
function gathered(trigger: TriggerDoc, request: Record<string, unknown>) {
  const found = { credentials: {} as Record<string, unknown>, reads: {} as Record<string, unknown> };
  for (const use of trigger.policies ?? []) if (typeof use !== 'string') take(use.in ?? {}, request, found);
  return found;
}

/** What one attachment gives, added to what earlier attachments already gave. */
function take(
  given: Record<string, unknown>,
  request: Record<string, unknown>,
  found: { credentials: Record<string, unknown>; reads: Record<string, unknown> },
) {
  for (const [name, written] of Object.entries(given)) {
    found.reads[name] ??= written;
    if (found.credentials[name] !== undefined) continue;
    const value = credentialFrom(written, request);
    if (value !== undefined) found.credentials[name] = value;
  }
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
    const inType = () => {
      if (trigger.in) return this.scope.types.ref(trigger.in);
      return trigger.fire.in !== undefined ? accepts() : undefined;
    };
    return { in: inType(), out: trigger.out ? this.scope.types.ref(trigger.out) : undefined };
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
      if ('refuse' in id) return refused(`${this.guard.root} guard`, 'identify', id.refuse);
      Object.assign(request, id.context);
    }
    for (const use of trigger.policies) {
      const decided = await this.decide(policyPath(use), request, opts, args);
      if (decided) return decided;
    }
    return undefined;
  }

  /** One policy's decision: nothing when it allows, else the report that ends the run. */
  private async decide(
    ref: string,
    request: Record<string, unknown>,
    opts: FireOptions,
    args: GuardArgs,
  ): Promise<Report | undefined> {
    const policy = this.scope.get('policy', ref);
    if (!policy) throw new Error(`unknown policy '${ref}'`);
    const report = await runGraph(this.operation(policy.doc.decide.run), {
      initial: { in: fillTemplates(policy.doc.decide.in ?? {}, { request }), request },
      signal: opts.signal,
      env: opts.blobs ? { ...this.env, blobs: opts.blobs } : this.env,
    });
    if (report.status === 'done') return undefined;
    const decided: Report = { ...report, graph: policy.path };
    const outcome = refusalOf(report);
    if (!outcome) return decided; // the decision broke: a fault, answered as one
    const effect = policy.doc.outcomes[outcome.reason];
    if (effect?.effect !== 'challenge' || !this.guard) return decided;
    return this.challenged(decided, args, { policy: policy.path, outcome, method: effect.method });
  }

  /** A denial the guard turns into a challenge: the same report, carrying how to answer it. */
  private async challenged(
    decided: Report,
    args: GuardArgs,
    what: { policy: string; outcome: { reason: string; message: string }; method?: string },
  ): Promise<Report> {
    const challenge = await this.guard?.guard?.challenge({
      ...args,
      policy: what.policy,
      reason: what.outcome.reason,
      message: what.outcome.message,
      method: what.method,
    });
    const failed = Object.entries(decided.nodes).find(([, node]) => node.status === 'failed');
    if (!challenge || !failed) return decided;
    const [id, node] = failed;
    return {
      ...decided,
      nodes: { ...decided.nodes, [id]: { ...node, error: challenge.message, detail: challenge.detail } },
    };
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
    const { credentials, reads } = gathered(trigger, request);
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
