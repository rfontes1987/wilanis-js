import { describe, expect, it } from 'vitest';
import { relocate, sabotage } from './example-harness.js';

describe('sabotage: graphs, layers, resolvers and triggers', () => {
  it('G003 a deep path that does not exist', () => {
    expect(
      sabotage('features/monitor/domain/record-entry.graph.json', graph => {
        graph.nodes[0].in.url = '{{in.urrl}}';
      }),
    ).toContain('G003');
  });
  it('G004 an optional read feeding a required input', () => {
    expect(
      sabotage('features/monitor/domain/list-entries.graph.json', graph => {
        graph.nodes[0].rules[0].when = 'true == true';
      }),
    ).toContain('G004');
  });
  it('G005 a required input left unwired', () => {
    expect(
      sabotage('features/monitor/domain/record-entry.graph.json', graph => {
        delete graph.nodes[0].in.url;
      }),
    ).toContain('G005');
  });
  it('G008 a node nobody reads', () => {
    expect(
      sabotage('features/monitor/domain/digest.graph.json', graph => {
        graph.out.from = 'all';
        graph.out.type = '@monitor/domain/Entry.shape.json[]';
      }),
    ).toContain('G008');
  });
  it('G010 a second out candidate that is never routed', () => {
    expect(
      sabotage('features/monitor/domain/digest.graph.json', graph => {
        graph.out.from = ['joined', 'all'];
      }),
    ).toContain('G010');
  });
  it('L002 an effect run from a domain graph', () => {
    expect(
      sabotage('features/monitor/domain/digest.graph.json', graph => {
        graph.nodes[0].run = '@http/http.port.json#request';
        graph.nodes[0].in = { connection: '@connections/monitor-api.connection.json', method: 'GET', path: '/x' };
      }),
    ).toContain('L002');
  });
  it('D008 a port outside the domain layer', () => {
    expect(relocate('features/monitor/domain/monitor.port.json', 'features/monitor/edge/monitor.port.json')).toContain(
      'D008',
    );
  });
  it('D008 a trigger outside the edge layer', () => {
    expect(
      relocate('features/monitor/edge/digest.trigger.json', 'features/monitor/domain/digest.trigger.json'),
    ).toContain('D008');
  });
  it('D008 a document in a feature but in no layer at all', () => {
    expect(relocate('features/monitor/domain/Entry.shape.json', 'features/monitor/Entry.shape.json')).toContain('D008');
  });
  it('D008 a connection outside connections/', () => {
    expect(
      relocate('connections/monitor-api.connection.json', 'features/monitor/data/monitor-api.connection.json'),
    ).toContain('D008');
  });
  it('D008 a shape whose declared layer contradicts the directory it sits in', () => {
    expect(
      sabotage('features/monitor/domain/Entry.shape.json', shape => {
        shape.layer = 'edge';
      }),
    ).toContain('D008');
  });
  it('L006 a trigger that fires a native operation instead of a domain port', () => {
    expect(
      sabotage('features/monitor/edge/digest.trigger.json', trigger => {
        trigger.fire.run = '@std/list.port.json#count';
      }),
    ).toContain('L006');
  });
  it('L007 a domain graph that only forwards its input to one port operation', () => {
    expect(
      sabotage('features/monitor/domain/record-entry.graph.json', graph => {
        // strip what earns its place: the constant it injects, so it becomes a pass-through
        delete graph.constants;
        graph.in = '@monitor/domain/EntryRef.shape.json';
        graph.out = { type: '@monitor/domain/Entry.shape.json', from: 'recorded' };
        graph.nodes = [
          {
            type: '@wilanis/node/run.schema.json',
            id: 'recorded',
            run: '@monitor/domain/monitor.port.json#get',
            in: { id: '{{in.id}}' },
          },
        ];
      }),
    ).toContain('L007');
  });
  it('L003 an effect the feature does not allow', () => {
    expect(
      sabotage('features/monitor/feature.json', feature => {
        feature.effects = [];
      }),
    ).toContain('L003');
  });
  it('T002 a trigger whose edge shape does not fit the graph', () => {
    expect(
      sabotage('features/monitor/edge/RecordRequest.shape.json', shape => {
        delete shape.fields.url;
      }),
    ).toContain('T002');
  });
  it('T004 a resolver reading request.* under a kind that hands none', () => {
    // list-rows is reached from the digest, a cli trigger: the command line hands no headers
    expect(
      sabotage('features/monitor/data/list-rows.graph.json', graph => {
        graph.resolvers = '@monitor/edge/request.resolvers.json';
        graph.nodes[0].in.headers = { 'x-forwarded-user-agent': '{{agent}}' };
      }),
    ).toContain('T004');
  });
  it('L002 a domain graph that names a resolvers document', () => {
    expect(
      sabotage('features/monitor/domain/digest.graph.json', graph => {
        graph.resolvers = '@monitor/edge/request.resolvers.json';
      }),
    ).toContain('L002');
  });
  it('R001 a resolvers document that does not exist', () => {
    expect(
      sabotage('features/monitor/data/create-row.graph.json', graph => {
        graph.resolvers = '@monitor/edge/nope.resolvers.json';
      }),
    ).toContain('R001');
  });
  it('G003 a read of a resolver the named document does not define', () => {
    expect(
      sabotage('features/monitor/data/create-row.graph.json', graph => {
        graph.nodes[0].in.headers = { 'x-forwarded-user-agent': '{{caller}}' };
      }),
    ).toContain('G003');
  });
  it('P002 a resolver reading a path no trigger kind hands', () => {
    expect(
      sabotage('features/monitor/edge/request.resolvers.json', resolvers => {
        resolvers.resolvers.agent.read = 'request.nowhere.session';
      }),
    ).toContain('P002');
  });
  it('P003 a resolver named like a root', () => {
    expect(
      sabotage('features/monitor/edge/request.resolvers.json', resolvers => {
        resolvers.resolvers.in = { read: 'request.headers.host' };
      }),
    ).toContain('P003');
  });
  it('D001 a resolver whose read does not start at the request', () => {
    expect(
      sabotage('features/monitor/edge/request.resolvers.json', resolvers => {
        resolvers.resolvers.agent.read = "headers['user-agent']";
      }),
    ).toContain('D001');
  });
  it('D008 a resolvers document outside the edge layer', () => {
    expect(
      relocate('features/monitor/edge/request.resolvers.json', 'features/monitor/data/request.resolvers.json'),
    ).toContain('D008');
  });
  it('T005 a refusal reason the trigger can reach but does not map', () => {
    expect(
      sabotage('features/monitor/edge/get-entry.trigger.json', trigger => {
        delete trigger.settings.response.refusals.missing;
      }),
    ).toEqual(['T005']);
  });
  it('T005 a reason reached only through a map, from the batch delete', () => {
    expect(
      sabotage('features/monitor/edge/delete-entries.trigger.json', trigger => {
        delete trigger.settings.response.refusals.missing;
      }),
    ).toEqual(['T005']);
  });
  it('T006 a mapped reason nothing the trigger fires refuses with', () => {
    expect(
      sabotage('features/monitor/edge/get-entry.trigger.json', trigger => {
        trigger.settings.response.refusals.teapot = 418;
      }),
    ).toEqual(['T006']);
  });
  it('P001 a reason given as a read: the checker must see the word', () => {
    // the mapping that named it is not dead, though: reasons are gathered across profiles, and under
    // local the same operation is met by a graph over the store, which still refuses with the word
    expect(
      sabotage('features/monitor/data/get-row.graph.json', graph => {
        graph.nodes.find((node: any) => node.id === 'missing').in.reason = '{{asked.status}}';
      }).sort(),
    ).toEqual(['P001']);
  });
  it('G005 a refusal without a reason', () => {
    expect(
      sabotage('features/monitor/data/get-row.graph.json', graph => {
        delete graph.nodes.find((node: any) => node.id === 'missing').in.reason;
      }).sort(),
    ).toEqual(['G005']);
  });
  it('G006 an input the operation does not declare', () => {
    expect(
      sabotage('features/monitor/data/list-rows.graph.json', graph => {
        graph.nodes[0].in.query = { a: 'b' };
      }),
    ).toContain('G006');
  });
  it('P001 a static field given a read', () => {
    expect(
      sabotage('features/monitor/data/list-rows-by-method.graph.json', graph => {
        graph.nodes[0].in.method = '{{in.method}}';
      }),
    ).toContain('P001');
  });
  it('G003 a read of a node that does not exist', () => {
    expect(
      sabotage('features/monitor/data/list-rows.graph.json', graph => {
        graph.nodes[2].in.value = '{{asked2.body}}';
      }),
    ).toContain('G003');
  });
  it('T003 a route placeholder the route does not declare', () => {
    expect(
      sabotage('features/monitor/edge/get-entry.trigger.json', trigger => {
        trigger.settings.route = '/monitor/{entry}';
      }),
    ).toContain('T003');
  });
});
