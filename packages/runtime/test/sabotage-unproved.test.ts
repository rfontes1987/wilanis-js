/**
 * The refusals no test named until now. Every code the checker and the loader can produce is proved here or
 * in a sibling sabotage file, so `every-refusal-code-is-proved-by-a-sabotage` stays green: a rule with no
 * sabotage is a rule nobody would notice the loss of.
 *
 * Where a sabotage earns more than one code the assertion lists them all, and the `it` says why the others
 * come along -- a document that breaks one rule often breaks the next, and the extra code is the cascade,
 * not a second decision.
 */
import { describe, expect, it } from 'vitest';
import { corrupt, planted, sabotage, without } from './example-harness.js';

const SCHEMAS = 'https://raw.githubusercontent.com/wilanis/wilanis-js/main/packages/core/schemas';

/** A scenario document, valid but for what a case breaks. */
const scenario = (trigger: string) => ({
  $schema: `${SCHEMAS}/scenario.schema.json`,
  description: 'A recorded run, for a trigger this tree does not have.',
  trigger,
  seed: 1,
  expect: { status: 'done', nodes: {} },
});

describe('sabotage: the documents a tree may not have', () => {
  it('D000 a file that is not JSON', () => {
    // the four D010s are the documents that named the project's aliases, which a project that did not parse never declared
    expect(corrupt('project.json', '{ "name": ')).toEqual(['D000', 'D010', 'D010', 'D010', 'D010']);
  });
  it('D003 the project document somewhere other than the root', () => {
    expect(
      planted('features/hello/elsewhere.json', {
        $schema: `${SCHEMAS}/project.schema.json`,
        name: 'elsewhere',
        description: 'A second project document, which a tree has no place for.',
        plugins: [],
      }),
    ).toEqual(['D003']);
  });
  it('D004 a trigger kind authored in a tree instead of shipped by a plugin', () => {
    expect(
      planted('features/hello/edge/mine.trigger-kind.json', {
        $schema: `${SCHEMAS}/trigger-kind.schema.json`,
        description: 'A kind a tree must not author; a plugin grants one.',
        settings: { fields: {} },
        context: { fields: {} },
      }),
    ).toEqual(['D004']);
  });
  it('D005 no project.json at the root', () => {
    // the four D010s are the documents whose aliases the missing project would have declared
    expect(without('project.json')).toEqual(['D005', 'D010', 'D010', 'D010', 'D010']);
  });
  it('D007 an alias that collides with a folder of the tree', () => {
    // twice: the alias is judged where it is declared and again where the include's aliases are folded in
    expect(
      sabotage('project.json', project => {
        project.aliases['@features'] = '@features/monitor';
      }),
    ).toEqual(['D007', 'D007']);
  });
  it('D007 an alias that collides with a plugin root', () => {
    expect(
      sabotage('project.json', project => {
        project.aliases['@http'] = '@features/monitor';
      }),
    ).toEqual(['D007']);
  });
});

describe('sabotage: ports, bindings and secrets', () => {
  it('B001 a port operation no binding meets', () => {
    expect(
      sabotage('features/hello/domain/greeting.port.json', port => {
        port.operations.farewell = {
          description: 'Say goodbye, which no binding answers.',
          returns: '@hello/domain/Greeting.shape.json',
        };
      }),
    ).toEqual(['B001']);
  });
  it('B003 a binding that names a native port the plugin binds', () => {
    // B002 comes with it: the operations the binding names are not the native port's
    expect(
      sabotage('features/hello/data/greeting.binding.json', binding => {
        binding.port = '@http/http.port.json';
      }),
    ).toEqual(['B002', 'B003']);
  });
  it('C001 settings that read anything but a secret', () => {
    expect(
      sabotage('connections/monitor-api.connection.json', connection => {
        connection.settings.baseUrl = '{{request.host}}';
      }),
    ).toEqual(['C001']);
  });
});

