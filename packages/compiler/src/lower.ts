/**
 * Lowering values to kernel sources. A literal bakes; a whole {{template}} reads a node, the input, a resolver
 * (a read below request) or a constant; text with templates concatenates; lists and objects lower each member.
 * Also the secret paths of a type, which a call's report redacts.
 */
import { splitPath, TEMPLATE, type Type, type Values, WHOLE_TEMPLATE } from '@wilanis/core';
import { type KSource, readPath } from '@wilanis/engine';

/** The roots a value may read where it is written, and how each lowers. */
export interface Roots {
  /** resolver name -> the segments it reads below request */
  resolvers: Record<string, string[]>;
  /** constant name -> baked value */
  consts?: Record<string, unknown>;
  /** may read request.* (a resolver's own in) */
  request?: boolean;
  /** may read other nodes by id (a graph node's in) */
  nodes?: boolean;
}

/** One template read as a source: a resolver reads below request, a constant bakes, the rest read their root. */
function lowerRef(template: string, roots: Roots): KSource {
  const [root, ...path] = splitPath(template);
  if (roots.resolvers[root]) return { ref: 'request', path: [...roots.resolvers[root], ...path] };
  if (root === 'in') return { ref: root, path };
  if (root === 'const' && roots.consts) return { value: readPath(roots.consts[path[0]], path.slice(1)) };
  if (root === 'request' && roots.request) return { ref: root, path };
  if (roots.nodes) return { ref: root, path };
  throw new Error(`unresolvable template {{${template}}}`);
}

/** Text with templates in it: the literal pieces and the reads, in order. */
function lowerText(text: string, roots: Roots): KSource {
  const parts: (string | KSource)[] = [];
  let last = 0;
  for (const match of text.matchAll(TEMPLATE)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(text.slice(last, index));
    parts.push(lowerRef(match[1], roots));
    last = index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return { concat: parts };
}

function lowerString(text: string, roots: Roots): KSource {
  const whole = WHOLE_TEMPLATE.exec(text);
  if (whole) return lowerRef(whole[1], roots);
  return text.includes('{{') ? lowerText(text, roots) : { value: text };
}

/** One value as a source. */
export function lowerValue(value: unknown, roots: Roots): KSource {
  if (typeof value === 'string') return lowerString(value, roots);
  if (Array.isArray(value)) return { list: value.map(item => lowerValue(item, roots)) };
  if (value && typeof value === 'object') return { object: lowerValues(value as Values, roots) };
  return { value };
}

/** Every named value as a source. */
export function lowerValues(values: Values | undefined, roots: Roots): Record<string, KSource> {
  return Object.fromEntries(Object.entries(values ?? {}).map(([name, value]) => [name, lowerValue(value, roots)]));
}

/** Inputs passed on from the caller's by name. */
export function inputsByName(names: string[]): Record<string, KSource> {
  return Object.fromEntries(names.map(name => [name, { ref: 'in', path: [name] }]));
}

/** A map's bind, each dotted path split; nothing when the element arrives whole as `item`. */
export function bindPaths(bind: Record<string, string> | undefined): Record<string, string[]> | undefined {
  if (!bind) return undefined;
  return Object.fromEntries(Object.entries(bind).map(([name, path]) => [name, path ? path.split('.') : []]));
}

const SECRET_DEPTH = 6;

/** Every path to a secret field inside a type, to a bounded depth. */
export function secretPaths(
  type: Type | undefined,
  prefix: string[] = [],
  out: string[][] = [],
  depth = 0,
): string[][] {
  if (!type || depth > SECRET_DEPTH) return out;
  if (type.kind === 'list') secretPaths(type.of, prefix, out, depth + 1);
  if (type.kind !== 'object') return out;
  for (const [name, field] of Object.entries(type.fields)) {
    if (field.secret) out.push([...prefix, name]);
    else secretPaths(field.type, [...prefix, name], out, depth + 1);
  }
  return out;
}
