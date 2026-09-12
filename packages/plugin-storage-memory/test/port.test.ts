/**
 * The engine, reached the way a served tree reaches it: a tree loaded with `loadProject`, every plugin's
 * `postLoad` run, and each operation fired through the `Embedder` -- the same path the http listener and
 * `wilanis run` take, and the only one that proves the wiring rather than the table.
 *
 * What it is here to catch is the seam nothing else sees. `@storage` keys its engine table by the environment
 * object, `postLoad` registers against `emb.env`, and the embedder hands a handler `{ ...env, blobs }` -- a
 * new object -- on any run carrying a blob scope. A table keyed on the handler's env would therefore be empty
 * on exactly the runs a real listener makes, and every test that calls a handler directly would still pass.
 * So every fire below is given a blob scope on purpose.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkTree } from '@wilanis/compiler';
import { loadTree, type PluginModule } from '@wilanis/core';
import storage from '@wilanis/plugin-storage';
import { BUILTIN_PLUGINS, embedderFor, FileBlobStore, postLoad } from '@wilanis/runtime';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import memory from '../src/index.js';

const KIND = '@storage-memory/memory.connection-kind.json';
const CONNECTION = '@connections/records.connection.json';

/** A tree that keeps entries in memory and fires every operation from the command line. */
function treeServing(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wilanis-memory-port-'));
  const write = (relative: string, doc: unknown) => {
    const path = join(dir, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(doc));
  };
  const node = (id: string, run: string, into: Record<string, unknown>) => ({
    type: '@wilanis/node/run.schema.json',
    id,
    run,
    in: into,
  });

  write('project.json', {
    $schema: '@wilanis/project.schema.json',
    description: 'a tree that keeps its entries in memory and is driven from the command line',
    name: 'kept-in-memory',
    plugins: [{ use: '@std' }, { use: '@cli' }, { use: '@storage' }, { use: '@storage-memory' }],
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
    exports: ['@features/monitor/domain/entries.port.json', '@features/monitor/domain/Entry.shape.json'],
    effects: ['@storage/store.port.json#put', '@storage/store.port.json#get', '@storage/store.port.json#count'],
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
  write('features/monitor/domain/Kept.shape.json', {
    $schema: '@wilanis/shape.schema.json',
    description: 'what a write answers: the entry, and whether the key was already taken',
    layer: 'core',
    fields: {
      record: { type: '@features/monitor/domain/Entry.shape.json', required: false },
      conflict: { type: 'boolean' },
    },
  });
  write('features/monitor/domain/Found.shape.json', {
    $schema: '@wilanis/shape.schema.json',
    description: 'what a read answers: the entry, where there is one under that key',
    layer: 'core',
    fields: { record: { type: '@features/monitor/domain/Entry.shape.json', required: false } },
  });
  write('features/monitor/domain/entries.port.json', {
    $schema: '@wilanis/port.schema.json',
    description: 'what the domain needs of entry storage',
    operations: {
      record: {
        description: 'Keep one entry.',
        accepts: { id: { type: 'string' }, url: { type: 'string' } },
        returns: '@features/monitor/domain/Kept.shape.json',
      },
      get: {
        description: 'One entry by its id.',
        accepts: { id: { type: 'string' } },
        returns: '@features/monitor/domain/Found.shape.json',
      },
      howMany: { description: 'How many entries are kept.', returns: 'number' },
    },
  });
  write('features/monitor/data/entries-memory.binding.json', {
    $schema: '@wilanis/binding.schema.json',
    description: 'the port over an @storage store',
    port: '@features/monitor/domain/entries.port.json',
    operations: {
      record: { graph: '@features/monitor/data/record-entry.graph.json' },
      get: { graph: '@features/monitor/data/get-entry.graph.json' },
      howMany: { graph: '@features/monitor/data/count-entries.graph.json' },
    },
  });
  write('features/monitor/data/record-entry.graph.json', {
    $schema: '@wilanis/graph.schema.json',
    description: 'put the whole record, and answer it',
    in: '@features/monitor/domain/Entry.shape.json',
    out: { type: '@features/monitor/domain/Kept.shape.json', from: ['kept'] },
    nodes: [
      node('kept', '@storage/store.port.json#put', {
        store: '@features/monitor/data/entries.store.json',
        collection: 'entries',
        record: { id: '{{in.id}}', url: '{{in.url}}' },
      }),
    ],
  });
  write('features/monitor/data/get-entry.graph.json', {
    $schema: '@wilanis/graph.schema.json',
    description: 'read one record back',
    in: '@features/monitor/edge/IdRequest.shape.json',
    out: { type: '@features/monitor/domain/Found.shape.json', from: ['found'] },
    nodes: [
      node('found', '@storage/store.port.json#get', {
        store: '@features/monitor/data/entries.store.json',
        collection: 'entries',
        key: '{{in.id}}',
      }),
    ],
  });
  write('features/monitor/data/count-entries.graph.json', {
    $schema: '@wilanis/graph.schema.json',
    description: 'how many are kept',
    out: { type: 'number', from: ['counted'] },
    nodes: [
      node('counted', '@storage/store.port.json#count', {
        store: '@features/monitor/data/entries.store.json',
        collection: 'entries',
      }),
    ],
  });
  write('features/monitor/edge/KeptView.shape.json', {
    $schema: '@wilanis/shape.schema.json',
    description: 'what the command line prints after a write',
    layer: 'edge',
    fields: {
      record: { type: '@features/monitor/edge/EntryView.shape.json', required: false },
      conflict: { type: 'boolean' },
    },
  });
  write('features/monitor/edge/FoundView.shape.json', {
    $schema: '@wilanis/shape.schema.json',
    description: 'what the command line prints after a read',
    layer: 'edge',
    fields: { record: { type: '@features/monitor/edge/EntryView.shape.json', required: false } },
  });
  write('features/monitor/edge/EntryView.shape.json', {
    $schema: '@wilanis/shape.schema.json',
    description: 'one entry, as the command line prints it',
    layer: 'edge',
    fields: { id: { type: 'string' }, url: { type: 'string' } },
  });
  write('features/monitor/edge/EntryRequest.shape.json', {
    $schema: '@wilanis/shape.schema.json',
    description: 'an entry asked to be kept',
    layer: 'edge',
    fields: { id: { type: 'string' }, url: { type: 'string' } },
  });
  write('features/monitor/edge/IdRequest.shape.json', {
    $schema: '@wilanis/shape.schema.json',
    description: 'an id asked for',
    layer: 'edge',
    fields: { id: { type: 'string' } },
  });
  const trigger = (
    name: string,
    op: string,
    out: string,
    what: { in?: string; fire?: Record<string, unknown> } = {},
  ) => ({
    $schema: '@wilanis/trigger.schema.json',
    description: `${name} from the command line`,
    kind: '@cli/cli.trigger-kind.json',
    settings: { command: name },
    ...(what.in ? { in: what.in } : {}),
    out,
    fire: {
      run: `@features/monitor/domain/entries.port.json#${op}`,
      ...(what.fire ? { in: what.fire } : {}),
    },
  });
  write(
    'features/monitor/edge/record.trigger.json',
    trigger('record', 'record', '@features/monitor/edge/KeptView.shape.json', {
      in: '@features/monitor/edge/EntryRequest.shape.json',
      fire: { id: '{{request.flags.id}}', url: '{{request.flags.url}}' },
    }),
  );
  write(
    'features/monitor/edge/get.trigger.json',
    trigger('get', 'get', '@features/monitor/edge/FoundView.shape.json', {
      in: '@features/monitor/edge/IdRequest.shape.json',
      fire: { id: '{{request.flags.id}}' },
    }),
  );
  write('features/monitor/edge/count.trigger.json', trigger('count', 'howMany', 'number'));
  return dir;
}

const PLUGINS: Record<string, PluginModule> = {
  ...BUILTIN_PLUGINS,
  '@storage': storage,
  '@storage-memory': memory,
};

const dir = treeServing();
let tree: ReturnType<typeof loadTree>;
let emb: ReturnType<typeof embedderFor>;
let down: () => Promise<void>;

beforeAll(async () => {
  tree = loadTree(dir, PLUGINS);
  expect(checkTree(tree).format()).toBe('');
  emb = embedderFor(tree); // no seed: a seeded embedder stubs every effect, and the engine would never run
  down = await postLoad(tree, emb, () => {});
});

afterAll(async () => {
  await down();
  if (emb.blobs instanceof FileBlobStore) emb.blobs.destroy();
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Fire one trigger the way `wilanis run` and the http listener do: a blob scope of this run's own, handed to
 * `fire`, which is what makes the handler's env a copy of the tree's rather than the tree's itself.
 */
const fire = async (name: string, input?: Record<string, unknown>) => {
  const path = `@features/monitor/edge/${name}.trigger.json`;
  const found = tree.registry.get('trigger', tree.resolve(path));
  if (!found) throw new Error(`no trigger at '${path}'`);
  const blobs = emb.blobs.scope();
  try {
    return await emb.fire(found.doc, input, { flags: {}, args: [], cwd: dir }, { blobs });
  } finally {
    await blobs.release();
  }
};

describe('the engine, reached through the embedder on a run that carries a blob scope', () => {
  it('a record put through a trigger is read back by another, so postLoad registered against the env a run uses', async () => {
    const kept = await fire('record', { id: '1', url: 'https://x' });
    expect(kept.status).toBe('done');
    expect(kept.output).toEqual({ record: { id: '1', url: 'https://x' }, conflict: false });

    const read = await fire('get', { id: '1' });
    expect(read.status).toBe('done');
    expect(read.output).toEqual({ record: { id: '1', url: 'https://x' } });
  });

  it('what one run kept, the next run counts: the table is the tree’s, not the request’s', async () => {
    await fire('record', { id: '2', url: 'https://y' });
    const counted = await fire('count');
    expect(counted.status).toBe('done');
    expect(counted.output).toBe(2);
  });
});
