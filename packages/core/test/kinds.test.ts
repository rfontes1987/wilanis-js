import { describe, expect, it } from 'vitest';
import { NODE_RUN } from '../src/model.js';
import { at, doc, refused } from './documents.js';

describe('shape and the type grammar', () => {
  it('layer is edge or core', () => {
    expect(refused(doc('shape', { layer: 'middle' }))).toEqual([at('layer', '"edge", "core"')]);
  });
  it('a field type is a type reference or an inline object; the refusal quotes the grammar', () => {
    expect(refused(doc('shape', { fields: { a: { type: 'object' } } }))).toEqual([
      at('fields/a/type', 'A type: string, number, boolean, blob'),
    ]);
    expect(refused(doc('shape', { fields: { a: { type: 'Task' } } }))).toEqual([at('fields/a/type', 'A type:')]);
    expect(refused(doc('shape', { fields: { a: { type: 3 } } }))).toEqual([
      at('fields/a/type', 'must be string or object'),
    ]);
    expect(refused(doc('shape', { fields: { a: { type: { open: true } } } }))).toEqual([
      at('fields/a/type', "missing 'fields'"),
    ]);
    expect(refused(doc('shape', { fields: { a: {} } }))).toEqual([at('fields/a', "missing 'type'")]);
    expect(refused(doc('shape', { fields: { a: { type: 'string', enum: [] } } }))).toEqual([
      at('fields/a/enum', 'fewer than 1 items'),
    ]);
    expect(refused(doc('shape', { fields: { a: { type: 'string', binds: 'body' } } }))).toEqual([
      at('fields/a/binds', 'Native contracts only'),
    ]);
    expect(refused(doc('shape', { fields: { 'Bad Name': { type: 'string' } } }))).toEqual([at('fields', 'identifier')]);
  });
  it('the type grammar accepts every form it promises', () => {
    for (const type of [
      'string',
      'number[]',
      'blob',
      'blob[]',
      'unknown',
      'type',
      '$T',
      '$Body[]',
      '@shapes/Task.shape.json',
      '@features/f/shapes/Task.shape.json[][]',
    ])
      expect(refused(doc('shape', { fields: { a: { type } } }))).toEqual([]);
  });
  it('open is a boolean or a type reference, shared with inline objects', () => {
    expect(refused(doc('shape', { open: 5 }))).toEqual([at('open', 'must be boolean or string')]);
    expect(refused(doc('shape', { open: 'string' }))).toEqual([]);
    expect(refused(doc('trigger-kind', { settings: { fields: {}, open: 5 } }))).toEqual([
      at('settings/open', 'must be boolean or string'),
    ]);
  });
});

describe('port and binding', () => {
  it('an operation has a description; accepts is fields; pure is a boolean', () => {
    expect(refused(doc('port', { operations: { get: {} } }))).toEqual([at('operations/get', "missing 'description'")]);
    expect(refused(doc('port', { operations: {} }))).toEqual([at('operations', 'fewer than 1 properties')]);
    expect(refused(doc('port', { operations: { get: { description: 'x', accepts: { a: 'string' } } } }))).toEqual([
      at('operations/get/accepts/a', 'must be object'),
    ]);
    expect(refused(doc('port', { operations: { get: { description: 'x', pure: 'yes' } } }))).toEqual([
      at('operations/get/pure', 'must be boolean'),
    ]);
    expect(refused(doc('port', { operations: { get: { description: 'x', params: {} } } }))).toEqual([
      at('operations/get', "unknown property 'params'"),
    ]);
  });
  it('a binding operation is a graph or a run, never both, never neither; a graph takes no in', () => {
    expect(refused(doc('binding', { operations: { get: { graph: '@x/g.graph.json', run: '@y/p.json#op' } } }))).toEqual(
      [at('operations/get/run', "'run' is not allowed here")],
    );
    expect(refused(doc('binding', { operations: { get: { description: 'x' } } }))).toEqual([
      at('operations/get', "missing 'graph'"),
      at('operations/get', "missing 'run'"),
    ]);
    expect(refused(doc('binding', { operations: { get: { graph: '@x/g.graph.json', in: {} } } }))).toEqual([
      at('operations/get/in', "'in' is not allowed here"),
    ]);
    expect(refused(doc('binding', { operations: { get: { run: '@y/p.json#op', in: { a: '{{in.a}}' } } } }))).toEqual(
      [],
    );
    expect(refused(doc('binding', { operations: { get: { run: '@y/p.json#op', params: {} } } }))).toEqual([
      at('operations/get', "unknown property 'params'"),
    ]);
  });
  it('a binding names its resolvers document by path', () => {
    expect(refused(doc('binding', { resolvers: '@features/f/edge/r.resolvers.json' }))).toEqual([]);
    expect(refused(doc('binding', { resolvers: { caller: { read: 'request.params.id' } } }))).toEqual([
      at('resolvers', 'must be string'),
    ]);
  });
});

