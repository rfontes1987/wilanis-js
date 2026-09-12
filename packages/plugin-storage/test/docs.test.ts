/**
 * The documents this plugin ships, judged the way a tree judges them. Everything the DSL names is a file under
 * docs/, so the ports are documents like any other: they are loaded, validated against their schemas, and held
 * to the rules -- including the `resolves` paths, which say where $T and $K come from and are refused here
 * rather than at the call site that reads them.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkTree } from '@wilanis/compiler';
import { loadTree, type PluginModule } from '@wilanis/core';
import { BUILTIN_PLUGINS } from '@wilanis/runtime';
import { afterAll, describe, expect, it } from 'vitest';
import storage from '../src/index.js';

const PLUGINS: Record<string, PluginModule> = { ...BUILTIN_PLUGINS, '@storage': storage };

/** The smallest tree that loads this plugin: a project that names it, and nothing else at all. */
function treeNaming(plugins: { use: string }[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'wilanis-storage-'));
  writeFileSync(
    join(dir, 'project.json'),
    JSON.stringify({
      $schema: '@wilanis/project.schema.json',
      description: 'a tree that keeps nothing yet, and loads the storage plugin',
      name: 'storage-docs',
      plugins,
    }),
  );
  return dir;
}

const dir = treeNaming([{ use: '@std' }, { use: '@storage' }]);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('the documents @storage ships', () => {
  it('load and stand: every one validates, and every rule the checker has is content', () => {
    const refusals = checkTree(loadTree(dir, PLUGINS));
    expect(refusals.format()).toBe('');
    expect(refusals.ok).toBe(true);
  });

  it('are the ones plugin.json grants, and they are files rather than objects in code', () => {
    const registry = loadTree(dir, PLUGINS).registry;
    for (const path of ['@storage/store.port.json', '@storage/storage.port.json'])
      expect(registry.get('port', path)?.native).toBe('@storage');
    expect(registry.get('shape', '@storage/Order.shape.json')?.doc.layer).toBe('edge');
  });

  it('say where every type variable comes from, so no call site repeats the record type', () => {
    const port = loadTree(dir, PLUGINS).registry.get('port', '@storage/store.port.json');
    const resolves = (name: string) => port?.doc.operations[name]?.accepts?.store?.resolves;
    expect(resolves('get')).toEqual({
      $T: 'collections[collection].of',
      $K: 'collections[collection].of{key}.type',
    });
    expect(resolves('find')).toEqual({ $T: 'collections[collection].of' });
    expect(resolves('newKey')).toEqual({ $K: 'collections[collection].of{key}.type' });
    expect(resolves('count')).toBeUndefined();
  });
});
