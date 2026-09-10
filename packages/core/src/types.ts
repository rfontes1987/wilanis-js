/**
 * The type system the checker reasons with. A TypeRef string or an InlineObject becomes a Type; every edge,
 * param and contract is judged by `assignable` (assign.ts), and every dotted read by `typeAt` (values.ts).
 */
import type { Field, Fields, InlineObject, ShapeDoc, TypeRef, TypeSpec } from './model.js';

export type Type =
  | { kind: 'string'; enum?: string[] }
  | { kind: 'number' }
  | { kind: 'boolean' }
  /** A stored file. The value is a handle -- id, contentType, size, filename -- never the bytes; the blob registry holds those. */
  | { kind: 'blob' }
  | { kind: 'unknown' }
  | { kind: 'list'; of: Type }
  | { kind: 'object'; name?: string; fields: Record<string, ObjField>; open: false | Type }
  /** A type variable of a native contract ($T), bound per call site by unification or a `type` param. */
  | { kind: 'var'; name: string }
  /** The type of a param whose value is a type reference (native contracts only). */
  | { kind: 'type' };

export type ObjectType = Extract<Type, { kind: 'object' }>;
export type StringType = Extract<Type, { kind: 'string' }>;

export interface ObjField {
  type: Type;
  required: boolean;
  secret?: boolean;
}

/** A read of a type at a path: what is there, and whether it may be missing. */
export interface Read {
  type: Type;
  optional: boolean;
}

export const UNKNOWN: Type = { kind: 'unknown' };
export const STRING: Type = { kind: 'string' };
export const NUMBER: Type = { kind: 'number' };
export const BOOLEAN: Type = { kind: 'boolean' };
export const BLOB: Type = { kind: 'blob' };
export const EMPTY_OBJECT: Type = { kind: 'object', fields: {}, open: false };
/** What a blob value is on the wire and in a report: the handle. Reads into a blob (`{{in.file.filename}}`) see these fields. */
export const BLOB_HANDLE: Type = {
  kind: 'object',
  name: 'blob',
  fields: {
    id: { type: STRING, required: true },
    contentType: { type: STRING, required: true },
    size: { type: NUMBER, required: true },
    filename: { type: STRING, required: false },
  },
  open: false,
};
export interface BlobHandle {
  id: string;
  contentType: string;
  size: number;
  filename?: string;
}
/** Whether a value is a blob handle rather than the bytes: an id, a content type and a size are there. */
export const isBlobHandle = (value: unknown): value is BlobHandle =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  typeof (value as BlobHandle).id === 'string' &&
  typeof (value as BlobHandle).contentType === 'string' &&
  typeof (value as BlobHandle).size === 'number';

const TYPE_REF =
  /^(string|number|boolean|blob|unknown|type|\$[A-Z][A-Za-z0-9]*|@[A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_.-]+)*\.json)((?:\[\])*)$/;

const SCALARS: Record<string, Type> = {
  string: STRING,
  number: NUMBER,
  boolean: BOOLEAN,
  blob: BLOB,
  unknown: UNKNOWN,
  type: { kind: 'type' },
};

/** What resolving a type throws when the reference is not one, or names a shape the tree does not have. */
export class TypeError_ extends Error {}

/** Is the value a string in the type reference grammar? */
export const isTypeRef = (value: unknown): value is string => typeof value === 'string' && TYPE_REF.test(value);

/** Resolves shape paths (through project aliases); memoised, cycle-safe. */
export class TypeResolver {
  private readonly memo = new Map<string, Type>();

  constructor(
    private readonly shapes: (path: string) => ShapeDoc | undefined,
    private readonly canon: (ref: string) => string = ref => ref,
  ) {}

  /** The type a reference names: a scalar, a variable, a shape by path, each optionally as a list (`[]`). */
  ref(ref: TypeRef): Type {
    const match = TYPE_REF.exec(ref);
    if (!match) throw new TypeError_(`not a type: '${ref}'`);
    const [, base, brackets] = match;
    let type = SCALARS[base] ?? (base.startsWith('$') ? { kind: 'var', name: base } : this.shape(base));
    for (let depth = 0; depth < brackets.length / 2; depth++) type = { kind: 'list', of: type };
    return type;
  }

  /** A shape document as an object type, named by its canonical path. */
  shape(ref: string): Type {
    const path = this.canon(ref);
    const hit = this.memo.get(path);
    if (hit) return hit;
    const doc = this.shapes(path);
    if (!doc) throw new TypeError_(`unknown shape '${ref}'`);
    const type: Type = { kind: 'object', name: path, fields: {}, open: false };
    this.memo.set(path, type); // placeholder first: a self-reference resolves to this object
    Object.assign(type, this.inline({ fields: doc.fields, open: doc.open }, path));
    return type;
  }

  /** An inline object spec as an object type. */
  inline(spec: InlineObject, name?: string): Type {
    const fields: Record<string, ObjField> = {};
    for (const [key, field] of Object.entries(spec.fields)) fields[key] = this.field(field);
    return { kind: 'object', name, fields, open: this.openOf(spec.open) };
  }

  /** What an object admits beyond its fields: nothing, anything, or values of one type. */
  private openOf(open: InlineObject['open']): false | Type {
    if (open === undefined || open === false) return false;
    return open === true ? UNKNOWN : this.ref(open);
  }

  /**
   * One declared field as a typed field: its type, its enum narrowing a string, and whether it must be
   * there -- a field is required unless it says otherwise.
   */
  field(field: Field): ObjField {
    let type = this.spec(field.type);
    if (field.enum && type.kind === 'string') type = { kind: 'string', enum: field.enum };
    return { type, required: field.required !== false, secret: field.secret };
  }

  /** The type a spec names, written either way: a reference string, or an object spelled out inline. */
  spec(spec: TypeSpec): Type {
    return typeof spec === 'string' ? this.ref(spec) : this.inline(spec);
  }

  /** accepts: named fields become one object type. */
  fields(fields: Fields | undefined): Type {
    return this.inline({ fields: fields ?? {} });
  }
}

/** A type as a reader sees it: a shape by its name, an inline object by its fields, an enum by its values. */
export function show(type: Type): string {
  switch (type.kind) {
    case 'list':
      return `${show(type.of)}[]`;
    case 'object':
      return type.name || showFields(type);
    case 'string':
      return type.enum ? type.enum.map(value => JSON.stringify(value)).join(' | ') : 'string';
    case 'var':
      return type.name;
    default:
      return type.kind;
  }
}

function showFields(type: ObjectType): string {
  const fields = Object.entries(type.fields).map(
    ([name, field]) => `${name}${field.required ? '' : '?'}: ${show(field.type)}`,
  );
  return `{${fields.join(', ')}${type.open ? ', ...' : ''}}`;
}
