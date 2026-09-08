/**
 * What a plugin is to the toolchain: an alias root (@http), the directory of documents it ships (its manifest
 * plugin.json, ports, trigger kinds, connection kinds, codecs, shapes -- JSON files a reader can open, the way
 * a library ships headers), the handlers behind its native
 * operations, the runtimes behind its trigger kinds, the codecs behind its content types, and two hooks:
 * `check` for its own rules, `postLoad` for work that happens once the tree is loaded and judged -- and, for the one
 * plugin that identifies callers, a `guard`.
 *
 * A plugin package exports its PluginModule as the default export; project.json names the package in
 * `plugins[].from` and the runtime imports it. @std and @cli are built into the runtime and need no `from`.
 */
import type { Readable } from 'node:stream';
import type { Handler, Report } from '@wilanis/engine';
import type { Registry, TriggerDoc } from './model.js';
import type { Scope } from './scope.js';
import type { BlobHandle, Type } from './types.js';

/**
 * The blob registry: where the bytes of a `blob` value live, so that a file is held once, on disk, and never
 * as a value. A codec streams an uploaded body in and answers the handle; an operation streams a handle out
 * to read it, or streams bytes in to answer a new one; a codec streams the answer to the caller. The engine
 * only ever carries handles. The runtime owns the one store of a tree.
 */
export interface BlobStore {
  /** Store what the source yields, as it yields it; answers the handle a graph carries once the source has ended. */
  put(source: Readable | Buffer | string, meta: { contentType: string; filename?: string }): Promise<BlobHandle>;
  /** The bytes behind a handle, as a stream. Fails when the handle names nothing this store holds. */
  open(handle: BlobHandle): Readable;
  /** Forget a handle and its bytes. */
  drop(handle: BlobHandle): Promise<void>;
  /** A scope of this store: what is put through it is dropped by `release`, so a run's blobs end with the run. */
  scope(): BlobScope;
}
export interface BlobScope extends BlobStore { release(): Promise<void> }

/**
 * What a `holds` operation is given, as `env.hold`: it hands back the way to stop what it started, and the
 * runtime keeps the process alive until every held thing has been stopped, in reverse. A handler that does
 * not hold anything never sees it; a `holds` operation that never calls it holds nothing and the run ends.
 */
export type Hold = (what: { label: string; stop: () => Promise<void> }) => void;

/**
 * What a `holds` operation that answers requests is given, as `env.serving`: the triggers of one kind and
 * the way to fire them. It is read afresh on every request, so a reload can replace the tree underneath a
 * listener whose socket stays open -- the listener holds this object, never the tree it came from.
 */
export interface Serving {
  /** Every trigger of one kind in the tree as it now stands. */
  triggers(kind: string): TriggerDoc[];
  /** Run a trigger's operation and answer its report. */
  fire(args: FireArgs): Promise<Report>;
  /** The trigger's in/out types, resolved. */
  types(t: TriggerDoc): { in?: Type; out?: Type };
  /** Build and judge the trigger's input from the context this kind assembled (body already decoded). */
  inputFor(t: TriggerDoc, request: Record<string, unknown>): { input: unknown } | { error: string };
  /** content type -> codec, from a plugin's settings table. */
  codecs(root: string): Codecs;
  /** The tree's blob registry; a listener opens a scope per request and releases it once it has answered. */
  blobs: BlobStore;
  log(s: string): void;
  /**
   * Load and judge the tree again, and serve it if it is clean. The runtime does the loading and the judging
   * -- a plugin never imports the compiler -- so a watcher only decides *when*. A tree that refuses is not
   * served: the refusals come back and whatever is already listening keeps answering from the last good one.
   */
  reload(): Promise<{ ok: true; documents: number } | { ok: false; refusals: string }>;
  /** The directory of the tree being served, for a watcher that has to know what to watch. */
  root: string;
}

/** The whole of a stream, for a codec that needs the body entire (JSON, text, a form). A blob codec never calls this. */
export async function readAll(source: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of source) chunks.push(typeof c === 'string' ? Buffer.from(c) : (c as Buffer));
  return Buffer.concat(chunks);
}

export interface FireArgs {
  trigger: TriggerDoc;
  /** The decoded input, already judged against the trigger's in type. */
  input: unknown;
  /** The context this kind hands: what resolvers read as request.* */
  request: Record<string, unknown>;
  /** The blob scope of this run: what the graph stores through it is released when the kind has answered. */
  blobs?: BlobStore;
}

export interface TriggerRuntime {
  /** Start every trigger of this kind; `fire` runs the graph and answers its report. Answers a stop function. */
  start(triggers: TriggerDoc[], fire: (args: FireArgs) => Promise<Report>, opts: {
    settings: Record<string, unknown>; registry: Registry; log: (s: string) => void;
    /** The trigger's in/out types, resolved. */
    types: (t: TriggerDoc) => { in?: Type; out?: Type };
    /** Build and judge the trigger's input from the context this kind assembled (body already decoded). */
    inputFor: (t: TriggerDoc, request: Record<string, unknown>) => { input: unknown } | { error: string };
    /** content type -> codec, from this plugin's settings table. */
    codecs: Codecs;
    /** The tree's blob registry; a kind opens a scope per run and releases it once it has answered. */
    blobs: BlobStore;
  }): Promise<() => Promise<void>>;
  /** Encode a report the way this kind would answer, for `wilanis run` and rehearsal. */
  encode?(trigger: TriggerDoc, report: Report): unknown;
}

