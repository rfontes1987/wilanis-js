import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkTree } from '@wilanis/compiler';
import { loadTree, type PluginModule, schemaRef, schemaUrl } from '@wilanis/core';
import { describe, expect, it } from 'vitest';
import { BUILTIN_PLUGINS, describe as describeDoc, loadProject, rehearse, start } from '../src/index.js';
import { codes, docsDir, EXAMPLE, INCLUDES, PLUGINS } from './example-harness.js';

describe('the example tree', () => {
  it('passes check', () => {
    expect(codes(EXAMPLE)).toEqual([]);
  });
  it('rehearses every branch of every switch, whatever the seed', async () => {
    // solved from the rules, so no seed can leave a branch untried
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const r = await rehearse(loadTree(EXAMPLE, PLUGINS, INCLUDES), { seed });
      expect(r.ok, `seed ${seed}: ${r.lines.join('\n')}`).toBe(true);
      expect(r.lines.join('\n')).not.toMatch(/NEVER RUN|BROKE|BLOCKED|WRONG ROUTE/);
    }
  });
  it('reports each decision once, under the graph that declares it', async () => {
    const r = await rehearse(loadTree(EXAMPLE, PLUGINS, INCLUDES), { seed: 1 });
    const text = r.lines.join('\n');
    // list-rows is reached from two triggers (the listing and the digest), and is one decision even so
    expect(text.match(/list-rows {2}switch 'route'/g)).toHaveLength(1);
    // delete-row is reached directly by the single delete and once per element by the batch delete's map
    expect(text.match(/delete-row {2}switch 'route'/g)).toHaveLength(1);
    expect(text).toMatch(/every branch settled -- 37 branch\(es\), 15 decision\(s\), 15 graph\(s\)/);
  });
  it('reaches both the answer and the declared failure of every data graph', async () => {
    const r = await rehearse(loadTree(EXAMPLE, PLUGINS, INCLUDES), { seed: 1 });
    const text = r.lines.join('\n');
    // the six data graphs each answer on one branch and refuse on purpose on the others
    expect(text.match(/refused on purpose at 'failed' as upstream/g)).toHaveLength(6);
    // the three graphs behind an id declare what a missing id means, and say so in one word the trigger maps
    expect(text.match(/refused on purpose at 'missing' as missing: "no entry /g)).toHaveLength(3);
    // every branch that answers names the node it answered from, never a bare status word: the monitor's eight, and the access feature's
    expect(text.match(/answered from '/g)).toHaveLength(16);
    // the rule is shown as a condition, not as a bare expression next to a node id
    expect(text).toMatch(/when status == 200 && has\(body\)/);
    expect(text).toMatch(/anything else/);
    expect(text).toMatch(/when status == 404/);
  });
  it('rehearses a switch inside a mapped operation through the first element, whatever the seed', async () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const r = await rehearse(loadTree(EXAMPLE, PLUGINS, INCLUDES), { seed, verbose: true });
      const text = r.lines.join('\n');
      // the batch delete reaches the delete-row decision through its map, and every branch of it settles
      expect(text).toMatch(/delete-row {2}switch 'route' {2}3\/3 branches {2}\[via delete-entries, delete-entry\]/);
    }
  });
  it('loads its plugin packages through project.json → plugins[].from', async () => {
    const l = await loadProject(EXAMPLE);
    expect(l.refusals.items).toEqual([]);
    expect(l.plugins.map(p => p.root).sort()).toEqual(['@auth', '@blob', '@cli', '@http', '@reload', '@std']);
  });
});

describe('plugin packages and hooks', () => {
  const project = (plugins: unknown[]) => {
    const dir = mkdtempSync(join(tmpdir(), 'wilanis-hooks-'));
    writeFileSync(
      join(dir, 'project.json'),
      JSON.stringify({ $schema: schemaUrl('project'), name: 'hooks', description: 'a tree with hooks', plugins }),
    );
    return dir;
  };
  it('D006 when from is not a package name, or names a package that is not installed', async () => {
    const codesOf = async (from: string) =>
      (await loadProject(project([{ use: '@std' }, { use: '@x', from }]))).refusals.items.map(r => r.code);
    expect(await codesOf('../evil.js')).toContain('D006');
    expect(await codesOf('@wilanis/no-such-plugin')).toContain('D006');
  });
  it('every document a plugin ships is a file a reader can open, and describe says where', () => {
    const l = loadTree(EXAMPLE, PLUGINS, INCLUDES);
    for (const f of l.registry.files.filter(f => f.native)) {
      expect(f.file, f.path).toBeDefined();
      expect(existsSync(f.file!), f.path).toBe(true);
      expect(JSON.parse(readFileSync(f.file!, 'utf8'))).toEqual(f.doc);
    }
    expect(describeDoc(l, '@http/http.port.json')).toContain(
      `file  ${l.registry.get('port', '@http/http.port.json')?.file}`,
    );
    // a native document says whose it is: who implements it must not be a code detail
    expect(describeDoc(l, '@http/server.port.json')).toContain('granted by  @http  (@wilanis/plugin-http)');
    expect(describeDoc(l, '@reload/watch.port.json')).toContain('granted by  @reload  (@wilanis/plugin-reload)');
    expect(describeDoc(l, '@std/list.port.json')).toContain('granted by  @std  (built into the runtime)');
    expect(describeDoc(l, '@monitor/domain/monitor.port.json')).not.toContain('granted by');
    // and a holds operation says that it holds
    expect(describeDoc(l, '@http/server.port.json')).toContain('#listen  (holds until stopped)');
    expect(l.registry.get('graph', '@features/monitor/data/get-row.graph.json')?.file).toBe(
      join(EXAMPLE, 'features/monitor/data/get-row.graph.json'),
    );
  });
  it('D006 when a plugin ships no plugin.json', () => {
    const fake: PluginModule = {
      root: '@fake',
      docs: docsDir({
        'fake.port.json': {
          $schema: schemaRef('port'),
          description: 'a port',
          operations: { op: { description: 'x' } },
        },
      }),
      handlers: {},
    };
    const dir = project([{ use: '@std' }, { use: '@fake' }]);
    expect(loadTree(dir, { ...BUILTIN_PLUGINS, '@fake': fake }).refusals.items.map(r => r.code)).toContain('D006');
    rmSync(dir, { recursive: true, force: true });
  });
  it('postLoad runs once after load with the plugin settings; its teardown runs on stop', async () => {
    const calls: string[] = [];
    const fake: PluginModule = {
      root: '@fake',
      docs: docsDir({
        'plugin.json': {
          $schema: schemaRef('plugin'),
          description: 'a plugin with a postLoad hook',
          settings: { fields: { greeting: { type: 'string' } } },
          grants: {},
        },
      }),
      handlers: {},
      postLoad: async ({ settings, root }) => {
        calls.push(`up:${settings.greeting}:${typeof root}`);
        return async () => {
          calls.push('down');
        };
      },
    };
    const dir = project([{ use: '@std' }, { use: '@fake', settings: { greeting: 'hi' } }]);
    const l = loadTree(dir, { ...BUILTIN_PLUGINS, '@fake': fake });
    expect(checkTree(l).items).toEqual([]);
    const { stop } = await start(l, { log: () => {} });
    expect(calls).toEqual(['up:hi:string']);
    await stop();
    expect(calls).toEqual(['up:hi:string', 'down']);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('branch rehearsal', () => {
  /** Copy the example, edit one document, and rehearse every branch of it. */
  async function withEdit(file: string, edit: (doc: any) => void): Promise<string[]> {
    const dir = mkdtempSync(join(tmpdir(), 'wilanis-'));
    cpSync(EXAMPLE, dir, { recursive: true, filter: p => !p.includes('node_modules') });
    const p = join(dir, file);
    const doc = JSON.parse(readFileSync(p, 'utf8'));
    edit(doc);
    writeFileSync(p, JSON.stringify(doc));
    const r = await rehearse(loadTree(dir, PLUGINS), { seed: 1 });
    rmSync(dir, { recursive: true, force: true });
    return r.lines;
  }

  it('reports a rule an earlier rule already covers', async () => {
    const lines = await withEdit('features/monitor/data/list-rows.graph.json', d => {
      const route = d.nodes.find((n: any) => n.id === 'route');
      route.rules = [
        { when: 'status >= 200', to: 'rows' },
        { when: 'status == 200 && has(body)', to: 'rows' },
      ];
    });
    expect(lines.join('\n')).toMatch(/NEVER RUN/);
  });

  it('reports a rule that contradicts itself', async () => {
    const lines = await withEdit('features/monitor/data/list-rows.graph.json', d => {
      const route = d.nodes.find((n: any) => n.id === 'route');
      route.rules = [{ when: 'status > 500 && status < 200', to: 'rows' }];
    });
    expect(lines.join('\n')).toMatch(/NEVER RUN/);
  });
});