describe('sabotage: layers and visibility', () => {
  it('L001 a core shape that declares unknown', () => {
    // T002 follows: the trigger that answers this shape no longer has a field it maps
    expect(
      sabotage('features/hello/domain/Greeting.shape.json', shape => {
        shape.fields[Object.keys(shape.fields)[0]].type = 'unknown';
      }),
    ).toEqual(['L001', 'T002']);
  });
  it('L001 a native contract type named from a tree', () => {
    expect(
      sabotage('features/hello/domain/Greeting.shape.json', shape => {
        shape.fields[Object.keys(shape.fields)[0]].type = '$Params';
      }),
    ).toEqual(['L001']);
  });
  it('L005 a shape of another feature that feature does not export', () => {
    // G004 and T002 follow from the field's new type, which the graph and the trigger no longer fit
    expect(
      sabotage('features/hello/domain/Greeting.shape.json', shape => {
        shape.fields[Object.keys(shape.fields)[0]].type = '@monitor/domain/Digest.shape.json';
      }),
    ).toEqual(['L005', 'G004', 'T002']);
  });
});

describe('sabotage: graphs', () => {
  it('G001 two nodes with one id', () => {
    expect(
      sabotage('features/monitor/data/list-rows.graph.json', graph => {
        graph.nodes.push(JSON.parse(JSON.stringify(graph.nodes[0])));
      }),
    ).toEqual(['G001']);
  });
  it('G007 a cycle: a node that reads itself', () => {
    // G006 comes with it: a node inside a cycle reaches the graph's answer from nowhere
    expect(
      sabotage('features/hello/domain/greet.graph.json', graph => {
        graph.nodes[0].in.self = `{{${graph.nodes[0].id}.who}}`;
      }),
    ).toEqual(['G006', 'G007']);
  });
  it('G009 a switch that routes to a node the graph does not declare', () => {
    // G004 and G010 follow: the node the rule left unreached is the one the answer read
    expect(
      sabotage('features/monitor/data/list-rows.graph.json', graph => {
        graph.nodes.find((node: any) => node.id === 'route').rules[0].to = 'nowhere';
      }),
    ).toEqual(['G009', 'G004', 'G010']);
  });
  it('G011 a rule whose when is not a boolean', () => {
    // G004: the branch that no longer decides feeds an input that needed it
    expect(
      sabotage('features/monitor/data/list-rows.graph.json', graph => {
        graph.nodes.find((node: any) => node.id === 'route').rules[0].when = 'status';
      }),
    ).toEqual(['G011', 'G004']);
  });
  it('G011 a rule whose when does not parse', () => {
    expect(
      sabotage('features/monitor/data/list-rows.graph.json', graph => {
        graph.nodes.find((node: any) => node.id === 'route').rules[0].when = 'status >=';
      }),
    ).toEqual(['G011', 'G004']);
  });
  it('G013 a constant whose value is not of its type', () => {
    expect(
      sabotage('features/hello/domain/greet.graph.json', graph => {
        graph.constants.who.value = 42;
      }),
    ).toEqual(['G013']);
  });
});

describe('sabotage: triggers, scenarios and a pluginrule', () => {
  it('T001 a type setting written as anything but a string', () => {
    // twice: the setting is judged against the kind's shape and again as a type reference
    expect(
      sabotage('features/monitor/edge/list-entries.trigger.json', trigger => {
        trigger.settings.body = { not: 'a string' };
      }),
    ).toEqual(['T001', 'T001']);
  });
  it('S001 a scenario that names a trigger the tree does not have', () => {
    expect(planted('scenarios/probe.scenario.json', scenario('@monitor/edge/no-such.trigger.json'))).toEqual(['S001']);
  });
  it('X001 a codec table that names something that is not a codec', () => {
    expect(
      sabotage('project.json', project => {
        const http = project.plugins.find((plugin: any) => plugin.use === '@http');
        http.settings.codecs['application/json'] = '@http/codecs/nope.codec.json';
      }),
    ).toEqual(['X001']);
  });
});
