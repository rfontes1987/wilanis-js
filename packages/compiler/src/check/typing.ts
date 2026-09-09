/** Small judgements over types that more than one rule family makes. */
import { assignable, type Read, type Type, typeAt } from '@wilanis/core';
import type { Resolve } from './judge.js';

/** Why `from` cannot feed `to`; nothing when it can, or when either side is unknown (refused elsewhere). */
export function mismatch(from: Type | undefined, to: Type | undefined): string | null {
  return from && to ? assignable(from, to) : null;
}

/** A read continued below a typed root: the root's optionality carries into what is read beneath it. */
export function readAt(base: Read, path: string[]): Read | string {
  const read = typeAt(base.type, path);
  return typeof read === 'string' ? read : { type: read.type, optional: base.optional || read.optional };
}

/** A resolver of template roots where only `request.*` may be read, typed against a trigger kind's context. */
export function requestOnly(ctx: Type, otherwise: string): Resolve {
  return (root, path) => (root === 'request' ? typeAt(ctx, path) : `'${root}': ${otherwise}`);
}

/** Is a dotted path the prefix itself, or below it? */
export function atOrBelow(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}.`);
}

/**
 * Assignability at the edge: wire text (query, route placeholders, headers, form fields, flags) may feed any scalar,
 * and a value that may be missing may feed a required field -- the trigger coerces and judges the input when it
 * arrives, and a request missing it is refused there rather than run.
 */
export function assignableWire(from: Type, to: Type): string | null {
  if (from.kind === 'string' && !from.enum && isScalar(to)) return null;
  if (from.kind === 'list' && to.kind === 'list') return assignableWire(from.of, to.of);
  if (from.kind === 'object' && to.kind === 'object') return objectWire(from, to);
  return assignable(from, to);
}

function isScalar(type: Type): boolean {
  return type.kind === 'string' || type.kind === 'number' || type.kind === 'boolean';
}

type ObjectType = Extract<Type, { kind: 'object' }>;

function objectWire(from: ObjectType, to: ObjectType): string | null {
  for (const [name, field] of Object.entries(to.fields)) {
    const given = from.fields[name];
    if (!given) {
      if (field.required) return `missing required field '${name}'`;
      continue;
    }
    const bad = assignableWire(given.type, field.type);
    if (bad) return `field '${name}': ${bad}`;
  }
  return null;
}
