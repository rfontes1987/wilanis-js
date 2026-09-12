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
 * field's type does not admit. Judging a filter before anything runs is RFC 0003's business, in the X band.
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

/**
 * Why a filter is not one: a name the shape does not have, a value the field would not accept, or grammar the
 * port does not admit. A run fails the node on any of them; the checker gives each its own code, which is why
 * they are told apart here rather than read back out of a message.
 */
export type WhereFault = 'name' | 'value' | 'grammar';

/** A filter the grammar refuses: which rule it breaks, and where in the filter it breaks it. */
export class WhereError extends Error {
  constructor(
    readonly fault: WhereFault,
    message: string,
    readonly at: string[] = [],
  ) {
    super(message);
    this.name = 'WhereError';
  }
}

/** One test of one field: the operator, what it is given, and where in the filter it was written. */
export interface Test {
  op: Operator;
  value: unknown;
  /** the path from the filter's root, so a refusal points at what the document actually says */
  at: string[];
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

/**
 * How a filter is being read: which values are reads rather than what they will be, and where in the filter
 * the reading stands. A run sees every value as the value, so nothing is a read by default; a checker sees
 * `{{in.urls}}` where a list will be, and a shape judged against the spelling of a read would refuse what the
 * run then accepts.
 */
interface Reading {
  isRead: (value: unknown) => boolean;
  at: string[];
}
const under = (ctx: Reading, ...steps: string[]): Reading => ({ ...ctx, at: [...ctx.at, ...steps] });

/** One field of the shape, as the tests written against it are judged. */
interface FieldAt {
  name: string;
  type: Type;
  ctx: Reading;
}

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

/**
 * One test, held to being one the grammar names and one the field's type admits. What a value *is* -- a list
 * for `in`, a boolean for `has` -- is judged only where the value is one: a read is still `{{...}}` here and
 * is judged by the type it reads, which is the checker's business and not the grammar's.
 */
function testOf(op: string, value: unknown, field: FieldAt): Test {
  const { name, type, ctx } = field;
  if (!isOperator(op))
    throw new WhereError(
      'grammar',
      `where: '${op}' is not an operator of '${name}' (operators: ${OPERATORS.join(', ')})`,
      ctx.at,
    );
  const bad = unfit(op, type);
  if (bad) throw new WhereError('grammar', `where: on '${name}', ${bad}`, ctx.at);
  if (!ctx.isRead(value)) {
    if (LISTS.has(op) && !Array.isArray(value))
      throw new WhereError('grammar', `where: '${name}.${op}' takes a list`, ctx.at);
    if (op === 'has' && typeof value !== 'boolean')
      throw new WhereError('value', `where: '${name}.has' takes a boolean`, ctx.at);
  }
  return { op, value, at: ctx.at };
}

/**
 * One field's tests. An object is a predicate and every key of it is an operator -- which is what lets a
 * misspelled one be named rather than silently compared -- and any other value means equality. A bare value
 * is written at the field, so that is where its test points: the document has no `eq` key to point at.
 */
function testsOf(name: string, given: unknown, type: Type, ctx: Reading): Test[] {
  const here = under(ctx, name);
  if (!isPlainObject(given)) return [testOf('eq', given, { name, type, ctx: here })];
  const keys = Object.keys(given);
  if (!keys.length) throw new WhereError('grammar', `where: the predicate on '${name}' names no operator`, here.at);
  return keys.map(key => testOf(key, given[key], { name, type, ctx: under(here, key) }));
}

/** Every filter of a combinator that takes a list of them, each knowing its place in the list. */
function branches(key: string, given: unknown, shape: Type, ctx: Reading): Where[] {
  if (!Array.isArray(given))
    throw new WhereError('grammar', `where: '${key}' takes a list of filters`, [...ctx.at, key]);
  return given.map((one, index) => parse(one, shape, under(ctx, key, String(index))));
}

/** One entry of a filter object: a combinator, or a field of the shape with what is asked of it. */
function entry(key: string, given: unknown, shape: Type, ctx: Reading): Where {
  if (key === 'all') return { kind: 'all', of: branches(key, given, shape, ctx) };
  if (key === 'any') return { kind: 'any', of: branches(key, given, shape, ctx) };
  if (key === 'not') return { kind: 'not', of: parse(given, shape, under(ctx, key)) };
  const field = fieldsOf(shape)[key];
  if (!field) {
    const names = Object.keys(fieldsOf(shape)).join(', ') || 'none';
    throw new WhereError('name', `where: '${key}' is not a field of the collection's shape (fields: ${names})`, [
      ...ctx.at,
      key,
    ]);
  }
  return { kind: 'field', field: key, tests: testsOf(key, given, field.type, ctx) };
}

/** A filter, parsed from wherever in another filter it sits. */
function parse(given: unknown, shape: Type, ctx: Reading): Where {
  if (!isPlainObject(given))
    throw new WhereError('grammar', 'where: a filter is an object of fields and combinators', ctx.at);
  const of = Object.entries(given).map(([key, value]) => entry(key, value, shape, ctx));
  if (of.length === 1) return of[0];
  return { kind: 'all', of };
}

/**
 * A filter as written, parsed against the collection's shape; it throws with what a reader can act on where
 * the filter names a field the shape lacks or an operator the grammar does not have. Several keys are one
 * `all`. `isRead` says which values are not yet what they will be -- a checker knows, a run has none.
 */
export function parseWhere(given: unknown, shape: Type, isRead: (value: unknown) => boolean = () => false): Where {
  return parse(given, shape, { isRead, at: [] });
}

/** A filter as written, or nothing where none was given: what every operation that takes one reads. */
export function whereOf(given: unknown, shape: Type, isRead?: (value: unknown) => boolean): Where | undefined {
  return given === undefined || given === null ? undefined : parseWhere(given, shape, isRead);
}
