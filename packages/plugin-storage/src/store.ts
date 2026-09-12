/**
 * Reading a store document from the environment a handler is given. A call site names the store and the
 * collection; everything else -- the connection, its kind and settings, the record's shape, the field that
 * identifies one -- is read from documents the tree already holds, the way @http reads a connection.
 */
import type { Resolves } from '@wilanis/core';
import type { At, Engine } from './engine.js';
import { engines } from './engine.js';

type Connection = { kind: string; settings: Record<string, unknown> };

/** The environment a handler reads: what the runtime built for the tree it is running. */
interface Env {
  canon?: (ref: string) => string;
  connections?: Record<string, Connection>;
  resolving?: Resolves;
}

/** One collection as a store document declares it. */
interface Declared {
  of: string;
  key: string;
}
interface StoreDocument {
  connection: string;
  collections: Record<string, Declared>;
}

const canonOf = (env: Record<string, unknown>) => (env as Env).canon ?? ((ref: string) => ref);

/** The store document a call names, or the reason it is not one this tree holds. */
function documentOf(env: Record<string, unknown>, named: unknown): StoreDocument {
  const resolving = (env as Env).resolving;
  if (!resolving) throw new Error('no tree in this environment to read a store from');
  const doc = resolving.document(String(named));
  if (!doc || typeof doc !== 'object') throw new Error(`unknown store '${named}'`);
  const store = doc as Partial<StoreDocument>;
  if (!store.connection || !store.collections) throw new Error(`'${named}' is not a store document`);
  return store as StoreDocument;
}

/** The connection a store sits on, with its kind canonicalised and its secrets already substituted. */
function connectionOf(env: Record<string, unknown>, store: StoreDocument): { path: string; conn: Connection } {
  const path = canonOf(env)(store.connection);
  const conn = (env as Env).connections?.[path];
  if (!conn) throw new Error(`unknown connection '${store.connection}'`);
  return { path, conn };
}

/** One collection of a store, as the engine sees it: where it lives, what it is called, its shape and its key. */
export function collectionAt(env: Record<string, unknown>, named: unknown, name: unknown): At {
  const store = documentOf(env, named);
  const declared = store.collections[String(name)];
  if (!declared) {
    const names = Object.keys(store.collections).join(', ') || 'none';
    throw new Error(`store '${named}' has no collection '${name}' (collections: ${names})`);
  }
  const { path, conn } = connectionOf(env, store);
  const resolving = (env as Env).resolving;
  if (!resolving) throw new Error('no tree in this environment to read a shape from');
  return {
    connection: path,
    kind: conn.kind,
    settings: conn.settings,
    name: String(name),
    shape: resolving.type(declared.of),
    key: declared.key,
  };
}

/** Every collection of a store, in the order it declares them: what `ensure` is given. */
export function collectionsOf(env: Record<string, unknown>, named: unknown): At[] {
  const store = documentOf(env, named);
  return Object.keys(store.collections).map(name => collectionAt(env, named, name));
}

/**
 * The engine that keeps these records: the one registered for the connection's kind. Where none is, the tree
 * names no plugin that grants that kind an engine -- which X203 refuses before anything runs, so this message
 * is for a plugin that failed to load rather than for a tree that is wrong.
 */
export function engineFor(env: Record<string, unknown>, at: At): Engine {
  const engine = engines(env).for(at.kind);
  if (engine) return engine;
  const registered = engines(env).kinds.join(', ') || 'none';
  throw new Error(
    `no storage engine for connection kind '${at.kind}': add the package that grants it to project.json -> plugins (registered: ${registered})`,
  );
}
