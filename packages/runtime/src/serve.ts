/** wilanis start: run every plugin's postLoad, then the project's startup steps -- what listens is what those steps say. wilanis run: fire one cli trigger. */
import { createReadStream } from 'node:fs';
import { basename, extname } from 'node:path';
import type { Readable } from 'node:stream';
import { isBlobHandle, type BlobHandle, type LoadResult, type Serving, type TriggerDoc } from '@wilanis/core';
import type { Embedder } from './embed.js';
import type { Report } from '@wilanis/engine';
import { checkTree } from '@wilanis/compiler';
import { loadProject } from './project.js';
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

/**
 * A tree being served, as a listener sees it. It reads `current` on every request rather than closing over
 * one load, so `swap` can put a freshly loaded tree behind a socket that never closed -- what `@reload` does.
 */
export class Served {
  constructor(private current: { load: LoadResult; emb: Embedder }, readonly log: (s: string) => void, private readonly profile?: string) {}
  get emb() { return this.current.emb; }
  get load() { return this.current.load; }

  /**
   * Load and judge the tree again; serve it only if it is clean. What was held stays held -- the listener is
   * the same one, and its socket never closed -- so a reload swaps the tree a request is answered from, and
   * a tree that refuses leaves the last good one serving.
   */
  async reload(): Promise<{ ok: true; documents: number } | { ok: false; refusals: string }> {
    const load = await loadProject(this.load.root);
    const refusals = checkTree(load);
    if (!refusals.ok) return { ok: false, refusals: refusals.format() };
    const emb = embedderFor(load, { profile: this.profile });
    if (emb.missingSecrets.length) return { ok: false, refusals: `missing secrets: ${emb.missingSecrets.join(', ')}` };
    emb.serve(this);
    // what the old embedder held is still running and still ours: the new one answers for it when we stop
    emb.held.push(...this.emb.held);
    this.swap(load, emb);
    return { ok: true, documents: load.registry.files.length };
  }
  /** Put a newly loaded tree behind whatever is already listening. The old embedder's held things are not stopped: the listener is the same one. */
  swap(load: LoadResult, emb: Embedder) { this.current = { load, emb }; }
  /** What a `holds` operation reads as env.serving: every member goes through `current`, so a swap is seen at once. */
  serving(): Serving {
    const held = this;
    return {
      triggers: kind => held.load.registry.all('trigger').filter(t => held.load.resolve(t.doc.kind) === kind).map(t => t.doc),
      fire: ({ trigger, input, request, blobs }) => held.emb.fire(trigger, input, request, { blobs }),
      types: t => held.emb.types(t),
      inputFor: (t, r) => held.emb.inputFor(t, r),
      codecs: root => held.emb.codecsOf(root),
      get blobs() { return held.emb.blobs; },
      log: held.log,
      reload: () => held.reload(),
      get root() { return held.load.root; },
    };
  }
}

/**
 * Load a tree, run every plugin's postLoad, then run the project's startup steps -- and nothing else. What
 * listens, and whether anything listens at all, is what those steps say: a tree whose startup names no
 * `holds` operation serves nothing and this answers at once. Answers the way to stop what was held.
 */
export async function start(load: LoadResult, opts: { profile?: string; log?: (s: string) => void } = {}): Promise<{ stop: () => Promise<void>; held: number }> {
  const log = opts.log ?? ((s: string) => console.log(s));
  const emb = embedderFor(load, { profile: opts.profile });
  if (emb.missingSecrets.length) throw new Error(`missing secrets: ${emb.missingSecrets.join(', ')}`);
  const served = new Served({ load, emb }, log, opts.profile);
  emb.serve(served);
  const down = await postLoad(load, emb, log);
  const bye = async () => {
    for (const h of [...served.emb.held].reverse()) await h.stop();
    await down();
    if (emb.blobs instanceof FileBlobStore) emb.blobs.destroy();
  };
  try { await runStartup(load, emb, log); }
  catch (e) { await bye(); throw e; }
  return { stop: bye, held: emb.held.length };
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
