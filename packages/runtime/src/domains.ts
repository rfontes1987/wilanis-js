/**
 * The little solver behind branch enumeration: what one input path must hold for a branch to be taken.
 *
 * A switch rule is a predicate over the node's inputs, written in the one expression grammar. Constraints accumulate
 * per path as a small domain (must be absent, must be present, a numeric range, a set of excluded values, a required
 * length) rather than a single value, because a rule's case is usually the conjunction of its own demand with the
 * negation of the rules before it: `n > 5` after `!(n > 10)` is the range (5, 10], which no single guessed value
 * would find.
 */
import { expr } from '@wilanis/core';

/** What one input path must hold for a branch to be taken. */
export interface Domain {
  /** The path must be missing entirely. */
  absent?: boolean;
  /** The path must be present, whatever the value. */
  present?: boolean;
  /** One exact value; when set, the other bounds are already consistent with it. */
  eq?: unknown;
  /** Values the path must not hold. */
  ne?: unknown[];
  /** Numeric bounds, inclusive flags carried alongside. */
  gt?: number;
  gte?: number;
  lt?: number;
  lte?: number;
  /** Bounds on len(path): the path is a list of at least/at most this many elements. */
  minLen?: number;
  maxLen?: number;
  /** The path is a list holding each of these (`x in path`) / none of these (`!(x in path)`). */
  has?: unknown[];
  lacks?: unknown[];
  /** The path must be truthy / falsy, used when a bare path is the whole predicate. */
  truthy?: boolean;
}

/** Constraints for one branch, keyed by dotted input path. */
export type Demands = Record<string, Domain>;

/** The values one branch needs, and whether they could be solved at all. */
export interface Branch {
  /** The switch rule this case exercises, by index; -1 is the else. */
  rule: number;
  /** The rule's source text, or 'else'. */
  when: string;
  /** The node the switch routes to in this case. */
  to: string;
  /** Constraints on the switch's inputs, by dotted path. */
  demands: Demands;
  /** Set when the branch could not be solved from its expressions. */
  unsolved?: string;
}

export const UNSAT = Symbol('unsatisfiable');
export type Maybe<T> = T | typeof UNSAT;

export const key = (p: string[]) => p.join('.');

/** Whether the list must both hold and lack the same value. */
function contradicts(d: Domain): boolean {
  if (!d.has || !d.lacks) return false;
  return d.has.some(one => d.lacks?.some(bad => JSON.stringify(one) === JSON.stringify(bad)));
}

/** Whether everything gathered for a path can hold at once. */
export function consistent(d: Domain): boolean {
  if (contradicts(d)) return false;
  // an exact value must survive every bound and exclusion gathered for the path
  if (d.absent && (d.eq !== undefined || d.present || d.truthy || d.minLen !== undefined)) return false;
  if (d.eq !== undefined && !fits(d.eq, d)) return false;
  if (d.eq === undefined && emptyRange(d)) return false;
  if (d.minLen !== undefined && d.maxLen !== undefined && d.minLen > d.maxLen) return false;
  return true;
}

/** What the two constraints say about presence and truth, together. UNSAT when they disagree. */
function narrowPresence(d: Domain, b: Domain): Maybe<Domain> {
  // absence and any demand for a value are contradictory; absence and absence agree
  if (b.absent) {
    if (d.present || d.eq !== undefined || d.truthy || d.minLen !== undefined) return UNSAT;
    d.absent = true;
  }
  if (b.present) {
    if (d.absent) return UNSAT;
    d.present = true;
  }
  if (b.truthy !== undefined) {
    if (d.absent) return UNSAT;
    if (d.truthy !== undefined && d.truthy !== b.truthy) return UNSAT;
    d.truthy = b.truthy;
    d.present = true;
  }
  return d;
}

