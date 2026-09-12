/**
 * The eight operations, each the same three steps: read the collection off the store document, find the engine
 * registered for its connection's kind, and ask it. Nothing here knows how records are kept, and nothing here
 * decides what a filter may say -- the grammar is parsed in `where.ts` so every engine judges one alike.
 */
import type { Handler } from '@wilanis/engine';
import type { At, Engine, Order, Query } from './engine.js';
import { collectionAt, collectionsOf, engineFor } from './store.js';
import { whereOf } from './where.js';

type Input = Record<string, unknown>;
type Ctx = { env: Record<string, unknown> };

/** What every operation starts from: the collection it names, and whoever keeps it. */
function at(input: Input, ctx: Ctx): { at: At; engine: Engine } {
  const collection = collectionAt(ctx.env, input.store, input.collection);
  return { at: collection, engine: engineFor(ctx.env, collection) };
}

/** The orderings a find asks for, held to the one shape they may have. */
function orderOf(given: unknown): Order[] | undefined {
  if (given === undefined || given === null) return undefined;
  if (!Array.isArray(given)) throw new Error('order: a list of { by, dir }');
  return given.map(one => {
    const entry = (one ?? {}) as Partial<Order>;
    if (typeof entry.by !== 'string') throw new Error("order: every entry names the field it orders 'by'");
    return { by: entry.by, dir: entry.dir === 'desc' ? 'desc' : 'asc' };
  });
}

/** How much of the answer a find takes: a count, a skip, or neither. */
function countOf(given: unknown, name: string): number | undefined {
  if (given === undefined || given === null) return undefined;
  if (typeof given !== 'number' || !Number.isInteger(given) || given < 0)
    throw new Error(`${name}: a whole number of records, or nothing`);
  return given;
}

/** An object a write is given, held to being one before it reaches an engine. */
function objectOf(given: unknown, name: string): Record<string, unknown> {
  if (!given || typeof given !== 'object' || Array.isArray(given)) throw new Error(`${name}: an object`);
  return given as Record<string, unknown>;
}

const get: Handler = async ({ in: input, ctx }) => {
  const { at: where, engine } = at(input, ctx);
  return engine.get(where, input.key);
};

const find: Handler = async ({ in: input, ctx }) => {
  const { at: where, engine } = at(input, ctx);
  const query: Query = {
    where: whereOf(input.where, where.shape),
    order: orderOf(input.order),
    limit: countOf(input.limit, 'limit'),
    offset: countOf(input.offset, 'offset'),
  };
  return engine.find(where, query);
};

const count: Handler = async ({ in: input, ctx }) => {
  const { at: where, engine } = at(input, ctx);
  return engine.count(where, whereOf(input.where, where.shape));
};

const put: Handler = async ({ in: input, ctx }) => {
  const { at: where, engine } = at(input, ctx);
  return engine.put(where, objectOf(input.record, 'record'), input.replace !== false);
};

const patch: Handler = async ({ in: input, ctx }) => {
  const { at: where, engine } = at(input, ctx);
  const changes = objectOf(input.changes, 'changes');
  if (where.key in changes)
    throw new Error(`patch: '${where.key}' is the key of this collection, and a key is never patched`);
  return engine.patch(where, input.key, changes);
};

const remove: Handler = async ({ in: input, ctx }) => {
  const { at: where, engine } = at(input, ctx);
  return engine.remove(where, input.key);
};

const newKey: Handler = async ({ in: input, ctx }) => {
  const { at: where, engine } = at(input, ctx);
  return engine.newKey(where);
};

const ensure: Handler = async ({ in: input, ctx }) => {
  const collections = collectionsOf(ctx.env, input.store);
  if (collections.length) await engineFor(ctx.env, collections[0]).ensure(collections);
  return { collections: collections.length };
};

/** Every operation this plugin grants, by the path#operation a graph names. */
export const handlers: Record<string, Handler> = {
  '@storage/store.port.json#get': get,
  '@storage/store.port.json#find': find,
  '@storage/store.port.json#count': count,
  '@storage/store.port.json#put': put,
  '@storage/store.port.json#patch': patch,
  '@storage/store.port.json#remove': remove,
  '@storage/store.port.json#newKey': newKey,
  '@storage/storage.port.json#ensure': ensure,
};
