/**
 * `resolves` on a native contract's static field: where a type variable comes from when no call site spells
 * it. The field's literal names a document; the path walks into that document to a value that must be a type
 * reference, and the variable is bound to it.
 *
 * A segment may take a key rather than a fixed name, written two ways and both read left to right:
 * `[input]` takes it from another static input of the same call, so `collections[collection].of` covers every
 * collection of a store; `{sibling}` takes it from a field beside the one just read, so
 * `collections[collection].of.{key}` follows `of` into the shape it names and takes the field whose name the
 * collection's `key` holds -- which is how a key's type is reached without the port repeating it.
 *
 * A path that reaches a type reference and keeps going follows it into the shape it names: that is the one
 * place a path leaves the document it started in, and it is what makes the second form worth having.
 *
 * The grammar is deliberately small -- field names, one optional key per segment, no expressions -- and it is
 * parsed in one place so that the checker, the compiler and the gate's stub bind the same variable to the
 * same type. A port document that writes a path outside the grammar is refused when the plugin loads
 * (D011, `contracts.ts`).
 */
import type { Field, Fields, Values } from './model.js';
import { isTypeRef, type Type, TypeError_ } from './types.js';

/** Where a segment takes its key from: an input of the same call, or a field beside the one just read. */
export type KeyFrom = 'input' | 'sibling';

/** One step of a `resolves` path: a field name, and -- where it takes one -- the key to take under it. */
export interface Segment {
  name: string;
  /** the name whose value is the key, for `collections[collection]` and `of.{key}` */
  by?: string;
  /** where that name is read: an input of the call, or a sibling of the value just read */
  from?: KeyFrom;
}

/** A `resolves` path as parsed: the segments to walk, in order. */
export type ResolvesPath = Segment[];

const SEGMENT = /^([a-z][A-Za-z0-9_]*)(?:\[([a-z][A-Za-z0-9_]*)\]|\{([a-z][A-Za-z0-9_]*)\})?$/;

/**
 * A `resolves` path parsed, or the reason it is not one: dot-separated field names, each optionally taking a
 * key by an input of the same call (`collections[collection]`) or by a sibling field (`of.{key}`).
 */
export function parsePath(expr: string): ResolvesPath | string {
  if (!expr) return 'an empty path';
  const path: ResolvesPath = [];
  for (const part of expr.split('.')) {
    const match = SEGMENT.exec(part);
    if (!match) return `'${part}' is not a field name, optionally followed by [input] or {sibling}`;
    const [, name, input, sibling] = match;
    if (input) path.push({ name, by: input, from: 'input' });
    else if (sibling) path.push({ name, by: sibling, from: 'sibling' });
    else path.push({ name });
  }
  return path;
}

/** The inputs a path takes keys by, so a contract can be held to naming inputs it has. */
export function substituted(path: ResolvesPath): string[] {
  return path.flatMap(segment => (segment.from === 'input' && segment.by ? [segment.by] : []));
}

/** A `resolves` path as a reader sees it, the way it was written. */
export function showPath(path: ResolvesPath): string {
  return path
    .map(segment => {
      if (!segment.by) return segment.name;
      return segment.from === 'sibling' ? `${segment.name}{${segment.by}}` : `${segment.name}[${segment.by}]`;
    })
    .join('.');
}

/** What lies under one key of a value, or nothing where the value is not an object that has it. */
function under(at: unknown, key: string): unknown {
  if (!at || typeof at !== 'object' || Array.isArray(at)) return undefined;
  return (at as Record<string, unknown>)[key];
}

/**
 * Where the next segment reads from. A path that has reached a type reference and is not done follows it into
 * the shape it names and goes on among that shape's fields: the one place a path leaves the document it
 * started in, and what lets a key's type be read from the record's own shape.
 */
function into(at: unknown, tree: Resolves): unknown {
  if (!isTypeRef(at)) return at;
  const shape = tree.document(at);
  return shape === undefined ? undefined : under(shape, 'fields');
}

/** The key a segment takes, read from an input of the call or from a sibling of the value it was read beside. */
function keyOf(segment: Segment, beside: unknown, given: Values): string | undefined {
  if (!segment.by) return undefined;
  const held = segment.from === 'sibling' ? under(beside, segment.by) : given[segment.by];
  return typeof held === 'string' ? held : undefined;
}

/**
 * One step of a path: the named field of wherever the walk stands, and then -- where the segment takes a key
 * -- what lies under that key. A sibling key is read beside the field just taken, which is why the two are
 * resolved together rather than one after the other.
 */
function step(at: unknown, segment: Segment, given: Values, tree: Resolves): unknown {
  const here = into(at, tree);
  const field = under(here, segment.name);
  if (!segment.by) return field;
  const key = keyOf(segment, here, given);
  if (key === undefined) return undefined;
  return under(into(field, tree), key);
}

/** The value a path names, or nothing where a step is missing, not an object, or a shape the tree lacks. */
function walk(doc: unknown, path: ResolvesPath, given: Values, tree: Resolves): unknown {
  return path.reduce<unknown>((at, segment) => step(at, segment, given, tree), doc);
}

/** What a `resolves` channel needs of the tree: the document one path names, and the type one reference names. */
export interface Resolves {
  /** the document a static field's literal names, whatever its kind */
  document: (ref: string) => unknown;
  /** the type a reference names; it throws where the reference is not one */
  type: (ref: string) => Type;
}

/** The type a reference names, or nothing: an unknown shape is refused where the document naming it is judged. */
function quietType(ref: unknown, tree: Resolves): Type | undefined {
  if (!isTypeRef(ref)) return undefined;
  try {
    return tree.type(ref);
  } catch (error) {
    if (error instanceof TypeError_) return undefined;
    throw error;
  }
}

/**
 * The variables one field's `resolves` binds at one call site: the document the field's literal names is
 * opened, each path walked, and the variable bound to the type the value at the end names. A step that is
 * missing, or a value that is not a type reference, binds nothing -- a malformed path was refused when the
 * plugin loaded (D011), and a tree that names an unknown store is refused where it names it.
 */
export function resolvedBy(field: Field, value: unknown, given: Values, tree: Resolves): Record<string, Type> {
  const subst: Record<string, Type> = {};
  if (!field.resolves || typeof value !== 'string') return subst;
  const doc = tree.document(value);
  if (doc === undefined) return subst;
  for (const [variable, expr] of Object.entries(field.resolves)) {
    const path = parsePath(expr);
    if (typeof path === 'string') continue;
    const type = quietType(walk(doc, path, given, tree), tree);
    if (type) subst[variable] = type;
  }
  return subst;
}

/** Every variable an operation's inputs bind through `resolves`, at one call site. */
export function resolvedHere(accepts: Fields | undefined, given: Values, tree: Resolves): Record<string, Type> {
  const subst: Record<string, Type> = {};
  for (const [name, field] of Object.entries(accepts ?? {})) {
    if (!field.resolves) continue;
    Object.assign(subst, resolvedBy(field, given[name], given, tree));
  }
  return subst;
}
