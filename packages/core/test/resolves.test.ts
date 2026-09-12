/**
 * Where a type variable comes from when no call site spells it: the path grammar, what it finds in the
 * document the field's literal names, and what a port document may say for itself (D011). Nothing here is
 * storage-specific: a store is the first document to be read this way, not the only one a path could name.
 */
import { describe, expect, it } from 'vitest';
import { badResolves } from '../src/contracts.js';
import type { Field, PortDoc } from '../src/model.js';
import { parsePath, type Resolves, resolvedBy, resolvedHere, showPath, substituted } from '../src/resolves.js';
import { type Type, TypeError_, TypeResolver } from '../src/types.js';

const ENTRY: Type = { kind: 'object', name: '@f/Entry.shape.json', fields: {}, open: false };
const COUNT: Type = { kind: 'object', name: '@f/Count.shape.json', fields: {}, open: false };

/** A tree holding one store and the shapes its collections keep: entries keyed by a string, counts by a number. */
const store = {
  connection: '@connections/records.connection.json',
  collections: {
    entries: { of: '@f/Entry.shape.json', key: 'id' },
    counts: { of: '@f/Count.shape.json', key: 'at' },
  },
};

const DOCS: Record<string, unknown> = {
  '@f/data/records.store.json': store,
  '@f/Entry.shape.json': { layer: 'core', fields: { id: { type: 'string' }, note: { type: 'string' } } },
  '@f/Count.shape.json': { layer: 'core', fields: { at: { type: 'number' } } },
};

const tree: Resolves = {
  document: ref => DOCS[ref],
  type: ref => {
    if (ref === '@f/Entry.shape.json') return ENTRY;
    if (ref === '@f/Count.shape.json') return COUNT;
    if (ref === 'number') return { kind: 'number' };
    if (ref === 'string') return { kind: 'string' };
    throw new TypeError_(`unknown shape '${ref}'`);
  },
};

const field: Field = { type: 'string', static: true, resolves: { $T: 'collections[collection].of' } };

describe('the path grammar', () => {
  it('is field names separated by dots, a segment optionally taking a key by an input or by a sibling', () => {
    expect(parsePath('of')).toEqual([{ name: 'of' }]);
    expect(parsePath('collections[collection].of')).toEqual([
      { name: 'collections', by: 'collection', from: 'input' },
      { name: 'of' },
    ]);
    expect(parsePath('of{key}')).toEqual([{ name: 'of', by: 'key', from: 'sibling' }]);
    expect(parsePath('a.b.c')).toEqual([{ name: 'a' }, { name: 'b' }, { name: 'c' }]);
  });

  it('says why a path that is not one is not one', () => {
    expect(parsePath('')).toBe('an empty path');
    expect(parsePath('.of')).toContain('is not a field name');
    expect(parsePath('collections[Collection].of')).toContain('is not a field name');
    expect(parsePath('collections[collection]of')).toContain('is not a field name');
    expect(parsePath('of[key]{key}')).toContain('is not a field name');
  });

  it('answers the inputs it takes keys by -- a sibling is not one -- and reads back as it was written', () => {
    const path = parsePath('collections[collection].of');
    expect(path).not.toBeTypeOf('string');
    expect(substituted(path as never)).toEqual(['collection']);
    expect(substituted(parsePath('a.b') as never)).toEqual([]);
    // a sibling key is read from the document, not from the call, so no input has to accept it
    expect(substituted(parsePath('of{key}') as never)).toEqual([]);
    expect(showPath(path as never)).toBe('collections[collection].of');
    expect(showPath(parsePath('collections[collection].of{key}') as never)).toBe('collections[collection].of{key}');
  });
});

