import { describe, expect, it } from 'vitest';
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTree, schemaRef, schemaUrl, type PluginModule } from '@wilanis/core';
import { checkTree } from '@wilanis/compiler';
import http from '@wilanis/plugin-http';
import { BUILTIN_PLUGINS, describe as describeDoc, loadProject, rehearse, serve } from '../src/index.js';

const EXAMPLE = fileURLToPath(new URL('../../../example', import.meta.url));
const PLUGINS = { ...BUILTIN_PLUGINS, '@http': http };
const codes = (root: string) => checkTree(loadTree(root, PLUGINS)).items.map(r => r.code);

/** A plugin's docs directory, written from name -> document. */
function docsDir(docs: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'wilanis-docs-'));
  for (const [name, doc] of Object.entries(docs)) writeFileSync(join(dir, name), JSON.stringify(doc));
  return dir;
}

/** Copy the example, apply an edit to one file, answer the refusal codes. */
function sabotage(file: string, edit: (doc: any) => void): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'wilanis-'));
  cpSync(EXAMPLE, dir, { recursive: true, filter: p => !p.includes('node_modules') });
  const p = join(dir, file);
  const doc = JSON.parse(readFileSync(p, 'utf8'));
  edit(doc);
  writeFileSync(p, JSON.stringify(doc));
  const out = codes(dir);
  rmSync(dir, { recursive: true, force: true });
  return out;
}

