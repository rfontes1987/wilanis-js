/** wilanis start: run every plugin's postLoad, then the project's startup steps -- what listens is what those steps say. wilanis run: fire one cli trigger. */
import { createReadStream } from 'node:fs';
import { basename, extname } from 'node:path';
import type { Readable } from 'node:stream';
import { checkTree } from '@wilanis/compiler';
import {
  type BlobHandle,
  isBlobHandle,
  type Loaded,
  type LoadResult,
  type Serving,
  type TriggerDoc,
} from '@wilanis/core';
import type { Report } from '@wilanis/engine';
import { FileBlobStore } from './blobs.js';
import type { Embedder } from './embed.js';
import { loadProject } from './project.js';
import { embedderFor } from './tools.js';

/**
 * Run every plugin's postLoad hook in project.json order; answers a teardown that runs theirs in reverse.
 * Where one throws, what already ran is undone before the throw is passed on, so a load that does not finish
 * holds nothing.
 */
export async function postLoad(
  load: LoadResult,
  emb: Embedder,
  log: (line: string) => void,
): Promise<() => Promise<void>> {
  const downs: (() => Promise<void>)[] = [];
  const teardown = async () => {
    for (const down of [...downs].reverse()) await down();
  };
  try {
    for (const plugin of load.plugins) {
      if (!plugin.postLoad) continue;
      const settings = (emb.env.plugins as Record<string, Record<string, unknown>>)[plugin.root] ?? {};
      const down = await plugin.postLoad({
        root: load.root,
        registry: load.registry,
        scope: emb.scope,
        settings,
        env: emb.env,
        log,
      });
      if (down) downs.push(down);
    }
  } catch (error) {
    await teardown();
    throw error;
  }
  return teardown;
}

/**
 * Run the project's startup steps in order, before any trigger kind starts: each fires the domain port
 * operation it names, and the profile's binding decides how it is met. A step that refuses stops serving
 * unless it says `required: false`, in which case the refusal is logged and the rest go on.
 */
export async function runStartup(load: LoadResult, emb: Embedder, log: (line: string) => void): Promise<void> {
  const steps = load.registry.project?.doc.startup ?? [];
  for (const [at, step] of steps.entries()) {
    const name = step.label ?? step.run;
    const report = await emb.startup(step);
    if (report.status === 'done') {
      log(`startup ${at + 1}/${steps.length} ${name}: ok`);
      continue;
    }
    const why = failureOf(report);
    if (step.required === false) {
      log(`startup ${at + 1}/${steps.length} ${name}: ${why} (optional, going on)`);
      continue;
    }
    throw new Error(
      `startup step ${at} '${name}' ${why}; nothing is serving. Mark it "required": false in project.json to serve without it.`,
    );
  }
}

/** Why a report did not reach done: the first node that did not finish, and what it said. */
function failureOf(report: Report): string {
  if (report.status === 'blocked') return `is blocked, needing ${(report.needs ?? []).join(', ')}`;
  for (const [id, node] of Object.entries(report.nodes)) {
    if (node.status !== 'failed') continue;
    return node.reason ? `refused at '${id}' with '${node.reason}': ${node.error}` : `failed at '${id}': ${node.error}`;
  }
  return `did not finish (${report.status})`;
}

/**
 * A tree being served, as a listener sees it. It reads `current` on every request rather than closing over
 * one load, so `swap` can put a freshly loaded tree behind a socket that never closed -- what `@reload` does.
 */
export class Served {
  /**
   * What the plugins of the tree now being served set up in their postLoad. A reload replaces it, since the
   * tree it belongs to is the one being replaced: an engine registered against the old environment is not
   * registered against the new one, and nothing else would notice until a graph asked for it.
   */
  private down: () => Promise<void> = async () => {};

  constructor(
    private current: { load: LoadResult; emb: Embedder },
    readonly log: (line: string) => void,
    private readonly profile?: string,
  ) {}

  /** Take what the plugins of this tree set up, so a reload can replace it and stopping can undo it. */
  setDown(down: () => Promise<void>): void {
    this.down = down;
  }

  /** Undo what the plugins of the tree being served set up. */
  stopPlugins(): Promise<void> {
    return this.down();
  }
  /** The embedder of the tree being served now, so a swap is seen by whoever asks next. */
  get emb() {
    return this.current.emb;
  }
  /** The tree being served now, so a swap is seen by whoever asks next. */
  get load() {
    return this.current.load;
  }

  /**
   * Load and judge the tree again; serve it only if it is clean. What was held stays held -- the listener is
   * the same one, and its socket never closed -- so a reload swaps the tree a request is answered from, and
   * a tree that refuses leaves the last good one serving.
   */
  async reload(): Promise<{ ok: true; documents: number } | { ok: false; refusals: string }> {
    // the modules this tree was started with, so a reload serves the same plugins rather than whatever the
    // directory resolves to now: one started with a module of its own could not otherwise reload at all
    const plugins = Object.fromEntries(this.load.plugins.map(plugin => [plugin.root, plugin]));
    const load = await loadProject(this.load.root, { plugins });
    const refusals = checkTree(load);
    if (!refusals.ok) return { ok: false, refusals: refusals.format() };
    const emb = embedderFor(load, { profile: this.profile });
    if (emb.missingSecrets.length) return { ok: false, refusals: `missing secrets: ${emb.missingSecrets.join(', ')}` };
    emb.serve(this);
    // what the old embedder held is still running and still ours: the new one answers for it when we stop
    emb.held.push(...this.emb.held);
    // the new tree's plugins set themselves up before it is served, so nothing is asked of an environment
    // they have not seen; a plugin that will not start leaves the last good tree serving, as a refusal does
    let down: () => Promise<void>;
    try {
      down = await postLoad(load, emb, this.log);
    } catch (error) {
      return { ok: false, refusals: `a plugin did not load: ${(error as Error).message}` };
    }
    const before = this.down;
    this.swap(load, emb);
    this.setDown(down);
    await before();
    return { ok: true, documents: load.registry.files.length };
  }
  /** Put a newly loaded tree behind whatever is already listening. The old embedder's held things are not stopped: the listener is the same one. */
  swap(load: LoadResult, emb: Embedder) {
    this.current = { load, emb };
  }
  /** What a `holds` operation reads as env.serving: every member goes through `current`, so a swap is seen at once. */
  serving(): Serving {
    const held = this;
    return {
      triggers: kind =>
        held.load.registry
          .all('trigger')
          .filter(trigger => held.load.resolve(trigger.doc.kind) === kind)
          .map(trigger => trigger.doc),
      fire: ({ trigger, input, request, blobs }) => held.emb.fire(trigger, input, request, { blobs }),
      types: trigger => held.emb.types(trigger),
      inputFor: (trigger, request) => held.emb.inputFor(trigger, request),
      codecs: root => held.emb.codecsOf(root),
      get blobs() {
        return held.emb.blobs;
      },
      log: held.log,
      reload: () => held.reload(),
      get root() {
        return held.load.root;
      },
    };
  }
}

