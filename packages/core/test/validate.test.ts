import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { KINDS, NODE_MAP, NODE_RUN, NODE_SWITCH, schemaRef, schemaUrl, type Kind } from '../src/model.js';
import { SCHEMAS_DIR, validateDocument } from '../src/validate.js';

/**
 * Every deviation from a schema is refused with D001, at the path of the deviation, in words a reader can
 * act on: nothing more (no noise from alternatives the document never chose), nothing less (every
 * deviation, not only the deepest). The smallest conforming document of each kind is the baseline.
 */

const run = (id: string, extra: Record<string, unknown> = {}) => ({ type: NODE_RUN, id, run: '@std/object.port.json#make', in: { value: {}, type: 'string' }, ...extra });

const minimal: Record<Kind, Record<string, unknown>> = {
  project: { name: 'p', plugins: [{ use: '@std' }] },
  plugin: { grants: {} },
  port: { operations: { get: { description: 'one' } } },
  binding: { port: '@features/f/f.port.json', operations: { get: { graph: '@features/f/graphs/g.graph.json' } } },
  graph: { nodes: [run('a')] },
  trigger: { kind: '@cli/cli.trigger-kind.json', settings: {}, fire: { run: '@features/f/domain/f.port.json#get' } },
  'trigger-kind': { settings: { fields: {} }, context: { fields: {} } },
  'connection-kind': { settings: { fields: {} } },
  connection: { kind: '@http/http.connection-kind.json', settings: {} },
  codec: { yields: 'declared' },
  feature: {},
  shape: { layer: 'core', fields: {} },
  scenario: { trigger: '@features/f/edge/t.trigger.json', seed: 1, expect: { status: 'done', nodes: {} } },
  resolvers: { resolvers: { caller: { read: "request.headers['user-agent']" } } },
};
const doc = (kind: Kind, body: Record<string, unknown> = {}, schema = schemaRef(kind)) => ({ $schema: schema, description: 'd', ...minimal[kind], ...body });

