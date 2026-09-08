/**
 * What a plugin is to the toolchain: an alias root (@http), its documents by path (its manifest at
 * @http/plugin.json, ports, trigger kinds, connection kinds, codecs), the handlers behind its native
 * operations, the runtimes behind its trigger kinds, and the codecs behind its content types.
 */
import type { AnyDoc, Registry, TriggerDoc } from '../model.js';
import type { Handler, Report } from '../kernel/spec.js';
import type { Type } from '../types/type.js';

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

export interface PluginModule {
  /** The alias root, e.g. '@http'. */
  root: string;
  /** Every document this plugin ships, by canonical path. Must include `${root}/plugin.json`. */
  docs: Record<string, AnyDoc>;
  /** 'path#operation' -> handler */
  handlers: Record<string, Handler>;
  /** trigger-kind path -> runtime */
  triggers?: Record<string, TriggerRuntime>;
  /** codec path -> implementation */
  codecs?: Record<string, Codec>;
}
