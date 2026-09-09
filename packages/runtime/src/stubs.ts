/**
 * From a solved demand to a value a rehearsal can run with: the smallest change to a generated stub that puts it
 * inside the domain a branch asks for, and the paths that change is written at.
 */
import { generate, rng, type Type } from '@wilanis/core';
import { type Domain, fits } from './domains.js';

// ---- from demands to stubs --------------------------------------------------------------------------

/**
 * A value satisfying a domain, built by patching what the seed generated. The generated value is kept
 * wherever the domain says nothing, so a branch case differs from an ordinary rehearsal only in the
 * fields its rule actually reads.
 */
/**
 * Whether two numbers say the same thing about an outcome. HTTP statuses come in families -- any 2xx is a
 * success -- so excluding one 2xx and generating another leaves the branch testing the opposite of what
 * its rule describes.
 */
function sameFamily(a: number, b: number): boolean {
  if (a >= 200 && a < 600 && b >= 200 && b < 600) return Math.floor(a / 100) === Math.floor(b / 100);
  return false;
}

/**
 * A number unlike `v`, chosen to read as the case being tested rather than merely to differ from it.
 *
 * Adding one is the arithmetic answer and the wrong one: a rule that excludes 200 excludes success, and
 * 201 is also a success, so the branch meant for the error path would be exercised with a value that
 * contradicts what the branch is for. Where `v` looks like an HTTP status, the value is a failure of the
 * same family, so the run reads like the case the rule was written for.
 */
function unlike(v: number, d: Domain): number {
  const no = (n: number) => !fits(n, d);
  if (v >= 200 && v < 600) for (const c of [500, 404, 503, 400, 502]) if (!no(c)) return c;
  for (const c of [v + 1, v - 1, 0, -1]) if (!no(c)) return c;
  return v + 1;
}

/** A list to start from: what the seed made, else a fresh one -- but never a fresh list when a value must be held. */
function baseList(d: Domain, generated: unknown, t: Type | undefined, seed: number): unknown[] {
  if (Array.isArray(generated)) return generated;
  if (d.has?.length) return [];
  const made = fresh(t, seed);
  return Array.isArray(made) ? (made as unknown[]) : [];
}

/** The generated list, less what it must lack, plus what it must hold; a list demanded to lack a value can stay empty. */
function withMembers(d: Domain, generated: unknown, t: Type | undefined, seed: number): unknown[] {
  const same = (one: unknown, other: unknown) => JSON.stringify(one) === JSON.stringify(other);
  const kept = baseList(d, generated, t, seed).filter(item => !d.lacks?.some(bad => same(item, bad)));
  for (const wanted of d.has ?? []) if (!kept.some(item => same(wanted, item))) kept.push(wanted);
  return kept;
}

/** A list of the length the domain asks for: cut when too long, padded with its first element when too short. */
function withLength(d: Domain, generated: unknown, t: Type | undefined, seed: number): unknown[] {
  const base = Array.isArray(generated) ? generated : baseList({}, generated, t, seed);
  const want = d.minLen !== undefined ? Math.max(base.length, d.minLen) : Math.min(base.length, d.maxLen ?? 0);
  const size = d.maxLen !== undefined ? Math.min(want, d.maxLen) : want;
  if (base.length === size) return base;
  if (base.length > size) return base.slice(0, size);
  const fill = base.length ? base[0] : elementOf(t, seed);
  return [...base, ...Array.from({ length: size - base.length }, () => fill)];
}

/** The first of the bounds that is a real number, else zero. */
function firstFinite(lo: number, hi: number): number {
  if (Number.isFinite(lo)) return lo;
  return Number.isFinite(hi) ? hi : 0;
}

/** A number inside the range the domain asks for, keeping the seed's own when it already is. */
function withinRange(d: Domain, generated: unknown): number {
  const lo = Math.max(d.gt !== undefined ? d.gt + 1 : -Infinity, d.gte ?? -Infinity);
  const hi = Math.min(d.lt !== undefined ? d.lt - 1 : Infinity, d.lte ?? Infinity);
  if (typeof generated === 'number' && generated >= lo && generated <= hi && fits(generated, d)) return generated;
  const pick = firstFinite(lo, hi);
  return fits(pick, d) ? pick : pick + 1;
}