describe('what a path finds', () => {
  it('binds the variable to the type written at the end of the path', () => {
    expect(resolvedBy(field, '@f/data/records.store.json', { collection: 'entries' }, tree)).toEqual({ $T: ENTRY });
  });

  it('the substituted key chooses the collection, so one expression covers every one of them', () => {
    expect(resolvedBy(field, '@f/data/records.store.json', { collection: 'entries' }, tree)).toEqual({ $T: ENTRY });
    // the same expression, a different collection: the type follows the call's own `collection`
    expect(resolvedBy(field, '@f/data/records.store.json', { collection: 'counts' }, tree)).toEqual({ $T: COUNT });
  });

  it("the key's type is read through the record's own shape, by the name the collection's key holds", () => {
    // the one expression a port writes for both: `of` is followed into the shape, `{key}` takes the field it names
    const both: Field = {
      type: 'string',
      static: true,
      resolves: { $T: 'collections[collection].of', $K: 'collections[collection].of{key}.type' },
    };
    expect(resolvedBy(both, '@f/data/records.store.json', { collection: 'entries' }, tree)).toEqual({
      $T: ENTRY,
      $K: { kind: 'string' },
    });
    // a collection keyed by a number field types its key with a number, and no rule objects
    expect(resolvedBy(both, '@f/data/records.store.json', { collection: 'counts' }, tree)).toEqual({
      $T: COUNT,
      $K: { kind: 'number' },
    });
  });

  it('binds nothing where the tree cannot answer: an unknown document, a collection it lacks, a key not given', () => {
    expect(resolvedBy(field, '@f/data/absent.store.json', { collection: 'entries' }, tree)).toEqual({});
    expect(resolvedBy(field, '@f/data/records.store.json', { collection: 'absent' }, tree)).toEqual({});
    expect(resolvedBy(field, '@f/data/records.store.json', {}, tree)).toEqual({});
    expect(resolvedBy(field, '{{in.store}}', { collection: 'entries' }, tree)).toEqual({});
  });

  it('binds nothing where the value at the end is not a type reference, or names a shape the tree lacks', () => {
    const missing: Field = { type: 'string', static: true, resolves: { $T: 'connection' } };
    expect(resolvedBy(missing, '@f/data/records.store.json', {}, tree)).toEqual({});
    const notARef: Field = { type: 'string', static: true, resolves: { $T: 'collections' } };
    expect(resolvedBy(notARef, '@f/data/records.store.json', {}, tree)).toEqual({});
  });

  it('a field with no resolves binds nothing through this channel', () => {
    expect(resolvedBy({ type: 'string' }, '@f/data/records.store.json', {}, tree)).toEqual({});
  });

  it('every input of one call site binds together', () => {
    const accepts = { store: field, collection: { type: 'string', static: true } };
    expect(resolvedHere(accepts, { store: '@f/data/records.store.json', collection: 'entries' }, tree)).toEqual({
      $T: ENTRY,
    });
    expect(resolvedHere(undefined, {}, tree)).toEqual({});
  });

  it('an unknown shape is quiet here: the document that names it is refused where it names it', () => {
    const types = new TypeResolver(() => undefined);
    const quiet: Resolves = { document: () => store, type: ref => types.ref(ref) };
    expect(resolvedBy(field, '@f/data/records.store.json', { collection: 'entries' }, quiet)).toEqual({});
  });
});

describe('D011: what a port document may say for itself', () => {
  const port = (accepts: Record<string, Field>): PortDoc =>
    ({
      $schema: '@wilanis/port.schema.json',
      description: 'd',
      operations: { get: { description: 'one record', accepts } },
    }) as PortDoc;

  const ok = { store: field, collection: { type: 'string', static: true } as Field };

  it('accepts a contract whose path parses and whose keys are static inputs of the same operation', () => {
    expect(badResolves(port(ok), '@storage/store.port.json')).toEqual([]);
  });

  it('refuses a path that is not a path, naming the variable and quoting the grammar', () => {
    const bad = badResolves(port({ ...ok, store: { ...field, resolves: { $T: 'collections[collection]of' } } }), 'f');
    expect(bad.map(refusal => refusal.code)).toEqual(['D011']);
    expect(bad[0].at).toBe('operations/get/accepts/store/resolves');
    expect(bad[0].message).toContain('$T resolves through');
    expect(bad[0].hint).toContain('collections[collection].of');
  });

  it('refuses a field that resolves a type but is not static', () => {
    const bad = badResolves(port({ ...ok, store: { type: 'string', resolves: field.resolves } }), 'f');
    expect(bad.map(refusal => refusal.message)).toEqual([
      expect.stringContaining("'store' resolves a type but is not static"),
    ]);
    expect(bad[0].hint).toContain('"static": true');
  });

  it('refuses a key taken by an input the operation has not got, and lists the ones it has', () => {
    const bad = badResolves(port({ store: field }), 'f');
    expect(bad.map(refusal => refusal.message)).toEqual([
      expect.stringContaining("takes a key by 'collection', not an input of this operation"),
    ]);
    expect(bad[0].hint).toContain('store');
  });

  it('refuses a key taken by an input that is not static, since a key is read before anything runs', () => {
    const bad = badResolves(port({ ...ok, collection: { type: 'string' } }), 'f');
    expect(bad.map(refusal => refusal.message)).toEqual([
      expect.stringContaining("takes a key by 'collection', an input that is not static"),
    ]);
  });

  it('says nothing about a port that resolves nothing', () => {
    expect(badResolves(port({ value: { type: 'string' } }), 'f')).toEqual([]);
  });
});