describe('resolvers', () => {
  it('a resolver reads a path into the request; a key that is not an identifier is quoted in brackets', () => {
    expect(refused(doc('resolvers', { resolvers: { a: { read: 'request.params.id' } } }))).toEqual([]);
    expect(refused(doc('resolvers', { resolvers: { a: { read: 'request.headers["user-agent"]' } } }))).toEqual([]);
    expect(refused(doc('resolvers', { resolvers: { a: { read: 'params.id' } } }))).toEqual([
      at('resolvers/a/read', 'A path into the request'),
    ]);
    expect(refused(doc('resolvers', { resolvers: { a: { read: 'request' } } }))).toEqual([
      at('resolvers/a/read', 'A path into the request'),
    ]);
    expect(refused(doc('resolvers', { resolvers: { a: { run: '@std/text.port.json#fill' } } }))).toEqual([
      at('resolvers/a', "missing 'read'"),
      at('resolvers/a', "unknown property 'run'"),
    ]);
    expect(refused(doc('resolvers', { resolvers: {} }))).toEqual([
      at('resolvers', 'must NOT have fewer than 1 properties'),
    ]);
  });
  it('a graph or binding names the resolvers document by path', () => {
    expect(refused(doc('graph', { resolvers: '@features/f/edge/r.resolvers.json' }))).toEqual([]);
    expect(refused(doc('graph', { resolvers: { a: { read: 'request.params.id' } } }))).toEqual([
      at('resolvers', 'must be string'),
    ]);
  });
});

describe('trigger, kinds, connection, codec', () => {
  it('a trigger names a kind by path and fires one port operation; its settings are an object', () => {
    expect(refused(doc('trigger', { kind: 'http' }))).toEqual([at('kind', 'A document path')]);
    expect(refused(doc('trigger', { settings: [] }))).toEqual([at('settings', 'must be object')]);
    expect(refused(doc('trigger', { in: { fields: {} } }))).toEqual([at('in', 'must be string')]);
    expect(
      refused(
        doc('trigger', { fire: { run: '@features/f/domain/f.port.json#get', in: { id: '{{request.params.id}}' } } }),
      ),
    ).toEqual([]);
    // the node type is the schema's declaration, never restated on the document
    expect(refused(doc('trigger', { fire: { type: NODE_RUN, run: '@features/f/domain/f.port.json#get' } }))).toEqual([
      at('fire', "unknown property 'type'"),
    ]);
    // a trigger fires an operation, never a graph
    expect(refused(doc('trigger', { fire: { run: '@features/f/data/g.graph.json' } }))).toEqual([
      at('fire/run', 'path#operation: one operation of a port'),
    ]);
  });
  it('a trigger kind has settings and context as inline objects', () => {
    expect(refused(doc('trigger-kind', { context: 'string' }))).toEqual([at('context', 'must be object')]);
    expect(
      refused(doc('trigger-kind', { settings: { fields: { route: { type: 'string', binds: 'Params' } } } })),
    ).toEqual([at('settings/fields/route/binds', 'Native contracts only')]);
  });
  it('a connection kind has settings; a connection names a kind; storage says the kind reaches an engine', () => {
    expect(refused(doc('connection-kind', { settings: {} }))).toEqual([at('settings', "missing 'fields'")]);
    expect(refused(doc('connection', { kind: 'postgres' }))).toEqual([at('kind', 'A document path')]);
    expect(refused(doc('connection-kind', { storage: true }))).toEqual([]);
    expect(refused(doc('connection-kind', { storage: 'yes' }))).toEqual([at('storage', 'must be boolean')]);
  });
  it('a codec yields declared or a type; the refusal names both', () => {
    expect(refused(doc('codec', { yields: 'maybe' }))).toEqual([at('yields', 'must be "declared", or', 'A type:')]);
    expect(refused(doc('codec', { yields: 'string' }))).toEqual([]);
  });
});