/**
 * Whether a value reads like the case being tested. An exclusion of 200 is an exclusion of success, so a generated 201
 * satisfies the rule while contradicting what the branch is for -- the report would then say a 201 caused the error
 * path. A value is implausible when it says the same thing as what the rule excludes, and also when the rule excludes
 * a status but the seed produced a number that is no status at all.
 */
function plausible(d: Domain, value: unknown): boolean {
  if (typeof value !== 'number') return true;
  const statusLike = d.ne?.some(one => typeof one === 'number' && one >= 200 && one < 600);
  const sameThing = d.ne?.some(one => typeof one === 'number' && sameFamily(value, one));
  return !sameThing && (!statusLike || (value >= 200 && value < 600));
}

/** A value the domain does not exclude, of the same family as what it excludes where that can be told. */
function excluding(d: Domain, generated: unknown): unknown {
  if (generated !== undefined && fits(generated, d) && plausible(d, generated)) return generated;
  const bad = d.ne?.[0];
  if (typeof bad === 'number') return unlike(bad, d);
  if (typeof bad === 'string') return bad === '' ? 'x' : '';
  if (typeof bad === 'boolean') return !bad;
  return null;
}

/**
 * A bare has(path): any value of the declared type will do, so generate one rather than invent a shape. An empty list
 * is the exception -- it satisfies has() while failing whatever reads the list, which would report a fault the
 * rehearsal's own stub caused rather than one the documents contain.
 */
function anyValue(generated: unknown, t: Type | undefined, seed: number): unknown {
  if (generated === undefined) return fresh(t, seed);
  if (Array.isArray(generated) && !generated.length) return fresh(t, seed);
  return generated;
}

/** A boolean the domain asks for, keeping the seed's own when it already reads that way. */
function asTruthy(d: Domain, generated: unknown): unknown {
  if (generated !== undefined && Boolean(generated) === d.truthy && fits(generated, d)) return generated;
  return Boolean(d.truthy);
}

/** What kind of demand a domain makes, and what satisfies it; the first that applies wins. */
const DEMANDS: {
  asks: (d: Domain) => boolean;
  met: (d: Domain, generated: unknown, t: Type | undefined, seed: number) => unknown;
}[] = [
  { asks: d => Boolean(d.absent), met: () => undefined },
  { asks: d => d.eq !== undefined, met: d => d.eq },
  { asks: d => Boolean(d.has?.length || d.lacks?.length), met: withMembers },
  { asks: d => d.minLen !== undefined || d.maxLen !== undefined, met: withLength },
  {
    asks: d => d.gt !== undefined || d.gte !== undefined || d.lt !== undefined || d.lte !== undefined,
    met: (d, generated) => withinRange(d, generated),
  },
  { asks: d => d.truthy !== undefined, met: (d, generated) => asTruthy(d, generated) },
  { asks: d => Boolean(d.ne?.length), met: (d, generated) => excluding(d, generated) },
  { asks: d => Boolean(d.present), met: (_d, generated, t, seed) => anyValue(generated, t, seed) },
];

/** The smallest change to a generated value that puts it inside the domain a branch asks for. */
export function satisfy(d: Domain, generated: unknown, t?: Type, seed = 1): unknown {
  const demand = DEMANDS.find(one => one.asks(d));
  return demand ? demand.met(d, generated, t, seed) : generated;
}

/**
 * A generated value of a declared type, or a harmless placeholder when the type is unknown.
 *
 * A presence demand is satisfied by any value, but an empty list satisfies has() while failing whatever
 * reads the list -- the branch would then report a fault that only the rehearsal's own stub caused. So a
 * generated list is given an element, and a generated object every field it declares.
 */
function fresh(t: Type | undefined, seed: number): unknown {
  if (!t) return PLACEHOLDER;
  try {
    const v = generate(t, rng(seed));
    if (t.kind === 'list' && Array.isArray(v) && !v.length) return [generate(t.of, rng(seed + 1))];
    return v;
  } catch {
    return PLACEHOLDER;
  }
}

/** A generated element of a declared list type, for padding a list out to a demanded length. */
function elementOf(t: Type | undefined, seed: number): unknown {
  if (t && t.kind === 'list') {
    try {
      return generate(t.of, rng(seed));
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

export function getPath(root: unknown, path: string[]): unknown {
  let cur = root;
  for (const seg of path) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = Array.isArray(cur) ? (cur as unknown[])[Number(seg)] : (cur as Record<string, unknown>)[seg];
  }
  return cur;
}