/** Every bound of one direction, tightened; false when the path must be absent. */
function tighten(
  d: Domain,
  b: Domain,
  bounds: readonly ('gt' | 'gte' | 'minLen' | 'lt' | 'lte' | 'maxLen')[],
  tighter: (one: number, other: number) => number,
): boolean {
  for (const bound of bounds) {
    if (b[bound] === undefined) continue;
    if (d.absent) return false;
    d[bound] = d[bound] === undefined ? b[bound] : tighter(d[bound] ?? 0, b[bound] ?? 0);
  }
  return true;
}

/** The bounds of the two constraints, together: the tighter of each. UNSAT when the path must be absent. */
function narrowBounds(d: Domain, b: Domain): Maybe<Domain> {
  const lower = tighten(d, b, ['gt', 'gte', 'minLen'], Math.max);
  const upper = tighten(d, b, ['lt', 'lte', 'maxLen'], Math.min);
  return lower && upper ? d : UNSAT;
}

/** The exact value and the membership the two constraints ask for, together. */
function narrowValues(d: Domain, b: Domain): Maybe<Domain> {
  if (b.eq !== undefined) {
    if (d.absent) return UNSAT;
    if (d.eq !== undefined && JSON.stringify(d.eq) !== JSON.stringify(b.eq)) return UNSAT;
    d.eq = b.eq;
    d.present = true;
  }
  // membership: what the list must hold implies the list is there; what it must lack does not
  if (b.has) {
    if (d.absent) return UNSAT;
    d.has = [...(d.has ?? []), ...b.has];
    d.present = true;
  }
  if (b.lacks) d.lacks = [...(d.lacks ?? []), ...b.lacks];
  return d;
}

/** One path's constraint, narrowed by another. UNSAT when the two cannot both hold. */
export function narrow(a: Domain, b: Domain): Maybe<Domain> {
  let d: Domain = { ...a };
  const step = narrowPresence(d, b);
  if (step === UNSAT) return UNSAT;
  d = step;
  // `ne` does not imply presence: a missing path satisfies 'x != lit' too, so absence stays compatible
  if (b.ne) d.ne = [...(d.ne ?? []), ...b.ne];
  const bounded = narrowBounds(d, b);
  if (bounded === UNSAT) return UNSAT;
  d = bounded;
  const valued = narrowValues(d, b);
  if (valued === UNSAT) return UNSAT;
  return consistent(valued) ? valued : UNSAT;
}

/** Whether a number sits inside a domain's numeric bounds. */
function withinBounds(v: number, d: Domain): boolean {
  if (d.gt !== undefined && !(v > d.gt)) return false;
  if (d.gte !== undefined && !(v >= d.gte)) return false;
  if (d.lt !== undefined && !(v < d.lt)) return false;
  if (d.lte !== undefined && !(v <= d.lte)) return false;
  return true;
}

/** Whether a concrete value satisfies a domain's bounds and exclusions. */
export function fits(v: unknown, d: Domain): boolean {
  if (d.ne?.some(x => JSON.stringify(x) === JSON.stringify(v))) return false;
  if (d.truthy !== undefined && Boolean(v) !== d.truthy) return false;
  if (typeof v === 'number' && !withinBounds(v, d)) return false;
  if (Array.isArray(v)) {
    if (d.minLen !== undefined && v.length < d.minLen) return false;
    if (d.maxLen !== undefined && v.length > d.maxLen) return false;
    const holds = (x: unknown) => v.some(y => JSON.stringify(x) === JSON.stringify(y));
    if (d.has?.some(x => !holds(x))) return false;
    if (d.lacks?.some(holds)) return false;
  } else if (d.has?.length) return false;
  return true;
}

/** Whether a numeric range excludes every number. Integers are assumed; the grammar's literals are exact. */
export function emptyRange(d: Domain): boolean {
  const lo = Math.max(d.gt !== undefined ? d.gt + 1 : -Infinity, d.gte ?? -Infinity);
  const hi = Math.min(d.lt !== undefined ? d.lt - 1 : Infinity, d.lte ?? Infinity);
  return lo > hi;
}

/** Two demand sets, narrowed path by path. UNSAT when any path contradicts. */