describe('project and feature', () => {
  it('names, aliases, plugins, secrets and profiles follow their grammars, each explained', () => {
    expect(refused(doc('project', { name: 'My Project' }))).toEqual([at('name', 'kebab-case')]);
    expect(refused(doc('project', { aliases: { tasks: '@features/tasks' } }))).toEqual([
      at('aliases', "property name 'tasks'", '@ followed by a kebab-case name'),
    ]);
    expect(refused(doc('project', { aliases: { '@tasks': 'features/tasks' } }))).toEqual([
      at('aliases/@tasks', 'A folder path from the root'),
    ]);
    expect(refused(doc('project', { plugins: [{ from: '@wilanis/plugin-http' }] }))).toEqual([
      at('plugins/0', "missing 'use'"),
    ]);
    expect(refused(doc('project', { plugins: [{ use: '@x', from: '../evil.js' }] }))).toEqual([
      at('plugins/0/from', 'A package name, never a file path'),
    ]);
    expect(refused(doc('project', { secrets: { k: 'lower' } }))).toEqual([
      at('secrets/k', 'environment variable', 'UPPER_CASE'),
    ]);
    expect(refused(doc('project', { profiles: { Prod: { bindings: {} } } }))).toEqual([at('profiles', 'kebab-case')]);
    expect(refused(doc('project', { profiles: { prod: {} } }))).toEqual([at('profiles/prod', "missing 'bindings'")]);
    expect(
      refused(doc('project', { profiles: { prod: { bindings: { 'tasks.port.json': '@x/b.binding.json' } } } })),
    ).toEqual([at('profiles/prod/bindings', 'domain port path')]);
  });
  it('a feature lists kebab-case dependencies, exported paths and effect operations', () => {
    expect(refused(doc('feature', { dependsOn: ['Tasks'] }))).toEqual([
      at('dependsOn/0', 'feature folder', 'kebab-case'),
    ]);
    expect(refused(doc('feature', { dependsOn: ['a', 'a'] }))).toEqual([at('dependsOn', 'duplicate')]);
    expect(refused(doc('feature', { exports: ['tasks.port.json'] }))).toEqual([at('exports/0', 'A document path')]);
    expect(refused(doc('feature', { effects: ['@http/http.port.json'] }))).toEqual([at('effects/0', 'path#operation')]);
  });
});

describe('scenario', () => {
  it('status is done, failed or blocked; nodes is required', () => {
    expect(refused(doc('scenario', { expect: { status: 'ok', nodes: {} } }))).toEqual([
      at('expect/status', '"done", "failed", "blocked"'),
    ]);
    expect(refused(doc('scenario', { expect: { status: 'done' } }))).toEqual([at('expect', "missing 'nodes'")]);
    expect(refused(doc('scenario', { seed: 'one' }))).toEqual([at('seed', 'must be integer')]);
  });
});

