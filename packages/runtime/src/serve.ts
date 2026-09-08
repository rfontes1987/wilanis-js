/** wilanis serve: run every plugin's postLoad, then start every trigger kind the tree uses. wilanis run: fire one cli trigger. */
import type { LoadResult, TriggerDoc } from '@wilanis/core';
import type { Embedder } from './embed.js';
import { embedderFor } from './tools.js';

/** Run every plugin's postLoad hook in project.json order; answers a teardown that runs theirs in reverse. */
export async function postLoad(load: LoadResult, emb: Embedder, log: (s: string) => void): Promise<() => Promise<void>> {
  const downs: (() => Promise<void>)[] = [];
  for (const p of load.plugins) {
    if (!p.postLoad) continue;
    const settings = (emb.env.plugins as Record<string, Record<string, unknown>>)[p.root] ?? {};
    const down = await p.postLoad({ root: load.root, registry: load.registry, scope: emb.scope, settings, env: emb.env, log });
    if (down) downs.push(down);
  }
  return async () => { for (const d of downs.reverse()) await d(); };
}

export async function serve(load: LoadResult, opts: { profile?: string; log?: (s: string) => void } = {}): Promise<() => Promise<void>> {
  const log = opts.log ?? ((s: string) => console.log(s));
  const emb = embedderFor(load, { profile: opts.profile });
  if (emb.missingSecrets.length) throw new Error(`missing secrets: ${emb.missingSecrets.join(', ')}`);
  const down = await postLoad(load, emb, log);
  const stops: (() => Promise<void>)[] = [];
  const byKind = new Map<string, TriggerDoc[]>();
  for (const t of load.registry.all('trigger')) { const k = load.resolve(t.doc.kind); byKind.set(k, [...(byKind.get(k) ?? []), t.doc]); }
  for (const p of load.plugins) {
    for (const [kindPath, runtime] of Object.entries(p.triggers ?? {})) {
      const triggers = byKind.get(kindPath) ?? [];
      if (!triggers.length) continue;
      const settings = (emb.env.plugins as Record<string, Record<string, unknown>>)[p.root] ?? {};
      stops.push(await runtime.start(triggers, ({ trigger, input, request }) => emb.fire(trigger, input, request), {
        settings, registry: load.registry, log, types: t => emb.types(t), inputFor: (t, r) => emb.inputFor(t, r), codecs: emb.codecsOf(p.root),
      }));
    }
  }
  return async () => { for (const s of stops) await s(); await down(); };
}

/**
 * Fire a trigger from the command line with a context built from flags and args. A real run (no seed)
 * runs postLoad first and its teardown after; a seeded run stubs every effect and skips the hooks.
 */
export async function runTrigger(load: LoadResult, ref: string, flags: Record<string, string>, args: string[], opts: { profile?: string; seed?: number; log?: (s: string) => void } = {}) {
  const t = load.registry.get('trigger', load.resolve(ref));
  if (!t) throw new Error(`no trigger at '${ref}'`);
  const emb = embedderFor(load, { profile: opts.profile, seed: opts.seed });
  const down = opts.seed === undefined ? await postLoad(load, emb, opts.log ?? ((s: string) => console.error(s))) : async () => {};
  try {
    const request: Record<string, unknown> = { flags, args, cwd: process.cwd() };
    if (flags.in !== undefined) request.body = JSON.parse(flags.in);
    const built = emb.inputFor(t.doc, request);
    if ('error' in built) throw new Error(`input: ${built.error}`);
    const report = await emb.fire(t.doc, built.input, request);
    const runtime = load.plugins.flatMap(p => Object.entries(p.triggers ?? {})).find(([k]) => k === load.resolve(t.doc.kind))?.[1];
    return { report, answer: runtime?.encode ? runtime.encode(t.doc, report) : report.output };
  } finally { await down(); }
}
