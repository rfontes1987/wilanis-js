/**
 * What an engine is, and how @storage finds one. An engine keeps records; it is a plugin of its own, and it
 * depends on this package for the contract while this package depends on no engine -- the arrow points the
 * way every other arrow in the workspace does.
 *
 * The seam is the hook plugins already have: an engine's `postLoad` registers itself, under the connection
 * kind it grants, in a table the environment carries. The table is created on first use by whichever side
 * reaches it first, so nothing has to be said in `project.json` about the order the plugins are named in.
 */
import type { Type } from '@wilanis/core';
import type { Where } from './where.js';

/** One record, as it is kept and as it comes back: an object of the collection's shape. */
export type Record_ = Record<string, unknown>;

/** One ordering of a find: the field, and the direction. */
export interface Order {
  by: string;
  dir?: 'asc' | 'desc';
}

/** What a find asks for beyond the collection: which records, in what order, and how much of the answer. */
export interface Query {
  where?: Where;
  order?: Order[];
  limit?: number;
  offset?: number;
}

/**
 * A collection as an engine sees it: where its records live, what it is called there, the shape they have and
 * the field that identifies one. A collection is named by the pair (connection, name), never by the store
 * document, so two features declaring the same name over one connection mean the same collection.
 */
export interface At {
  /** the connection document's canonical path */
  connection: string;
  /** the connection kind, so an engine kept per kind knows what it was reached as */
  kind: string;
  /** the connection's settings, secrets already substituted */
  settings: Record<string, unknown>;
  /** the collection's name, which is the name the records are kept under */
  name: string;
  /** the record type */
  shape: Type;
  /** the field of the shape that identifies a record */
  key: string;
}

/** What @storage asks of whoever keeps the records. No SQL, no dialect, no driver: values in, values out. */
export interface Engine {
  /** The record under that key, or `record` absent where there is none. */
  get(at: At, key: unknown): Promise<{ record?: Record_ }>;
  /** Every record the query matches, in the order it asks for. */
  find(at: At, query: Query): Promise<Record_[]>;
  /** How many records the filter matches. */
  count(at: At, where: Where | undefined): Promise<number>;
  /** Write the whole record under its own key; with `replace` false, write nothing where one is already there. */
  put(at: At, record: Record_, replace: boolean): Promise<{ record?: Record_; conflict: boolean }>;
  /** Change some fields of the record under that key, or answer `record` absent where there is none. */
  patch(at: At, key: unknown, changes: Record_): Promise<{ record?: Record_ }>;
  /** Remove the record under that key and answer it, or `record` absent where there was none. */
  remove(at: At, key: unknown): Promise<{ record?: Record_ }>;
  /** A key no record of the collection has, of the type the collection's key field declares. */
  newKey(at: At): Promise<unknown>;
  /** Create every collection that is not there yet and leave alone every one that is. */
  ensure(collections: At[]): Promise<void>;
}

/** The engines registered under one environment, by the connection kind each was registered for. */
export class Engines {
  private readonly byKind = new Map<string, Engine>();

  /** Take an engine in, under the canonical path of the connection kind its plugin grants. */
  register(kind: string, engine: Engine): void {
    this.byKind.set(kind, engine);
  }

  /** The engine registered for a connection kind, or nothing where no plugin registered one. */
  for(kind: string): Engine | undefined {
    return this.byKind.get(kind);
  }

  /** Every kind an engine registered for, so a message can say what this tree can reach. */
  get kinds(): string[] {
    return [...this.byKind.keys()];
  }
}

/** Every table in play, one per environment, so nothing is global and a reload starts clean. */
const tables = new WeakMap<object, Engines>();

/**
 * The engines of one environment, created on first use by whichever side reaches it first. @storage builds
 * nothing in its own `postLoad`, so an engine that registers before @storage is loaded finds no emptier a
 * table than one that registers after.
 */
export function engines(env: object): Engines {
  let table = tables.get(env);
  if (!table) {
    table = new Engines();
    tables.set(env, table);
  }
  return table;
}