/** The refusals of a document, as [at, message] pairs; every one is D001 and points at the kind's schema. */
function refused(d: unknown): [string | undefined, string][] {
  const { kind, refusals } = validateDocument(d, 'f.json');
  for (const r of refusals) {
    expect(r.code).toBe('D001');
    expect(r.file).toBe('f.json');
    if (kind) expect(r.hint).toBe(`see ${schemaUrl(kind)}`);
  }
  return refusals.map(r => [r.at, r.message]);
}
const at = (path: string | undefined, ...words: string[]) => [path, words.length === 1 ? expect.stringContaining(words[0]) : expect.stringMatching(words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*'))];

describe('the schemas themselves', () => {
  it('are plain JSON Schema 2020-12: every one compiles under a strict validator with no extensions, and $id matches its place', () => {
    // strict refuses unknown keywords and formats; strictRequired is an Ajv lint (required keys re-listed in the same properties), not a JSON Schema rule
    const ajv = new Ajv2020({ strict: true, strictRequired: false, allowUnionTypes: true });
    const files = [...readdirSync(SCHEMAS_DIR).filter(f => f.endsWith('.schema.json')), ...readdirSync(join(SCHEMAS_DIR, 'node')).map(f => `node/${f}`)];
    const schemas = files.map(f => ({ file: f, schema: JSON.parse(readFileSync(join(SCHEMAS_DIR, f), 'utf8')) as { $id: string; $schema: string; title: string } }));
    for (const { file, schema } of schemas) {
      expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
      expect(schema.$id).toBe(`${schemaUrl('x' as Kind).replace('/x.schema.json', '')}/${file}`);
      expect(schema.title).toBe(file.replace('.schema.json', ''));
      ajv.addSchema(schema);
    }
    for (const { schema } of schemas) expect(() => ajv.getSchema(schema.$id)).not.toThrow();
    expect(KINDS.map(k => `${k}.schema.json`).every(f => files.includes(f))).toBe(true);
  });
});

describe('the baseline', () => {
  it.each(KINDS)('%s: the smallest document conforms, under both $schema forms', kind => {
    expect(validateDocument(doc(kind), 'f.json')).toEqual({ kind, refusals: [] });
    expect(validateDocument(doc(kind, {}, schemaUrl(kind)), 'f.json')).toEqual({ kind, refusals: [] });
  });
});

describe('the envelope', () => {
  it('a document is a JSON object', () => {
    expect(refused([])).toEqual([at(undefined, 'a document is a JSON object')]);
    expect(refused('x')).toEqual([at(undefined, 'a document is a JSON object')]);
    expect(validateDocument(null, 'f.json').refusals[0].hint).toContain('$schema');
  });
  it('$schema must name a wilanis kind, in either form', () => {
    expect(refused({ $schema: '@wilanis/widget.schema.json', description: 'd' })).toEqual([at('$schema', 'does not name a wilanis kind')]);
    expect(refused({ $schema: 'https://example.com/port.schema.json', description: 'd' })).toEqual([at('$schema', 'does not name a wilanis kind')]);
    expect(refused({ description: 'd' })).toEqual([at('$schema', 'does not name a wilanis kind')]);
    expect(validateDocument({ $schema: 'x' }, 'f.json').refusals[0].hint).toContain(schemaRef('port'));
  });
  it.each(KINDS)('%s: description is required and never empty; unknown properties are named', kind => {
    const { description: _, ...without } = doc(kind);
    expect(refused(without)).toEqual([at(undefined, "missing 'description'")]);
    expect(refused(doc(kind, { description: '' }))).toEqual([at('description', 'fewer than 1 characters')]);
    expect(refused(doc(kind, { params: {} }))).toEqual([at(undefined, "unknown property 'params'")]);
  });
  it('every missing required property is reported, not only the first', () => {
    expect(refused({ $schema: schemaRef('trigger'), description: 'd', settings: {} })).toEqual([at(undefined, "missing 'kind'"), at(undefined, "missing 'fire'")]);
  });
});

describe('graph', () => {
  it('a node is judged against the one node schema its type names', () => {
    expect(refused(doc('graph', { nodes: [{ type: NODE_RUN, id: 'a' }] }))).toEqual([at('nodes/0', "missing 'run'")]);
    expect(refused(doc('graph', { nodes: [{ type: NODE_SWITCH, id: 's', in: {}, rules: [{ when: 'x' }] }] }))).toEqual([at('nodes/0', "missing 'else'"), at('nodes/0/rules/0', "missing 'to'")]);
    expect(refused(doc('graph', { nodes: [{ type: NODE_MAP, id: 'm', run: '@x/p.json#op' }] }))).toEqual([at('nodes/0', "missing 'over'")]);
  });
  it('an unknown node type names the three that exist', () => {
    expect(refused(doc('graph', { nodes: [{ type: '@wilanis/node/loop.schema.json', id: 'a' }] }))).toEqual([at('nodes/0/type', NODE_RUN, NODE_SWITCH, NODE_MAP)]);
  });
  it('several deviations in one node are all reported, each at its own path', () => {
    expect(refused(doc('graph', { nodes: [{ type: NODE_RUN, id: 'Bad-Id', params: {} }] }))).toEqual([
      at('nodes/0', "missing 'run'"), at('nodes/0', "unknown property 'params'"), at('nodes/0/id', '^[a-z][A-Za-z0-9_]*$', 'node identifier'),
    ]);
  });
  it('identifiers, operation references and paths follow the shared grammar, quoted in the refusal', () => {
    expect(refused(doc('graph', { nodes: [run('a', { run: 'object.port.json#make' })] }))).toEqual([at('nodes/0/run', 'path#operation')]);
    expect(refused(doc('graph', { nodes: [run('a', { run: '@std/object.port.json' })] }))).toEqual([at('nodes/0/run', 'path#operation')]);
    expect(refused(doc('graph', { nodes: [run('a', { in: { 'bad key': 1 } })] }))).toEqual([at('nodes/0/in', "property name 'bad key'", 'identifier')]);
    expect(refused(doc('graph', { nodes: [run('a', { in: { x: 1 } }), { type: NODE_SWITCH, id: 's', in: {}, rules: [{ when: 'x', to: 'Not-Ident' }], else: 'a' }] }))).toEqual([at('nodes/1/rules/0/to', 'identifier')]);
  });
  it("in, out.type and constants: in is a type reference; out.from is a node or a list of nodes; a constant has type and value", () => {
    expect(refused(doc('graph', { in: { fields: {} } }))).toEqual([at('in', 'must be string')]);
    expect(refused(doc('graph', { in: 'object' }))).toEqual([at('in', 'A type: string, number, boolean, blob')]);
    expect(refused(doc('graph', { out: { type: 'string', from: 3 } }))).toEqual([at('out/from', 'must be string or array')]);
    expect(refused(doc('graph', { out: { type: 'string', from: [] } }))).toEqual([at('out/from', 'fewer than 1 items')]);
    expect(refused(doc('graph', { out: { type: 'string' } }))).toEqual([at('out', "missing 'from'")]);
    expect(refused(doc('graph', { constants: { n: { value: 1 } } }))).toEqual([at('constants/n', "missing 'type'")]);
    expect(refused(doc('graph', { constants: { n: { type: 'number' } } }))).toEqual([at('constants/n', "missing 'value'")]);
  });
  it('a value in in is any JSON: the schema does not judge it, the checker does', () => {
    expect(refused(doc('graph', { nodes: [run('a', { in: { s: '{{in.x}}', n: 1, b: true, l: [1, '{{in.y}}'], o: { k: '{{in.z}}' }, z: null } })] }))).toEqual([]);
  });
  it("a map's bind is input -> dotted path or \"\"; onItemFailure is fail or collect", () => {
    const map = (extra: Record<string, unknown>) => doc('graph', { nodes: [{ type: NODE_MAP, id: 'm', run: '@x/p.json#op', over: '{{in.list}}', ...extra }] });
    expect(refused(map({ bind: { item: '' } }))).toEqual([]);
    expect(refused(map({ bind: { item: 'a.b' } }))).toEqual([]);
    expect(refused(map({ bind: { item: '.a' } }))).toEqual([at('nodes/0/bind/item', 'dotted path within the element')]);
    expect(refused(map({ onItemFailure: 'ignore' }))).toEqual([at('nodes/0/onItemFailure', '"fail", "collect"')]);
  });
});

describe('shape and the type grammar', () => {
  it('layer is edge or core', () => {
    expect(refused(doc('shape', { layer: 'middle' }))).toEqual([at('layer', '"edge", "core"')]);
  });
  it('a field type is a type reference or an inline object; the refusal quotes the grammar', () => {
    expect(refused(doc('shape', { fields: { a: { type: 'object' } } }))).toEqual([at('fields/a/type', 'A type: string, number, boolean, blob')]);
    expect(refused(doc('shape', { fields: { a: { type: 'Task' } } }))).toEqual([at('fields/a/type', 'A type:')]);
    expect(refused(doc('shape', { fields: { a: { type: 3 } } }))).toEqual([at('fields/a/type', 'must be string or object')]);
    expect(refused(doc('shape', { fields: { a: { type: { open: true } } } }))).toEqual([at('fields/a/type', "missing 'fields'")]);
    expect(refused(doc('shape', { fields: { a: {} } }))).toEqual([at('fields/a', "missing 'type'")]);
    expect(refused(doc('shape', { fields: { a: { type: 'string', enum: [] } } }))).toEqual([at('fields/a/enum', 'fewer than 1 items')]);
    expect(refused(doc('shape', { fields: { a: { type: 'string', binds: 'body' } } }))).toEqual([at('fields/a/binds', 'Native contracts only')]);
    expect(refused(doc('shape', { fields: { 'Bad Name': { type: 'string' } } }))).toEqual([at('fields', 'identifier')]);
  });
  it('the type grammar accepts every form it promises', () => {
    for (const t of ['string', 'number[]', 'blob', 'blob[]', 'unknown', 'type', '$T', '$Body[]', '@shapes/Task.shape.json', '@features/f/shapes/Task.shape.json[][]']) expect(refused(doc('shape', { fields: { a: { type: t } } }))).toEqual([]);
  });
  it('open is a boolean or a type reference, shared with inline objects', () => {
    expect(refused(doc('shape', { open: 5 }))).toEqual([at('open', 'must be boolean or string')]);
    expect(refused(doc('shape', { open: 'string' }))).toEqual([]);
    expect(refused(doc('trigger-kind', { settings: { fields: {}, open: 5 } }))).toEqual([at('settings/open', 'must be boolean or string')]);
  });
});

describe('port and binding', () => {
  it('an operation has a description; accepts is fields; pure is a boolean', () => {
    expect(refused(doc('port', { operations: { get: {} } }))).toEqual([at('operations/get', "missing 'description'")]);
    expect(refused(doc('port', { operations: {} }))).toEqual([at('operations', 'fewer than 1 properties')]);
    expect(refused(doc('port', { operations: { get: { description: 'x', accepts: { a: 'string' } } } }))).toEqual([at('operations/get/accepts/a', 'must be object')]);
    expect(refused(doc('port', { operations: { get: { description: 'x', pure: 'yes' } } }))).toEqual([at('operations/get/pure', 'must be boolean')]);
    expect(refused(doc('port', { operations: { get: { description: 'x', params: {} } } }))).toEqual([at('operations/get', "unknown property 'params'")]);
  });
  it('a binding operation is a graph or a run, never both, never neither; a graph takes no in', () => {
    expect(refused(doc('binding', { operations: { get: { graph: '@x/g.graph.json', run: '@y/p.json#op' } } }))).toEqual([at('operations/get/run', "'run' is not allowed here")]);
    expect(refused(doc('binding', { operations: { get: { description: 'x' } } }))).toEqual([at('operations/get', "missing 'graph'"), at('operations/get', "missing 'run'")]);
    expect(refused(doc('binding', { operations: { get: { graph: '@x/g.graph.json', in: {} } } }))).toEqual([at('operations/get/in', "'in' is not allowed here")]);
    expect(refused(doc('binding', { operations: { get: { run: '@y/p.json#op', in: { a: '{{in.a}}' } } } }))).toEqual([]);
    expect(refused(doc('binding', { operations: { get: { run: '@y/p.json#op', params: {} } } }))).toEqual([at('operations/get', "unknown property 'params'")]);
  });
  it('a binding names its resolvers document by path', () => {
    expect(refused(doc('binding', { resolvers: '@features/f/edge/r.resolvers.json' }))).toEqual([]);
    expect(refused(doc('binding', { resolvers: { caller: { read: 'request.params.id' } } }))).toEqual([at('resolvers', 'must be string')]);
  });
});

describe('resolvers', () => {
  it('a resolver reads a path into the request; a key that is not an identifier is quoted in brackets', () => {
    expect(refused(doc('resolvers', { resolvers: { a: { read: 'request.params.id' } } }))).toEqual([]);
    expect(refused(doc('resolvers', { resolvers: { a: { read: 'request.headers["user-agent"]' } } }))).toEqual([]);
    expect(refused(doc('resolvers', { resolvers: { a: { read: 'params.id' } } }))).toEqual([at('resolvers/a/read', 'A path into the request')]);
    expect(refused(doc('resolvers', { resolvers: { a: { read: 'request' } } }))).toEqual([at('resolvers/a/read', 'A path into the request')]);
    expect(refused(doc('resolvers', { resolvers: { a: { run: '@std/text.port.json#fill' } } }))).toEqual([at('resolvers/a', "missing 'read'"), at('resolvers/a', "unknown property 'run'")]);
    expect(refused(doc('resolvers', { resolvers: {} }))).toEqual([at('resolvers', 'must NOT have fewer than 1 properties')]);
  });
  it('a graph or binding names the resolvers document by path', () => {
    expect(refused(doc('graph', { resolvers: '@features/f/edge/r.resolvers.json' }))).toEqual([]);
    expect(refused(doc('graph', { resolvers: { a: { read: 'request.params.id' } } }))).toEqual([at('resolvers', 'must be string')]);
  });
});

describe('trigger, kinds, connection, codec', () => {
  it('a trigger names a kind by path and fires one port operation; its settings are an object', () => {
    expect(refused(doc('trigger', { kind: 'http' }))).toEqual([at('kind', 'A document path')]);
    expect(refused(doc('trigger', { settings: [] }))).toEqual([at('settings', 'must be object')]);
    expect(refused(doc('trigger', { in: { fields: {} } }))).toEqual([at('in', 'must be string')]);
    expect(refused(doc('trigger', { fire: { run: '@features/f/domain/f.port.json#get', in: { id: '{{request.params.id}}' } } }))).toEqual([]);
    // the node type is the schema's declaration, never restated on the document
    expect(refused(doc('trigger', { fire: { type: NODE_RUN, run: '@features/f/domain/f.port.json#get' } }))).toEqual([at('fire', "unknown property 'type'")]);
    // a trigger fires an operation, never a graph
    expect(refused(doc('trigger', { fire: { run: '@features/f/data/g.graph.json' } }))).toEqual([at('fire/run', 'path#operation: one operation of a port')]);
  });
  it('a trigger kind has settings and context as inline objects', () => {
    expect(refused(doc('trigger-kind', { context: 'string' }))).toEqual([at('context', 'must be object')]);
    expect(refused(doc('trigger-kind', { settings: { fields: { route: { type: 'string', binds: 'Params' } } } }))).toEqual([at('settings/fields/route/binds', 'Native contracts only')]);
  });
  it('a connection kind has settings; a connection names a kind', () => {
    expect(refused(doc('connection-kind', { settings: {} }))).toEqual([at('settings', "missing 'fields'")]);
    expect(refused(doc('connection', { kind: 'postgres' }))).toEqual([at('kind', 'A document path')]);
  });
  it('a codec yields declared or a type; the refusal names both', () => {
    expect(refused(doc('codec', { yields: 'maybe' }))).toEqual([at('yields', 'must be "declared", or', 'A type:')]);
    expect(refused(doc('codec', { yields: 'string' }))).toEqual([]);
  });
});

describe('project and feature', () => {
  it('names, aliases, plugins, secrets and profiles follow their grammars, each explained', () => {
    expect(refused(doc('project', { name: 'My Project' }))).toEqual([at('name', 'kebab-case')]);
    expect(refused(doc('project', { aliases: { tasks: '@features/tasks' } }))).toEqual([at('aliases', "property name 'tasks'", '@ followed by a kebab-case name')]);
    expect(refused(doc('project', { aliases: { '@tasks': 'features/tasks' } }))).toEqual([at('aliases/@tasks', 'A folder path from the root')]);
    expect(refused(doc('project', { plugins: [{ from: '@wilanis/plugin-http' }] }))).toEqual([at('plugins/0', "missing 'use'")]);
    expect(refused(doc('project', { plugins: [{ use: '@x', from: '../evil.js' }] }))).toEqual([at('plugins/0/from', 'A package name, never a file path')]);
    expect(refused(doc('project', { secrets: { k: 'lower' } }))).toEqual([at('secrets/k', 'environment variable', 'UPPER_CASE')]);
    expect(refused(doc('project', { profiles: { Prod: { bindings: {} } } }))).toEqual([at('profiles', 'kebab-case')]);
    expect(refused(doc('project', { profiles: { prod: {} } }))).toEqual([at('profiles/prod', "missing 'bindings'")]);
    expect(refused(doc('project', { profiles: { prod: { bindings: { 'tasks.port.json': '@x/b.binding.json' } } } }))).toEqual([at('profiles/prod/bindings', 'domain port path')]);
  });
  it('a feature lists kebab-case dependencies, exported paths and effect operations', () => {
    expect(refused(doc('feature', { dependsOn: ['Tasks'] }))).toEqual([at('dependsOn/0', 'feature folder', 'kebab-case')]);
    expect(refused(doc('feature', { dependsOn: ['a', 'a'] }))).toEqual([at('dependsOn', 'duplicate')]);
    expect(refused(doc('feature', { exports: ['tasks.port.json'] }))).toEqual([at('exports/0', 'A document path')]);
    expect(refused(doc('feature', { effects: ['@http/http.port.json'] }))).toEqual([at('effects/0', 'path#operation')]);
  });
});

describe('scenario', () => {
  it('status is done, failed or blocked; nodes is required', () => {
    expect(refused(doc('scenario', { expect: { status: 'ok', nodes: {} } }))).toEqual([at('expect/status', '"done", "failed", "blocked"')]);
    expect(refused(doc('scenario', { expect: { status: 'done' } }))).toEqual([at('expect', "missing 'nodes'")]);
    expect(refused(doc('scenario', { seed: 'one' }))).toEqual([at('seed', 'must be integer')]);
  });
});
