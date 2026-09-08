import { describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTree, schemaRef, schemaUrl, type PluginModule } from '@wilanis/core';
import { checkTree } from '@wilanis/compiler';
import http from '@wilanis/plugin-http';
import { BUILTIN_PLUGINS, loadProject, rehearse, serve } from '../src/index.js';

const EXAMPLE = fileURLToPath(new URL('../../../example', import.meta.url));
const PLUGINS = { ...BUILTIN_PLUGINS, '@http': http };
const codes = (root: string) => checkTree(loadTree(root, PLUGINS)).items.map(r => r.code);

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
  it('rehearses every trigger to a settled report', async () => {
    const r = await rehearse(loadTree(EXAMPLE, PLUGINS), { seed: 4 });
    expect(r.ok).toBe(true);
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
  it('postLoad runs once after load with the plugin settings; its teardown runs on stop', async () => {
    const calls: string[] = [];
    const fake: PluginModule = {
      root: '@fake',
      docs: { '@fake/plugin.json': { $schema: schemaRef('plugin'), description: 'a plugin with a postLoad hook', settings: { fields: { greeting: { type: 'string' } } }, grants: {} } },
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

describe('sabotage', () => {
  it('G003 a deep path that does not exist', () => {
    expect(sabotage('features/tasks/graphs/create-task.graph.json', d => { d.nodes[0].in.title = 'in.tittle'; })).toContain('G003');
  });
  it('G004 an optional read feeding a required input', () => {
    expect(sabotage('features/tasks/graphs/list-tasks.graph.json', d => { d.nodes[0].rules[0].when = 'true == true'; })).toContain('G004');
  });
  it('G005 a required input left unwired', () => {
    expect(sabotage('features/tasks/graphs/create-task.graph.json', d => { delete d.nodes[0].in.title; })).toContain('G005');
  });
  it('G008 a node nobody reads', () => {
    expect(sabotage('features/tasks/graphs/digest.graph.json', d => { d.out.from = 'all'; d.out.type = '@shapes/Task.shape.json[]'; })).toContain('G008');
  });
  it('G010 a second out candidate that is never routed', () => {
    expect(sabotage('features/tasks/graphs/digest.graph.json', d => { d.out.from = ['joined', 'all']; })).toContain('G010');
  });
  it('L002 an effect run from a domain graph', () => {
    expect(sabotage('features/tasks/graphs/digest.graph.json', d => { d.nodes[0].run = '@http/http.port.json#request'; d.nodes[0].params = { connection: '@connections/postgres-rest.connection.json', method: 'GET', path: '/x' }; })).toContain('L002');
  });
  it('L003 an effect the feature does not allow', () => {
    expect(sabotage('features/tasks/feature.json', d => { d.effects = []; })).toContain('L003');
  });
  it('T002 a trigger whose edge shape does not fit the graph', () => {
    expect(sabotage('features/tasks/shapes/CreateTaskRequest.shape.json', d => { delete d.fields.title; })).toContain('T002');
  });
  it('T004 a resolver reading request.* under a kind that hands none', () => {
    expect(sabotage('features/tasks/graphs/list-rows.graph.json', d => {
      d.resolvers = { caller: { run: '@std/text.port.json#format', in: { values: '{{request.headers}}' }, params: { template: '{authorization}' } } };
      d.nodes[0].params.headers = { authorization: '{{caller}}' };
    })).toContain('T004');
  });
  it('P001 a param the operation does not declare', () => {
    expect(sabotage('features/tasks/graphs/list-rows.graph.json', d => { d.nodes[0].params.query = { a: 'b' }; })).toContain('P001');
  });
  it('X002 a content type with no codec', () => {
    expect(sabotage('features/tasks/triggers/create-task.trigger.json', d => { d.settings.consumes = 'application/xml'; })).toContain('X002');
  });
  it('B004 a profile whose binding implements another port', () => {
    expect(sabotage('features/tasks/tasks-rest.binding.json', d => { d.port = '@tasks/other.port.json'; })).toContain('B004');
  });
  it('B002 a domain port with no binding once the profile is gone', () => {
    expect(sabotage('project.json', d => { delete d.profiles; d.aliases['@tasks'] = '@features/nowhere'; })).toContain('B002');
  });
  it('D001 a document that breaks its schema', () => {
    expect(sabotage('features/tasks/tasks.port.json', d => { d.operations.listAll.returnz = 'x'; })).toContain('D001');
  });
  it('D001 a $schema in neither the published nor the alias form', () => {
    expect(sabotage('features/tasks/tasks.port.json', d => { d.$schema = 'https://example.com/port.schema.json'; })).toContain('D001');
  });
  it('R001 an alias to nowhere', () => {
    expect(sabotage('features/tasks/graphs/digest.graph.json', d => { d.nodes[0].run = '@tasks/nope.port.json#listAll'; })).toContain('R001');
  });
});
