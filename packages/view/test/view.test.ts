import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadProject } from '@wilanis/runtime';
import { indexOf, schemaRelOf, schemaViewOf, serveView, viewOf, type DocView, type SchemaView } from '../src/index.js';

const EXAMPLE = fileURLToPath(new URL('../../../example', import.meta.url));
const GET_ROW = '@features/monitor/data/get-row.graph.json';

const view = async (path: string): Promise<DocView> => {
  const v = viewOf(await loadProject(EXAMPLE), path);
  if (!v) throw new Error(`no view for ${path}`);
  return v;
};
const edge = (v: DocView, from: string, fromPort: string, to: string, toPort: string) =>
  v.graph!.edges.find(e => e.from === from && e.fromPort === fromPort && e.to === to && e.toPort === toPort);

describe('the view model of the example', () => {
  it('lists every document, sorted by kind then path, with no refusals', async () => {
    const idx = indexOf(await loadProject(EXAMPLE));
    expect(idx.project).toBe('monitor');
    expect(idx.refusals).toEqual([]);
    expect(idx.docs.map(d => d.kind)).toEqual(idx.docs.map(d => d.kind).slice().sort());
    expect(idx.docs.some(d => d.path === '@http/http.port.json' && d.native === '@http')).toBe(true);
    expect(idx.aliases).toEqual({ '@monitor': '@features/monitor' });
  });

  it('labels every document: its own label, or its file name made readable', async () => {
    const idx = indexOf(await loadProject(EXAMPLE));
    expect(idx.docs.find(d => d.path === GET_ROW)?.label).toBe('Get a row');
    expect(idx.docs.find(d => d.path === '@http/http.port.json')?.label).toBe('HTTP');
    const v = await view('@features/monitor/domain/Entry.shape.json');
    expect(v.label).toBe('Entry');
    expect(v.refs).toEqual([]);
    expect(v.callers.find(c => c.path === GET_ROW)?.label).toBe('Get a row');
  });

  it('answers undefined for a path that names nothing', async () => {
    expect(viewOf(await loadProject(EXAMPLE), '@features/nope.graph.json')).toBeUndefined();
  });

  it('accepts an alias and answers the canonical path', async () => {
    const v = await view('@monitor/data/get-row.graph.json');
    expect(v.path).toBe(GET_ROW);
    expect(v.kind).toBe('graph');
    expect(v.graph?.role).toBe('data');
  });

  it('draws a data graph: in, every node, out, with typed ports', async () => {
    const v = await view(GET_ROW);
    const ids = v.graph!.nodes.map(n => n.id);
    expect(ids).toEqual(['in', 'asked', 'route/1', 'route/2', 'row', 'missing', 'failed', 'out']);
    const asked = v.graph!.nodes.find(n => n.id === 'asked')!;
    expect(asked.kind).toBe('run');
    expect(asked.label).toBe('GET the row');
    expect(asked.op).toBe('@http/http.port.json#request');
    expect(asked.target).toMatchObject({ op: '@http/http.port.json#request', native: true, effect: true });
    // every declared input is a port: given literals carry their value, reads carry nothing, absent optionals are marked
    expect(asked.inputs.find(p => p.name === 'method')).toMatchObject({ type: expect.stringContaining('"GET"'), literal: '"GET"', static: true });
    expect(asked.inputs.find(p => p.name === 'path')).toMatchObject({ text: '/monitor/{{in.id}}' });
    expect(asked.inputs.find(p => p.name === 'body')).toMatchObject({ missing: true, required: false });
    // a literal that names a document carries the canonical path, so the page can label and link it
    expect(asked.inputs.find(p => p.name === 'returns')).toMatchObject({ literal: '"@monitor/edge/EntryRow.shape.json"', ref: '@features/monitor/edge/EntryRow.shape.json' });
    expect(asked.inputs.find(p => p.name === 'connection')?.ref).toBe('@connections/monitor-api.connection.json');
    // the result's fields are output ports, with the type variable bound from `returns`
    expect(asked.outputs.map(p => p.name)).toEqual(['', 'status', 'headers', 'body']);
    expect(asked.outputs.find(p => p.name === 'body')?.type).toBe('@features/monitor/edge/EntryRow.shape.json');
    const input = v.graph!.nodes.find(n => n.id === 'in')!;
    expect(input.label).toBe('Input');
    expect(input.type).toBe('@features/monitor/domain/EntryRef.shape.json');
    expect(input.outputs.map(p => p.name)).toEqual(['', 'id']);
  });

  it('wires a data edge per read, from the field read to the input that reads it', async () => {
    const v = await view(GET_ROW);
    expect(edge(v, 'in', 'id', 'asked', 'path')).toMatchObject({ kind: 'data' });
    expect(edge(v, 'asked', 'status', 'route/1', 'status')).toMatchObject({ kind: 'data' });
    expect(edge(v, 'asked', 'body', 'row', 'value')).toMatchObject({ kind: 'data' });
    expect(edge(v, 'asked', 'status', 'failed', 'message')).toMatchObject({ kind: 'data' });
  });

  it('draws a switch as a ladder: one rule node per rule, reading only what its condition names, then to its target, otherwise down or out', async () => {
    const v = await view(GET_ROW);
    const first = v.graph!.nodes.find(n => n.id === 'route/1')!, second = v.graph!.nodes.find(n => n.id === 'route/2')!;
    expect(first).toMatchObject({ kind: 'rule', label: 'if status is 404', inputs: [{ name: 'status' }], outputs: [{ name: 'then', description: 'missing' }] });
    expect(first.decision).toEqual({ id: 'route', label: 'What did the API say?', description: undefined, when: 'status == 404', rule: 1, of: 2, then: 'missing', otherwise: 'route/2', last: false });
    // a condition is said in words, one clause per line, each input named so the page can point at its port
    expect(second.label).toBe('if status is 200 and body exists');
    expect(second.says).toEqual([
      { lead: 'if', parts: [{ input: 'status', text: 'status' }, { text: ' is ' }, { value: '200' }] },
      { lead: 'and', parts: [{ input: 'body', text: 'body' }, { text: ' exists' }] },
    ]);
    expect(second.inputs.map(p => p.name)).toEqual(['status', 'body']);
    expect(second.outputs.map(p => p.name)).toEqual(['then', 'otherwise']);
    expect(second.decision).toMatchObject({ rule: 2, then: 'row', otherwise: 'failed', last: true });
    expect(edge(v, 'route/1', 'then', 'missing', '')).toMatchObject({ kind: 'route' });
    expect(edge(v, 'route/1', 'otherwise', 'route/2', '')).toMatchObject({ kind: 'route' });
    expect(edge(v, 'route/2', 'then', 'row', '')).toMatchObject({ kind: 'route' });
    expect(edge(v, 'route/2', 'otherwise', 'failed', '')).toMatchObject({ kind: 'route' });
    // the body is read by the second rule only: the first never looks at it
    expect(edge(v, 'asked', 'body', 'route/2', 'body')).toMatchObject({ kind: 'data' });
    expect(edge(v, 'asked', 'body', 'route/1', 'body')).toBeUndefined();
  });

  it('shows the out node as the fields it answers, fed by each candidate in order', async () => {
    const v = await view(GET_ROW);
    const out = v.graph!.nodes.find(n => n.id === 'out')!;
    expect(out.inputs).toEqual([]);
    expect(out.type).toBe('@features/monitor/domain/Entry.shape.json');
    expect(out.fields!.map(p => [p.name, p.type, p.required])).toEqual([['id', 'string', true], ['url', 'string', true], ['method', 'string', true], ['ua', 'string', false]]);
    expect(edge(v, 'row', '', 'out', '')).toMatchObject({ kind: 'out', label: '1st candidate' });
    expect(edge(v, 'failed', '', 'out', '')).toMatchObject({ kind: 'out', label: '3rd candidate' });
    // one candidate needs no ordinal: nothing else could have answered
    const single = await view('@features/monitor/domain/record-entry.graph.json');
    expect(edge(single, 'recorded', '', 'out', '')?.label).toBeUndefined();
  });

  it('names who calls a graph: the binding that binds it, and the trigger that fires the port operation, via it', async () => {
    const v = await view(GET_ROW);
    expect(v.callers).toContainEqual({ path: '@features/monitor/data/monitor-rest.binding.json', label: 'REST storage', kind: 'binding', at: '/operations/get/graph' });
    expect(v.callers).toContainEqual({ path: '@features/monitor/edge/get-entry.trigger.json', label: 'GET /monitor/{id}', kind: 'trigger', at: '/fire/run', via: '@features/monitor/domain/monitor.port.json#get' });
  });

  it('points a domain call at its implementation: the graph behind the binding', async () => {
    const v = await view('@features/monitor/domain/list-entries.graph.json');
    expect(v.graph?.role).toBe('domain');
    const byMethod = v.graph!.nodes.find(n => n.id === 'byMethod')!;
    const BY_METHOD = '@features/monitor/data/list-rows-by-method.graph.json';
    expect(byMethod.target).toEqual({
      op: '@features/monitor/domain/monitor.port.json#listByMethod', opName: 'listByMethod', port: '@features/monitor/domain/monitor.port.json', portLabel: 'Entry storage', native: false,
      bindings: [{ path: '@features/monitor/data/monitor-rest.binding.json', label: 'REST storage', graph: BY_METHOD, graphLabel: 'List rows by method' }],
      implementation: BY_METHOD,
    });
    const asked = (await view(GET_ROW)).graph!.nodes.find(n => n.id === 'asked')!;
    expect(asked.target).toMatchObject({ portLabel: 'HTTP', opName: 'request', implementation: '@http/http.port.json' });
  });

  it('draws the request as a node whose ports are the paths the resolvers read, the leaf labelled by the resolver', async () => {
    const v = await view('@features/monitor/data/create-row.graph.json');
    const ids = v.graph!.nodes.map(n => n.id);
    expect(ids.slice(0, 2)).toEqual(['request', 'in']);
    const request = v.graph!.nodes.find(n => n.id === 'request')!;
    expect(request.opens).toBe('@features/monitor/edge/request.resolvers.json');
    expect(request.outputs).toEqual([
      { name: 'headers', type: '{, ...}' },
      { name: 'headers.user-agent', depth: 1, type: 'string', label: "The caller's user agent", description: 'absent when the caller sent none; the header is then not forwarded' },
    ]);
    expect(edge(v, 'request', 'headers.user-agent', 'asked', 'headers')).toMatchObject({ kind: 'data' });
    // no node stands between the request and the node that reads it
    expect(ids).not.toContain('agent');
  });

  it('opens a deep read as an attribute port under its parent', async () => {
    const v = await view('@features/monitor/data/get-row.graph.json');
    const asked = v.graph!.nodes.find(n => n.id === 'asked')!;
    // {{asked.status}} and {{asked.body}} read top-level fields, which are ports already: nothing is added
    expect(asked.outputs.map(p => p.name)).toEqual(['', 'status', 'headers', 'body']);
    const w = await view('@features/monitor/domain/record-entry.graph.json');
    const input = w.graph!.nodes.find(n => n.id === 'in')!;
    expect(input.outputs.map(p => p.name)).toEqual(['', 'url', 'method']);
  });

  it('names the port operation a trigger fires and where it leads', async () => {
    const v = await view('@features/monitor/edge/get-entry.trigger.json');
    expect(v.fires).toMatchObject({ op: '@features/monitor/domain/monitor.port.json#get', opName: 'get', portLabel: 'Entry storage', native: false, implementation: GET_ROW });
    expect(v.fires!.bindings![0]).toMatchObject({ label: 'REST storage', graphLabel: 'Get a row' });
    // the graph behind the binding knows the trigger reaches it
    const g = await view(GET_ROW);
    expect(g.callers).toContainEqual({ path: '@features/monitor/edge/get-entry.trigger.json', label: 'GET /monitor/{id}', kind: 'trigger', at: '/fire/run', via: '@features/monitor/domain/monitor.port.json#get' });
  });

  it('composes two nodes into one output: the digest', async () => {
    const v = await view('@features/monitor/domain/digest.graph.json');
    expect(edge(v, 'count', '', 'digest', 'value')).toMatchObject({ kind: 'data' });
    expect(v.graph!.nodes.find(n => n.id === 'digest')!.target).toMatchObject({ portLabel: 'Objects', opName: 'make', pure: true });
    expect(edge(v, 'joined', '', 'digest', 'value')).toMatchObject({ kind: 'data' });
    const out = v.graph!.nodes.find(n => n.id === 'out')!;
    expect(out.fields!.map(p => p.name)).toEqual(['count', 'text']);
    expect(edge(v, 'digest', '', 'out', '')).toMatchObject({ kind: 'out' });
  });

  it('draws a map node with its over port and a list result', async () => {
    const v = await view('@features/monitor/domain/digest.graph.json');
    const lines = v.graph!.nodes.find(n => n.id === 'lines')!;
    expect(lines.kind).toBe('map');
    expect(lines.inputs[0].name).toBe('over');
    expect(lines.outputs).toEqual([{ name: '', type: 'string[]' }]);
    expect(edge(v, 'all', '', 'lines', 'over')).toMatchObject({ kind: 'data' });
  });

  it('answers references both ways for a document that is not a graph', async () => {
    const port = await view('@features/monitor/domain/monitor.port.json');
    expect(port.graph).toBeUndefined();
    expect(port.callers.map(c => c.path)).toContain('@features/monitor/data/monitor-rest.binding.json');
    expect(port.callers.map(c => c.path)).toContain('@features/monitor/domain/list-entries.graph.json');
    expect(port.refs.map(r => r.path)).toContain('@features/monitor/domain/Entry.shape.json');
    expect(port.implementations).toEqual([{ path: '@features/monitor/data/monitor-rest.binding.json', label: 'REST storage', operations: expect.objectContaining({ get: { graph: GET_ROW, graphLabel: 'Get a row' } }) }]);
  });
});

