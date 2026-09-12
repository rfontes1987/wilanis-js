/**
 * A type variable bound from a document rather than from the call site: a plugin whose port resolves $T and
 * $K through a store the tree declares, and a graph that names the store and the collection and nothing else.
 * The three sites that bind a variable are proved to agree here -- the checker holds the call to the type it
 * found, the compiler substitutes the same one into what the operation answers, and a rehearsal's stub
 * generates a value of it -- since a disagreement between them is exactly what one shared resolution prevents.
 *
 * D011 is proved beside them: a port document whose `resolves` is outside the grammar is refused when the
 * plugin loads, and the tree it would have served is never judged.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkTree } from '@wilanis/compiler';
import { loadTree, NODE_RUN, type PluginModule, schemaUrl } from '@wilanis/core';
import { describe, expect, it } from 'vitest';
import { BUILTIN_PLUGINS, describe as describeDoc, rehearse } from '../src/index.js';
import { docsDir } from './example-harness.js';

/** The `resolves` a case gives the store input; the default is the one a storage port would write. */
const RESOLVES = { $T: 'collections[collection].of', $K: 'collections[collection].of{key}.type' };

/** A plugin granting one port whose `get` says where its record and key types are written down. */
function keeper(resolves: unknown = RESOLVES, storeField: Record<string, unknown> = { static: true }): PluginModule {
  return {
    root: '@keeper',
    docs: docsDir({
      'plugin.json': {
        $schema: schemaUrl('plugin'),
        description: 'a plugin that keeps records of whatever shape a store declares',
        grants: {},
      },
      'keep.connection-kind.json': {
        $schema: schemaUrl('connection-kind'),
        description: 'where kept records live',
        settings: { fields: {} },
      },
      'keep.port.json': {
        $schema: schemaUrl('port'),
        description: 'records of the shape a store declares, named by store and collection',
        operations: {
          get: {
            description: 'the record of a collection under one key',
            accepts: {
              store: { type: 'string', ...storeField, resolves },
              collection: { type: 'string', static: true },
              key: { type: '$K' },
            },
            returns: '$T',
          },
        },
      },
    }),
    handlers: {
      'keep.port.json#get': async () => ({ id: 'x', note: 'kept' }),
    },
  };
}

/** A tree that keeps entries: one shape, one store over a connection, and one graph that reads a record. */
function tree(graphIn: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'wilanis-resolves-'));
  const write = (file: string, doc: unknown) => {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), JSON.stringify(doc));
  };
  write('project.json', {
    $schema: schemaUrl('project'),
    name: 'keeps',
    description: 'a tree whose records have the shape its store declares',
    plugins: [{ use: '@std' }, { use: '@keeper' }],
  });
  write('features/records/feature.json', {
    $schema: schemaUrl('feature'),
    description: 'what this tree keeps',
    effects: ['@keeper/keep.port.json#get'],
  });
  write('features/records/domain/Entry.shape.json', {
    $schema: schemaUrl('shape'),
    description: 'one entry that is kept',
    layer: 'core',
    fields: { id: { type: 'string' }, note: { type: 'string' } },
  });
  write('connections/records.connection.json', {
    $schema: schemaUrl('connection'),
    description: 'where the records live',
    kind: '@keeper/keep.connection-kind.json',
    settings: {},
  });
  write('features/records/data/records.store.json', {
    $schema: schemaUrl('store'),
    description: 'the entries this tree keeps',
    connection: '@connections/records.connection.json',
    collections: { entries: { of: '@features/records/domain/Entry.shape.json', key: 'id' } },
  });
  write('features/records/data/read.graph.json', {
    $schema: schemaUrl('graph'),
    description: 'read one entry by its key',
    in: 'string',
    nodes: [{ type: NODE_RUN, id: 'got', run: '@keeper/keep.port.json#get', in: graphIn }],
    out: { type: '@features/records/domain/Entry.shape.json', from: 'got' },
  });
  return dir;
}

const READ = { store: '@features/records/data/records.store.json', collection: 'entries', key: '{{in}}' };

/** The refusal codes one tree answers with, loaded against a keeper plugin. */
function codesOf(dir: string, plugin: PluginModule): string[] {
  const loaded = loadTree(dir, { ...BUILTIN_PLUGINS, '@keeper': plugin });
  return [...loaded.refusals.items, ...checkTree(loaded).items].map(refusal => refusal.code);
}

/** Run one case against a throwaway tree, then take the tree away again, whether it answered or threw. */
async function withTree(graphIn: Record<string, unknown>, use: (dir: string) => unknown): Promise<void> {
  const dir = tree(graphIn);
  try {
    await use(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('a type bound from the document that declares it', () => {
  it('the checker holds the call to the type the store declares, though no call site names it', async () => {
    await withTree(READ, dir => {
      expect(codesOf(dir, keeper())).toEqual([]);
    });
  });

  it("$K is bound beside $T, so the key takes the type of the collection's key field", async () => {
    // the key field is a string, so a number is refused where the call site gives one
    await withTree({ ...READ, key: 42 }, dir => {
      expect(codesOf(dir, keeper())).toEqual(['G004']);
    });
  });

  it('a collection the store does not declare binds nothing, and the unbound variable is refused', async () => {
    await withTree({ ...READ, collection: 'absent' }, dir => {
      // $T is never bound, so what the node answers is a variable no call site filled in
      expect(codesOf(dir, keeper())).toEqual(['G010']);
    });
  });

  it('describe says where each variable comes from, so no reader has to guess', async () => {
    await withTree(READ, dir => {
      const loaded = loadTree(dir, { ...BUILTIN_PLUGINS, '@keeper': keeper() });
      const said = describeDoc(loaded, '@keeper/keep.port.json');
      expect(said).toContain('binds $T from collections[collection].of');
      expect(said).toContain('binds $K from collections[collection].of{key}.type');
    });
  });

  it("a rehearsal's stub answers the bound type, so the compiler and the gate agree with the checker", async () => {
    await withTree(READ, async dir => {
      const loaded = loadTree(dir, { ...BUILTIN_PLUGINS, '@keeper': keeper() });
      expect(checkTree(loaded).items).toEqual([]);
      const run = await rehearse(loaded, { seed: 1 });
      expect(run.lines.join('\n')).not.toMatch(/BROKE|WRONG ROUTE/);
    });
  });
});

describe('D011: what a port document may say for itself, judged when the plugin loads', () => {
  it('a field that resolves a type but is not static, since a resolved type is read before anything runs', async () => {
    await withTree(READ, dir => {
      expect(codesOf(dir, keeper(RESOLVES, {}))).toContain('D011');
    });
  });

  it('a key taken by an input the operation has not got', async () => {
    await withTree(READ, dir => {
      expect(codesOf(dir, keeper({ $T: 'collections[absent].of' }))).toContain('D011');
    });
  });

  it("a path outside the grammar is the schema's to refuse, and the port never reaches D011", async () => {
    // the pattern on `resolves` is what an editor completes against, so a malformed path is D001 at the field
    await withTree(READ, dir => {
      expect(codesOf(dir, keeper({ $T: 'collections[collection]of' }))).toContain('D001');
    });
  });
});