/**
 * A body codec: a body stream <-> a value, judged against a declared type when the codec yields `declared`.
 * A codec that yields `blob` streams the body into the registry and answers the handle, and streams a
 * handle's bytes back out; every other codec reads the body whole and ignores the store.
 */
export interface Encoded {
  /** The answer's bytes: a stream (a blob, read from the registry) or a buffer (a value, encoded). */
  body: Readable | Buffer;
  contentType: string;
  /** The stream's length when known, so the caller can say so up front. */
  length?: number;
  headers?: Record<string, string>;
}
export interface Codec {
  decode(body: Readable, contentType: string, declared: Type | undefined, blobs: BlobStore): unknown | Promise<unknown>;
  encode(value: unknown, declared: Type | undefined, blobs: BlobStore): Encoded | Promise<Encoded>;
}
/** content type -> codec, as the plugin's settings table declares it. */
export type Codecs = Record<string, Codec>;

/** What a guard is handed on every fire of a trigger that attaches a policy. */
export interface GuardArgs {
  trigger: TriggerDoc;
  /** The trigger kind, canonical. */
  kind: string;
  /** The kind's context as assembled so far; what `identify` answers is added to it. */
  request: Record<string, unknown>;
  /** The credentials the trigger's policy attachments gave, by the names the guard's plugin.json declares, read from the context; absent when the request carried none. */
  credentials: Record<string, unknown>;
  /** The same, as written on the trigger: the {{request.*}} reads, so the guard can tell a caller where to present an answer. */
  reads: Record<string, unknown>;
  /** The guarding plugin's settings from project.json, secrets substituted. */
  settings: Record<string, unknown>;
  env: Record<string, unknown>;
}
/**
 * The one plugin that identifies callers. The runtime calls it around every fire of a gated trigger, for every
 * trigger kind alike: `identify` before any policy, `challenge` when a policy's outcome asks for one, `settle`
 * after the run. Validating a credential lives here and nowhere else; what a verified caller may do is the
 * policies' decision. Its `plugin.json` declares `guard`: the context it adds and the reasons it refuses with.
 */
export interface Guard {
  /**
   * Verify the credentials the trigger gave and answer what the context gains: request.principal, request.session,
   * request.challenge. A credential that is there and does not verify is refused here with one of the plugin's
   * declared reasons; an absent one is not -- the caller is anonymous and the policies decide.
   */
  identify(a: GuardArgs): Promise<{ context: Record<string, unknown> } | { refuse: { reason: string; message: string; detail?: Record<string, unknown> } }>;
  /** Open a challenge a policy outcome asked for; answers what the caller is told, and the detail (its id, how to answer) that rides with the refusal. */
  challenge(a: GuardArgs & { policy: string; reason: string; message: string; method?: string }): Promise<{ message: string; detail: Record<string, unknown> }>;
  /** After the trigger's operation ran: consume what was single-use, stamp what was proven. */
  settle?(a: GuardArgs & { report: Report }): Promise<void>;
}

/** What a plugin's `check` sees: the resolved tree, its own settings, and the way to refuse. */
export interface PluginCheckContext {
  scope: Scope;
  settings: Record<string, unknown>;
  refuse: (code: string, file: string, message: string, at?: string, hint?: string) => void;
}

/** What a plugin's `postLoad` sees. */
export interface PostLoadContext {
  /** The project directory. */
  root: string;
  registry: Registry;
  scope: Scope;
  /** This plugin's settings from project.json, secrets substituted. */
  settings: Record<string, unknown>;
  /** The environment handlers see: connections, plugins, canon, resolveType. */
  env: Record<string, unknown>;
  log: (s: string) => void;
}

export interface PluginModule {
  /** The alias root, e.g. '@http'. */
  root: string;
  /**
   * The directory of the documents this plugin ships. Every *.json under it is loaded as `${root}/<relative path>`
   * and judged like any tree document; it must hold plugin.json. Absolute, so a package points it at itself:
   * fileURLToPath(new URL('../docs', import.meta.url)).
   */
  docs: string;
  /** 'path#operation' -> handler */
  handlers: Record<string, Handler>;
  /** trigger-kind path -> runtime */
  triggers?: Record<string, TriggerRuntime>;
  /** codec path -> implementation */
  codecs?: Record<string, Codec>;
  /** Identifies callers and opens challenges; at most one plugin of a tree has one, and its plugin.json declares `guard`. */
  guard?: Guard;
  /** Plugin-specific rules (X codes), run by `checkTree` after the generic ones. */
  check?(ctx: PluginCheckContext): void;
  /**
   * Runs once after the tree is loaded and checked, before any trigger starts: open connections, warm
   * caches, register parsers. May hand back a teardown, run when the runtime stops.
   */
  postLoad?(ctx: PostLoadContext): Promise<void | (() => Promise<void>)>;
}