describe('schemas as pages', () => {
  it('recognises a schema reference in either form, and nothing else', () => {
    expect(schemaRelOf('@wilanis/node/run.schema.json')).toBe('node/run.schema.json');
    expect(schemaRelOf('@wilanis/graph.schema.json')).toBe('graph.schema.json');
    expect(schemaRelOf('https://raw.githubusercontent.com/rfontes1987/wilanis-js/schemas-v1/packages/core/schemas/trigger.schema.json')).toBe('trigger.schema.json');
    expect(schemaRelOf('@features/monitor/domain/Entry.shape.json')).toBeUndefined();
    expect(schemaRelOf('@wilanis/../package.json')).toBeUndefined();
    expect(schemaRelOf(42)).toBeUndefined();
  });

  it('views a schema: the kind it judges, its title, where it is published', () => {
    const graph = schemaViewOf('graph.schema.json', { title: 'graph', description: 'A dataflow.' });
    expect(graph).toMatchObject({ kind: 'schema', path: '@wilanis/graph.schema.json', judges: 'graph', label: 'graph', description: 'A dataflow.', url: expect.stringMatching(/schemas-v1\/packages\/core\/schemas\/graph\.schema\.json$/) });
    expect(schemaViewOf('node/run.schema.json', { title: 'node/run' }).judges).toBeUndefined();
    expect(schemaViewOf('common.schema.json', {}).judges).toBeUndefined();
  });
});

