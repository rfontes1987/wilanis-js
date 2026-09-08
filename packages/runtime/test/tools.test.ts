import { describe, expect, it } from 'vitest';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTree, type ResolvedInclude } from '@wilanis/core';
import { checkTree } from '@wilanis/compiler';
import http from '@wilanis/plugin-http';
import blobs from '@wilanis/plugin-blob';
import reload from '@wilanis/plugin-reload';
import auth from '@wilanis/plugin-auth';
import { Readable } from 'node:stream';
import { BUILTIN_PLUGINS, fuzz, init, regress, runTrigger, scaffold } from '../src/index.js';
import { isBlobHandle, schemaUrl } from '@wilanis/core';

const EXAMPLE = fileURLToPath(new URL('../../../example', import.meta.url));
/** The tree the example includes, as the runtime would resolve it from the example's node_modules. */
const INCLUDES: ResolvedInclude[] = [{ from: '@wilanis/access', dir: fileURLToPath(new URL('../../../libraries/access', import.meta.url)), features: ['access'] }];
const PLUGINS = { ...BUILTIN_PLUGINS, '@http': http, '@blob': blobs, '@reload': reload, '@auth': auth };
const tmp = () => mkdtempSync(join(tmpdir(), 'wilanis-tools-'));
const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

describe('wilanis new', () => {
  it('writes a project that loads, and refuses to overwrite', () => {
    const dir = tmp();
    expect(scaffold(dir, 'project', 'board', {})).toEqual(['package.json', 'project.json']);
    expect(read(join(dir, 'project.json')).plugins.map((p: any) => p.use)).toEqual(['@std', '@cli', '@http']);
    expect(() => scaffold(dir, 'project', 'board', {})).toThrow('package.json exists');
    rmSync(dir, { recursive: true, force: true });
  });
  it('writes each kind into the layer it lives in, and the result passes the placement rules', () => {
    const dir = tmp();
    scaffold(dir, 'project', 'board', {});
    expect(scaffold(dir, 'feature', 'tasks', {})).toEqual(['features/tasks/feature.json']);
    // features/<name>/<file>: the layer is inserted for the author, from the kind (and --layer for a shape or a graph)
    expect(scaffold(dir, 'shape', 'features/tasks/Task', {})).toEqual(['features/tasks/domain/Task.shape.json']);
    expect(scaffold(dir, 'shape', 'features/tasks/TaskView', { layer: 'edge' })).toEqual(['features/tasks/edge/TaskView.shape.json']);
    expect(scaffold(dir, 'port', 'features/tasks/tasks', {})).toEqual(['features/tasks/domain/tasks.port.json']);
    expect(scaffold(dir, 'graph', 'features/tasks/greet', {})).toEqual(['features/tasks/domain/greet.graph.json']);
    expect(scaffold(dir, 'graph', 'features/tasks/fetch', { layer: 'data' })).toEqual(['features/tasks/data/fetch.graph.json']);
    expect(scaffold(dir, 'binding', 'features/tasks/tasks-rest', { port: '@features/tasks/domain/tasks.port.json' })).toEqual(['features/tasks/data/tasks-rest.binding.json']);
    expect(scaffold(dir, 'resolvers', 'features/tasks/request', {})).toEqual(['features/tasks/edge/request.resolvers.json']);
    expect(scaffold(dir, 'trigger', 'features/tasks/list', { run: '@features/tasks/domain/tasks.port.json#example' })).toEqual(['features/tasks/edge/list.trigger.json']);
    // a path with the layer already in it is taken as written, and the shape's layer follows the directory
    expect(scaffold(dir, 'shape', 'features/tasks/edge/ListRequest', {})).toEqual(['features/tasks/edge/ListRequest.shape.json']);
    expect(read(join(dir, 'features/tasks/edge/ListRequest.shape.json')).layer).toBe('edge');
    // the scaffolds fit together: the binding meets the port's example operation, nothing is misplaced, every
    // document is a valid instance of its schema. What is left is the one TODO a scaffold cannot decide for the
    // author: the trigger must declare what it answers.
    expect(checkTree(loadTree(dir, PLUGINS)).items.map(r => r.code)).toEqual(['T002']);
    expect(() => scaffold(dir, 'nonsense', 'x', {})).toThrow("unknown kind 'nonsense'");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('wilanis init', () => {
  it('writes CLAUDE.md and the hooks, keeps what exists, and says which', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'CLAUDE.md'), '# mine\n');
    const lines = init(dir);
    expect(lines).toEqual([`kept ${join(dir, 'CLAUDE.md')}`, `wrote ${join(dir, '.claude', 'settings.json')}`]);
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe('# mine\n');
    expect(read(join(dir, '.claude', 'settings.json')).hooks.Stop).toBeDefined();
    // a second run changes nothing
    expect(init(dir).every(l => l.startsWith('kept '))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('wilanis fuzz and regress', () => {
  it('fuzz writes one scenario per trigger per seed, and regress replays every one as the same', async () => {
    const dir = tmp();
    cpSync(EXAMPLE, dir, { recursive: true, filter: p => !p.includes('node_modules') });
    const written = await fuzz(loadTree(dir, PLUGINS, INCLUDES), { runs: 2 });
    // seventeen triggers -- the example's and the included access tree's -- two seeds each
    expect(written).toHaveLength(34);
    expect(readdirSync(join(dir, 'scenarios')).sort()).toEqual(written.map(w => w.split('/').pop()!).sort());
    const sc = read(join(dir, 'scenarios', 'get-entry.1.scenario.json'));
    expect(sc.trigger).toBe('@features/monitor/edge/get-entry.trigger.json');
    expect(['done', 'failed']).toContain(sc.expect.status);
    // the scenarios are documents of the tree: they load, and they pass check
    const again = loadTree(dir, PLUGINS, INCLUDES);
    expect(again.registry.all('scenario')).toHaveLength(34);
    expect(checkTree(again).items).toEqual([]);
    const r = await regress(again);
    expect(r.ok, r.lines.join('\n')).toBe(true);
    expect(r.lines).toHaveLength(34);
    expect(r.lines.every(l => l.endsWith(': same'))).toBe(true);
    // a graph that changes is caught: the answering node under a new name is a node the scenario never saw
    const g = join(dir, 'features/monitor/data/get-row.graph.json');
    const doc = read(g);
    doc.nodes.find((n: any) => n.id === 'row').id = 'entry'; doc.nodes.find((n: any) => n.id === 'route').rules[1].to = 'entry'; doc.out.from = ['entry', 'missing', 'failed'];
    writeFileSync(g, JSON.stringify(doc));
    const changed = await regress(loadTree(dir, PLUGINS, INCLUDES));
    expect(changed.ok).toBe(false);
    expect(changed.lines.some(l => l.includes('get-entry') && !l.endsWith(': same'))).toBe(true);
    expect(existsSync(join(dir, 'scenarios'))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('wilanis run with files', () => {
  /** A tree with no network in it: a cli trigger that reads the file --file hands in, and one that answers a file. */
  function filesTree(): string {
    const dir = tmp();
    const S = (k: string) => schemaUrl(k as never);
    const put = (rel: string, doc: unknown) => { mkdirSync(join(dir, rel, '..'), { recursive: true }); writeFileSync(join(dir, rel), JSON.stringify(doc)); };
    put('project.json', { $schema: S('project'), name: 'files', description: 'd', plugins: [{ use: '@std' }, { use: '@cli' }, { use: '@blob' }] });
    put('features/files/feature.json', { $schema: S('feature'), description: 'd', exports: [], effects: ['@blob/text.port.json#read', '@blob/text.port.json#write'] });
    put('features/files/domain/files.port.json', { $schema: S('port'), description: 'd', operations: { read: { description: 'the text of a file', accepts: { file: { type: 'blob' } }, returns: 'string' }, hello: { description: 'a file that says hello', returns: 'blob' } } });
    put('features/files/data/files.binding.json', { $schema: S('binding'), description: 'd', port: '@features/files/domain/files.port.json', operations: { read: { graph: '@features/files/data/read-file.graph.json' }, hello: { graph: '@features/files/data/write-hello.graph.json' } } });
    put('features/files/data/read-file.graph.json', { $schema: S('graph'), description: 'd', in: 'blob', out: { type: 'string', from: 'text' }, nodes: [{ type: '@wilanis/node/run.schema.json', id: 'text', run: '@blob/text.port.json#read', in: { file: '{{in}}' } }] });
    put('features/files/data/write-hello.graph.json', { $schema: S('graph'), description: 'd', out: { type: 'blob', from: 'file' }, nodes: [{ type: '@wilanis/node/run.schema.json', id: 'file', run: '@blob/text.port.json#write', in: { text: 'hello', filename: 'hello.txt' } }] });
    put('features/files/edge/Upload.shape.json', { $schema: S('shape'), description: 'd', layer: 'edge', fields: { file: { type: 'blob' } } });
    put('features/files/edge/read.trigger.json', { $schema: S('trigger'), description: 'd', kind: '@cli/cli.trigger-kind.json', settings: {}, in: '@features/files/edge/Upload.shape.json', out: 'string', fire: { run: '@features/files/domain/files.port.json#read', in: { file: '{{request.file}}' } } });
    put('features/files/edge/hello.trigger.json', { $schema: S('trigger'), description: 'd', kind: '@cli/cli.trigger-kind.json', settings: {}, out: 'blob', fire: { run: '@features/files/domain/files.port.json#hello' } });
    writeFileSync(join(dir, 'in.csv'), 'url,method\nhttps://a.example/,GET\n');
    return dir;
  }
  it('hands --file as a blob in request.file: the graph gets a handle, the operation streams the bytes', async () => {
    const dir = filesTree();
    const load = loadTree(dir, PLUGINS);
    expect(checkTree(load).items).toEqual([]);
    const r = await runTrigger(load, '@features/files/edge/read.trigger.json', { file: join(dir, 'in.csv') }, []);
    expect(r.report.status).toBe('done');
    // the node saw a handle, never the bytes
    expect(r.report.nodes.op.sub!.nodes.text.in).toMatchObject({ file: { contentType: 'text/csv', filename: 'in.csv', size: 34 } });
    expect(r.answer).toBe('url,method\nhttps://a.example/,GET\n');
    // without the flag the trigger's input cannot be built, and the run says so
    await expect(runTrigger(load, '@features/files/edge/read.trigger.json', {}, [])).rejects.toThrow('input:');
    rmSync(dir, { recursive: true, force: true });
  });
  it("delivers a blob answer as a stream from the registry, with its handle, and releases the run's blobs after", async () => {
    const dir = filesTree();
    const load = loadTree(dir, PLUGINS);
    const delivered: { handle: unknown; text: string }[] = [];
    const r = await runTrigger(load, '@features/files/edge/hello.trigger.json', {}, [], { deliver: async (body: Readable, handle) => { let t = ''; for await (const c of body) t += c; delivered.push({ handle, text: t }); } });
    expect(r.report.status).toBe('done');
    expect(isBlobHandle(r.answer)).toBe(true);
    expect(delivered).toEqual([{ handle: expect.objectContaining({ contentType: 'text/plain; charset=utf-8', filename: 'hello.txt', size: 5 }), text: 'hello' }]);
    rmSync(dir, { recursive: true, force: true });
  });
});
