import { fileURLToPath } from 'node:url';
import { loadProject } from '@wilanis/runtime';
import { describe, expect, it } from 'vitest';
import { type DocView, indexOf, viewOf } from '../src/index.js';

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

describe('the view model of the example', () => {
  it('lists every document, sorted by kind then path, with no refusals', async () => {
    const idx = indexOf(await loadProject(EXAMPLE));
    expect(idx.project).toBe('monitor');
    expect(idx.refusals).toEqual([]);
    expect(idx.docs.map(doc => doc.kind)).toEqual(
      idx.docs
        .map(doc => doc.kind)
        .slice()
        .sort(),
    );
    expect(idx.docs.some(doc => doc.path === '@http/http.port.json' && doc.native === '@http')).toBe(true);
    expect(idx.aliases).toEqual({
      '@monitor': '@features/monitor',
      '@access': '@features/access',
      '@hello': '@features/hello',
    });
  });

  it('labels every document: its own label, or its file name made readable', async () => {
    const idx = indexOf(await loadProject(EXAMPLE));
    expect(idx.docs.find(doc => doc.path === GET_ROW)?.label).toBe('Get a row');
    expect(idx.docs.find(doc => doc.path === '@http/http.port.json')?.label).toBe('HTTP');
    const seen = await view('@features/monitor/domain/Entry.shape.json');
    expect(seen.label).toBe('Entry');
    expect(seen.refs).toEqual([]);
    expect(seen.callers.find(caller => caller.path === GET_ROW)?.label).toBe('Get a row');
  });

  it('answers undefined for a path that names nothing', async () => {
    expect(viewOf(await loadProject(EXAMPLE), '@features/nope.graph.json')).toBeUndefined();
  });

  it('accepts an alias and answers the canonical path', async () => {
    const seen = await view('@monitor/data/get-row.graph.json');
    expect(seen.path).toBe(GET_ROW);
    expect(seen.kind).toBe('graph');
    expect(seen.graph!.role).toBe('data');
  });

  it('names the port operation a trigger fires and where it leads', async () => {
    const seen = await view('@features/monitor/edge/get-entry.trigger.json');
    expect(seen.fires).toMatchObject({
      op: '@features/monitor/domain/monitor.port.json#get',
      opName: 'get',
      portLabel: 'Entry storage',
      native: false,
      implementation: GET_ROW,
    });
    expect(seen.fires!.bindings![0]).toMatchObject({ label: 'REST storage', graphLabel: 'Get a row' });
    // the graph behind the binding knows the trigger reaches it
    const graph = await view(GET_ROW);
    expect(graph.callers).toContainEqual({
      path: '@features/monitor/edge/get-entry.trigger.json',
      label: 'GET /monitor/{id}',
      kind: 'trigger',
      at: '/fire/run',
      via: '@features/monitor/domain/monitor.port.json#get',
    });
  });

  it('says how a trigger answers each refusal it can reach, and which node refuses with it', async () => {
    const seen = await view('@features/monitor/edge/get-entry.trigger.json');
    expect(seen.answers).toEqual([
      // one reason, refused in both bindings' graphs: the viewer names each, since which one runs is the
      // profile's choice and a reader of the route wants to see every place the answer can come from
      {
        reason: 'missing',
        answer: 404,
        from: [
          { graph: GET_ROW, graphLabel: 'Get a row', node: 'missing', nodeLabel: 'No such entry' },
          {
            graph: '@features/monitor/data/kept-get.graph.json',
            graphLabel: 'Get what is kept',
            node: 'missing',
            nodeLabel: 'No such entry',
          },
        ],
      },
      {
        reason: 'upstream',
        answer: 502,
        from: [{ graph: GET_ROW, graphLabel: 'Get a row', node: 'failed', nodeLabel: 'Unexpected answer' }],
      },
    ]);
    // reached through a domain graph and a map: the batch delete refuses where delete-row does
    const batch = await view('@features/monitor/edge/delete-entries.trigger.json');
    expect(batch.answers!.find(answer => answer.reason === 'missing')).toMatchObject({
      answer: 404,
      from: [
        { graph: '@features/monitor/data/delete-row.graph.json', node: 'missing' },
        { graph: '@features/monitor/data/kept-remove.graph.json', node: 'missing' },
      ],
    });
    // a kind that maps no refusals has nothing to say here
    expect((await view('@features/monitor/edge/digest.trigger.json')).answers).toBeUndefined();
  });
  it('tells a refusing node which triggers reach it and how each answers its reason', async () => {
    const missing = (await view(GET_ROW)).graph!.nodes.find(node => node.id === 'missing')!;
    expect(missing.target?.refuses).toBe(true);
    expect(missing.answeredBy).toEqual([
      {
        trigger: '@features/monitor/edge/get-entry.trigger.json',
        triggerLabel: 'GET /monitor/{id}',
        maps: true,
        answer: 404,
      },
    ]);
    // list-rows is reached by the http listing, which maps the reason, and by the cli digest, whose kind answers every refusal alike
    const failed = (await view('@features/monitor/data/list-rows.graph.json')).graph!.nodes.find(
      node => node.id === 'failed',
    )!;
    expect(failed.answeredBy).toEqual(
      expect.arrayContaining([
        {
          trigger: '@features/monitor/edge/list-entries.trigger.json',
          triggerLabel: 'GET /monitor',
          maps: true,
          answer: 502,
        },
        { trigger: '@features/monitor/edge/digest.trigger.json', triggerLabel: 'digest', maps: false },
      ]),
    );
    // a node that answers has no such list
    expect((await view(GET_ROW)).graph!.nodes.find(node => node.id === 'row')?.answeredBy).toBeUndefined();
  });
  it('views a policy: what it decides through, its outcomes, what it proves, and the triggers it gates', async () => {
    const seen = await view('@features/access/edge/employees-only.policy.json');
    expect(seen.kind).toBe('policy');
    expect(seen.decides).toMatchObject({
      op: '@features/access/domain/access.port.json#requireEmployee',
      opName: 'requireEmployee',
      native: false,
      implementation: '@features/access/domain/require-employee.graph.json',
    });
    expect(seen.outcomes!.forbidden).toMatchObject({ effect: 'deny' });
    expect(seen.proves).toEqual(['request.principal', 'request.session']);
    expect(seen.gates?.map(gate => gate.path)).toEqual(
      expect.arrayContaining([
        '@features/monitor/edge/record-entry.trigger.json',
        '@features/monitor/edge/update-entry.trigger.json',
        '@features/monitor/edge/delete-entry.trigger.json',
      ]),
    );
    // the trigger attaches its policies in order, giving the guard the token where it may sit, and answers the reasons they reach and the guard's own
    const trigger = await view('@features/monitor/edge/record-entry.trigger.json');
    expect(trigger.policies).toHaveLength(2);
    expect(trigger.policies![0]).toMatchObject({
      path: '@features/access/edge/employees-only.policy.json',
      label: 'Employees only',
      decide: '@access/domain/access.port.json#requireEmployee',
      gives: { token: ['{{request.headers.authorization}}', '{{request.cookies.session}}'] },
    });
    expect(trigger.policies![1].gives).toBeUndefined();
    const reasons = trigger.answers!.map(answer => answer.reason);
    expect(reasons).toEqual(expect.arrayContaining(['forbidden', 'anonymous', 'invalid_credential', 'upstream']));
    expect(trigger.answers!.find(answer => answer.reason === 'invalid_credential')).toMatchObject({
      answer: 401,
      from: [{ graph: '@auth/plugin.json', node: 'identify' }],
    });
    expect(trigger.answers!.find(answer => answer.reason === 'forbidden')?.from.map(field => field.graph)).toEqual(
      expect.arrayContaining([
        '@features/access/domain/require-employee.graph.json',
        '@features/access/domain/require-recorder.graph.json',
      ]),
    );
  });
  it('composes two nodes into one output: the digest', async () => {
    const seen = await view('@features/monitor/domain/digest.graph.json');
    expect(edge(seen, { from: 'count', fromPort: '', to: 'digest', toPort: 'value' })).toMatchObject({ kind: 'data' });
    expect(seen.graph!.nodes.find(node => node.id === 'digest')?.target).toMatchObject({
      portLabel: 'Objects',
      opName: 'make',
      pure: true,
    });
    expect(edge(seen, { from: 'joined', fromPort: '', to: 'digest', toPort: 'value' })).toMatchObject({ kind: 'data' });
    const out = seen.graph!.nodes.find(node => node.id === 'out')!;
    expect(out.fields!.map(port => port.name)).toEqual(['count', 'text']);
    expect(edge(seen, { from: 'digest', fromPort: '', to: 'out', toPort: '' })).toMatchObject({ kind: 'out' });
  });

  it('draws a map node with its over port and a list result', async () => {
    const seen = await view('@features/monitor/domain/digest.graph.json');
    const lines = seen.graph!.nodes.find(node => node.id === 'lines')!;
    expect(lines.kind).toBe('map');
    expect(lines.inputs[0].name).toBe('over');
    expect(lines.outputs).toEqual([{ name: '', type: 'string[]' }]);
    expect(edge(seen, { from: 'all', fromPort: '', to: 'lines', toPort: 'over' })).toMatchObject({ kind: 'data' });
  });

  it('a map with bind shows each bound input as read from the element, never as missing; an input typed by a bound variable shows the bound type', async () => {
    const recorded = (await view('@features/monitor/domain/import-entries.graph.json')).graph!.nodes.find(
      node => node.id === 'recorded',
    )!;
    expect(recorded.inputs.map(port => [port.name, port.bound, port.missing])).toEqual([
      ['over', undefined, undefined],
      ['url', 'url', undefined],
      ['method', 'method', undefined],
    ]);
    const remove = (await view('@features/monitor/domain/remove-entries.graph.json')).graph!.nodes.find(
      node => node.id === 'removed',
    )!;
    expect(remove.inputs.find(port => port.name === 'id')).toMatchObject({ bound: '' });
    const file = (await view('@features/monitor/data/write-csv.graph.json')).graph!.nodes.find(
      node => node.id === 'file',
    )!;
    expect(file.inputs.find(port => port.name === 'rows')?.type).toBe('@features/monitor/domain/Entry.shape.json[]');
  });

  it('draws a graph that takes and answers a file: the blob type on the in and out nodes', async () => {
    const seen = await view('@features/monitor/data/parse-drafts.graph.json');
    expect(seen.graph!.nodes.find(node => node.id === 'in')).toMatchObject({
      type: 'blob',
      outputs: [{ name: '', type: 'blob' }],
    });
    expect(edge(seen, { from: 'in', fromPort: '', to: 'rows', toPort: 'file' })).toMatchObject({ kind: 'data' });
    const wrote = await view('@features/monitor/data/write-csv.graph.json');
    expect(wrote.graph!.nodes.find(node => node.id === 'out')).toMatchObject({ type: 'blob' });
    expect((await view('@features/monitor/edge/export-entries.trigger.json')).fires).toMatchObject({
      opName: 'export',
      implementation: '@features/monitor/domain/export-entries.graph.json',
    });
  });

  it('answers references both ways for a document that is not a graph', async () => {
    const port = await view('@features/monitor/domain/monitor.port.json');
    expect(port.graph).toBeUndefined();
    expect(port.callers.map(caller => caller.path)).toContain('@features/monitor/data/monitor-rest.binding.json');
    expect(port.callers.map(caller => caller.path)).toContain('@features/monitor/domain/list-entries.graph.json');
    expect(port.refs.map(refusal => refusal.path)).toContain('@features/monitor/domain/Entry.shape.json');
    // both bindings of the port, so the page says what meets it under either profile
    expect(port.implementations).toEqual([
      {
        path: '@features/monitor/data/monitor-rest.binding.json',
        label: 'REST storage',
        operations: expect.objectContaining({ get: { graph: GET_ROW, graphLabel: 'Get a row' } }),
      },
      {
        path: '@features/monitor/data/monitor-store.binding.json',
        label: 'Monitor over a store',
        operations: expect.objectContaining({
          get: { graph: '@features/monitor/data/kept-get.graph.json', graphLabel: 'Get what is kept' },
        }),
      },
    ]);
    // a native port has no binding: the page names the plugin that grants it instead
    expect(await view('@http/server.port.json')).toMatchObject({
      native: '@http',
      from: '@wilanis/plugin-http',
      implementations: [],
    });
    expect(await view('@std/list.port.json')).toMatchObject({ native: '@std', from: undefined });
  });
});
