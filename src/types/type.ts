/**
 * The type system the checker reasons with. A TypeRef string or an InlineObject becomes a Type;
 * every edge, param and contract is judged by `assignable`, and every dotted read by `typeAt`.
 */
import type { Field, Fields, InlineObject, ShapeDoc, TypeRef, TypeSpec } from '../model.js';

export type Type =
  | { kind: 'string'; enum?: string[] }
  | { kind: 'number' }
  | { kind: 'boolean' }
  | { kind: 'unknown' }
  | { kind: 'list'; of: Type }
  | { kind: 'object'; name?: string; fields: Record<string, ObjField>; open: false | Type }
  /** A type variable of a native contract ($T), bound per call site by unification or a `type` param. */
  | { kind: 'var'; name: string }
  /** The type of a param whose value is a type reference (native contracts only). */
  | { kind: 'type' };

export interface ObjField { type: Type; required: boolean; secret?: boolean }

export const UNKNOWN: Type = { kind: 'unknown' };
export const STRING: Type = { kind: 'string' };
export const NUMBER: Type = { kind: 'number' };
export const BOOLEAN: Type = { kind: 'boolean' };
export const EMPTY_OBJECT: Type = { kind: 'object', fields: {}, open: false };

const TYPE_REF = /^(string|number|boolean|unknown|type|\$[A-Z][A-Za-z0-9]*|@[A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_.-]+)*\.json)((?:\[\])*)$/;

export class TypeError_ extends Error {}

/** Resolves shape paths (through project aliases); memoised, cycle-safe. */
export class TypeResolver {
  private memo = new Map<string, Type>();
  constructor(private shapes: (path: string) => ShapeDoc | undefined, private canon: (ref: string) => string = r => r) {}

  ref(ref: TypeRef): Type {
    const m = TYPE_REF.exec(ref);
    if (!m) throw new TypeError_(`not a type: '${ref}'`);
    let t: Type;
    switch (m[1]) {
      case 'string': t = STRING; break;
      case 'number': t = NUMBER; break;
      case 'boolean': t = BOOLEAN; break;
      case 'unknown': t = UNKNOWN; break;
      case 'type': t = { kind: 'type' }; break;
      default: t = m[1].startsWith('$') ? { kind: 'var', name: m[1] } : this.shape(m[1]);
    }
    for (let i = 0; i < m[2].length / 2; i++) t = { kind: 'list', of: t };
    return t;
  }

  shape(ref: string): Type {
    const path = this.canon(ref);
    const hit = this.memo.get(path);
    if (hit) return hit;
    const doc = this.shapes(path);
    if (!doc) throw new TypeError_(`unknown shape '${ref}'`);
    const t: Type = { kind: 'object', name: path, fields: {}, open: false };
    this.memo.set(path, t); // placeholder first: a self-reference resolves to this object
    const built = this.inline({ fields: doc.fields, open: doc.open }, path);
    Object.assign(t, built);
    return t;
  }

  inline(o: InlineObject, name?: string): Type {
    const fields: Record<string, ObjField> = {};
    for (const [k, f] of Object.entries(o.fields)) fields[k] = this.field(f);
    const open: false | Type = o.open === undefined || o.open === false ? false
      : o.open === true ? UNKNOWN : this.ref(o.open);
    return { kind: 'object', name, fields, open };
  }

  field(f: Field): ObjField {
    let t = this.spec(f.type);
    if (f.enum && t.kind === 'string') t = { kind: 'string', enum: f.enum };
    return { type: t, required: f.required !== false, secret: f.secret };
  }

  spec(s: TypeSpec): Type { return typeof s === 'string' ? this.ref(s) : this.inline(s); }

  /** accepts/params: named fields become one object type. */
  fields(f: Fields | undefined): Type { return this.inline({ fields: f ?? {} }); }
}

export function show(t: Type): string {
  switch (t.kind) {
    case 'list': return `${show(t.of)}[]`;
    case 'object':
      if (t.name) return t.name;
      return `{${Object.entries(t.fields).map(([k, f]) => `${k}${f.required ? '' : '?'}: ${show(f.type)}`).join(', ')}${t.open ? ', ...' : ''}}`;
    case 'string': return t.enum ? t.enum.map(e => JSON.stringify(e)).join(' | ') : 'string';
    case 'var': return t.name;
    default: return t.kind;
  }
}

export const isTypeRef = (s: unknown): s is string => typeof s === 'string' && TYPE_REF.test(s);

export function hasVars(t: Type): boolean {
  switch (t.kind) {
    case 'var': return true;
    case 'list': return hasVars(t.of);
    case 'object': return Object.values(t.fields).some(f => hasVars(f.type)) || (t.open ? hasVars(t.open) : false);
    default: return false;
  }
}

