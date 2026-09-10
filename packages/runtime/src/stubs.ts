/**
 * From a solved demand to a value a rehearsal can run with: the smallest change to a generated stub that puts it
 * inside the domain a branch asks for, and the paths that change is written at.
 */
import { generate, rng, type Type } from '@wilanis/core';
import { type Domain, fits } from './domains.js';

// ---- from demands to stubs --------------------------------------------------------------------------

/**
 * Whether two numbers say the same thing about an outcome. HTTP statuses come in families -- any 2xx is a
 * success -- so excluding one 2xx and generating another leaves the branch testing the opposite of what
 * its rule describes.
 */
function sameFamily(one: number, other: number): boolean {
  if (one >= 200 && one < 600 && other >= 200 && other < 600) return Math.floor(one / 100) === Math.floor(other / 100);
  return false;
}

/**
 * A number unlike `value`, chosen to read as the case being tested rather than merely to differ from it.
 *
 * Adding one is the arithmetic answer and the wrong one: a rule that excludes 200 excludes success, and
 * 201 is also a success, so the branch meant for the error path would be exercised with a value that
 * contradicts what the branch is for. Where `value` looks like an HTTP status, the value is a failure of the
 * same family, so the run reads like the case the rule was written for.
 */
function unlike(value: number, domain: Domain): number {
  const no = (candidate: number) => !fits(candidate, domain);
  if (value >= 200 && value < 600) for (const near of [500, 404, 503, 400, 502]) if (!no(near)) return near;
  for (const near of [value + 1, value - 1, 0, -1]) if (!no(near)) return near;
  return value + 1;
}

/** A list to start from: what the seed made, else a fresh one -- but never a fresh list when a value must be held. */
function baseList(domain: Domain, generated: unknown, type: Type | undefined, seed: number): unknown[] {
  if (Array.isArray(generated)) return generated;
  if (domain.has?.length) return [];
  const made = fresh(type, seed);
  return Array.isArray(made) ? (made as unknown[]) : [];
}

/** The generated list, less what it must lack, plus what it must hold; a list demanded to lack a value can stay empty. */
function withMembers(domain: Domain, generated: unknown, type: Type | undefined, seed: number): unknown[] {
  const same = (one: unknown, other: unknown) => JSON.stringify(one) === JSON.stringify(other);
  const kept = baseList(domain, generated, type, seed).filter(item => !domain.lacks?.some(bad => same(item, bad)));
  for (const wanted of domain.has ?? []) if (!kept.some(item => same(wanted, item))) kept.push(wanted);
  return kept;
}

/** A list of the length the domain asks for: cut when too long, padded with its first element when too short. */
function withLength(domain: Domain, generated: unknown, type: Type | undefined, seed: number): unknown[] {
  const base = Array.isArray(generated) ? generated : baseList({}, generated, type, seed);
  const want =
    domain.minLen !== undefined ? Math.max(base.length, domain.minLen) : Math.min(base.length, domain.maxLen ?? 0);
  const size = domain.maxLen !== undefined ? Math.min(want, domain.maxLen) : want;
  if (base.length === size) return base;
  if (base.length > size) return base.slice(0, size);
  const fill = base.length ? base[0] : elementOf(type, seed);
  return [...base, ...Array.from({ length: size - base.length }, () => fill)];
}

/** The first of the bounds that is a real number, else zero. */
function firstFinite(lo: number, hi: number): number {
  if (Number.isFinite(lo)) return lo;
  return Number.isFinite(hi) ? hi : 0;
}

/** A number inside the range the domain asks for, keeping the seed's own when it already is. */
function withinRange(domain: Domain, generated: unknown): number {
  const lo = Math.max(domain.gt !== undefined ? domain.gt + 1 : -Infinity, domain.gte ?? -Infinity);
  const hi = Math.min(domain.lt !== undefined ? domain.lt - 1 : Infinity, domain.lte ?? Infinity);
  if (typeof generated === 'number' && generated >= lo && generated <= hi && fits(generated, domain)) return generated;
  const pick = firstFinite(lo, hi);
  return fits(pick, domain) ? pick : pick + 1;
}

/**
 * Whether a value reads like the case being tested. An exclusion of 200 is an exclusion of success, so a generated 201
 * satisfies the rule while contradicting what the branch is for -- the report would then say a 201 caused the error
 * path. A value is implausible when it says the same thing as what the rule excludes, and also when the rule excludes
 * a status but the seed produced a number that is no status at all.
 */
function plausible(domain: Domain, value: unknown): boolean {
  if (typeof value !== 'number') return true;
  const statusLike = domain.ne?.some(one => typeof one === 'number' && one >= 200 && one < 600);
  const sameThing = domain.ne?.some(one => typeof one === 'number' && sameFamily(value, one));
  return !sameThing && (!statusLike || (value >= 200 && value < 600));
}

