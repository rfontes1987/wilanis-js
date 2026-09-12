/**
 * The `where` grammar. What a filter may say is judged here and not in an engine, so these are the answers
 * every engine gives alike -- and the refusals are the ones a graph sees at run time until RFC 0003 moves
 * them to `wilanis check`.
 */
import { type Type, TypeResolver } from '@wilanis/core';
import { describe, expect, it } from 'vitest';
import { OPERATORS, parseWhere, whereOf } from '../src/where.js';

const types = new TypeResolver(() => undefined);
const SHAPE: Type = types.inline({
  fields: {
    url: { type: 'string' },
    hits: { type: 'number' },
    ok: { type: 'boolean' },
    ua: { type: 'string', required: false },
    tags: { type: 'string[]' },
    at: { type: { fields: { city: { type: 'string' } } } },
  },
});
const parse = (filter: unknown) => parseWhere(filter, SHAPE);

describe('what a filter says', () => {
  it('a bare value is equality, whatever the value is', () => {
    expect(parse({ url: 'https://x' })).toEqual({
      kind: 'field',
      field: 'url',
      tests: [{ op: 'eq', value: 'https://x' }],
    });
    expect(parse({ ok: false })).toEqual({ kind: 'field', field: 'ok', tests: [{ op: 'eq', value: false }] });
    expect(parse({ hits: 0 })).toEqual({ kind: 'field', field: 'hits', tests: [{ op: 'eq', value: 0 }] });
  });

  it('an object of operators is a predicate, and several of them test one field together', () => {
    expect(parse({ hits: { gte: 2, lt: 9 } })).toEqual({
      kind: 'field',
      field: 'hits',
      tests: [
        { op: 'gte', value: 2 },
        { op: 'lt', value: 9 },
      ],
    });
  });

  it('every operator the grammar names parses', () => {
    const given: Record<string, unknown> = { has: true, in: ['x'], notIn: ['x'] };
    for (const op of OPERATORS) {
      const value = op in given ? given[op] : 'x';
      expect(parse({ url: { [op]: value } })).toEqual({ kind: 'field', field: 'url', tests: [{ op, value }] });
    }
  });

  it('several keys are one all, and all, any and not nest', () => {
    expect(parse({ url: 'x', hits: 1 })).toEqual({
      kind: 'all',
      of: [
        { kind: 'field', field: 'url', tests: [{ op: 'eq', value: 'x' }] },
        { kind: 'field', field: 'hits', tests: [{ op: 'eq', value: 1 }] },
      ],
    });
    expect(parse({ any: [{ url: 'x' }, { not: { hits: 1 } }] })).toEqual({
      kind: 'any',
      of: [
        { kind: 'field', field: 'url', tests: [{ op: 'eq', value: 'x' }] },
        { kind: 'not', of: { kind: 'field', field: 'hits', tests: [{ op: 'eq', value: 1 }] } },
      ],
    });
  });

  it('no filter at all is no filter, and an empty one matches everything', () => {
    expect(whereOf(undefined, SHAPE)).toBeUndefined();
    expect(whereOf(null, SHAPE)).toBeUndefined();
    expect(whereOf({}, SHAPE)).toEqual({ kind: 'all', of: [] });
  });
});

describe('what a filter may not say', () => {
  it('a field the shape lacks is refused, and the fields it has are named', () => {
    expect(() => parse({ methd: 'GET' })).toThrow(
      /'methd' is not a field of the collection's shape \(fields: url, hits/,
    );
  });

  it('an operator the grammar lacks is refused, and the operators it has are named', () => {
    expect(() => parse({ url: { like: 'x' } })).toThrow(/'like' is not an operator of 'url' \(operators: eq, ne/);
  });

  it('only has may test a field that is a shape or a list', () => {
    expect(parse({ tags: { has: true } })).toEqual({
      kind: 'field',
      field: 'tags',
      tests: [{ op: 'has', value: true }],
    });
    expect(() => parse({ tags: { eq: ['x'] } })).toThrow(/only 'has' may test one/);
    expect(() => parse({ at: { contains: 'x' } })).toThrow(/only 'has' may test one/);
    expect(() => parse({ tags: ['x'] })).toThrow(/only 'has' may test one/);
  });

  it('a predicate that names no operator is refused rather than read as equality', () => {
    expect(() => parse({ url: {} })).toThrow(/the predicate on 'url' names no operator/);
  });

  it('text is matched on a string, and an ordering does not apply to a boolean', () => {
    expect(() => parse({ hits: { contains: '2' } })).toThrow(/'contains' matches text, and this field is number/);
    expect(() => parse({ ok: { gt: false } })).toThrow(/'gt' orders, and a boolean does not/);
  });

  it('a list operator takes a list, a combinator takes what it combines, and a filter is an object', () => {
    expect(() => parse({ url: { in: 'x' } })).toThrow(/'url.in' takes a list/);
    expect(() => parse({ tags: { has: 'yes' } })).toThrow(/'tags.has' takes a boolean/);
    expect(() => parse({ all: { url: 'x' } })).toThrow(/'all' takes a list of filters/);
    expect(() => parse('url')).toThrow(/a filter is an object of fields and combinators/);
  });
});
