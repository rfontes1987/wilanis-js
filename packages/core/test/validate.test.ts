import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { KINDS, type Kind, NODE_MAP, NODE_RUN, NODE_SWITCH, schemaRef, schemaUrl } from '../src/model.js';
import { SCHEMAS_DIR, validateDocument } from '../src/validate.js';
import { at, doc, refused, run } from './documents.js';

describe('the schemas themselves', () => {
  it('are plain JSON Schema 2020-12: every one compiles under a strict validator with no extensions, and $id matches its place', () => {
    // strict refuses unknown keywords and formats; strictRequired is an Ajv lint (required keys re-listed in the same properties), not a JSON Schema rule
    const ajv = new Ajv2020({ strict: true, strictRequired: false, allowUnionTypes: true });
    const files = [
      ...readdirSync(SCHEMAS_DIR).filter(name => name.endsWith('.schema.json')),
      ...readdirSync(join(SCHEMAS_DIR, 'node')).map(name => `node/${name}`),
    ];
    const schemas = files.map(file => ({
      file,
      schema: JSON.parse(readFileSync(join(SCHEMAS_DIR, file), 'utf8')) as {
        $id: string;
        $schema: string;
        title: string;
      },
    }));
    for (const { file, schema } of schemas) {
      expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
      expect(schema.$id).toBe(`${schemaUrl('x' as Kind).replace('/x.schema.json', '')}/${file}`);
      expect(schema.title).toBe(file.replace('.schema.json', ''));
      ajv.addSchema(schema);
    }
    for (const { schema } of schemas) expect(() => ajv.getSchema(schema.$id)).not.toThrow();
    expect(KINDS.map(kind => `${kind}.schema.json`).every(name => files.includes(name))).toBe(true);
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
    expect(refused({ $schema: '@wilanis/widget.schema.json', description: 'd' })).toEqual([
      at('$schema', 'does not name a wilanis kind'),
    ]);
    expect(refused({ $schema: 'https://example.com/port.schema.json', description: 'd' })).toEqual([
      at('$schema', 'does not name a wilanis kind'),
    ]);
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
    expect(refused({ $schema: schemaRef('trigger'), description: 'd', settings: {} })).toEqual([
      at(undefined, "missing 'kind'"),
      at(undefined, "missing 'fire'"),
    ]);
  });
});

describe('graph', () => {
  it('a node is judged against the one node schema its type names', () => {
    expect(refused(doc('graph', { nodes: [{ type: NODE_RUN, id: 'a' }] }))).toEqual([at('nodes/0', "missing 'run'")]);
    expect(refused(doc('graph', { nodes: [{ type: NODE_SWITCH, id: 's', in: {}, rules: [{ when: 'x' }] }] }))).toEqual([
      at('nodes/0', "missing 'else'"),
      at('nodes/0/rules/0', "missing 'to'"),
    ]);
    expect(refused(doc('graph', { nodes: [{ type: NODE_MAP, id: 'm', run: '@x/p.json#op' }] }))).toEqual([
      at('nodes/0', "missing 'over'"),
    ]);
  });
  it('an unknown node type names the three that exist', () => {
    expect(refused(doc('graph', { nodes: [{ type: '@wilanis/node/loop.schema.json', id: 'a' }] }))).toEqual([
      at('nodes/0/type', NODE_RUN, NODE_SWITCH, NODE_MAP),
    ]);
  });
  it('several deviations in one node are all reported, each at its own path', () => {
    expect(refused(doc('graph', { nodes: [{ type: NODE_RUN, id: 'Bad-Id', params: {} }] }))).toEqual([
      at('nodes/0', "missing 'run'"),
      at('nodes/0', "unknown property 'params'"),
      at('nodes/0/id', '^[a-z][A-Za-z0-9_]*$', 'node identifier'),
    ]);
  });
  it('identifiers, operation references and paths follow the shared grammar, quoted in the refusal', () => {
    expect(refused(doc('graph', { nodes: [run('a', { run: 'object.port.json#make' })] }))).toEqual([
      at('nodes/0/run', 'path#operation'),
    ]);
    expect(refused(doc('graph', { nodes: [run('a', { run: '@std/object.port.json' })] }))).toEqual([
      at('nodes/0/run', 'path#operation'),
    ]);
    expect(refused(doc('graph', { nodes: [run('a', { in: { 'bad key': 1 } })] }))).toEqual([
      at('nodes/0/in', "property name 'bad key'", 'identifier'),
    ]);
    expect(
      refused(
        doc('graph', {
          nodes: [
            run('a', { in: { x: 1 } }),
            { type: NODE_SWITCH, id: 's', in: {}, rules: [{ when: 'x', to: 'Not-Ident' }], else: 'a' },
          ],
        }),
      ),
    ).toEqual([at('nodes/1/rules/0/to', 'identifier')]);
  });
  it('in, out.type and constants: in is a type reference; out.from is a node or a list of nodes; a constant has type and value', () => {
    expect(refused(doc('graph', { in: { fields: {} } }))).toEqual([at('in', 'must be string')]);
    expect(refused(doc('graph', { in: 'object' }))).toEqual([at('in', 'A type: string, number, boolean, blob')]);
    expect(refused(doc('graph', { out: { type: 'string', from: 3 } }))).toEqual([
      at('out/from', 'must be string or array'),
    ]);
    expect(refused(doc('graph', { out: { type: 'string', from: [] } }))).toEqual([
      at('out/from', 'fewer than 1 items'),
    ]);
    expect(refused(doc('graph', { out: { type: 'string' } }))).toEqual([at('out', "missing 'from'")]);
    expect(refused(doc('graph', { constants: { n: { value: 1 } } }))).toEqual([at('constants/n', "missing 'type'")]);
    expect(refused(doc('graph', { constants: { n: { type: 'number' } } }))).toEqual([
      at('constants/n', "missing 'value'"),
    ]);
  });
  it('a value in in is any JSON: the schema does not judge it, the checker does', () => {
    expect(
      refused(
        doc('graph', {
          nodes: [
            run('a', { in: { s: '{{in.x}}', n: 1, b: true, l: [1, '{{in.y}}'], o: { k: '{{in.z}}' }, z: null } }),
          ],
        }),
      ),
    ).toEqual([]);
  });
  it('a map\'s bind is input -> dotted path or ""; onItemFailure is fail or collect', () => {
    const map = (extra: Record<string, unknown>) =>
      doc('graph', { nodes: [{ type: NODE_MAP, id: 'm', run: '@x/p.json#op', over: '{{in.list}}', ...extra }] });
    expect(refused(map({ bind: { item: '' } }))).toEqual([]);
    expect(refused(map({ bind: { item: 'a.b' } }))).toEqual([]);
    expect(refused(map({ bind: { item: '.a' } }))).toEqual([at('nodes/0/bind/item', 'dotted path within the element')]);
    expect(refused(map({ onItemFailure: 'ignore' }))).toEqual([at('nodes/0/onItemFailure', '"fail", "collect"')]);
  });
});