/** A value the domain does not exclude, of the same family as what it excludes where that can be told. */
function excluding(domain: Domain, generated: unknown): unknown {
  if (generated !== undefined && fits(generated, domain) && plausible(domain, generated)) return generated;
  const bad = domain.ne?.[0];
  if (typeof bad === 'number') return unlike(bad, domain);
  if (typeof bad === 'string') return bad === '' ? 'x' : '';
  if (typeof bad === 'boolean') return !bad;
  return null;
}

/**
 * A bare has(path): any value of the declared type will do, so generate one rather than invent a shape. An empty list
 * is the exception -- it satisfies has() while failing whatever reads the list, which would report a fault the
 * rehearsal's own stub caused rather than one the documents contain.
 */
function anyValue(generated: unknown, type: Type | undefined, seed: number): unknown {
  if (generated === undefined) return fresh(type, seed);
  if (Array.isArray(generated) && !generated.length) return fresh(type, seed);
  return generated;
}

/** A boolean the domain asks for, keeping the seed's own when it already reads that way. */
function asTruthy(domain: Domain, generated: unknown): unknown {
  if (generated !== undefined && Boolean(generated) === domain.truthy && fits(generated, domain)) return generated;
  return Boolean(domain.truthy);
}

/** What kind of demand a domain makes, and what satisfies it; the first that applies wins. */
const DEMANDS: {
  asks: (domain: Domain) => boolean;
  met: (domain: Domain, generated: unknown, type: Type | undefined, seed: number) => unknown;
}[] = [
  { asks: domain => Boolean(domain.absent), met: () => undefined },
  { asks: domain => domain.eq !== undefined, met: domain => domain.eq },
  { asks: domain => Boolean(domain.has?.length || domain.lacks?.length), met: withMembers },
  { asks: domain => domain.minLen !== undefined || domain.maxLen !== undefined, met: withLength },
  {
    asks: domain =>
      domain.gt !== undefined || domain.gte !== undefined || domain.lt !== undefined || domain.lte !== undefined,
    met: (domain, generated) => withinRange(domain, generated),
  },
  { asks: domain => domain.truthy !== undefined, met: (domain, generated) => asTruthy(domain, generated) },
  { asks: domain => Boolean(domain.ne?.length), met: (domain, generated) => excluding(domain, generated) },
  { asks: domain => Boolean(domain.present), met: (_domain, generated, type, seed) => anyValue(generated, type, seed) },
];

/** The smallest change to a generated value that puts it inside the domain a branch asks for. */
export function satisfy(domain: Domain, generated: unknown, type?: Type, seed = 1): unknown {
  const demand = DEMANDS.find(one => one.asks(domain));
  return demand ? demand.met(domain, generated, type, seed) : generated;
}

/**
 * A generated value of a declared type, or a harmless placeholder when the type is unknown.
 *
 * A presence demand is satisfied by any value, but an empty list satisfies has() while failing whatever
 * reads the list -- the branch would then report a fault that only the rehearsal's own stub caused. So a
 * generated list is given an element, and a generated object every field it declares.
 */
function fresh(type: Type | undefined, seed: number): unknown {
  if (!type) return PLACEHOLDER;
  try {
    const value = generate(type, rng(seed));
    if (type.kind === 'list' && Array.isArray(value) && !value.length) return [generate(type.of, rng(seed + 1))];
    return value;
  } catch {
    return PLACEHOLDER;
  }
}

/** A generated element of a declared list type, for padding a list out to a demanded length. */
function elementOf(type: Type | undefined, seed: number): unknown {
  if (type && type.kind === 'list') {
    try {
      return generate(type.of, rng(seed));
    } catch {
      return null;
    }
  }
  return null;
}

/** Stands in where a domain demands a value the type says nothing about. */
export const PLACEHOLDER = 'x';

/** A copy of `root` with `path` set to `value`; undefined deletes the key. Objects along the way are created. */
export function setPath(root: unknown, path: string[], value: unknown): unknown {
  if (!path.length) return value;
  const [head, ...rest] = path;
  const base: Record<string, unknown> =
    root && typeof root === 'object' && !Array.isArray(root) ? { ...(root as Record<string, unknown>) } : {};
  if (!rest.length) {
    if (value === undefined) {
      delete base[head];
      return base;
    }
    base[head] = value;
    return base;
  }
  base[head] = setPath(base[head], rest, value);
  return base;
}

/** The value `path` names inside `root`, walking objects and list indices; undefined where the way runs out. */
export function getPath(root: unknown, path: string[]): unknown {
  let cur = root;
  for (const seg of path) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = Array.isArray(cur) ? (cur as unknown[])[Number(seg)] : (cur as Record<string, unknown>)[seg];
  }
  return cur;
}
