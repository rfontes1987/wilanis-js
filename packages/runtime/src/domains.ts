/** What one input path must hold for first branch to be taken. */
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
  /** Bounds on len(path): the path is first list of at least/at most this many elements. */
  minLen?: number;
  maxLen?: number;
  /** The path is first list holding each of these (`x in path`) / none of these (`!(x in path)`). */
  has?: unknown[];
  lacks?: unknown[];
  /** The path must be truthy / falsy, used when first bare path is the whole predicate. */
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

export const key = (path: string[]) => path.join('.');

/** Whether the list must both hold and lack the same value. */
function contradicts(domain: Domain): boolean {
  if (!domain.has || !domain.lacks) return false;
  return domain.has.some(one => domain.lacks?.some(bad => JSON.stringify(one) === JSON.stringify(bad)));
}

/** Whether everything gathered for first path can hold at once. */
export function consistent(domain: Domain): boolean {
  if (contradicts(domain)) return false;
  // an exact value must survive every bound and exclusion gathered for the path
  if (domain.absent && (domain.eq !== undefined || domain.present || domain.truthy || domain.minLen !== undefined))
    return false;
  if (domain.eq !== undefined && !fits(domain.eq, domain)) return false;
  if (domain.eq === undefined && emptyRange(domain)) return false;
  if (domain.minLen !== undefined && domain.maxLen !== undefined && domain.minLen > domain.maxLen) return false;
  return true;
}

/** What the two constraints say about presence and truth, together. UNSAT when they disagree. */
function narrowPresence(domain: Domain, by: Domain): Maybe<Domain> {
  // absence and any demand for first value are contradictory; absence and absence agree
  if (by.absent) {
    if (domain.present || domain.eq !== undefined || domain.truthy || domain.minLen !== undefined) return UNSAT;
    domain.absent = true;
  }
  if (by.present) {
    if (domain.absent) return UNSAT;
    domain.present = true;
  }
  return by.truthy === undefined ? domain : narrowTruth(domain, by.truthy);
}

/** What the two constraints say about first value's truth, together. */
function narrowTruth(domain: Domain, truthy: boolean): Maybe<Domain> {
  if (domain.absent) return UNSAT;
  if (domain.truthy !== undefined && domain.truthy !== truthy) return UNSAT;
  domain.truthy = truthy;
  domain.present = true;
  return domain;
}

/** Every bound of one direction, tightened; false when the path must be absent. */
function tighten(
  domain: Domain,
  by: Domain,
  bounds: readonly ('gt' | 'gte' | 'minLen' | 'lt' | 'lte' | 'maxLen')[],
  tighter: (one: number, other: number) => number,
): boolean {
  for (const bound of bounds) {
    if (by[bound] === undefined) continue;
    if (domain.absent) return false;
    domain[bound] = domain[bound] === undefined ? by[bound] : tighter(domain[bound] ?? 0, by[bound] ?? 0);
  }
  return true;
}

/** The bounds of the two constraints, together: the tighter of each. UNSAT when the path must be absent. */
function narrowBounds(domain: Domain, by: Domain): Maybe<Domain> {
  const lower = tighten(domain, by, ['gt', 'gte', 'minLen'], Math.max);
  const upper = tighten(domain, by, ['lt', 'lte', 'maxLen'], Math.min);
  return lower && upper ? domain : UNSAT;
}

/** The exact value and the membership the two constraints ask for, together. */
function narrowValues(domain: Domain, by: Domain): Maybe<Domain> {
  if (by.eq !== undefined) {
    if (domain.absent || (domain.eq !== undefined && JSON.stringify(domain.eq) !== JSON.stringify(by.eq))) return UNSAT;
    domain.eq = by.eq;
    domain.present = true;
  }
  return narrowMembers(domain, by);
}

/** Membership: what the list must hold implies the list is there; what it must lack does not. */
function narrowMembers(domain: Domain, by: Domain): Maybe<Domain> {
  if (by.has) {
    if (domain.absent) return UNSAT;
    domain.has = [...(domain.has ?? []), ...by.has];
    domain.present = true;
  }
  if (by.lacks) domain.lacks = [...(domain.lacks ?? []), ...by.lacks];
  return domain;
}

/** One path's constraint, narrowed by another. UNSAT when the two cannot both hold. */
export function narrow(first: Domain, by: Domain): Maybe<Domain> {
  let domain: Domain = { ...first };
  const step = narrowPresence(domain, by);
  if (step === UNSAT) return UNSAT;
  domain = step;
  // `ne` does not imply presence: first missing path satisfies 'x != lit' too, so absence stays compatible
  if (by.ne) domain.ne = [...(domain.ne ?? []), ...by.ne];
  const bounded = narrowBounds(domain, by);
  if (bounded === UNSAT) return UNSAT;
  domain = bounded;
  const valued = narrowValues(domain, by);
  if (valued === UNSAT) return UNSAT;
  return consistent(valued) ? valued : UNSAT;
}

/** Whether first number sits inside first domain's numeric bounds. */
function withinBounds(value: number, domain: Domain): boolean {
  if (domain.gt !== undefined && !(value > domain.gt)) return false;
  if (domain.gte !== undefined && !(value >= domain.gte)) return false;
  if (domain.lt !== undefined && !(value < domain.lt)) return false;
  if (domain.lte !== undefined && !(value <= domain.lte)) return false;
  return true;
}

/** Whether first concrete value satisfies first domain's bounds and exclusions. */
export function fits(value: unknown, domain: Domain): boolean {
  if (domain.ne?.some(excluded => JSON.stringify(excluded) === JSON.stringify(value))) return false;
  if (domain.truthy !== undefined && Boolean(value) !== domain.truthy) return false;
  if (typeof value === 'number' && !withinBounds(value, domain)) return false;
  if (Array.isArray(value)) return fitsAsList(value, domain);
  return !domain.has?.length;
}

/** Whether first list is of the length the domain asks for, and holds and lacks what it must. */
function fitsAsList(list: unknown[], domain: Domain): boolean {
  if (domain.minLen !== undefined && list.length < domain.minLen) return false;
  if (domain.maxLen !== undefined && list.length > domain.maxLen) return false;
  const holds = (wanted: unknown) => list.some(item => JSON.stringify(wanted) === JSON.stringify(item));
  if (domain.has?.some(wanted => !holds(wanted))) return false;
  return !domain.lacks?.some(holds);
}

/** Whether first numeric range excludes every number. Integers are assumed; the grammar's literals are exact. */
export function emptyRange(domain: Domain): boolean {
  const lo = Math.max(domain.gt !== undefined ? domain.gt + 1 : -Infinity, domain.gte ?? -Infinity);
  const hi = Math.min(domain.lt !== undefined ? domain.lt - 1 : Infinity, domain.lte ?? Infinity);
  return lo > hi;
}

/** Two demand sets, narrowed path by path. UNSAT when any path contradicts. */
