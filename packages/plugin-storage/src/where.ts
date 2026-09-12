/**
 * The `where` grammar: a filter as a graph writes it, parsed into the tree an engine compiles. It lives here
 * and not in an engine so that every engine judges the same filter the same way -- the memory one compiles the
 * tree to a predicate, the postgres one to expressions, and neither decides what a filter may say.
 *
 * A filter is an object whose keys are fields of the collection's shape, or one of the three combinators. A
 * field's value is a literal, meaning equality, or a predicate object of one or more operators. A field that
 * is a shape or a list may only be tested with `has`: what lies inside one is not this grammar's business.
 *
 * What is judged here is what the port promises at run time -- an unknown field, an unknown operator, a test a
 * field's type does not admit. Judging a filter before anything runs is RFC 0003's X206 to X208.
 */
import type { ObjField, Type } from '@wilanis/core';

/** The operators a predicate object may carry. */
export const OPERATORS = [
  'eq',
  'ne',
  'lt',
  'lte',
  'gt',
  'gte',
  'in',
  'notIn',
  'has',
  'contains',
  'startsWith',
] as const;
export type Operator = (typeof OPERATORS)[number];

const ORDERINGS = new Set<Operator>(['lt', 'lte', 'gt', 'gte']);
const STRINGS = new Set<Operator>(['contains', 'startsWith']);
const LISTS = new Set<Operator>(['in', 'notIn']);

/** One test of one field: the operator, and what it is given. */
export interface Test {
  op: Operator;
  value: unknown;
}

/** A filter as parsed: the combinators, and a field with the tests it must pass. */
export type Where =
  | { kind: 'all'; of: Where[] }
  | { kind: 'any'; of: Where[] }
  | { kind: 'not'; of: Where }
  | { kind: 'field'; field: string; tests: Test[] };

const isOperator = (key: string): key is Operator => (OPERATORS as readonly string[]).includes(key);
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** The fields a shape has, so an unknown one can be named alongside the ones that exist. */
function fieldsOf(shape: Type): Record<string, ObjField> {
  return shape.kind === 'object' ? shape.fields : {};
}

/** Whether a field holds something this grammar looks inside: only `has` may test a shape or a list. */
function opaque(type: Type): boolean {
  return type.kind === 'object' || type.kind === 'list';
}

/** The test a field's type does not admit, or nothing: strings are matched as text, and only what orders orders. */
function unfit(op: Operator, type: Type): string | undefined {
  if (opaque(type) && op !== 'has')
    return `'${op}' tests inside a field that is a shape or a list; only 'has' may test one`;
  if (STRINGS.has(op) && type.kind !== 'string') return `'${op}' matches text, and this field is ${type.kind}`;
  if (ORDERINGS.has(op) && type.kind === 'boolean') return `'${op}' orders, and a boolean does not`;
  return undefined;
}

/** One test, held to being one the grammar names and one the field's type admits. */
function testOf(field: string, op: string, value: unknown, type: Type): Test {
  if (!isOperator(op))
    throw new Error(`where: '${op}' is not an operator of '${field}' (operators: ${OPERATORS.join(', ')})`);
  const bad = unfit(op, type);
  if (bad) throw new Error(`where: on '${field}', ${bad}`);
  if (LISTS.has(op) && !Array.isArray(value)) throw new Error(`where: '${field}.${op}' takes a list`);
  return { op, value };
}

/**
 * One field's tests. An object is a predicate and every key of it is an operator -- which is what lets a
 * misspelled one be named rather than silently compared -- and any other value means equality.
 */
function testsOf(field: string, given: unknown, type: Type): Test[] {
  if (!isPlainObject(given)) return [testOf(field, 'eq', given, type)];
  const keys = Object.keys(given);
  if (!keys.length) throw new Error(`where: the predicate on '${field}' names no operator`);
  return keys.map(key => testOf(field, key, given[key], type));
}

/** Every filter of a combinator that takes a list of them. */
function branches(key: string, given: unknown, shape: Type): Where[] {
  if (!Array.isArray(given)) throw new Error(`where: '${key}' takes a list of filters`);
  return given.map(one => parseWhere(one, shape));
}

/** One entry of a filter object: a combinator, or a field of the shape with what is asked of it. */
function entry(key: string, given: unknown, shape: Type): Where {
  if (key === 'all') return { kind: 'all', of: branches(key, given, shape) };
  if (key === 'any') return { kind: 'any', of: branches(key, given, shape) };
  if (key === 'not') return { kind: 'not', of: parseWhere(given, shape) };
  const field = fieldsOf(shape)[key];
  if (!field) {
    const names = Object.keys(fieldsOf(shape)).join(', ') || 'none';
    throw new Error(`where: '${key}' is not a field of the collection's shape (fields: ${names})`);
  }
  return { kind: 'field', field: key, tests: testsOf(key, given, field.type) };
}

/**
 * A filter as written, parsed against the collection's shape; it throws with what a reader can act on where the
 * filter names a field the shape lacks or an operator the grammar does not have. Several keys are one `all`.
 */
export function parseWhere(given: unknown, shape: Type): Where {
  if (!isPlainObject(given)) throw new Error('where: a filter is an object of fields and combinators');
  const of = Object.entries(given).map(([key, value]) => entry(key, value, shape));
  if (of.length === 1) return of[0];
  return { kind: 'all', of };
}

/** A filter as written, or nothing where none was given: what every operation that takes one reads. */
export function whereOf(given: unknown, shape: Type): Where | undefined {
  return given === undefined || given === null ? undefined : parseWhere(given, shape);
}
