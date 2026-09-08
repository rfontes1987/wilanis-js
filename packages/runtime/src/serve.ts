/** wilanis serve: run every plugin's postLoad, then the project's startup steps, then start every trigger kind the tree uses. wilanis run: fire one cli trigger. */
import { createReadStream } from 'node:fs';
import { basename, extname } from 'node:path';
import type { Readable } from 'node:stream';
import { isBlobHandle, type BlobHandle, type LoadResult, type TriggerDoc } from '@wilanis/core';
import type { Embedder } from './embed.js';
import type { Report } from '@wilanis/engine';
import { embedderFor } from './tools.js';
import { FileBlobStore } from './blobs.js';

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

/**
 * Run the project's startup steps in order, before any trigger kind starts: each fires the domain port
 * operation it names, and the profile's binding decides how it is met. A step that refuses stops serving
 * unless it says `required: false`, in which case the refusal is logged and the rest go on.
 */
export async function runStartup(load: LoadResult, emb: Embedder, log: (s: string) => void): Promise<void> {
  const steps = load.registry.project?.doc.startup ?? [];
  for (const [i, step] of steps.entries()) {
    const name = step.label ?? step.run;
    const report = await emb.startup(step);
    if (report.status === 'done') { log(`startup ${i + 1}/${steps.length} ${name}: ok`); continue; }
    const why = failureOf(report);
    if (step.required === false) { log(`startup ${i + 1}/${steps.length} ${name}: ${why} (optional, going on)`); continue; }
    throw new Error(`startup step ${i} '${name}' ${why}; nothing is serving. Mark it "required": false in project.json to serve without it.`);
  }
}

/** Why a report did not reach done: the first node that did not finish, and what it said. */
function failureOf(report: Report): string {
  if (report.status === 'blocked') return `is blocked, needing ${(report.needs ?? []).join(', ')}`;
  for (const [id, n] of Object.entries(report.nodes)) {
    if (n.status !== 'failed') continue;
    return n.reason ? `refused at '${id}' with '${n.reason}': ${n.error}` : `failed at '${id}': ${n.error}`;
  }
  return `did not finish (${report.status})`;
}

export async function serve(load: LoadResult, opts: { profile?: string; log?: (s: string) => void } = {}): Promise<() => Promise<void>> {
  const log = opts.log ?? ((s: string) => console.log(s));
  const emb = embedderFor(load, { profile: opts.profile });
  if (emb.missingSecrets.length) throw new Error(`missing secrets: ${emb.missingSecrets.join(', ')}`);
  const down = await postLoad(load, emb, log);
  try { await runStartup(load, emb, log); }
  catch (e) { await down(); if (emb.blobs instanceof FileBlobStore) emb.blobs.destroy(); throw e; }
  const stops: (() => Promise<void>)[] = [];
  const byKind = new Map<string, TriggerDoc[]>();
  for (const t of load.registry.all('trigger')) { const k = load.resolve(t.doc.kind); byKind.set(k, [...(byKind.get(k) ?? []), t.doc]); }
  for (const p of load.plugins) {
    for (const [kindPath, runtime] of Object.entries(p.triggers ?? {})) {
      const triggers = byKind.get(kindPath) ?? [];
      if (!triggers.length) continue;
      const settings = (emb.env.plugins as Record<string, Record<string, unknown>>)[p.root] ?? {};
      stops.push(await runtime.start(triggers, ({ trigger, input, request, blobs }) => emb.fire(trigger, input, request, { blobs }), {
        settings, registry: load.registry, log, types: t => emb.types(t), inputFor: (t, r) => emb.inputFor(t, r), codecs: emb.codecsOf(p.root), blobs: emb.blobs,
      }));
    }
  }
  return async () => { for (const s of stops) await s(); await down(); if (emb.blobs instanceof FileBlobStore) emb.blobs.destroy(); };
}

/** The content type a file on disk is taken to have, by its extension; anything else is a stream of bytes. */
const BY_EXTENSION: Record<string, string> = { '.csv': 'text/csv', '.json': 'application/json', '.txt': 'text/plain', '.md': 'text/markdown', '.html': 'text/html', '.xml': 'application/xml', '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.zip': 'application/zip' };
export const contentTypeOf = (file: string) => BY_EXTENSION[extname(file).toLowerCase()] ?? 'application/octet-stream';

/**
 * Fire a trigger from the command line with a context built from flags and args. A real run (no seed)
 * runs postLoad first and its teardown after; a seeded run stubs every effect and skips the hooks. `--file`
 * streams a file into the blob registry and hands its handle as request.file; a blob answer is streamed to
 * `--out`, or to stdout, by `deliver`. The run's blobs are released once delivered.
 */
export async function runTrigger(load: LoadResult, ref: string, flags: Record<string, string>, args: string[], opts: { profile?: string; seed?: number; log?: (s: string) => void; deliver?: (body: Readable, handle: BlobHandle) => Promise<void> } = {}) {
  const t = load.registry.get('trigger', load.resolve(ref));
  if (!t) throw new Error(`no trigger at '${ref}'`);
  const emb = embedderFor(load, { profile: opts.profile, seed: opts.seed });
  const down = opts.seed === undefined ? await postLoad(load, emb, opts.log ?? ((s: string) => console.error(s))) : async () => {};
  const blobs = emb.blobs.scope();
  try {
    const request: Record<string, unknown> = { flags, args, cwd: process.cwd() };
    if (flags.in !== undefined) request.body = JSON.parse(flags.in);
    if (flags.file !== undefined) request.file = await blobs.put(createReadStream(flags.file), { contentType: contentTypeOf(flags.file), filename: basename(flags.file) });
    const built = emb.inputFor(t.doc, request);
    if ('error' in built) throw new Error(`input: ${built.error}`);
    const report = await emb.fire(t.doc, built.input, request, { blobs });
    const runtime = load.plugins.flatMap(p => Object.entries(p.triggers ?? {})).find(([k]) => k === load.resolve(t.doc.kind))?.[1];
    const answer = runtime?.encode ? runtime.encode(t.doc, report) : report.output;
    if (isBlobHandle(answer) && opts.deliver) await opts.deliver(blobs.open(answer), answer);
    return { report, answer };
  } finally { await blobs.release(); await down(); if (emb.blobs instanceof FileBlobStore) emb.blobs.destroy(); }
}
