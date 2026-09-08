/**
 * What a plugin is to the toolchain: an alias root (@http), the directory of documents it ships (its manifest
 * plugin.json, ports, trigger kinds, connection kinds, codecs, shapes -- JSON files a reader can open, the way
 * a library ships headers), the handlers behind its native
 * operations, the runtimes behind its trigger kinds, the codecs behind its content types, and two hooks:
 * `check` for its own rules, `postLoad` for work that happens once the tree is loaded and judged.
 *
 * A plugin package exports its PluginModule as the default export; project.json names the package in
 * `plugins[].from` and the runtime imports it. @std and @cli are built into the runtime and need no `from`.
 */
import type { Handler, Report } from '@wilanis/engine';
import type { Registry, TriggerDoc } from './model.js';
import type { Scope } from './scope.js';
import type { Type } from './types.js';

export interface FireArgs {
  trigger: TriggerDoc;
  /** The decoded input, already judged against the trigger's in type. */
  input: unknown;
  /** The context this kind hands: what resolvers read as request.* */
  request: Record<string, unknown>;
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
  }): Promise<() => Promise<void>>;
  /** Encode a report the way this kind would answer, for `wilanis run` and rehearsal. */
  encode?(trigger: TriggerDoc, report: Report): unknown;
}

/** A body codec: bytes <-> value, judged against a declared type when the codec yields `declared`. */
export interface Codec {
  decode(bytes: Buffer, contentType: string, declared: Type | undefined): unknown;
  encode(value: unknown, declared: Type | undefined): { bytes: Buffer; contentType: string };
}
/** content type -> codec, as the plugin's settings table declares it. */
export type Codecs = Record<string, Codec>;

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
  /** Plugin-specific rules (X codes), run by `checkTree` after the generic ones. */
  check?(ctx: PluginCheckContext): void;
  /**
   * Runs once after the tree is loaded and checked, before any trigger starts: open connections, warm
   * caches, register parsers. May hand back a teardown, run when the runtime stops.
   */
  postLoad?(ctx: PostLoadContext): Promise<void | (() => Promise<void>)>;
}
