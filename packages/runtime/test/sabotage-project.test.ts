import { describe, expect, it } from 'vitest';
import { sabotage } from './example-harness.js';

describe('sabotage: the project, its plugins and its startup', () => {
  it('X003 a throttle that lets nothing through', () => {
    expect(
      sabotage('connections/monitor-api.connection.json', connection => {
        connection.settings.throttle.concurrency = 0;
      }),
    ).toContain('X003');
    expect(
      sabotage('connections/monitor-api.connection.json', connection => {
        connection.settings.throttle = { perSecond: -1 };
      }),
    ).toContain('X003');
    expect(
      sabotage('connections/monitor-api.connection.json', connection => {
        connection.settings.throttle.concurrency = 1.5;
      }),
    ).toContain('X003');
  });
  it('C002 a throttle that is not a number', () => {
    expect(
      sabotage('connections/monitor-api.connection.json', connection => {
        connection.settings.throttle.concurrency = 'four';
      }),
    ).toContain('C002');
  });
  it('G012 a map over something that is not a list', () => {
    expect(
      sabotage('features/monitor/domain/remove-entries.graph.json', graph => {
        graph.in = 'string';
      }),
    ).toContain('G012');
  });
  it('B005 a graph that takes its input whole, bound to an operation that accepts two fields', () => {
    expect(
      sabotage('features/monitor/domain/monitor.port.json', port => {
        port.operations.removeMany.accepts.reason = { type: 'string' };
      }),
    ).toContain('B005');
  });
  it('B005 a graph that takes its input whole, fed a field of another type', () => {
    expect(
      sabotage('features/monitor/domain/monitor.port.json', port => {
        port.operations.removeMany.accepts.ids.type = 'number[]';
      }),
    ).toContain('B005');
  });
  it('B006 a startup step naming an operation the port does not have', () => {
    expect(
      sabotage('project.json', project => {
        project.startup[0].run = '@monitor/domain/monitor.port.json#nope';
      }),
    ).toContain('B006');
  });
  it('B006 a startup step firing a native operation', () => {
    expect(
      sabotage('project.json', project => {
        project.startup[0].run = '@http/http.port.json#request';
      }),
    ).toContain('B006');
  });
  it('B007 a startup step giving input to an operation that takes none', () => {
    expect(
      sabotage('project.json', project => {
        project.startup[0].in = { bogus: 'x' };
      }),
    ).toContain('B007');
  });
  it('B007 a startup step reading the request, which nothing has sent yet', () => {
    expect(
      sabotage('project.json', project => {
        project.startup[0].in = { x: '{{request.body}}' };
      }),
    ).toContain('B007');
  });
  it('B007 a startup step reading an undeclared secret', () => {
    expect(
      sabotage('project.json', project => {
        project.startup[0].in = { x: '{{secrets.nope}}' };
      }),
    ).toContain('B007');
  });
  it('B008 a startup step whose bound graph reads the request', () => {
    expect(
      sabotage('project.json', project => {
        project.startup[0].run = '@monitor/domain/monitor.port.json#record';
        project.startup[0].in = { url: 'http://x', method: 'GET', ua: 'startup' };
      }),
    ).toContain('B008');
  });
  it('X002 a content type with no codec', () => {
    expect(
      sabotage('features/monitor/edge/record-entry.trigger.json', trigger => {
        trigger.settings.consumes = 'application/xml';
      }),
    ).toContain('X002');
  });
  it('B004 a profile whose binding implements another port', () => {
    expect(
      sabotage('features/monitor/data/monitor-rest.binding.json', binding => {
        binding.port = '@monitor/other.port.json';
      }),
    ).toContain('B004');
  });
  it('B002 a domain port with no binding once the profile is gone', () => {
    expect(
      sabotage('project.json', project => {
        delete project.profiles;
        project.aliases['@monitor'] = '@features/nowhere';
      }),
    ).toContain('B002');
  });
  it('D001 a document that breaks its schema', () => {
    expect(
      sabotage('features/monitor/domain/monitor.port.json', port => {
        port.operations.listAll.returnz = 'x';
      }),
    ).toContain('D001');
  });
  it('D001 a $schema in neither the published nor the alias form', () => {
    expect(
      sabotage('features/monitor/domain/monitor.port.json', port => {
        port.$schema = 'https://example.com/port.schema.json';
      }),
    ).toContain('D001');
  });
  it('R001 an alias to nowhere', () => {
    expect(
      sabotage('features/monitor/domain/digest.graph.json', graph => {
        graph.nodes[0].run = '@monitor/nope.port.json#listAll';
      }),
    ).toContain('R001');
  });
});