/** Bind the variables of `pattern` so that `actual` fits it. Answers an error, or null with `subst` extended. */
export function unify(pattern: Type, actual: Type, subst: Record<string, Type>): string | null {
  if (pattern.kind === 'var') {
    const bound = subst[pattern.name];
    if (!bound) { subst[pattern.name] = actual; return null; }
    const a = assignable(actual, bound); if (!a) return null;
    const b = assignable(bound, actual); if (!b) { subst[pattern.name] = actual; return null; }
    return `${pattern.name} is ${show(bound)} here but ${show(actual)} there`;
  }
  if (!hasVars(pattern)) return assignable(actual, pattern);
  if (pattern.kind === 'list') return actual.kind === 'list' ? unify(pattern.of, actual.of, subst) : `${show(actual)} is not a list`;
  if (pattern.kind === 'object' && actual.kind === 'object') {
    for (const [k, pf] of Object.entries(pattern.fields)) {
      const af = actual.fields[k];
      if (!af) { if (pf.required) return `missing required field '${k}'`; continue; }
      const r = unify(pf.type, af.type, subst); if (r) return `field '${k}': ${r}`;
    }
    return null;
  }
  return assignable(actual, pattern);
}

export function substitute(t: Type, subst: Record<string, Type>): Type {
  switch (t.kind) {
    case 'var': return subst[t.name] ?? UNKNOWN;
    case 'list': return { kind: 'list', of: substitute(t.of, subst) };
    case 'object': {
      if (!hasVars(t)) return t;
      const fields: Record<string, ObjField> = {};
      for (const [k, f] of Object.entries(t.fields)) fields[k] = { ...f, type: substitute(f.type, subst) };
      return { kind: 'object', name: t.name, fields, open: t.open ? substitute(t.open, subst) : false };
    }
    default: return t;
  }
}

/** Does every value of `from` satisfy `to`? Width subtyping: extra fields pass. Optional never feeds required. */
export function assignable(from: Type, to: Type): string | null {
  if (to.kind === 'unknown' || to.kind === 'var') return null;
  if (from.kind === 'var') return null;
  if (to.kind === 'type') return from.kind === 'string' ? null : `${show(from)} is not a type reference`;
  if (from.kind === 'unknown') return `unknown cannot feed ${show(to)}`;
  if (from.kind !== to.kind) return `${show(from)} is not ${show(to)}`;
  switch (to.kind) {
    case 'string': {
      const f = from as { kind: 'string'; enum?: string[] };
      if (to.enum) {
        if (!f.enum) return `string is not ${show(to)}`;
        const bad = f.enum.filter(e => !to.enum!.includes(e));
        if (bad.length) return `${bad.map(b => JSON.stringify(b)).join(', ')} not in ${show(to)}`;
      }
      return null;
    }
    case 'number': case 'boolean': return null;
    case 'list': return assignable((from as { kind: 'list'; of: Type }).of, to.of);
    case 'object': {
      const f = from as Extract<Type, { kind: 'object' }>;
      if (f === to) return null;
      for (const [k, tf] of Object.entries(to.fields)) {
        const ff = f.fields[k];
        if (!ff) {
          if (tf.required) return `missing required field '${k}'`;
          if (f.open) { const r = assignable(f.open, tf.type); if (r) return `field '${k}': ${r}`; }
          continue;
        }
        if (tf.required && !ff.required) return `field '${k}' is optional but required here`;
        const r = assignable(ff.type, tf.type);
        if (r) return `field '${k}': ${r}`;
      }
      if (to.open && to.open.kind !== 'unknown') {
        for (const [k, ff] of Object.entries(f.fields)) {
          if (to.fields[k]) continue;
          const r = assignable(ff.type, to.open);
          if (r) return `extra field '${k}': ${r}`;
        }
        if (f.open) { const r = assignable(f.open, to.open); if (r) return `extra values: ${r}`; }
      }
      return null;
    }
    default: return null;
  }
}

export interface Read { type: Type; optional: boolean }

/** Follow a dotted path through a type. Indices and open keys are optional reads; unknown cannot be read into. */
export function typeAt(t: Type, path: string[]): Read | string {
  let cur: Read = { type: t, optional: false };
  for (const seg of path) {
    const ty = cur.type;
    if (ty.kind === 'unknown' || ty.kind === 'var') return `cannot read '${seg}' inside ${show(ty)} -- forward it whole`;
    if (ty.kind === 'list') {
      if (!/^[0-9]+$/.test(seg)) return `'${seg}' is not an index into ${show(ty)}`;
      cur = { type: ty.of, optional: true };
      continue;
    }
    if (ty.kind !== 'object') return `cannot read '${seg}' of ${show(ty)}`;
    const f = ty.fields[seg];
    if (f) { cur = { type: f.type, optional: cur.optional || !f.required }; continue; }
    if (ty.open) { cur = { type: ty.open, optional: true }; continue; }
    return `no field '${seg}' in ${show(ty)}`;
  }
  return cur;
}

