/**
 * The operations, driven the way the kernel drives them: a store document read off the environment, the
 * collection found in it, and the engine registered for its connection's kind asked. What is tested here is
 * the three steps every handler takes -- not how records are kept, which is the engine's and the suite's.
 */
import { type Type, TypeResolver } from '@wilanis/core';
import { MemoryEngine } from '@wilanis/plugin-storage-memory';
import { beforeEach, describe, expect, it } from 'vitest';
import plugin, { engines } from '../src/index.js';

const KIND = '@fake/fake.connection-kind.json';
const CONNECTION = '@connections/records.connection.json';
const STORE = '@features/monitor/data/entries.store.json';
const SHAPE = '@features/monitor/domain/Entry.shape.json';

const types = new TypeResolver(() => undefined);
const ENTRY: Type = types.inline({
  fields: { id: { type: 'string' }, url: { type: 'string' }, hits: { type: 'number' } },
});

const storeDoc = {
  connection: CONNECTION,
  collections: {
    entries: { of: SHAPE, key: 'id' },
    notes: { of: SHAPE, key: 'id' },
  },
};

let env: Record<string, unknown>;
const ctx = () => ({ env, nodePath: [], attach: () => {} }) as never;
const run = (op: string, input: Record<string, unknown>) =>
  plugin.handlers[op]({ in: input, ctx: ctx() } as never) as Promise<Record<string, unknown>>;
const on = (extra: Record<string, unknown> = {}) => ({ store: STORE, collection: 'entries', ...extra });

beforeEach(() => {
  env = {
    canon: (ref: string) => ref,
    connections: { [CONNECTION]: { kind: KIND, settings: {} } },
    resolving: {
      document: (ref: string) => (ref === STORE ? storeDoc : undefined),
      type: (ref: string) => {
        if (ref === SHAPE) return ENTRY;
        throw new Error(`unknown type '${ref}'`);
      },
    },
  };
  engines(env).register(KIND, new MemoryEngine());
});

describe('what an operation reads off the tree', () => {
  it('a record written under one collection is read back from it', async () => {
    const record = { id: '1', url: 'https://x', hits: 2 };
    expect(await run('@storage/store.port.json#put', on({ record }))).toEqual({ record, conflict: false });
    expect(await run('@storage/store.port.json#get', on({ key: '1' }))).toEqual({ record });
    expect(await run('@storage/store.port.json#count', on({}))).toBe(1);
  });

  it('the collection is the pair of connection and name, so two of one store do not share records', async () => {
    await run('@storage/store.port.json#put', on({ record: { id: '1', url: 'https://x', hits: 2 } }));
    expect(await run('@storage/store.port.json#count', { store: STORE, collection: 'notes' })).toBe(0);
  });

  it('ensure prepares every collection the store declares, and says how many', async () => {
    expect(await run('@storage/storage.port.json#ensure', { store: STORE })).toEqual({ collections: 2 });
  });

  it('newKey answers a key the collection does not hold', async () => {
    const key = await run('@storage/store.port.json#newKey', on({}));
    expect(await run('@storage/store.port.json#get', on({ key }))).toEqual({ record: undefined });
  });
});

describe('what an operation refuses before it reaches an engine', () => {
  it('a store the tree does not hold, and a collection the store does not declare', async () => {
    await expect(run('@storage/store.port.json#get', { store: '@nope.store.json', key: '1' })).rejects.toThrow(
      /unknown store '@nope.store.json'/,
    );
    await expect(run('@storage/store.port.json#get', { store: STORE, collection: 'nope', key: '1' })).rejects.toThrow(
      /has no collection 'nope' \(collections: entries, notes\)/,
    );
  });

  it('a filter naming a field the collection shape lacks, judged by the grammar and not by the engine', async () => {
    await expect(run('@storage/store.port.json#find', on({ where: { nope: 1 } }))).rejects.toThrow(
      /'nope' is not a field of the collection's shape/,
    );
  });

  it('a patch of the key, since a key is never patched', async () => {
    await expect(run('@storage/store.port.json#patch', on({ key: '1', changes: { id: 'other' } }))).rejects.toThrow(
      /'id' is the key of this collection, and a key is never patched/,
    );
  });

  it('an order or a page that is not one', async () => {
    await expect(run('@storage/store.port.json#find', on({ order: [{ dir: 'asc' }] }))).rejects.toThrow(
      /every entry names the field it orders 'by'/,
    );
    await expect(run('@storage/store.port.json#find', on({ limit: -1 }))).rejects.toThrow(/limit: a whole number/);
  });

  it('a connection kind no loaded plugin registered an engine for, naming what to add', async () => {
    env.connections = { [CONNECTION]: { kind: '@other/other.connection-kind.json', settings: {} } };
    await expect(run('@storage/store.port.json#count', on({}))).rejects.toThrow(
      /no storage engine for connection kind '@other\/other.connection-kind.json': add the package that grants it/,
    );
  });
});
