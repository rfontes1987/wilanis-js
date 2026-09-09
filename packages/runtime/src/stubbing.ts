/**
 * What a gate runs a tree against instead of the world: stubbed effects, a fake environment for the secrets a tree
 * reads, and the input a trigger's fire would be given. Nothing here reaches a network, a disk or a clock.
 */
import type { EffectInfo } from '@wilanis/compiler';
import type { LoadResult } from '@wilanis/core';
import {
  generate,
  hasVars,
  type Loaded,
  policyPath,
  rng,
  Scope,
  schemaUrl,
  substitute,
  type TriggerDoc,
  type TriggerKindDoc,
  type Type,
} from '@wilanis/core';
import type { Handler, Report } from '@wilanis/engine';
import { Embedder } from './embed.js';

// ---- stubbing ---------------------------------------------------------------------------------------

const hash = (s: string) => {
  let h = 2166136261;
  for (const c of s) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

/** Every effectful native operation answers a generated value of its declared type, deterministic per seed and node path. */
/** The type variables this call binds, read from the `type` inputs the operation declares. */
function boundHere(info: EffectInfo, given: Record<string, unknown>, resolve: (ref: string) => Type) {
  const subst: Record<string, Type> = {};
  for (const [name, field] of Object.entries(info.op.accepts ?? {})) {
    if (!field.binds || field.type !== 'type' || typeof given[name] !== 'string') continue;
    try {
      subst[field.binds] = resolve(given[name] as string);
    } catch {
      /* unknown */
    }
  }
  return subst;
}

/** What an effect answers at this call site: its return type with the variables this call binds filled in. */
function answerType(
  info: EffectInfo,
  given: Record<string, unknown>,
  resolve: ((ref: string) => Type) | undefined,
): Type | undefined {
  const returns = info.returns;
  if (!returns || !hasVars(returns) || !resolve) return returns;
  return substitute(returns, boundHere(info, given, resolve));
}

export function stubEffects(seed: number, record?: Record<string, unknown>, types?: Record<string, Type>) {
  return (info: EffectInfo): Handler =>
    async ({ in: i, ctx }) => {
      const resolve = ctx.env.resolveType as ((ref: string) => Type) | undefined;
      const t = answerType(info, i, resolve);
      const key = ctx.nodePath.join('.');
      const value = t ? generate(t, rng(seed ^ hash(key))) : undefined;
      if (record) record[key] = value;
      if (types && t) types[key] = t;
      return value;
    };
}

export function embedderFor(
  load: LoadResult,
  opts: {
    seed?: number;
    record?: Record<string, unknown>;
    types?: Record<string, Type>;
    profile?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
): Embedder {
  const scope = new Scope(load.registry, load.resolve);
  const env = opts.env ?? (opts.seed !== undefined ? fakeEnv(scope) : process.env);
  return new Embedder(scope, load.plugins, {
    profile: opts.profile,
    stubEffects: opts.seed !== undefined ? stubEffects(opts.seed, opts.record, opts.types) : undefined,
    env,
    root: load.root,
  });
}

/** An environment where every declared secret is present, for runs that never leave the process. */
function fakeEnv(scope: Scope): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const v of Object.values(scope.project?.secrets ?? {})) env[v] = `stub-${v.toLowerCase()}`;
  return env;
}

/** A generated request context for a trigger kind, and a generated input for the trigger. */
export function generatedFire(
  emb: Embedder,
  t: Loaded<TriggerDoc>,
  seed: number,
): { input: unknown; request: Record<string, unknown> } {
  const kind = emb.scope.get('trigger-kind', t.doc.kind)?.doc as TriggerKindDoc;
  const r = rng(seed);
  const request = generate(emb.scope.contextType(kind, t.doc.settings), r) as Record<string, unknown>;
  const types = emb.types(t.doc);
  // the body/input is generated from the trigger's in type so it always conforms; the mapping is then honoured
  if (types.in) {
    if (t.doc.fire.in !== undefined) {
      const built = emb.inputFor(t.doc, request);
      if ('input' in built) return { input: built.input, request };
      return { input: generate(types.in, r), request };
    }
    const input = generate(types.in, r);
    request.body = input;
    return { input, request };
  }
  return { input: undefined, request };
}

/**
 * Every policy as a trigger of each kind that attaches it, for the gates that run triggers. A policy's decision
 * is a domain operation fired with an input read from the context, the way a trigger's is; rehearsed as a
 * root of its own, every branch of the decision graph is walked with a caller that is there and one that is
 * not. The settings are borrowed from an attaching trigger, since a kind's context (route placeholders, the
 * body's shape) is written in them; a policy nothing attaches is rehearsed under the first trigger's kind.
 */
export function policyRoots(load: LoadResult): Loaded<TriggerDoc>[] {
  const out: Loaded<TriggerDoc>[] = [];
  const triggers = load.registry.all('trigger');
  for (const p of load.registry.all('policy')) {
    const attaching = triggers.filter(t =>
      (t.doc.policies ?? []).some(ref => load.resolve(policyPath(ref)) === p.path),
    );
    const seen = new Set<string>();
    for (const t of attaching.length ? attaching : triggers.slice(0, 1)) {
      const kind = load.resolve(t.doc.kind);
      if (seen.has(kind)) continue;
      seen.add(kind);
      const doc: TriggerDoc = {
        $schema: schemaUrl('trigger'),
        description: p.doc.description,
        label: p.doc.label,
        kind: t.doc.kind,
        settings: t.doc.settings,
        fire: p.doc.decide,
      };
      out.push({ ...p, kind: 'trigger', doc } as unknown as Loaded<TriggerDoc>);
    }
  }
  return out;
}

type FailedNode = Report['nodes'][string] & { id: string };

/** The innermost failed node of a report, through nested runs and through the elements of a map. */
export function failedLeaf(report: Report): FailedNode | undefined {
  for (const [id, n] of Object.entries(report.nodes)) {
    if (n.status !== 'failed') continue;
    return failedBelow(id, n) ?? { ...n, id };
  }
  return undefined;
}

/** The failure strictly inside a failed node: in the graph it ran, or in the element of a map that failed. */
export function failedBelow(id: string, n: Report['nodes'][string]): FailedNode | undefined {
  if (n.sub) return failedLeaf(n.sub);
  const at = n.items?.findIndex(item => item.status === 'failed') ?? -1;
  const failed = at < 0 ? undefined : n.items?.[at];
  if (!failed) return undefined;
  return (failed.sub && failedLeaf(failed.sub)) || { ...failed, id: `${id}.${at}` };
}

export function summarize(report: Report, indent = ''): string {
  const lines = [
    `${indent}${report.graph}: ${report.status}${report.needs?.length ? ` needs ${report.needs.join(', ')}` : ''}`,
  ];
  const node = (id: string, n: Report['nodes'][string], depth: string) => {
    lines.push(`${depth}${id}: ${n.status}${n.selected ? ` → ${n.selected}` : ''}${n.error ? ` -- ${n.error}` : ''}`);
    if (n.sub) lines.push(summarize(n.sub, `${depth}  `));
    for (const [i, e] of (n.items ?? []).entries()) node(`${id}.${i}`, e, `${depth}  `);
  };
  for (const [id, n] of Object.entries(report.nodes)) node(id, n, `${indent}  `);
  return lines.join('\n');
}