/** The type a literal has, as narrowly as it can be told. */
export function typeOfValue(v: unknown): Type {
  if (v === null || v === undefined) return UNKNOWN;
  if (typeof v === 'string') return { kind: 'string', enum: [v] };
  if (typeof v === 'number') return NUMBER;
  if (typeof v === 'boolean') return BOOLEAN;
  if (Array.isArray(v)) {
    if (v.length === 0) return { kind: 'list', of: UNKNOWN };
    return { kind: 'list', of: widen(v.map(typeOfValue)) };
  }
  const fields: Record<string, ObjField> = {};
  for (const [k, x] of Object.entries(v as object)) fields[k] = { type: typeOfValue(x), required: true };
  return { kind: 'object', fields, open: false };
}

function widen(ts: Type[]): Type {
  const first = ts[0];
  if (ts.every(t => t.kind === first.kind)) {
    if (first.kind === 'string') return STRING;
    if (first.kind === 'object') return first; // good enough for literals
    return first;
  }
  return UNKNOWN;
}

/** Runtime check of a value against a type; returns the first problem or null. */
export function conforms(v: unknown, t: Type, at = '$'): string | null {
  switch (t.kind) {
    case 'unknown': case 'var': return null;
    case 'type': return isTypeRef(v) ? null : `${at}: expected a type reference`;
    case 'string':
      if (typeof v !== 'string') return `${at}: expected string`;
      if (t.enum && !t.enum.includes(v)) return `${at}: ${JSON.stringify(v)} not in ${show(t)}`;
      return null;
    case 'number': return typeof v === 'number' && Number.isFinite(v) ? null : `${at}: expected number`;
    case 'boolean': return typeof v === 'boolean' ? null : `${at}: expected boolean`;
    case 'list':
      if (!Array.isArray(v)) return `${at}: expected list`;
      for (let i = 0; i < v.length; i++) { const r = conforms(v[i], t.of, `${at}[${i}]`); if (r) return r; }
      return null;
    case 'object': {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) return `${at}: expected object`;
      const o = v as Record<string, unknown>;
      for (const [k, f] of Object.entries(t.fields)) {
        if (!(k in o) || o[k] === undefined) { if (f.required) return `${at}.${k}: required`; continue; }
        const r = conforms(o[k], f.type, `${at}.${k}`); if (r) return r;
      }
      for (const k of Object.keys(o)) {
        if (t.fields[k]) continue;
        if (!t.open) return `${at}.${k}: not a declared field`;
        const r = conforms(o[k], t.open, `${at}.${k}`); if (r) return r;
      }
      return null;
    }
  }
}

/** JSON Schema (2020-12) for a type: what a trigger validates the wire against. */
export function toJsonSchema(t: Type): Record<string, unknown> {
  switch (t.kind) {
    case 'unknown': case 'var': return {};
    case 'type': return { type: 'string' };
    case 'string': return t.enum ? { type: 'string', enum: t.enum } : { type: 'string' };
    case 'number': return { type: 'number' };
    case 'boolean': return { type: 'boolean' };
    case 'list': return { type: 'array', items: toJsonSchema(t.of) };
    case 'object': {
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [k, f] of Object.entries(t.fields)) { properties[k] = toJsonSchema(f.type); if (f.required) required.push(k); }
      return {
        type: 'object', properties, ...(required.length ? { required } : {}),
        additionalProperties: t.open ? toJsonSchema(t.open) : false,
      };
    }
  }
}

/** Deterministic PRNG (mulberry32) so a seed reproduces a run. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(xs: T[]) => xs[Math.floor(next() * xs.length)],
    bool: (p = 0.5) => next() < p,
  };
}
export type Rng = ReturnType<typeof rng>;

const WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima', '', 'x', 'Zulu-9'];

/** Generate a value of a type under a seed: every required field, optional ones half the time, lists of 0..3. */
export function generate(t: Type, r: Rng, depth = 0): unknown {
  switch (t.kind) {
    case 'string': return t.enum ? r.pick(t.enum) : r.pick(WORDS) + (r.bool(0.3) ? String(r.int(0, 999)) : '');
    case 'number': return r.pick([0, 1, -1, 42, 3.5, 200, 200, 201, 404, 500, r.int(-1000, 1000)]);
    case 'boolean': return r.bool();
    case 'type': return 'unknown';
    case 'var':
    case 'unknown': return depth > 2 ? r.pick([null, 0, 'x', true]) : generate(r.pick([STRING, NUMBER, BOOLEAN, { kind: 'list', of: STRING }, { kind: 'object', fields: { k: { type: STRING, required: true } }, open: false }]), r, depth + 1);
    case 'list': { const n = depth > 3 ? 0 : r.int(0, 3); return Array.from({ length: n }, () => generate(t.of, r, depth + 1)); }
    case 'object': {
      const o: Record<string, unknown> = {};
      for (const [k, f] of Object.entries(t.fields)) if (f.required || r.bool()) o[k] = generate(f.type, r, depth + 1);
      if (t.open && r.bool(0.3)) o[`extra${r.int(1, 9)}`] = generate(t.open, r, depth + 1);
      return o;
    }
  }
}