describe('the view server', () => {
  it('serves the page, the index and a document; refuses a missing path', async () => {
    const s = await serveView(EXAMPLE, { port: 0 });
    try {
      const page = await fetch(s.url);
      expect(page.headers.get('content-type')).toContain('text/html');
      expect(await page.text()).toContain('wilanis view');
      const idx = await (await fetch(`${s.url}api/index`)).json() as { docs: unknown[]; version: string; schemaBase: string };
      expect(idx.docs.length).toBeGreaterThan(40);
      expect(typeof idx.version).toBe('string');
      expect(idx.schemaBase).toMatch(/^https:\/\/.*\/schemas$/);
      const doc = await (await fetch(`${s.url}api/doc?path=${encodeURIComponent('@monitor/data/get-row.graph.json')}`)).json() as DocView;
      expect(doc.path).toBe(GET_ROW);
      expect(doc.graph?.nodes.length).toBe(8);
      const missing = await fetch(`${s.url}api/doc?path=${encodeURIComponent('@features/nope.json')}`);
      expect(missing.status).toBe(404);
      const none = await fetch(`${s.url}api/doc`);
      expect(none.status).toBe(400);
      // a node type opens as a page: the schema itself, read from the installed core
      const run = await (await fetch(`${s.url}api/schema?path=${encodeURIComponent('node/run.schema.json')}`)).json() as SchemaView;
      expect(run).toMatchObject({ kind: 'schema', path: '@wilanis/node/run.schema.json', label: 'node/run', file: expect.stringMatching(/schemas\/node\/run\.schema\.json$/) });
      expect((run.schema as { properties: { type: { const: string } } }).properties.type.const).toBe('@wilanis/node/run.schema.json');
      expect((await fetch(`${s.url}api/schema?path=${encodeURIComponent('../package.json')}`)).status).toBe(404);
      expect((await fetch(`${s.url}api/schema?path=nope.schema.json`)).status).toBe(404);
      expect((await fetch(`${s.url}api/schema`)).status).toBe(400);
    } finally { await s.close(); }
  });
});
