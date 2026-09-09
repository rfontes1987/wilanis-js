/**
 * Types against values: following a dotted path through a type (`typeAt`), the type a literal has, whether a
 * value conforms to a type at run time, and the JSON Schema a trigger validates the wire against.
 */
import {
  BLOB_HANDLE,
  BOOLEAN,
  isBlobHandle,
  isTypeRef,
  NUMBER,
  type ObjectType,
  type ObjField,
  type Read,
  STRING,
  show,
  type Type,
  UNKNOWN,
} from './types.js';

const INDEX = /^[0-9]+$/;

/** Follow a dotted path through a type. Indices and open keys are optional reads; unknown cannot be read into. */
export function typeAt(type: Type, path: string[]): Read | string {
  let current: Read = { type, optional: false };
  for (const segment of path) {
    const next = readInto(current, segment);
    if (typeof next === 'string') return next;
    current = next;
  }
  return current;
}

/** One step of a read: the segment inside what was read so far. */
function readInto(current: Read, segment: string): Read | string {
  const type = current.type.kind === 'blob' ? BLOB_HANDLE : current.type;
  if (type.kind === 'unknown' || type.kind === 'var')
    return `cannot read '${segment}' inside ${show(type)} -- forward it whole`;
  if (type.kind === 'list') {
    return INDEX.test(segment) ? { type: type.of, optional: true } : `'${segment}' is not an index into ${show(type)}`;
  }
  if (type.kind !== 'object') return `cannot read '${segment}' of ${show(type)}`;
  const field = type.fields[segment];
  if (field) return { type: field.type, optional: current.optional || !field.required };
  if (type.open) return { type: type.open, optional: true };
  return `no field '${segment}' in ${show(type)}`;
}

/** The type a literal has, as narrowly as it can be told. */
export function typeOfValue(value: unknown): Type {
  if (value === null || value === undefined) return UNKNOWN;
  if (typeof value === 'string') return { kind: 'string', enum: [value] };
  if (typeof value === 'number') return NUMBER;
  if (typeof value === 'boolean') return BOOLEAN;
  if (Array.isArray(value)) {
    return { kind: 'list', of: value.length ? widen(value.map(typeOfValue)) : UNKNOWN };
  }
  const fields: Record<string, ObjField> = {};
  for (const [name, item] of Object.entries(value as object))
    fields[name] = { type: typeOfValue(item), required: true };
  return { kind: 'object', fields, open: false };
}

/** The one type a list of literals has: strings widen to string; a mixed list is unknown. */
function widen(types: Type[]): Type {
  const first = types[0];
  if (!types.every(type => type.kind === first.kind)) return UNKNOWN;
  return first.kind === 'string' ? STRING : first;
}

/** Runtime check of a value against a type; returns the first problem or null. */
export function conforms(value: unknown, type: Type, at = '$'): string | null {
  switch (type.kind) {
    case 'unknown':
    case 'var':
      return null;
    case 'type':
      return isTypeRef(value) ? null : `${at}: expected a type reference`;
    case 'string':
      return conformsString(value, type.enum, at);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? null : `${at}: expected number`;
    case 'boolean':
      return typeof value === 'boolean' ? null : `${at}: expected boolean`;
    case 'blob':
      return isBlobHandle(value) ? null : `${at}: expected a blob (the handle of a stored file: id, contentType, size)`;
    case 'list':
      return conformsList(value, type.of, at);
    case 'object':
      return conformsObject(value, type, at);
  }
}

function conformsString(value: unknown, allowed: string[] | undefined, at: string): string | null {
  if (typeof value !== 'string') return `${at}: expected string`;
  if (allowed && !allowed.includes(value))
    return `${at}: ${JSON.stringify(value)} not in ${show({ kind: 'string', enum: allowed })}`;
  return null;
}

function conformsList(value: unknown, of: Type, at: string): string | null {
  if (!Array.isArray(value)) return `${at}: expected list`;
  for (const [index, item] of value.entries()) {
    const bad = conforms(item, of, `${at}[${index}]`);
    if (bad) return bad;
  }
  return null;
}

function conformsObject(value: unknown, type: ObjectType, at: string): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return `${at}: expected object`;
  const object = value as Record<string, unknown>;
  for (const [name, field] of Object.entries(type.fields)) {
    const bad = conformsField(object[name], field, `${at}.${name}`);
    if (bad) return bad;
  }
  return conformsExtras(object, type, at);
}

/** One declared field: absent is fine unless required; present must conform. */
function conformsField(value: unknown, field: ObjField, at: string): string | null {
  if (value === undefined) return field.required ? `${at}: required` : null;
  return conforms(value, field.type, at);
}

/** Keys the type does not declare: refused when it is closed, judged against what it is open to otherwise. */
function conformsExtras(object: Record<string, unknown>, type: ObjectType, at: string): string | null {
  for (const name of Object.keys(object)) {
    if (type.fields[name]) continue;
    if (!type.open) return `${at}.${name}: not a declared field`;
    const bad = conforms(object[name], type.open, `${at}.${name}`);
    if (bad) return bad;
  }
  return null;
}

/** JSON Schema (2020-12) for a type: what a trigger validates the wire against. */
export function toJsonSchema(type: Type): Record<string, unknown> {
  switch (type.kind) {
    case 'unknown':
    case 'var':
      return {};
    case 'type':
      return { type: 'string' };
    case 'string':
      return type.enum ? { type: 'string', enum: type.enum } : { type: 'string' };
    case 'number':
      return { type: 'number' };
    case 'boolean':
      return { type: 'boolean' };
    case 'blob':
      return toJsonSchema(BLOB_HANDLE);
    case 'list':
      return { type: 'array', items: toJsonSchema(type.of) };
    case 'object':
      return objectSchema(type);
  }
}

function objectSchema(type: ObjectType): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [name, field] of Object.entries(type.fields)) {
    properties[name] = toJsonSchema(field.type);
    if (field.required) required.push(name);
  }
  return {
    type: 'object',
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: type.open ? toJsonSchema(type.open) : false,
  };
}
