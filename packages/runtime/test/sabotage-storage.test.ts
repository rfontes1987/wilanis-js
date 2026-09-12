/**
 * What a store holds its records to, and what the compiler will not let it say. `unique`, `refs` and
 * `defaults` name fields of the shape a collection declares, and a name the shape lacks, a default the field
 * would not accept or a reference that leaves the store is refused before anything runs (C003 to C008).
 *
 * What a store *means* at a call site -- a filter over it, a patch of it -- is @storage's to judge (X208 to
 * X213, renumbered after RFC 0002's X207). The example keeps nothing yet (RFC 0002 step 8), so every case
 * plants the store it breaks, and the connection is simply one the example already has.
 */
import { schemaUrl } from '@wilanis/core';
import { describe, expect, it } from 'vitest';
import { plantedAll, plantedPointing } from './example-harness.js';

const KEPT = '@connections/entries.connection.json';
const shape = (label: string, fields: Record<string, unknown>) => ({
  $schema: schemaUrl('shape'),
  label,
  layer: 'core',
  description: `A ${label} as the domain knows it.`,
  fields,
});

/** A note of an entry, and a counted thing keyed by a number, so a reference has something to get wrong. */
const SHAPES = {
  'features/monitor/domain/Note.shape.json': shape('Note', {
    id: { type: 'string' },
    entryId: { type: 'string' },
    byId: { type: 'string', required: false, description: 'the entry this note answers, where it answers one' },
    tags: { type: 'string[]' },
    text: { type: 'string' },
  }),
  'features/monitor/domain/Counted.shape.json': shape('Counted', {
    n: { type: 'number' },
    label: { type: 'string' },
  }),
  'features/monitor/domain/Upload.shape.json': shape('Upload', {
    id: { type: 'string' },
    file: { type: 'blob' },
    tags: { type: 'string[]' },
  }),
};

/** The store the cases break: rows keyed by a string, notes referring to them, counted keyed by a number. */
const keeping = (collections: Record<string, unknown>) => ({
  ...SHAPES,
  'features/monitor/data/planted.store.json': {
    $schema: schemaUrl('store'),
    label: 'Entries',
    description: 'The rows recorded so far, and the notes hung off them.',
    connection: KEPT,
    collections,
  },
});

const entry = (extra: Record<string, unknown> = {}) => ({
  of: '@monitor/domain/Entry.shape.json',
  key: 'id',
  ...extra,
});
const notes = (extra: Record<string, unknown> = {}) => ({
  of: '@monitor/domain/Note.shape.json',
  key: 'id',
  ...extra,
});
const counted = { of: '@monitor/domain/Counted.shape.json', key: 'n' };
const codesOf = (collections: Record<string, unknown>) => plantedAll(keeping(collections));
const pointingAt = (collections: Record<string, unknown>) => plantedPointing(keeping(collections));

/** One refusal as a case expects it: the code, and the constraint of the planted store it points at. */
const STORE = '@features/monitor/data/planted.store.json';
const at = (code: string, where: string) => [`${code} ${STORE}#collections/${where}`];

describe('sabotage: what a store holds its records to', () => {
  it('passes check when every constraint names a field the shape has, and means what it can mean', () => {
    expect(
      codesOf({
        rows: entry({ unique: [['url', 'method']], defaults: { ua: 'unknown' } }),
        notes: notes({ refs: { entryId: { collection: 'rows', onRemove: 'refuse' } } }),
      }),
    ).toEqual([]);
  });

  it('C003 a constraint naming a field the shape does not have, pointing at the constraint that named it', () => {
    expect(pointingAt({ rows: entry({ unique: [['urrl']] }) })).toEqual(at('C003', 'rows/unique/0'));
    expect(pointingAt({ rows: entry({ defaults: { nope: 1 } }) })).toEqual(at('C003', 'rows/defaults/nope'));
    expect(pointingAt({ rows: entry({ refs: { nope: { collection: 'rows' } } }) })).toEqual(
      at('C003', 'rows/refs/nope'),
    );
  });

  it('C004 a default the field would not accept, or one given for the key', () => {
    expect(pointingAt({ rows: entry({ defaults: { ua: 7 } }) })).toEqual(at('C004', 'rows/defaults/ua'));
    expect(pointingAt({ rows: entry({ defaults: { id: 'x' } }) })).toEqual(at('C004', 'rows/defaults/id'));
    expect(codesOf({ rows: entry({ defaults: { ua: 'unknown' } }) })).toEqual([]);
  });

  it('C005 a reference to a collection this store does not declare', () => {
    const broken = { rows: entry(), notes: notes({ refs: { entryId: { collection: 'nowhere' } } }) };
    expect(pointingAt(broken)).toEqual(at('C005', 'notes/refs/entryId'));
  });

  it('C006 a reference of one type to records keyed by another', () => {
    const broken = { counted, notes: notes({ refs: { entryId: { collection: 'counted' } } }) };
    expect(pointingAt(broken)).toEqual(at('C006', 'notes/refs/entryId'));
    expect(codesOf({ rows: entry(), notes: notes({ refs: { entryId: { collection: 'rows' } } }) })).toEqual([]);
  });

  it('a reference on a field that may be absent is an ordinary nullable one, and passes', () => {
    // Nothing in RFC 0003's table forbids it: a note that answers no entry holds no reference, which is what
    // an optional field says. The rule that would refuse it is not written down, so it is not judged here.
    const optional = { rows: entry(), notes: notes({ refs: { byId: { collection: 'rows' } } }) };
    expect(codesOf(optional)).toEqual([]);
  });

  it('C007 a constraint that names the key, which identifies a record and is unique already', () => {
    expect(pointingAt({ rows: entry({ unique: [['id']] }) })).toEqual(at('C007', 'rows/unique/0'));
    const onItsKey = { rows: entry(), notes: notes({ refs: { id: { collection: 'rows' } } }) };
    expect(pointingAt(onItsKey)).toEqual(at('C007', 'notes/refs/id'));
  });

  it("a constraint naming one field twice is the schema's to refuse, so C007 never has to", () => {
    expect(codesOf({ rows: entry({ unique: [['url', 'url']] }) })).toEqual(['D001']);
  });

  it('C008 a constraint over a field an engine holds no value of: bytes, a shape or a list', () => {
    const uploads = (extra: Record<string, unknown>) => ({
      of: '@monitor/domain/Upload.shape.json',
      key: 'id',
      ...extra,
    });
    expect(pointingAt({ uploads: uploads({ unique: [['file']] }) })).toEqual(at('C008', 'uploads/unique/0'));
    expect(pointingAt({ uploads: uploads({ unique: [['tags']] }) })).toEqual(at('C008', 'uploads/unique/0'));
    expect(codesOf({ uploads: uploads({ unique: [['id']] }) })).not.toContain('C008');
  });

  it('a reference on a list field is C008 alone: a field an engine holds no value of refers to nothing', () => {
    const broken = { rows: entry(), notes: notes({ refs: { tags: { collection: 'rows' } } }) };
    expect(pointingAt(broken)).toEqual(at('C008', 'notes/refs/tags'));
  });

  it('an unknown shape is R001 once, wherever else the collection is looked at', () => {
    const missing = { rows: { of: '@monitor/domain/Nowhere.shape.json', key: 'id' } };
    expect(pointingAt(missing)).toEqual(at('R001', 'rows/of'));
    const referring = {
      rows: { of: '@monitor/domain/Nowhere.shape.json', key: 'id' },
      notes: notes({ refs: { entryId: { collection: 'rows' } } }),
    };
    expect(pointingAt(referring)).toEqual(at('R001', 'rows/of'));
  });
});