describe('store', () => {
  it('names one connection by path and at least one collection', () => {
    expect(refused(doc('store', { connection: 'postgres' }))).toEqual([at('connection', 'A document path')]);
    expect(refused(doc('store', { collections: {} }))).toEqual([
      at('collections', 'must NOT have fewer than 1 properties'),
    ]);
    const { connection: _, ...without } = doc('store');
    expect(refused(without)).toEqual([at(undefined, "missing 'connection'")]);
  });
  it('a collection is named by an identifier and says the shape it keeps and the field that keys it', () => {
    const collections = (one: Record<string, unknown>) => doc('store', { collections: { entries: one } });
    expect(refused(collections({ of: '@features/f/domain/Entry.shape.json' }))).toEqual([
      at('collections/entries', "missing 'key'"),
    ]);
    expect(refused(collections({ key: 'id' }))).toEqual([at('collections/entries', "missing 'of'")]);
    expect(refused(collections({ of: 'Entry', key: 'id' }))).toEqual([at('collections/entries/of', 'A type:')]);
    expect(refused(collections({ of: '@features/f/domain/Entry.shape.json', key: 'the id' }))).toEqual([
      at('collections/entries/key', 'identifier'),
    ]);
    expect(refused(collections({ of: '@features/f/domain/Entry.shape.json', key: 'id', table: 'entries' }))).toEqual([
      at('collections/entries', "unknown property 'table'"),
    ]);
    expect(refused(doc('store', { collections: { 'Bad Name': { of: 'unknown', key: 'id' } } }))).toEqual([
      at('collections', "property name 'Bad Name'", 'identifier'),
    ]);
  });
  it('a collection may declare what no two records repeat, which field holds another collection key, and what existing rows receive', () => {
    const entries = {
      of: '@features/f/domain/Entry.shape.json',
      key: 'id',
      unique: [['url', 'method']],
      defaults: { ua: 'unknown' },
      description: 'observed calls',
    };
    const notes = {
      of: '@features/f/domain/Note.shape.json',
      key: 'id',
      refs: { entryId: { collection: 'entries', onRemove: 'refuse', description: 'the entry observed' } },
    };
    expect(refused(doc('store', { collections: { entries, notes } }))).toEqual([]);
  });
  it('a constraint names each field by its identifier, and names at least one', () => {
    const collections = (one: Record<string, unknown>) =>
      doc('store', { collections: { entries: { of: '@features/f/domain/Entry.shape.json', key: 'id', ...one } } });
    expect(refused(collections({ unique: [[]] }))).toEqual([
      at('collections/entries/unique/0', 'must NOT have fewer than 1 items'),
    ]);
    expect(refused(collections({ unique: [['url', 'url']] }))).toEqual([
      at('collections/entries/unique/0', 'must NOT have duplicate items'),
    ]);
    expect(refused(collections({ unique: [['the url']] }))).toEqual([
      at('collections/entries/unique/0/0', 'identifier'),
    ]);
    expect(refused(collections({ unique: ['url'] }))).toEqual([at('collections/entries/unique/0', 'must be array')]);
    expect(refused(collections({ defaults: { 'not a field': 1 } }))).toEqual([
      at('collections/entries/defaults', "property name 'not a field'", 'identifier'),
    ]);
  });
  it('a reference names one collection and refuses a removal, and admits nothing else', () => {
    const collections = (ref: Record<string, unknown>) =>
      doc('store', {
        collections: { entries: { of: '@features/f/domain/Entry.shape.json', key: 'id', refs: { entryId: ref } } },
      });
    expect(refused(collections({}))).toEqual([at('collections/entries/refs/entryId', "missing 'collection'")]);
    expect(refused(collections({ collection: 'entries', onRemove: 'cascade' }))).toEqual([
      at('collections/entries/refs/entryId/onRemove', 'must be one of "refuse"'),
    ]);
    expect(refused(collections({ collection: '@features/f/data/other.store.json' }))).toEqual([
      at('collections/entries/refs/entryId/collection', 'identifier'),
    ]);
    expect(refused(collections({ collection: 'entries', of: 'string' }))).toEqual([
      at('collections/entries/refs/entryId', "unknown property 'of'"),
    ]);
  });
});
