/**
 * What a store holds its records to, and what the compiler will not let it say. `unique`, `refs` and
 * `defaults` name fields of the shape a collection declares, and a name the shape lacks, a default the field
 * would not accept or a reference that leaves the store is refused before anything runs (C003 to C008).
 *
 * What a store *means* at a call site -- a filter over it, a patch of it -- is @storage's to judge (X206 to
 * X211). The example keeps nothing yet (RFC 0002 step 8), so every case plants the store it breaks, and the
 * connection is simply one the example already has.
 */
import { schemaUrl } from '@wilanis/core';
import { describe, expect, it } from 'vitest';
import { plantedAll } from './example-harness.js';

const KEPT = '@connections/customers.connection.json';
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

/** The store the cases break: entries keyed by a string, notes referring to them, counted keyed by a number. */
const keeping = (collections: Record<string, unknown>) => ({
  ...SHAPES,
  'features/monitor/data/entries.store.json': {
    $schema: schemaUrl('store'),
    label: 'Entries',
    description: 'The entries recorded so far, and the notes hung off them.',
    connection: KEPT,
    collections,
  },
});

const entries = (extra: Record<string, unknown> = {}) => ({
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

describe('sabotage: what a store holds its records to', () => {
  it('passes check when every constraint names a field the shape has, and means what it can mean', () => {
    expect(
      codesOf({
        entries: entries({ unique: [['url', 'method']], defaults: { ua: 'unknown' } }),
        notes: notes({ refs: { entryId: { collection: 'entries', onRemove: 'refuse' } } }),
      }),
    ).toEqual([]);
  });

  it('C003 a constraint naming a field the shape does not have', () => {
    expect(codesOf({ entries: entries({ unique: [['urrl']] }) })).toContain('C003');
    expect(codesOf({ entries: entries({ defaults: { nope: 1 } }) })).toContain('C003');
    expect(codesOf({ entries: entries({ refs: { nope: { collection: 'entries' } } }) })).toContain('C003');
  });

  it('C004 a default the field would not accept, or one given for the key', () => {
    expect(codesOf({ entries: entries({ defaults: { ua: 7 } }) })).toContain('C004');
    expect(codesOf({ entries: entries({ defaults: { id: 'x' } }) })).toContain('C004');
    expect(codesOf({ entries: entries({ defaults: { ua: 'unknown' } }) })).toEqual([]);
  });

  it('C005 a reference to a collection this store does not declare', () => {
    const broken = { entries: entries(), notes: notes({ refs: { entryId: { collection: 'nowhere' } } }) };
    expect(codesOf(broken)).toContain('C005');
  });

  it('C006 a reference of one type to records keyed by another', () => {
    const broken = { counted, notes: notes({ refs: { entryId: { collection: 'counted' } } }) };
    expect(codesOf(broken)).toContain('C006');
    expect(codesOf({ entries: entries(), notes: notes({ refs: { entryId: { collection: 'entries' } } }) })).toEqual([]);
  });

  it('C007 a constraint that names the key, which identifies a record and is unique already', () => {
    expect(codesOf({ entries: entries({ unique: [['id']] }) })).toContain('C007');
    const onItsKey = { entries: entries(), notes: notes({ refs: { id: { collection: 'entries' } } }) };
    expect(codesOf(onItsKey)).toContain('C007');
  });

  it("a constraint naming one field twice is the schema's to refuse, so C007 never has to", () => {
    expect(codesOf({ entries: entries({ unique: [['url', 'url']] }) })).toEqual(['D001']);
  });

  it('C008 a constraint over a field an engine holds no value of: bytes, a shape or a list', () => {
    const uploads = (extra: Record<string, unknown>) => ({
      of: '@monitor/domain/Upload.shape.json',
      key: 'id',
      ...extra,
    });
    expect(codesOf({ uploads: uploads({ unique: [['file']] }) })).toContain('C008');
    expect(codesOf({ uploads: uploads({ unique: [['tags']] }) })).toContain('C008');
    expect(codesOf({ uploads: uploads({ unique: [['id']] }) })).not.toContain('C008');
  });
});
