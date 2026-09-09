/**
 * Assignability and type variables. `assignable` says whether every value of one type satisfies another;
 * `unify` binds the variables of a native contract so an actual type fits it; `substitute` writes the bindings in.
 */
import { type ObjectType, type ObjField, type StringType, show, type Type, UNKNOWN } from './types.js';

/** Does the type mention a variable anywhere? */
export function hasVars(type: Type): boolean {
  switch (type.kind) {
    case 'var':
      return true;
    case 'list':
      return hasVars(type.of);
    case 'object':
      return Object.values(type.fields).some(field => hasVars(field.type)) || (type.open ? hasVars(type.open) : false);
    default:
      return false;
  }
}

/** Bind the variables of `pattern` so that `actual` fits it. Answers an error, or null with `subst` extended. */
export function unify(pattern: Type, actual: Type, subst: Record<string, Type>): string | null {
  if (pattern.kind === 'var') return unifyVar(pattern.name, actual, subst);
  if (!hasVars(pattern)) return assignable(actual, pattern);
  if (pattern.kind === 'list') {
    return actual.kind === 'list' ? unify(pattern.of, actual.of, subst) : `${show(actual)} is not a list`;
  }
  if (pattern.kind === 'object' && actual.kind === 'object') return unifyObject(pattern, actual, subst);
  return assignable(actual, pattern);
}

/** A variable binds to the first type it meets; a later one must agree with it, the narrower of the two winning. */
function unifyVar(name: string, actual: Type, subst: Record<string, Type>): string | null {
  const bound = subst[name];
  if (!bound) {
    subst[name] = actual;
    return null;
  }
  if (!assignable(actual, bound)) return null;
  if (assignable(bound, actual)) return `${name} is ${show(bound)} here but ${show(actual)} there`;
  subst[name] = actual;
  return null;
}

function unifyObject(pattern: ObjectType, actual: ObjectType, subst: Record<string, Type>): string | null {
  for (const [name, wanted] of Object.entries(pattern.fields)) {
    const given = actual.fields[name];
    if (!given) {
      if (wanted.required) return `missing required field '${name}'`;
      continue;
    }
    const bad = unify(wanted.type, given.type, subst);
    if (bad) return `field '${name}': ${bad}`;
  }
  return null;
}

/** The type with every variable replaced by its binding; an unbound variable becomes unknown. */
export function substitute(type: Type, subst: Record<string, Type>): Type {
  switch (type.kind) {
    case 'var':
      return subst[type.name] ?? UNKNOWN;
    case 'list':
      return { kind: 'list', of: substitute(type.of, subst) };
    case 'object': {
      if (!hasVars(type)) return type;
      const fields: Record<string, ObjField> = {};
      for (const [name, field] of Object.entries(type.fields))
        fields[name] = { ...field, type: substitute(field.type, subst) };
      return { kind: 'object', name: type.name, fields, open: type.open ? substitute(type.open, subst) : false };
    }
    default:
      return type;
  }
}

/** Anything feeds unknown or a variable, and a variable feeds anything: nothing is known either way. */
function unjudged(from: Type, to: Type): boolean {
  return to.kind === 'unknown' || to.kind === 'var' || from.kind === 'var';
}

/** Does every value of `from` satisfy `to`? Width subtyping: extra fields pass. Optional never feeds required. */
export function assignable(from: Type, to: Type): string | null {
  if (unjudged(from, to)) return null;
  if (to.kind === 'type') return from.kind === 'string' ? null : `${show(from)} is not a type reference`;
  if (from.kind === 'unknown') return `unknown cannot feed ${show(to)}`;
  if (from.kind !== to.kind) return `${show(from)} is not ${show(to)}`;
  if (to.kind === 'string') return assignableString(from as StringType, to);
  if (to.kind === 'list') return assignable((from as { kind: 'list'; of: Type }).of, to.of);
  if (to.kind === 'object') return assignableObject(from as ObjectType, to);
  return null;
}

/** An enum feeds an enum that holds every one of its values; only an enum feeds an enum. */
function assignableString(from: StringType, to: StringType): string | null {
  const wanted = to.enum;
  if (!wanted) return null;
  if (!from.enum) return `string is not ${show(to)}`;
  const bad = from.enum.filter(value => !wanted.includes(value));
  return bad.length ? `${bad.map(value => JSON.stringify(value)).join(', ')} not in ${show(to)}` : null;
}

function assignableObject(from: ObjectType, to: ObjectType): string | null {
  if (from === to) return null;
  for (const [name, wanted] of Object.entries(to.fields)) {
    const bad = assignableField(from, name, wanted);
    if (bad) return bad;
  }
  return to.open && to.open.kind !== 'unknown' ? assignableExtras(from, to, to.open) : null;
}

/** One field `to` declares: given by name, or admitted through what `from` is open to. */
function assignableField(from: ObjectType, name: string, wanted: ObjField): string | null {
  const given = from.fields[name];
  if (!given) {
    if (wanted.required) return `missing required field '${name}'`;
    const bad = from.open ? assignable(from.open, wanted.type) : null;
    return bad ? `field '${name}': ${bad}` : null;
  }
  if (wanted.required && !given.required) return `field '${name}' is optional but required here`;
  const bad = assignable(given.type, wanted.type);
  return bad ? `field '${name}': ${bad}` : null;
}

/** What `from` has beyond `to`'s fields must fit what `to` is open to. */
function assignableExtras(from: ObjectType, to: ObjectType, open: Type): string | null {
  for (const [name, given] of Object.entries(from.fields)) {
    if (to.fields[name]) continue;
    const bad = assignable(given.type, open);
    if (bad) return `extra field '${name}': ${bad}`;
  }
  const bad = from.open ? assignable(from.open, open) : null;
  return bad ? `extra values: ${bad}` : null;
}