describe('the example tree', () => {
  it('passes check', () => { expect(codes(EXAMPLE)).toEqual([]); });
  it('rehearses every branch of every switch, whatever the seed', async () => {
    // solved from the rules, so no seed can leave a branch untried
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const r = await rehearse(loadTree(EXAMPLE, PLUGINS), { seed });
      expect(r.ok, `seed ${seed}: ${r.lines.join('\n')}`).toBe(true);
      expect(r.lines.join('\n')).not.toMatch(/NEVER RUN|BROKE|BLOCKED|WRONG ROUTE/);
    }
  });
  it('reports each decision once, under the graph that declares it', async () => {
    const r = await rehearse(loadTree(EXAMPLE, PLUGINS), { seed: 1 });
    const text = r.lines.join('\n');
    // list-rows is reached from two triggers (the listing and the digest), and is one decision even so
    expect(text.match(/list-rows  switch 'route'/g)).toHaveLength(1);
    expect(text).toMatch(/every branch settled -- 17 branch\(es\), 7 decision\(s\), 7 graph\(s\)/);
  });
  it('reaches both the answer and the declared failure of every data graph', async () => {
    const r = await rehearse(loadTree(EXAMPLE, PLUGINS), { seed: 1 });
    const text = r.lines.join('\n');
    // the six data graphs each answer on one branch and refuse on purpose on the others
    expect(text.match(/refused on purpose at 'failed'/g)).toHaveLength(6);
    // the three graphs behind an id declare what a missing id means
    expect(text.match(/refused on purpose at 'missing': "no entry /g)).toHaveLength(3);
    // every branch that answers names the node it answered from, never a bare status word
    expect(text.match(/answered from '/g)).toHaveLength(8);
    // the rule is shown as a condition, not as a bare expression next to a node id
    expect(text).toMatch(/when status == 200 && has\(body\)/);
    expect(text).toMatch(/anything else/);
    expect(text).toMatch(/when status == 404/);
  });
  it('loads its plugin packages through project.json → plugins[].from', async () => {
    const l = await loadProject(EXAMPLE);
    expect(l.refusals.items).toEqual([]);
    expect(l.plugins.map(p => p.root).sort()).toEqual(['@cli', '@http', '@std']);
  });
});

describe('plugin packages and hooks', () => {
  const project = (plugins: unknown[]) => {
    const dir = mkdtempSync(join(tmpdir(), 'wilanis-hooks-'));
    writeFileSync(join(dir, 'project.json'), JSON.stringify({ $schema: schemaUrl('project'), name: 'hooks', description: 'a tree with hooks', plugins }));
    return dir;
  };
  it('D006 when from is not a package name, or names a package that is not installed', async () => {
    const codesOf = async (from: string) => (await loadProject(project([{ use: '@std' }, { use: '@x', from }]))).refusals.items.map(r => r.code);
    expect(await codesOf('../evil.js')).toContain('D006');
    expect(await codesOf('@wilanis/no-such-plugin')).toContain('D006');
  });
  it('every document a plugin ships is a file a reader can open, and describe says where', () => {
    const l = loadTree(EXAMPLE, PLUGINS);
    for (const f of l.registry.files.filter(f => f.native)) {
      expect(f.file, f.path).toBeDefined();
      expect(existsSync(f.file!), f.path).toBe(true);
      expect(JSON.parse(readFileSync(f.file!, 'utf8'))).toEqual(f.doc);
    }
    expect(describeDoc(l, '@http/http.port.json')).toContain(`file  ${l.registry.get('port', '@http/http.port.json')!.file}`);
    expect(l.registry.get('graph', '@features/monitor/graphs/get-row.graph.json')!.file).toBe(join(EXAMPLE, 'features/monitor/graphs/get-row.graph.json'));
  });
  it('D006 when a plugin ships no plugin.json', () => {
    const fake: PluginModule = { root: '@fake', docs: docsDir({ 'fake.port.json': { $schema: schemaRef('port'), description: 'a port', operations: { op: { description: 'x' } } } }), handlers: {} };
    const dir = project([{ use: '@std' }, { use: '@fake' }]);
    expect(loadTree(dir, { ...BUILTIN_PLUGINS, '@fake': fake }).refusals.items.map(r => r.code)).toContain('D006');
    rmSync(dir, { recursive: true, force: true });
  });
  it('postLoad runs once after load with the plugin settings; its teardown runs on stop', async () => {
    const calls: string[] = [];
    const fake: PluginModule = {
      root: '@fake',
      docs: docsDir({ 'plugin.json': { $schema: schemaRef('plugin'), description: 'a plugin with a postLoad hook', settings: { fields: { greeting: { type: 'string' } } }, grants: {} } }),
      handlers: {},
      postLoad: async ({ settings, root }) => { calls.push(`up:${settings.greeting}:${typeof root}`); return async () => { calls.push('down'); }; },
    };
    const dir = project([{ use: '@std' }, { use: '@fake', settings: { greeting: 'hi' } }]);
    const l = loadTree(dir, { ...BUILTIN_PLUGINS, '@fake': fake });
    expect(checkTree(l).items).toEqual([]);
    const stop = await serve(l, { log: () => {} });
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
    const lines = await withEdit('features/monitor/graphs/list-rows.graph.json', d => {
      const route = d.nodes.find((n: any) => n.id === 'route');
      route.rules = [{ when: 'status >= 200', to: 'rows' }, { when: 'status == 200 && has(body)', to: 'rows' }];
    });
    expect(lines.join('\n')).toMatch(/NEVER RUN/);
  });

  it('reports a rule that contradicts itself', async () => {
    const lines = await withEdit('features/monitor/graphs/list-rows.graph.json', d => {
      const route = d.nodes.find((n: any) => n.id === 'route');
      route.rules = [{ when: 'status > 500 && status < 200', to: 'rows' }];
    });
    expect(lines.join('\n')).toMatch(/NEVER RUN/);
  });
});

describe('sabotage', () => {
  it('G003 a deep path that does not exist', () => {
    expect(sabotage('features/monitor/graphs/record-entry.graph.json', d => { d.nodes[0].in.url = '{{in.urrl}}'; })).toContain('G003');
  });
  it('G004 an optional read feeding a required input', () => {
    expect(sabotage('features/monitor/graphs/list-entries.graph.json', d => { d.nodes[0].rules[0].when = 'true == true'; })).toContain('G004');
  });
  it('G005 a required input left unwired', () => {
    expect(sabotage('features/monitor/graphs/record-entry.graph.json', d => { delete d.nodes[0].in.url; })).toContain('G005');
  });
  it('G008 a node nobody reads', () => {
    expect(sabotage('features/monitor/graphs/digest.graph.json', d => { d.out.from = 'all'; d.out.type = '@shapes/Entry.shape.json[]'; })).toContain('G008');
  });
  it('G010 a second out candidate that is never routed', () => {
    expect(sabotage('features/monitor/graphs/digest.graph.json', d => { d.out.from = ['joined', 'all']; })).toContain('G010');
  });
  it('L002 an effect run from a domain graph', () => {
    expect(sabotage('features/monitor/graphs/digest.graph.json', d => { d.nodes[0].run = '@http/http.port.json#request'; d.nodes[0].in = { connection: '@connections/monitor-api.connection.json', method: 'GET', path: '/x' }; })).toContain('L002');
  });
  it('L003 an effect the feature does not allow', () => {
    expect(sabotage('features/monitor/feature.json', d => { d.effects = []; })).toContain('L003');
  });
  it('T002 a trigger whose edge shape does not fit the graph', () => {
    expect(sabotage('features/monitor/shapes/RecordRequest.shape.json', d => { delete d.fields.url; })).toContain('T002');
  });
  it('T004 a resolver reading request.* under a kind that hands none', () => {
    expect(sabotage('features/monitor/graphs/list-rows.graph.json', d => {
      d.resolvers = { caller: { run: '@std/text.port.json#format', in: { values: '{{request.headers}}', template: '{authorization}' } } };
      d.nodes[0].in.headers = { authorization: '{{caller}}' };
    })).toContain('T004');
  });
  it('G006 an input the operation does not declare', () => {
    expect(sabotage('features/monitor/graphs/list-rows.graph.json', d => { d.nodes[0].in.query = { a: 'b' }; })).toContain('G006');
  });
  it('P001 a static field given a read', () => {
    expect(sabotage('features/monitor/graphs/list-rows-by-method.graph.json', d => { d.nodes[0].in.method = '{{in.method}}'; })).toContain('P001');
  });
  it('G003 a read of a node that does not exist', () => {
    expect(sabotage('features/monitor/graphs/list-rows.graph.json', d => { d.nodes[2].in.value = '{{asked2.body}}'; })).toContain('G003');
  });
  it('T003 a route placeholder the route does not declare', () => {
    expect(sabotage('features/monitor/triggers/get-entry.trigger.json', d => { d.settings.route = '/monitor/{entry}'; })).toContain('T003');
  });
  it('X002 a content type with no codec', () => {
    expect(sabotage('features/monitor/triggers/record-entry.trigger.json', d => { d.settings.consumes = 'application/xml'; })).toContain('X002');
  });
  it('B004 a profile whose binding implements another port', () => {
    expect(sabotage('features/monitor/monitor-rest.binding.json', d => { d.port = '@monitor/other.port.json'; })).toContain('B004');
  });
  it('B002 a domain port with no binding once the profile is gone', () => {
    expect(sabotage('project.json', d => { delete d.profiles; d.aliases['@monitor'] = '@features/nowhere'; })).toContain('B002');
  });
  it('D001 a document that breaks its schema', () => {
    expect(sabotage('features/monitor/monitor.port.json', d => { d.operations.listAll.returnz = 'x'; })).toContain('D001');
  });
  it('D001 a $schema in neither the published nor the alias form', () => {
    expect(sabotage('features/monitor/monitor.port.json', d => { d.$schema = 'https://example.com/port.schema.json'; })).toContain('D001');
  });
  it('R001 an alias to nowhere', () => {
    expect(sabotage('features/monitor/graphs/digest.graph.json', d => { d.nodes[0].run = '@monitor/nope.port.json#listAll'; })).toContain('R001');
  });
});
