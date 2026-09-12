/**
 * The engine, and the one thing about it a reader must not be surprised by: it keeps nothing past the process.
 * The behaviour itself is not restated here -- it is @storage's shared suite, run against this engine, which
 * is what makes "this is an engine" one executable meaning rather than a promise in a README.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkTree } from '@wilanis/compiler';
import { loadTree, type PluginModule, type Type, TypeResolver } from '@wilanis/core';
import type { At } from '@wilanis/plugin-storage';
import storage, { engines } from '@wilanis/plugin-storage';
import { cases } from '@wilanis/plugin-storage/suite';
import { BUILTIN_PLUGINS } from '@wilanis/runtime';
import { afterAll, describe, expect, it } from 'vitest';
import memory, { MemoryEngine } from '../src/index.js';

const KIND = '@storage-memory/memory.connection-kind.json';
const CONNECTION = '@connections/records.connection.json';
const subjectOf = () => ({
  engine: new MemoryEngine(),
  connection: { connection: CONNECTION, kind: KIND, settings: {} },
});

describe('what every engine answers alike', () => {
  const subject = subjectOf();
  for (const one of cases) it(one.name, () => one.run(subject));
});

const types = new TypeResolver(() => undefined);
const numbered: Type = types.inline({ fields: { id: { type: 'number' }, url: { type: 'string' } } });
const at = (shape: Type, key: string): At => ({ ...subjectOf().connection, name: 'entries', shape, key });

describe('the keys it makes', () => {
  it('a number key is one past the highest the collection holds', async () => {
    const engine = new MemoryEngine();
    const where = at(numbered, 'id');
    await engine.put(where, { id: 4, url: 'https://x' }, true);
    expect(await engine.newKey(where)).toBe(5);
    await engine.put(where, { id: 9, url: 'https://y' }, true);
    expect(await engine.newKey(where)).toBe(10);
  });

  it('a key of a type it cannot make one of says so, rather than answering something else', async () => {
    const flagged: Type = types.inline({ fields: { id: { type: 'boolean' }, url: { type: 'string' } } });
    await expect(new MemoryEngine().newKey(at(flagged, 'id'))).rejects.toThrow(
      /makes a key for a string or a number, and 'id' is boolean/,
    );
  });
});

describe('what it keeps, and for how long', () => {
  it('a second load starts empty: the records hang off the engine of one environment, never off the module', async () => {
    // each load builds its own connections, which is what @storage keys the table by, so these are two trees
    const scope = { canon: (ref: string) => ref } as never;
    const load = async () => {
      const env = { connections: { [CONNECTION]: { kind: KIND, settings: {} } } };
      await memory.postLoad?.({ env, scope } as never);
      return env;
    };
    const first = await load();
    const second = await load();

    const where = at(numbered, 'id');
    await engines(first).for(KIND)?.put(where, { id: 1, url: 'https://x' }, true);
    expect(await engines(first).for(KIND)?.count(where, undefined)).toBe(1);
    expect(await engines(second).for(KIND)?.count(where, undefined)).toBe(0);
  });

  it('a handler reaching it through a copy of the environment finds the engine postLoad registered', async () => {
    const env = { connections: { [CONNECTION]: { kind: KIND, settings: {} } } };
    await memory.postLoad?.({ env, scope: { canon: (ref: string) => ref } } as never);
    const where = at(numbered, 'id');
    await engines(env).for(KIND)?.put(where, { id: 1, url: 'https://x' }, true);
    // the embedder hands a handler { ...env, blobs } on any run that carries a blob scope
    expect(
      await engines({ ...env, blobs: {} })
        .for(KIND)
        ?.count(where, undefined),
    ).toBe(1);
  });

  it('two stores over one connection naming one collection meet the same records, as @storage says they do', async () => {
    const engine = new MemoryEngine();
    const where = at(numbered, 'id');
    await engine.put(where, { id: 1, url: 'https://x' }, true);
    expect(await engine.count({ ...where, connection: CONNECTION }, undefined)).toBe(1);
    expect(await engine.count({ ...where, connection: '@connections/other.connection.json' }, undefined)).toBe(0);
  });
});

/** A tree that declares what it keeps: the first one in the repository to name a storage connection kind. */
function treeKeeping(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wilanis-memory-'));
  const write = (relative: string, doc: unknown) => {
    const path = join(dir, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(doc));
  };
  write('project.json', {
    $schema: '@wilanis/project.schema.json',
    description: 'a tree that keeps its entries in memory',
    name: 'kept-in-memory',
    plugins: [{ use: '@std' }, { use: '@storage' }, { use: '@storage-memory' }],
  });
  write('connections/records.connection.json', {
    $schema: '@wilanis/connection.schema.json',
    description: 'the records, kept for as long as this process runs',
    kind: KIND,
    settings: {},
  });
  write('features/monitor/feature.json', {
    $schema: '@wilanis/feature.schema.json',
    description: 'what the monitor observes',
  });
  write('features/monitor/domain/Entry.shape.json', {
    $schema: '@wilanis/shape.schema.json',
    description: 'one observed call',
    layer: 'core',
    fields: { id: { type: 'string' }, url: { type: 'string' } },
  });
  write('features/monitor/data/entries.store.json', {
    $schema: '@wilanis/store.schema.json',
    description: 'the entries, kept in memory',
    connection: CONNECTION,
    collections: { entries: { of: '@features/monitor/domain/Entry.shape.json', key: 'id' } },
  });
  return dir;
}

const dir = treeKeeping();
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('a tree that names this engine', () => {
  const Plugins: Record<string, PluginModule> = { ...BUILTIN_PLUGINS, '@storage': storage, '@storage-memory': memory };

  it('stands: a store may name a connection of a kind marked storage, and the checker is content', () => {
    const refusals = checkTree(loadTree(dir, Plugins));
    expect(refusals.format()).toBe('');
  });

  it('the kind says it reaches a storage engine, which is how a store knows it may name it', () => {
    const kind = loadTree(dir, Plugins).registry.get('connection-kind', KIND);
    expect(kind?.doc.storage).toBe(true);
    expect(kind?.doc.settings).toEqual({ fields: {} });
  });
});