/**
 * Load a tree, run every plugin's postLoad, then run the project's startup steps -- and nothing else. What
 * listens, and whether anything listens at all, is what those steps say: a tree whose startup names no
 * `holds` operation serves nothing and this answers at once. Answers the way to stop what was held.
 */
export async function start(
  load: LoadResult,
  opts: { profile?: string; log?: (line: string) => void } = {},
): Promise<{ stop: () => Promise<void>; held: number }> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const emb = embedderFor(load, { profile: opts.profile });
  if (emb.missingSecrets.length) throw new Error(`missing secrets: ${emb.missingSecrets.join(', ')}`);
  const served = new Served({ load, emb }, log, opts.profile);
  emb.serve(served);
  served.setDown(await postLoad(load, emb, log));
  const bye = async () => {
    for (const holding of [...served.emb.held].reverse()) await holding.stop();
    await served.stopPlugins();
    if (emb.blobs instanceof FileBlobStore) emb.blobs.destroy();
  };
  try {
    await runStartup(load, emb, log);
  } catch (error) {
    await bye();
    throw error;
  }
  return { stop: bye, held: emb.held.length };
}

/** The content type a file on disk is taken to have, by its extension; anything else is a stream of bytes. */
const BY_EXTENSION: Record<string, string> = {
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.xml': 'application/xml',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.zip': 'application/zip',
};
/** The content type a file on disk is taken to have, read off its extension; anything unknown is a stream of bytes. */
export const contentTypeOf = (file: string) => BY_EXTENSION[extname(file).toLowerCase()] ?? 'application/octet-stream';

/** What a run answers: what the trigger kind's runtime encodes, or the report's own output. */
function encoded(load: LoadResult, trigger: Loaded<TriggerDoc>, report: Report) {
  const runtime = load.plugins
    .flatMap(plugin => Object.entries(plugin.triggers ?? {}))
    .find(([kind]) => kind === load.resolve(trigger.doc.kind))?.[1];
  return runtime?.encode ? runtime.encode(trigger.doc, report) : report.output;
}

/** What a command line hands a trigger: its flags and arguments, a body from --in, and a file streamed into the registry. */
async function requestOf(
  flags: Record<string, string>,
  args: string[],
  blobs: { put: (source: Readable, meta: { contentType: string; filename: string }) => Promise<BlobHandle> },
): Promise<Record<string, unknown>> {
  const request: Record<string, unknown> = { flags, args, cwd: process.cwd() };
  if (flags.in !== undefined) request.body = JSON.parse(flags.in);
  if (flags.file !== undefined)
    request.file = await blobs.put(createReadStream(flags.file), {
      contentType: contentTypeOf(flags.file),
      filename: basename(flags.file),
    });
  return request;
}

/**
 * Fire a trigger from the command line with a context built from flags and args. A real run (no seed)
 * runs postLoad first and its teardown after; a seeded run stubs every effect and skips the hooks. `--file`
 * streams a file into the blob registry and hands its handle as request.file; a blob answer is streamed to
 * `--out`, or to stdout, by `deliver`. The run's blobs are released once delivered.
 */
export async function runTrigger(
  load: LoadResult,
  ref: string,
  given: { flags?: Record<string, string>; args?: string[] } = {},
  opts: {
    profile?: string;
    seed?: number;
    log?: (line: string) => void;
    deliver?: (body: Readable, handle: BlobHandle) => Promise<void>;
  } = {},
) {
  const flags = given.flags ?? {};
  const args = given.args ?? [];
  const found = load.registry.get('trigger', load.resolve(ref));
  if (!found) throw new Error(`no trigger at '${ref}'`);
  const emb = embedderFor(load, { profile: opts.profile, seed: opts.seed });
  const down =
    opts.seed === undefined
      ? await postLoad(load, emb, opts.log ?? ((line: string) => console.error(line)))
      : async () => {};
  const blobs = emb.blobs.scope();
  try {
    const request = await requestOf(flags, args, blobs);
    const built = emb.inputFor(found.doc, request);
    if ('error' in built) throw new Error(`input: ${built.error}`);
    const report = await emb.fire(found.doc, built.input, request, { blobs });
    const answer = encoded(load, found, report);
    if (isBlobHandle(answer) && opts.deliver) await opts.deliver(blobs.open(answer), answer);
    return { report, answer };
  } finally {
    await blobs.release();
    await down();
    if (emb.blobs instanceof FileBlobStore) emb.blobs.destroy();
  }
}
