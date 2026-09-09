import { describe, expect, it } from 'vitest';
import {
  assignable,
  BLOB,
  conforms,
  generate,
  isBlobHandle,
  rng,
  show,
  TypeResolver,
  toJsonSchema,
  typeAt,
} from '../src/index.js';

const types = new TypeResolver(() => undefined);

describe('the blob type', () => {
  it('is a type of its own: named blob, assignable only to blob and unknown', () => {
    expect(types.ref('blob')).toEqual(BLOB);
    expect(show(types.ref('blob[]'))).toBe('blob[]');
    expect(assignable(BLOB, BLOB)).toBeNull();
    expect(assignable(BLOB, { kind: 'unknown' })).toBeNull();
    expect(assignable(BLOB, { kind: 'string' })).toBe('blob is not string');
    expect(
      assignable(
        types.inline({ fields: { id: { type: 'string' }, contentType: { type: 'string' }, size: { type: 'number' } } }),
        BLOB,
      ),
    ).toContain('is not blob');
  });
  it('a value of it is the handle -- id, contentType, size, an optional filename -- and nothing else passes', () => {
    expect(isBlobHandle({ id: 'x', contentType: 'text/csv', size: 3 })).toBe(true);
    expect(conforms({ id: 'x', contentType: 'text/csv', size: 3, filename: 'a.csv' }, BLOB)).toBeNull();
    expect(conforms('bytes', BLOB)).toBe('$: expected a blob (the handle of a stored file: id, contentType, size)');
    expect(conforms({ id: 'x' }, BLOB)).toContain('expected a blob');
  });
  it("reads into a blob see the handle's fields, so {{in.file.filename}} types as an optional string", () => {
    expect(typeAt(BLOB, ['filename'])).toEqual({ type: { kind: 'string' }, optional: true });
    expect(typeAt(BLOB, ['size'])).toEqual({ type: { kind: 'number' }, optional: false });
    expect(typeAt(BLOB, ['bytes'])).toBe("no field 'bytes' in blob");
  });
  it('generates a handle under a seed, and describes itself as the handle in JSON Schema', () => {
    expect(isBlobHandle(generate(BLOB, rng(7)))).toBe(true);
    expect(toJsonSchema(BLOB)).toMatchObject({ type: 'object', required: ['id', 'contentType', 'size'] });
  });
});
