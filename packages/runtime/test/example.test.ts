import { describe, expect, it } from 'vitest';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTree, schemaRef, schemaUrl, type PluginModule } from '@wilanis/core';
import { checkTree } from '@wilanis/compiler';
import http from '@wilanis/plugin-http';
import blobs from '@wilanis/plugin-blob';
import reload from '@wilanis/plugin-reload';
import { BUILTIN_PLUGINS, describe as describeDoc, loadProject, rehearse, start } from '../src/index.js';

const EXAMPLE = fileURLToPath(new URL('../../../example', import.meta.url));
const PLUGINS = { ...BUILTIN_PLUGINS, '@http': http, '@blob': blobs, '@reload': reload };
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

/** Copy the example, move one document to another path, and answer the refusal codes. */
function relocate(from: string, to: string): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'wilanis-'));
  cpSync(EXAMPLE, dir, { recursive: true, filter: p => !p.includes('node_modules') });
  mkdirSync(dirname(join(dir, to)), { recursive: true });
  renameSync(join(dir, from), join(dir, to));
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
    // delete-row is reached directly by the single delete and once per element by the batch delete's map
    expect(text.match(/delete-row  switch 'route'/g)).toHaveLength(1);
    expect(text).toMatch(/every branch settled -- 17 branch\(es\), 7 decision\(s\), 7 graph\(s\)/);
  });
  it('reaches both the answer and the declared failure of every data graph', async () => {
    const r = await rehearse(loadTree(EXAMPLE, PLUGINS), { seed: 1 });
    const text = r.lines.join('\n');
    // the six data graphs each answer on one branch and refuse on purpose on the others
    expect(text.match(/refused on purpose at 'failed' as upstream/g)).toHaveLength(6);
    // the three graphs behind an id declare what a missing id means, and say so in one word the trigger maps
    expect(text.match(/refused on purpose at 'missing' as missing: "no entry /g)).toHaveLength(3);
    // every branch that answers names the node it answered from, never a bare status word
    expect(text.match(/answered from '/g)).toHaveLength(8);
    // the rule is shown as a condition, not as a bare expression next to a node id
    expect(text).toMatch(/when status == 200 && has\(body\)/);
    expect(text).toMatch(/anything else/);
    expect(text).toMatch(/when status == 404/);
  });
  it('rehearses a switch inside a mapped operation through the first element, whatever the seed', async () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const r = await rehearse(loadTree(EXAMPLE, PLUGINS), { seed, verbose: true });
      const text = r.lines.join('\n');
      // the batch delete reaches the delete-row decision through its map, and every branch of it settles
      expect(text).toMatch(/delete-row  switch 'route'  3\/3 branches  \[via delete-entries, delete-entry\]/);
    }
  });
  it('loads its plugin packages through project.json → plugins[].from', async () => {
    const l = await loadProject(EXAMPLE);
    expect(l.refusals.items).toEqual([]);
    expect(l.plugins.map(p => p.root).sort()).toEqual(['@blob', '@cli', '@http', '@reload', '@std']);
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
    // a native document says whose it is: who implements it must not be a code detail
    expect(describeDoc(l, '@http/server.port.json')).toContain('granted by  @http  (@wilanis/plugin-http)');
    expect(describeDoc(l, '@reload/watch.port.json')).toContain('granted by  @reload  (@wilanis/plugin-reload)');
    expect(describeDoc(l, '@std/list.port.json')).toContain('granted by  @std  (built into the runtime)');
    expect(describeDoc(l, '@monitor/domain/monitor.port.json')).not.toContain('granted by');
    // and a holds operation says that it holds
    expect(describeDoc(l, '@http/server.port.json')).toContain('#listen  (holds until stopped)');
    expect(l.registry.get('graph', '@features/monitor/data/get-row.graph.json')!.file).toBe(join(EXAMPLE, 'features/monitor/data/get-row.graph.json'));
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
    const { stop } = await start(l, { log: () => {} });
    expect(calls).toEqual(['up:hi:string']);
    await stop();
    expect(calls).toEqual(['up:hi:string', 'down']);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('the project\'s startup steps', () => {
  /**
   * A tree whose one domain port is met by a native operation the test watches, and whose plugin grants a
   * `holds` operation standing in for a listener. `calls` records the order of the plugin's postLoad, each
   * startup step, and the moment the listener opened -- so the tests can say what started, and whether.
   */
  const tree = (startup: unknown[], onBoot: () => unknown) => {
    const calls: string[] = [];
    const fake: PluginModule = {
      root: '@fake',
      docs: docsDir({
        'plugin.json': { $schema: schemaRef('plugin'), description: 'a plugin behind the boot port', grants: { ports: ['@fake/boot.port.json', '@fake/server.port.json'] } },
        'boot.port.json': { $schema: schemaRef('port'), description: 'what the tree does before it serves', operations: { open: { description: 'open the connection', accepts: { name: { type: 'string' } }, returns: 'string' } } },
        'server.port.json': { $schema: schemaRef('port'), description: 'the listener this tree may open', operations: { listen: { description: 'answer requests until the process stops', holds: true } } },
      }),
      handlers: {
        '@fake/boot.port.json#open': async ({ in: input }: any) => { calls.push(`open:${input.name}`); return onBoot(); },
        '@fake/server.port.json#listen': async ({ ctx }: any) => {
          calls.push('listening');
          ctx.env.hold({ label: 'fake listener', stop: async () => { calls.push('stopped'); } });
          return undefined;
        },
      },
      postLoad: async () => { calls.push('postLoad'); },
    };
    const dir = mkdtempSync(join(tmpdir(), 'wilanis-startup-'));
    mkdirSync(join(dir, 'features/boot/domain'), { recursive: true });
    mkdirSync(join(dir, 'features/boot/data'), { recursive: true });
    const w = (p: string, doc: unknown) => writeFileSync(join(dir, p), JSON.stringify(doc));
    w('project.json', { $schema: schemaUrl('project'), name: 'boot', description: 'a tree with startup steps', plugins: [{ use: '@std' }, { use: '@fake' }], startup });
    w('features/boot/feature.json', { $schema: schemaRef('feature'), description: 'the boot feature', effects: ['@fake/boot.port.json#open'] });
    w('features/boot/domain/ready.port.json', { $schema: schemaRef('port'), description: 'what the tree needs before it serves', operations: {
      warm: { description: 'warm the connection', accepts: { name: { type: 'string' } }, returns: 'string' },
    } });
    w('features/boot/data/ready.binding.json', { $schema: schemaRef('binding'), description: 'met by the fake connection', port: '@features/boot/domain/ready.port.json', operations: {
      warm: { run: '@fake/boot.port.json#open', in: { name: '{{in.name}}' } },
    } });
    return { dir, calls, plugins: { ...BUILTIN_PLUGINS, '@fake': fake } };
  };

  const step = (extra: Record<string, unknown> = {}) => ({ run: '@features/boot/domain/ready.port.json#warm', in: { name: 'db' }, ...extra });
  const listen = { run: '@fake/server.port.json#listen' };

  it('every step runs in order, after postLoad, and the listener is one of them', async () => {
    const { dir, calls, plugins } = tree([step({ in: { name: 'db' } }), step({ in: { name: 'queue' } }), listen], () => 'ok');
    const l = loadTree(dir, plugins);
    expect(checkTree(l).items).toEqual([]);
    const { stop, held } = await start(l, { log: () => {} });
    expect(calls).toEqual(['postLoad', 'open:db', 'open:queue', 'listening']);
    expect(held).toBe(1);
    await stop();
    expect(calls).toEqual(['postLoad', 'open:db', 'open:queue', 'listening', 'stopped']);
    rmSync(dir, { recursive: true, force: true });
  });

  it('a tree whose startup names no listener holds nothing: it serves nothing at all', async () => {
    const { dir, calls, plugins } = tree([step()], () => 'ok');
    const l = loadTree(dir, plugins);
    const { stop, held } = await start(l, { log: () => {} });
    expect(calls).toEqual(['postLoad', 'open:db']);
    expect(calls).not.toContain('listening');
    expect(held).toBe(0);
    await stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('a tree with no startup at all starts nothing', async () => {
    const { dir, calls, plugins } = tree([], () => 'ok');
    const l = loadTree(dir, plugins);
    const { held } = await start(l, { log: () => {} });
    expect(calls).toEqual(['postLoad']);
    expect(held).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it('a required step that fails stops the whole start: nothing listens', async () => {
    const { dir, calls, plugins } = tree([step(), listen], () => { throw new Error('the database is unreachable'); });
    const l = loadTree(dir, plugins);
    await expect(start(l, { log: () => {} })).rejects.toThrow(/the database is unreachable/);
    expect(calls).not.toContain('listening');
    rmSync(dir, { recursive: true, force: true });
  });

  it('an optional step that fails is logged, and the steps after it still run', async () => {
    const { dir, calls, plugins } = tree([step({ required: false }), listen], () => { throw new Error('the cache is cold'); });
    const l = loadTree(dir, plugins);
    const logs: string[] = [];
    const { stop } = await start(l, { log: s => logs.push(s) });
    expect(calls).toContain('listening');
    expect(logs.join('\n')).toMatch(/the cache is cold/);
    await stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('L008 a graph may not run what outlives the run', () => {
    expect(sabotage('features/monitor/data/get-row.graph.json', d => {
      d.nodes[0].run = '@http/server.port.json#listen';
      d.nodes[0].in = {};
    })).toContain('L008');
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
      route.rules = [{ when: 'status >= 200', to: 'rows' }, { when: 'status == 200 && has(body)', to: 'rows' }];
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

describe('sabotage', () => {
  it('G003 a deep path that does not exist', () => {
    expect(sabotage('features/monitor/domain/record-entry.graph.json', d => { d.nodes[0].in.url = '{{in.urrl}}'; })).toContain('G003');
  });
  it('G004 an optional read feeding a required input', () => {
    expect(sabotage('features/monitor/domain/list-entries.graph.json', d => { d.nodes[0].rules[0].when = 'true == true'; })).toContain('G004');
  });
  it('G005 a required input left unwired', () => {
    expect(sabotage('features/monitor/domain/record-entry.graph.json', d => { delete d.nodes[0].in.url; })).toContain('G005');
  });
  it('G008 a node nobody reads', () => {
    expect(sabotage('features/monitor/domain/digest.graph.json', d => { d.out.from = 'all'; d.out.type = '@monitor/domain/Entry.shape.json[]'; })).toContain('G008');
  });
  it('G010 a second out candidate that is never routed', () => {
    expect(sabotage('features/monitor/domain/digest.graph.json', d => { d.out.from = ['joined', 'all']; })).toContain('G010');
  });
  it('L002 an effect run from a domain graph', () => {
    expect(sabotage('features/monitor/domain/digest.graph.json', d => { d.nodes[0].run = '@http/http.port.json#request'; d.nodes[0].in = { connection: '@connections/monitor-api.connection.json', method: 'GET', path: '/x' }; })).toContain('L002');
  });
  it('D008 a port outside the domain layer', () => {
    expect(relocate('features/monitor/domain/monitor.port.json', 'features/monitor/edge/monitor.port.json')).toContain('D008');
  });
  it('D008 a trigger outside the edge layer', () => {
    expect(relocate('features/monitor/edge/digest.trigger.json', 'features/monitor/domain/digest.trigger.json')).toContain('D008');
  });
  it('D008 a document in a feature but in no layer at all', () => {
    expect(relocate('features/monitor/domain/Entry.shape.json', 'features/monitor/Entry.shape.json')).toContain('D008');
  });
  it('D008 a connection outside connections/', () => {
    expect(relocate('connections/monitor-api.connection.json', 'features/monitor/data/monitor-api.connection.json')).toContain('D008');
  });
  it('D008 a shape whose declared layer contradicts the directory it sits in', () => {
    expect(sabotage('features/monitor/domain/Entry.shape.json', d => { d.layer = 'edge'; })).toContain('D008');
  });
  it('L006 a trigger that fires a native operation instead of a domain port', () => {
    expect(sabotage('features/monitor/edge/digest.trigger.json', d => { d.fire.run = '@std/list.port.json#count'; })).toContain('L006');
  });
  it('L007 a domain graph that only forwards its input to one port operation', () => {
    expect(sabotage('features/monitor/domain/record-entry.graph.json', d => {
      // strip what earns its place: the constant it injects, so it becomes a pass-through
      delete d.constants;
      d.in = '@monitor/domain/EntryRef.shape.json';
      d.out = { type: '@monitor/domain/Entry.shape.json', from: 'recorded' };
      d.nodes = [{ type: '@wilanis/node/run.schema.json', id: 'recorded', run: '@monitor/domain/monitor.port.json#get', in: { id: '{{in.id}}' } }];
    })).toContain('L007');
  });
  it('L003 an effect the feature does not allow', () => {
    expect(sabotage('features/monitor/feature.json', d => { d.effects = []; })).toContain('L003');
  });
  it('T002 a trigger whose edge shape does not fit the graph', () => {
    expect(sabotage('features/monitor/edge/RecordRequest.shape.json', d => { delete d.fields.url; })).toContain('T002');
  });
  it('T004 a resolver reading request.* under a kind that hands none', () => {
    // list-rows is reached from the digest, a cli trigger: the command line hands no headers
    expect(sabotage('features/monitor/data/list-rows.graph.json', d => {
      d.resolvers = '@monitor/edge/request.resolvers.json';
      d.nodes[0].in.headers = { 'x-forwarded-user-agent': '{{agent}}' };
    })).toContain('T004');
  });
  it('L002 a domain graph that names a resolvers document', () => {
    expect(sabotage('features/monitor/domain/digest.graph.json', d => { d.resolvers = '@monitor/edge/request.resolvers.json'; })).toContain('L002');
  });
  it('R001 a resolvers document that does not exist', () => {
    expect(sabotage('features/monitor/data/create-row.graph.json', d => { d.resolvers = '@monitor/edge/nope.resolvers.json'; })).toContain('R001');
  });
  it('G003 a read of a resolver the named document does not define', () => {
    expect(sabotage('features/monitor/data/create-row.graph.json', d => { d.nodes[0].in.headers = { 'x-forwarded-user-agent': '{{caller}}' }; })).toContain('G003');
  });
  it('P002 a resolver reading a path no trigger kind hands', () => {
    expect(sabotage('features/monitor/edge/request.resolvers.json', d => { d.resolvers.agent.read = 'request.cookies.session'; })).toContain('P002');
  });
  it('P003 a resolver named like a root', () => {
    expect(sabotage('features/monitor/edge/request.resolvers.json', d => { d.resolvers.in = { read: 'request.headers.host' }; })).toContain('P003');
  });
  it('D001 a resolver whose read does not start at the request', () => {
    expect(sabotage('features/monitor/edge/request.resolvers.json', d => { d.resolvers.agent.read = "headers['user-agent']"; })).toContain('D001');
  });
  it('D008 a resolvers document outside the edge layer', () => {
    expect(relocate('features/monitor/edge/request.resolvers.json', 'features/monitor/data/request.resolvers.json')).toContain('D008');
  });
  it('T005 a refusal reason the trigger can reach but does not map', () => {
    expect(sabotage('features/monitor/edge/get-entry.trigger.json', t => { delete t.settings.response.refusals.missing; })).toEqual(['T005']);
  });
  it('T005 a reason reached only through a map, from the batch delete', () => {
    expect(sabotage('features/monitor/edge/delete-entries.trigger.json', t => { delete t.settings.response.refusals.missing; })).toEqual(['T005']);
  });
  it('T006 a mapped reason nothing the trigger fires refuses with', () => {
    expect(sabotage('features/monitor/edge/get-entry.trigger.json', t => { t.settings.response.refusals.teapot = 418; })).toEqual(['T006']);
  });
  it('P001 a reason given as a read: the checker must see the word', () => {
    // and with the word unreadable, the mapping that named it has nothing to point at
    expect(sabotage('features/monitor/data/get-row.graph.json', g => { g.nodes.find((n: any) => n.id === 'missing').in.reason = '{{asked.status}}'; }).sort()).toEqual(['P001', 'T006']);
  });
  it('G005 a refusal without a reason', () => {
    expect(sabotage('features/monitor/data/get-row.graph.json', g => { delete g.nodes.find((n: any) => n.id === 'missing').in.reason; }).sort()).toEqual(['G005', 'T006']);
  });
  it('G006 an input the operation does not declare', () => {
    expect(sabotage('features/monitor/data/list-rows.graph.json', d => { d.nodes[0].in.query = { a: 'b' }; })).toContain('G006');
  });
  it('P001 a static field given a read', () => {
    expect(sabotage('features/monitor/data/list-rows-by-method.graph.json', d => { d.nodes[0].in.method = '{{in.method}}'; })).toContain('P001');
  });
  it('G003 a read of a node that does not exist', () => {
    expect(sabotage('features/monitor/data/list-rows.graph.json', d => { d.nodes[2].in.value = '{{asked2.body}}'; })).toContain('G003');
  });
  it('T003 a route placeholder the route does not declare', () => {
    expect(sabotage('features/monitor/edge/get-entry.trigger.json', d => { d.settings.route = '/monitor/{entry}'; })).toContain('T003');
  });
  it('X003 a throttle that lets nothing through', () => {
    expect(sabotage('connections/monitor-api.connection.json', d => { d.settings.throttle.concurrency = 0; })).toContain('X003');
    expect(sabotage('connections/monitor-api.connection.json', d => { d.settings.throttle = { perSecond: -1 }; })).toContain('X003');
    expect(sabotage('connections/monitor-api.connection.json', d => { d.settings.throttle.concurrency = 1.5; })).toContain('X003');
  });
  it('C002 a throttle that is not a number', () => {
    expect(sabotage('connections/monitor-api.connection.json', d => { d.settings.throttle.concurrency = 'four'; })).toContain('C002');
  });
  it('G012 a map over something that is not a list', () => {
    expect(sabotage('features/monitor/domain/remove-entries.graph.json', d => { d.in = 'string'; })).toContain('G012');
  });
  it('B005 a graph that takes its input whole, bound to an operation that accepts two fields', () => {
    expect(sabotage('features/monitor/domain/monitor.port.json', d => { d.operations.removeMany.accepts.reason = { type: 'string' }; })).toContain('B005');
  });
  it('B005 a graph that takes its input whole, fed a field of another type', () => {
    expect(sabotage('features/monitor/domain/monitor.port.json', d => { d.operations.removeMany.accepts.ids.type = 'number[]'; })).toContain('B005');
  });
  it('B006 a startup step naming an operation the port does not have', () => {
    expect(sabotage('project.json', d => { d.startup[0].run = '@monitor/domain/monitor.port.json#nope'; })).toContain('B006');
  });
  it('B006 a startup step firing a native operation', () => {
    expect(sabotage('project.json', d => { d.startup[0].run = '@http/http.port.json#request'; })).toContain('B006');
  });
  it('B007 a startup step giving input to an operation that takes none', () => {
    expect(sabotage('project.json', d => { d.startup[0].in = { bogus: 'x' }; })).toContain('B007');
  });
  it('B007 a startup step reading the request, which nothing has sent yet', () => {
    expect(sabotage('project.json', d => { d.startup[0].in = { x: '{{request.body}}' }; })).toContain('B007');
  });
  it('B007 a startup step reading an undeclared secret', () => {
    expect(sabotage('project.json', d => { d.startup[0].in = { x: '{{secrets.nope}}' }; })).toContain('B007');
  });
  it('B008 a startup step whose bound graph reads the request', () => {
    expect(sabotage('project.json', d => {
      d.startup[0].run = '@monitor/domain/monitor.port.json#record';
      d.startup[0].in = { url: 'http://x', method: 'GET', ua: 'startup' };
    })).toContain('B008');
  });
  it('X002 a content type with no codec', () => {
    expect(sabotage('features/monitor/edge/record-entry.trigger.json', d => { d.settings.consumes = 'application/xml'; })).toContain('X002');
  });
  it('B004 a profile whose binding implements another port', () => {
    expect(sabotage('features/monitor/data/monitor-rest.binding.json', d => { d.port = '@monitor/other.port.json'; })).toContain('B004');
  });
  it('B002 a domain port with no binding once the profile is gone', () => {
    expect(sabotage('project.json', d => { delete d.profiles; d.aliases['@monitor'] = '@features/nowhere'; })).toContain('B002');
  });
  it('D001 a document that breaks its schema', () => {
    expect(sabotage('features/monitor/domain/monitor.port.json', d => { d.operations.listAll.returnz = 'x'; })).toContain('D001');
  });
  it('D001 a $schema in neither the published nor the alias form', () => {
    expect(sabotage('features/monitor/domain/monitor.port.json', d => { d.$schema = 'https://example.com/port.schema.json'; })).toContain('D001');
  });
  it('R001 an alias to nowhere', () => {
    expect(sabotage('features/monitor/domain/digest.graph.json', d => { d.nodes[0].run = '@monitor/nope.port.json#listAll'; })).toContain('R001');
  });
});
