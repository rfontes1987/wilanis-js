import { fileURLToPath } from 'node:url';
import { loadProject } from '@wilanis/runtime';
import { describe, expect, it } from 'vitest';
import { type DocView, viewOf } from '../src/index.js';

const EXAMPLE = fileURLToPath(new URL('../../../example', import.meta.url));
const GET_ROW = '@features/monitor/data/get-row.graph.json';

const view = async (path: string): Promise<DocView> => {
  const seen = viewOf(await loadProject(EXAMPLE), path);
  if (!seen) throw new Error(`no view for ${path}`);
  return seen;
};
/** The edge between two ports, as the view drew it. */
const edge = (view: DocView, ends: { from: string; fromPort: string; to: string; toPort: string }) =>
  view.graph!.edges.find(
    one => one.from === ends.from && one.fromPort === ends.fromPort && one.to === ends.to && one.toPort === ends.toPort,
  );

describe('the view model of a graph', () => {
  it('draws a data graph: in, every node, out, with typed ports', async () => {
    const seen = await view(GET_ROW);
    const ids = seen.graph!.nodes.map(node => node.id);
    expect(ids).toEqual(['in', 'asked', 'route/1', 'route/2', 'row', 'missing', 'failed', 'out']);
    const asked = seen.graph!.nodes.find(node => node.id === 'asked')!;
    expect(asked.kind).toBe('run');
    expect(asked.label).toBe('GET the row');
    expect(asked.op).toBe('@http/http.port.json#request');
    expect(asked.target).toMatchObject({ op: '@http/http.port.json#request', native: true, effect: true });
    // every declared input is a port: given literals carry their value, reads carry nothing, absent optionals are marked
    expect(asked.inputs.find(port => port.name === 'method')).toMatchObject({
      type: expect.stringContaining('"GET"'),
      literal: '"GET"',
      static: true,
    });
    expect(asked.inputs.find(port => port.name === 'path')).toMatchObject({ text: '/monitor/{{in.id}}' });
    expect(asked.inputs.find(port => port.name === 'body')).toMatchObject({ missing: true, required: false });
    // a literal that names a document carries the canonical path, so the page can label and link it
    expect(asked.inputs.find(port => port.name === 'returns')).toMatchObject({
      literal: '"@monitor/edge/EntryRow.shape.json"',
      ref: '@features/monitor/edge/EntryRow.shape.json',
    });
    expect(asked.inputs.find(port => port.name === 'connection')?.ref).toBe('@connections/monitor-api.connection.json');
    // the result's fields are output ports, with the type variable bound from `returns`
    expect(asked.outputs.map(port => port.name)).toEqual(['', 'status', 'headers', 'body']);
    expect(asked.outputs.find(port => port.name === 'body')?.type).toBe('@features/monitor/edge/EntryRow.shape.json');
    const input = seen.graph!.nodes.find(node => node.id === 'in')!;
    expect(input.label).toBe('Input');
    expect(input.type).toBe('@features/monitor/domain/EntryRef.shape.json');
    expect(input.outputs.map(port => port.name)).toEqual(['', 'id']);
  });

  it('wires a data edge per read, from the field read to the input that reads it', async () => {
    const seen = await view(GET_ROW);
    expect(edge(seen, { from: 'in', fromPort: 'id', to: 'asked', toPort: 'path' })).toMatchObject({ kind: 'data' });
    expect(edge(seen, { from: 'asked', fromPort: 'status', to: 'route/1', toPort: 'status' })).toMatchObject({
      kind: 'data',
    });
    expect(edge(seen, { from: 'asked', fromPort: 'body', to: 'row', toPort: 'value' })).toMatchObject({ kind: 'data' });
    expect(edge(seen, { from: 'asked', fromPort: 'status', to: 'failed', toPort: 'message' })).toMatchObject({
      kind: 'data',
    });
  });

  it('draws a switch as a ladder: one rule node per rule, reading only what its condition names, then to its target, otherwise down or out', async () => {
    const seen = await view(GET_ROW);
    const first = seen.graph!.nodes.find(node => node.id === 'route/1')!,
      second = seen.graph!.nodes.find(node => node.id === 'route/2')!;
    expect(first).toMatchObject({
      kind: 'rule',
      label: 'if status is 404',
      inputs: [{ name: 'status' }],
      outputs: [{ name: 'then', description: 'missing' }],
    });
    expect(first.decision).toEqual({
      id: 'route',
      label: 'What did the API say?',
      description: undefined,
      when: 'status == 404',
      rule: 1,
      of: 2,
      then: 'missing',
      otherwise: 'route/2',
      last: false,
    });
    // a condition is said in words, one clause per line, each input named so the page can point at its port
    expect(second.label).toBe('if status is 200 and body exists');
    expect(second.says).toEqual([
      { lead: 'if', parts: [{ input: 'status', text: 'status' }, { text: ' is ' }, { value: '200' }] },
      { lead: 'and', parts: [{ input: 'body', text: 'body' }, { text: ' exists' }] },
    ]);
    expect(second.inputs.map(port => port.name)).toEqual(['status', 'body']);
    expect(second.outputs.map(port => port.name)).toEqual(['then', 'otherwise']);
    expect(second.decision).toMatchObject({ rule: 2, then: 'row', otherwise: 'failed', last: true });
    expect(edge(seen, { from: 'route/1', fromPort: 'then', to: 'missing', toPort: '' })).toMatchObject({
      kind: 'route',
    });
    expect(edge(seen, { from: 'route/1', fromPort: 'otherwise', to: 'route/2', toPort: '' })).toMatchObject({
      kind: 'route',
    });
    expect(edge(seen, { from: 'route/2', fromPort: 'then', to: 'row', toPort: '' })).toMatchObject({ kind: 'route' });
    expect(edge(seen, { from: 'route/2', fromPort: 'otherwise', to: 'failed', toPort: '' })).toMatchObject({
      kind: 'route',
    });
    // the body is read by the second rule only: the first never looks at it
    expect(edge(seen, { from: 'asked', fromPort: 'body', to: 'route/2', toPort: 'body' })).toMatchObject({
      kind: 'data',
    });
    expect(edge(seen, { from: 'asked', fromPort: 'body', to: 'route/1', toPort: 'body' })).toBeUndefined();
  });

  it('says a membership rule in words, so every operator of the grammar draws', async () => {
    // 'recorder' in principal.roles used to crash the view: the page 500'd on the graph behind every write
    const seen = await view('@features/access/domain/require-recorder.graph.json');
    const rule = seen.graph!.nodes.find(node =>
      node.says?.some(line => line.parts.some(part => part.text === ' is among ')),
    );
    expect(rule?.label).toBe('if principal exists and "recorder" is among principal \u203a roles');
  });

  it('shows the out node as the fields it answers, fed by each candidate in order', async () => {
    const seen = await view(GET_ROW);
    const out = seen.graph!.nodes.find(node => node.id === 'out')!;
    expect(out.inputs).toEqual([]);
    expect(out.type).toBe('@features/monitor/domain/Entry.shape.json');
    expect(out.fields!.map(port => [port.name, port.type, port.required])).toEqual([
      ['id', 'string', true],
      ['url', 'string', true],
      ['method', 'string', true],
      ['ua', 'string', false],
    ]);
    expect(edge(seen, { from: 'row', fromPort: '', to: 'out', toPort: '' })).toMatchObject({
      kind: 'out',
      label: '1st candidate',
    });
    expect(edge(seen, { from: 'failed', fromPort: '', to: 'out', toPort: '' })).toMatchObject({
      kind: 'out',
      label: '3rd candidate',
    });
    // one candidate needs no ordinal: nothing else could have answered
    const single = await view('@features/monitor/domain/record-entry.graph.json');
    expect(edge(single, { from: 'recorded', fromPort: '', to: 'out', toPort: '' })?.label).toBeUndefined();
  });

  it('names who calls a graph: the binding that binds it, and the trigger that fires the port operation, via it', async () => {
    const seen = await view(GET_ROW);
    expect(seen.callers).toContainEqual({
      path: '@features/monitor/data/monitor-rest.binding.json',
      label: 'REST storage',
      kind: 'binding',
      at: '/operations/get/graph',
    });
    expect(seen.callers).toContainEqual({
      path: '@features/monitor/edge/get-entry.trigger.json',
      label: 'GET /monitor/{id}',
      kind: 'trigger',
      at: '/fire/run',
      via: '@features/monitor/domain/monitor.port.json#get',
    });
  });

  it('points a domain call at its implementation: the graph behind the binding', async () => {
    const seen = await view('@features/monitor/domain/list-entries.graph.json');
    expect(seen.graph!.role).toBe('domain');
    const byMethod = seen.graph!.nodes.find(node => node.id === 'byMethod')!;
    const ByMethod = '@features/monitor/data/list-rows-by-method.graph.json';
    expect(byMethod.target).toEqual({
      op: '@features/monitor/domain/monitor.port.json#listByMethod',
      opName: 'listByMethod',
      port: '@features/monitor/domain/monitor.port.json',
      portLabel: 'Entry storage',
      native: false,
      bindings: [
        {
          path: '@features/monitor/data/monitor-rest.binding.json',
          label: 'REST storage',
          graph: ByMethod,
          graphLabel: 'List rows by method',
        },
      ],
      implementation: ByMethod,
    });
    const asked = (await view(GET_ROW)).graph!.nodes.find(node => node.id === 'asked')!;
    expect(asked.target).toMatchObject({
      portLabel: 'HTTP',
      opName: 'request',
      implementation: '@http/http.port.json',
    });
  });

  it('draws the request as a node whose ports are the paths the resolvers read, the leaf labelled by the resolver', async () => {
    const seen = await view('@features/monitor/data/create-row.graph.json');
    const ids = seen.graph!.nodes.map(node => node.id);
    expect(ids.slice(0, 2)).toEqual(['request', 'in']);
    const request = seen.graph!.nodes.find(node => node.id === 'request')!;
    expect(request.opens).toBe('@features/monitor/edge/request.resolvers.json');
    expect(request.outputs).toEqual([
      { name: 'headers', type: '{, ...}' },
      {
        name: 'headers.user-agent',
        depth: 1,
        type: 'string',
        label: "The caller's user agent",
        description: 'absent when the caller sent none; the header is then not forwarded',
      },
    ]);
    expect(
      edge(seen, { from: 'request', fromPort: 'headers.user-agent', to: 'asked', toPort: 'headers' }),
    ).toMatchObject({
      kind: 'data',
    });
    // no node stands between the request and the node that reads it
    expect(ids).not.toContain('agent');
  });

  it('opens a deep read as an attribute port under its parent', async () => {
    const seen = await view('@features/monitor/data/get-row.graph.json');
    const asked = seen.graph!.nodes.find(node => node.id === 'asked')!;
    // {{asked.status}} and {{asked.body}} read top-level fields, which are ports already: nothing is added
    expect(asked.outputs.map(port => port.name)).toEqual(['', 'status', 'headers', 'body']);
    const other = await view('@features/monitor/domain/record-entry.graph.json');
    const input = other.graph!.nodes.find(node => node.id === 'in')!;
    expect(input.outputs.map(port => port.name)).toEqual(['', 'url', 'method']);
  });
});
