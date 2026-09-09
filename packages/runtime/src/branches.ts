/**
 * Branch enumeration for the rehearsal: every way a switch can route, solved from its own expressions.
 *
 * A switch rule is a predicate over the node's inputs, written in the one expression grammar. Rehearsing
 * with generated stubs takes whichever branch the seed happens to satisfy; to walk them all we read the
 * rules instead of guessing. For each rule we build the values that make it true and every earlier rule
 * false -- that is the case which reaches its target, since the kernel tries rules in order -- and one
 * more case for the else, where every rule is false at once.
 *
 * Constraints accumulate per path as a small domain (must be absent, must be present, a numeric range, a
 * set of excluded values, a required length) rather than a single value, because a rule's case is usually
 * the conjunction of its own demand with the negation of the rules before it: 'n > 5' after '!(n > 10)'
 * is the range (5, 10], which no single guessed value would find.
 */
import { expr, generate, rng, type Type, typeAt } from '@wilanis/core';

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

const UNSAT = Symbol('unsatisfiable');
type Maybe<T> = T | typeof UNSAT;

const key = (p: string[]) => p.join('.');

/** One path's constraint, narrowed by another. UNSAT when the two cannot both hold. */
function narrow(a: Domain, b: Domain): Maybe<Domain> {
  const d: Domain = { ...a };
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
  // `ne` does not imply presence: a missing path satisfies 'x != lit' too, so absence stays compatible
  if (b.ne) d.ne = [...(d.ne ?? []), ...b.ne];
  for (const k of ['gt', 'gte', 'minLen'] as const)
    if (b[k] !== undefined) {
      if (d.absent) return UNSAT;
      d[k] = d[k] === undefined ? b[k] : Math.max(d[k]!, b[k]!);
    }
  for (const k of ['lt', 'lte', 'maxLen'] as const)
    if (b[k] !== undefined) {
      if (d.absent) return UNSAT;
      d[k] = d[k] === undefined ? b[k] : Math.min(d[k]!, b[k]!);
    }
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
  if (d.has && d.lacks && d.has.some(x => d.lacks!.some(y => JSON.stringify(x) === JSON.stringify(y)))) return UNSAT;
  // an exact value must survive every bound and exclusion gathered for the path
  if (d.absent && (d.eq !== undefined || d.present || d.truthy || d.minLen !== undefined)) return UNSAT;
  if (d.eq !== undefined && !fits(d.eq, d)) return UNSAT;
  if (d.eq === undefined && emptyRange(d)) return UNSAT;
  if (d.minLen !== undefined && d.maxLen !== undefined && d.minLen > d.maxLen) return UNSAT;
  return d;
}

/** Whether a concrete value satisfies a domain's bounds and exclusions. */
function fits(v: unknown, d: Domain): boolean {
  if (d.ne?.some(x => JSON.stringify(x) === JSON.stringify(v))) return false;
  if (d.truthy !== undefined && Boolean(v) !== d.truthy) return false;
  if (typeof v === 'number') {
    if (d.gt !== undefined && !(v > d.gt)) return false;
    if (d.gte !== undefined && !(v >= d.gte)) return false;
    if (d.lt !== undefined && !(v < d.lt)) return false;
    if (d.lte !== undefined && !(v <= d.lte)) return false;
  }
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
function emptyRange(d: Domain): boolean {
  const lo = Math.max(d.gt !== undefined ? d.gt + 1 : -Infinity, d.gte ?? -Infinity);
  const hi = Math.min(d.lt !== undefined ? d.lt - 1 : Infinity, d.lte ?? Infinity);
  return lo > hi;
}

/** Two demand sets, narrowed path by path. UNSAT when any path contradicts. */
function merge(a: Demands, b: Demands): Maybe<Demands> {
  const out: Demands = { ...a };
  for (const [k, d] of Object.entries(b)) {
    const got = out[k] ? narrow(out[k], d) : d;
    if (got === UNSAT) return UNSAT;
    out[k] = got;
  }
  return out;
}

/** Every assignment satisfying `e === want`, as alternatives; a disjunction yields more than one. */
function solve(e: expr.Expr, want: boolean): Demands[] {
  switch (e.kind) {
    case 'lit':
      return Boolean(e.value) === want ? [{}] : [];
    case 'has':
      return [want ? { [key(e.path)]: { present: true } } : { [key(e.path)]: { absent: true } }];
    case 'not':
      return solve(e.arg, !want);
    case 'path':
      return [{ [key(e.path)]: { truthy: want } }];
    case 'len': {
      // len() alone as a predicate is a length compared against nothing; only comparisons constrain it
      return [];
    }
    case 'bin': {
      if (e.op === '&&' || e.op === '||') {
        const both = (e.op === '&&') === want;
        const ls = solve(e.left, want),
          rs = solve(e.right, want);
        if (!both) return [...ls, ...rs];
        const out: Demands[] = [];
        for (const l of ls)
          for (const r of rs) {
            const m = merge(l, r);
            if (m !== UNSAT) out.push(m);
          }
        return out;
      }
      return compare(e, want);
    }
  }
}

const MIRROR = { '<': '>', '<=': '>=', '>': '<', '>=': '<=', '==': '==', '!=': '!=' } as const;
const NEGATE = { '==': '!=', '!=': '==', '<': '>=', '<=': '>', '>': '<=', '>=': '<' } as const;
type Cmp = keyof typeof NEGATE;

/** Solve one comparison. One side must be a literal; comparing two paths has no canonical answer. */
function compare(e: expr.Expr & { kind: 'bin' }, want: boolean): Demands[] {
  // `lit in path`: the list must hold the literal, or must not
  if (e.op === 'in') {
    if (e.left.kind !== 'lit' || e.right.kind !== 'path') return [];
    return [{ [key(e.right.path)]: want ? { has: [e.left.value], present: true } : { lacks: [e.left.value] } }];
  }
  const sides: [expr.Expr, expr.Expr] = [e.left, e.right];
  const li = sides.findIndex(s => s.kind === 'lit');
  if (li < 0) return []; // path vs path: unsolvable, no alternatives
  const target = sides[1 - li];
  const lit = (sides[li] as expr.Expr & { kind: 'lit' }).value;
  // the operator is written against the left operand; with the literal on the left it mirrors
  const op: Cmp = li === 0 ? MIRROR[e.op as Cmp] : (e.op as Cmp);
  const truth: Cmp = want ? op : NEGATE[op];
  // len(path) <op> n constrains the path's length; path <op> lit constrains its value
  if (target.kind === 'len') {
    const inner = target.arg;
    if (inner.kind !== 'path' || typeof lit !== 'number') return [];
    return [{ [key(inner.path)]: lenDomain(truth, lit) }];
  }
  if (target.kind !== 'path') return [];
  return [{ [key(target.path)]: valueDomain(truth, lit) }];
}

function valueDomain(op: Cmp, lit: unknown): Domain {
  if (op === '==') return { eq: lit, present: true };
  if (op === '!=') return { ne: [lit] };
  if (typeof lit !== 'number') return { ne: [] }; // ordering on a non-number: no useful bound
  switch (op) {
    case '>':
      return { gt: lit, present: true };
    case '>=':
      return { gte: lit, present: true };
    case '<':
      return { lt: lit, present: true };
    case '<=':
      return { lte: lit, present: true };
  }
}

function lenDomain(op: Cmp, n: number): Domain {
  switch (op) {
    case '==':
      return { minLen: n, maxLen: n, present: true };
    case '!=':
      return { minLen: n + 1, present: true }; // any length but n; longer is the simplest
    case '>':
      return { minLen: n + 1, present: true };
    case '>=':
      return { minLen: n, present: true };
    case '<':
      return { maxLen: n - 1, present: true };
    case '<=':
      return { maxLen: n, present: true };
  }
}

/** Whether an expression names any path the rehearsal could constrain, satisfiable or not. */
function nameable(e: expr.Expr): boolean {
  switch (e.kind) {
    case 'lit':
      return true;
    case 'has':
    case 'path':
      return true;
    case 'not':
      return nameable(e.arg);
    case 'len':
      return false;
    case 'bin': {
      if (e.op === '&&' || e.op === '||') return nameable(e.left) || nameable(e.right);
      if (e.op === 'in') return e.left.kind === 'lit' && e.right.kind === 'path';
      // a comparison names something when one side is a literal and the other a path or len(path)
      const sides = [e.left, e.right];
      if (!sides.some(s => s.kind === 'lit')) return false;
      const t = sides[sides.findIndex(s => s.kind === 'lit') === 0 ? 1 : 0];
      return t.kind === 'path' || (t.kind === 'len' && t.arg.kind === 'path');
    }
  }
}

/**
 * Every case of one switch: one per rule, plus the else. A rule's case makes that rule true and every
 * earlier rule false, which is what the kernel requires to reach its target.
 */
export function branchesOf(rules: { when: string; to: string }[], elseTo: string): Branch[] {
  const out: Branch[] = [];
  const parsed = rules.map(r => {
    try {
      return expr.parse(r.when);
    } catch {
      return undefined;
    }
  });
  /** Every alternative in which rules [0, upto) are all false. */
  const allFalseBefore = (upto: number): Demands[] => {
    let alts: Demands[] = [{}];
    for (let j = 0; j < upto; j++) {
      const e = parsed[j];
      if (!e) return []; // a rule that does not parse cannot be negated
      const next: Demands[] = [];
      for (const a of alts)
        for (const f of solve(e, false)) {
          const m = merge(a, f);
          if (m !== UNSAT) next.push(m);
        }
      alts = next;
      if (!alts.length) return [];
    }
    return alts;
  };
  for (let i = 0; i < rules.length; i++) {
    const e = parsed[i];
    const base = { rule: i, when: rules[i].when, to: rules[i].to };
    if (!e) {
      out.push({ ...base, demands: {}, unsolved: 'the expression does not parse' });
      continue;
    }
    const mine = solve(e, true);
    const before = allFalseBefore(i);
    let hit: Demands | undefined;
    for (const m of mine) {
      for (const b of before) {
        const j = merge(m, b);
        if (j !== UNSAT) {
          hit = j;
          break;
        }
      }
      if (hit) break;
    }
    if (hit) {
      out.push({ ...base, demands: hit });
      continue;
    }
    // no alternatives at all means the expression itself names nothing solvable; alternatives that all
    // contradict mean the rule is either self-contradictory or shadowed by an earlier one
    const reason = !nameable(e)
      ? `'${rules[i].when}' compares values the rehearsal cannot name`
      : !mine.length
        ? `no inputs satisfy '${rules[i].when}' -- the rule contradicts itself`
        : !before.length
          ? `the rules before it already cover every input, so '${rules[i].when}' is unreachable`
          : `no inputs satisfy '${rules[i].when}'`;
    out.push({ ...base, demands: {}, unsolved: reason });
  }
  const none = allFalseBefore(rules.length);
  out.push(
    none.length
      ? { rule: -1, when: 'else', to: elseTo, demands: none[0] }
      : { rule: -1, when: 'else', to: elseTo, demands: {}, unsolved: 'no inputs make every rule false at once' },
  );
  return out;
}

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

export function satisfy(d: Domain, generated: unknown, t?: Type, seed = 1): unknown {
  if (d.absent) return undefined;
  if (d.eq !== undefined) return d.eq;
  if (d.has?.length || d.lacks?.length) {
    // the generated list, less what it must lack, plus what it must hold; a list demanded to lack a value can stay empty
    const base = Array.isArray(generated)
      ? generated
      : d.has?.length
        ? []
        : Array.isArray(fresh(t, seed))
          ? (fresh(t, seed) as unknown[])
          : [];
    const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
    const kept = base.filter(x => !d.lacks?.some(y => same(x, y)));
    for (const x of d.has ?? []) if (!kept.some(y => same(x, y))) kept.push(x);
    return kept;
  }
  if (d.minLen !== undefined || d.maxLen !== undefined) {
    const base = Array.isArray(generated)
      ? generated
      : Array.isArray(fresh(t, seed))
        ? (fresh(t, seed) as unknown[])
        : [];
    const want = d.minLen !== undefined ? Math.max(base.length, d.minLen) : Math.min(base.length, d.maxLen!);
    const n = d.maxLen !== undefined ? Math.min(want, d.maxLen) : want;
    if (base.length === n) return base;
    if (base.length > n) return base.slice(0, n);
    const fill = base.length ? base[0] : elementOf(t, seed);
    return [...base, ...Array.from({ length: n - base.length }, () => fill)];
  }
  if (d.gt !== undefined || d.gte !== undefined || d.lt !== undefined || d.lte !== undefined) {
    const lo = Math.max(d.gt !== undefined ? d.gt + 1 : -Infinity, d.gte ?? -Infinity);
    const hi = Math.min(d.lt !== undefined ? d.lt - 1 : Infinity, d.lte ?? Infinity);
    if (typeof generated === 'number' && generated >= lo && generated <= hi && fits(generated, d)) return generated;
    const pick = Number.isFinite(lo) ? lo : Number.isFinite(hi) ? hi : 0;
    return fits(pick, d) ? pick : pick + 1;
  }
  if (d.truthy !== undefined) {
    if (generated !== undefined && Boolean(generated) === d.truthy && fits(generated, d)) return generated;
    return !!d.truthy;
  }
  if (d.ne?.length) {
    // The seed's value is kept only when it reads like the case being tested. An exclusion of 200 is an
    // exclusion of success, so a generated 201 satisfies the rule while contradicting what the branch is
    // for -- the report would then say a 201 caused the error path. Prefer a value of the same family.
    // a value is implausible when it says the same thing as what the rule excludes, and also when the
    // rule excludes a status but the seed produced a number that is no status at all
    const statusLike = d.ne!.some(x => typeof x === 'number' && x >= 200 && x < 600);
    const plausible = (v: unknown) =>
      typeof v !== 'number'
        ? true
        : !d.ne!.some(x => typeof x === 'number' && sameFamily(v, x)) && (!statusLike || (v >= 200 && v < 600));
    if (generated !== undefined && fits(generated, d) && plausible(generated)) return generated;
    const bad = d.ne[0];
    if (typeof bad === 'number') return unlike(bad, d);
    if (typeof bad === 'string') return bad === '' ? 'x' : '';
    if (typeof bad === 'boolean') return !bad;
    return null;
  }
  // A bare has(path): any value of the declared type will do, so generate one rather than invent a shape.
  // An empty list is the exception -- it satisfies has() while failing whatever reads the list, which
  // would report a fault the rehearsal's own stub caused rather than one the documents contain.
  if (d.present) {
    if (generated === undefined) return fresh(t, seed);
    if (Array.isArray(generated) && !generated.length) return fresh(t, seed);
    return generated;
  }
  return generated;
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

// ---- enumerating a spec's branches ------------------------------------------------------------------

/** One rehearsal case: a set of stubs by dotted node path, and the branch it is meant to reach. */
export interface Case {
  /** Dotted path of the switch, from the top-level graph. */
  at: string;
  branch: Branch;
  /** Node path -> the whole stubbed output of that node. Empty when nothing needed patching. */
  stubs: Record<string, unknown>;
  /**
   * Demands that land on the graph's own input rather than a node: path within the input -> value.
   * Only meaningful for a switch in the top-level graph, where the input is the trigger's.
   */
  input?: { path: string[]; value: unknown }[];
  /** Demands that could not be routed to anything the rehearsal can set. */
  unreachable?: string[];
}

/** A switch found in a spec, with the position it occupies in the run. */
export interface FoundSwitch {
  /** Dotted node path of the switch itself. */
  at: string;
  /** The prefix under which the switch's sibling nodes are stubbed. */
  prefix: string[];
  /** True while every enclosing frame forwards `in` unchanged, so the trigger's input still steers this switch. */
  fromTriggerIn?: boolean;
  node: KSwitchLike;
  /**
   * The nodes enclosing this switch, outermost first: each is a call whose graph the switch lives in.
   * A switch inside one of them is only reached when every enclosing switch routes towards it, so a
   * case for a nested switch must first satisfy its ancestors.
   */
  via: string[];
  /**
   * The map nodes enclosing this switch, outermost first. A switch inside a mapped operation runs once per
   * element and is rehearsed through the first one, so each enclosing list must hold at least one element.
   */
  lists: FoundList[];
}

/** A map node on the way to a switch: where it sits, what it iterates, and whether the trigger's input still steers that list. */
export interface FoundList {
  /** Dotted node path of the map itself. */
  at: string;
  /** The lowered source of `over`. */
  over: unknown;
  /** True when `over` reading `in` reads the trigger's own input. */
  fromTriggerIn: boolean;
}

/** The shape of a lowered switch this module needs; `label` carries the rule's source text. */
export interface KSwitchLike {
  kind: 'switch';
  in: Record<string, unknown>;
  rules: { to: string; label: string }[];
  else: string;
}

/** Where a switch input reads from: a node in the same spec, and the path within that node's output. */
function sourceOf(s: unknown): { ref: string; path: string[] } | undefined {
  if (!s || typeof s !== 'object') return undefined;
  const o = s as Record<string, unknown>;
  if (typeof o.ref === 'string' && Array.isArray(o.path)) return { ref: o.ref, path: o.path as string[] };
  return undefined; // list/object/value/concat sources are composed, not a single stubbable node
}

/**
 * Every switch reachable from a spec, including those inside graph-bound calls. `nested` resolves a
 * call's handler to the spec it runs, so the walk does not need the compiler's private caches.
 */
export function switchesOf(
  spec: { nodes: Record<string, unknown> },
  nested: (handler: string) => { nodes: Record<string, unknown> } | undefined,
  prefix: string[] = [],
  seen = new Set<string>(),
  via: string[] = [],
  fromTriggerIn = true,
  lists: FoundList[] = [],
): FoundSwitch[] {
  const out: FoundSwitch[] = [];
  for (const [id, raw] of Object.entries(spec.nodes)) {
    const n = raw as Record<string, unknown>;
    if (n.kind === 'switch') {
      out.push({ at: [...prefix, id].join('.'), prefix, node: n as unknown as KSwitchLike, via, fromTriggerIn, lists });
      continue;
    }
    const handler = typeof n.handler === 'string' ? n.handler : undefined;
    if (!handler || seen.has(handler)) continue;
    const sub = nested(handler);
    if (!sub) continue;
    const here = [...prefix, id].join('.');
    // a handler is walked once per branch position; recursion through the same handler would not terminate
    if (n.kind === 'map') {
      // the operation runs once per element, each under the element's index; the first element stands for all,
      // and what it receives is the element, never the trigger's input
      out.push(
        ...switchesOf(sub, nested, [...prefix, id, '0'], new Set([...seen, handler]), [...via, here], false, [
          ...lists,
          { at: here, over: n.over, fromTriggerIn },
        ]),
      );
      continue;
    }
    out.push(
      ...switchesOf(
        sub,
        nested,
        [...prefix, id],
        new Set([...seen, handler]),
        [...via, here],
        fromTriggerIn && forwardsIn(n),
        lists,
      ),
    );
  }
  return out;
}

/**
 * What it takes for a mapped operation to run at all: its list holds at least one element. A demand on the
 * trigger's input when the list is read from it, a stub of the node it is read from otherwise; nothing when
 * the list is composed or literal, since a literal list is already what it is.
 */
export function nonEmpty(
  list: FoundList,
  generated: (nodePath: string) => unknown,
  typeOf: (nodePath: string) => Type | undefined,
  seed: number,
  inputSeed?: unknown,
  inType?: Type,
): { stubs: Record<string, unknown>; input: { path: string[]; value: unknown }[] } {
  const src = sourceOf(list.over);
  const want: Domain = { minLen: 1, present: true };
  if (!src) return { stubs: {}, input: [] };
  if (src.ref === 'in') {
    if (!list.fromTriggerIn) return { stubs: {}, input: [] };
    return {
      stubs: {},
      input: [
        { path: src.path, value: satisfy(want, getPath(inputSeed, src.path), typeAtPath(inType, src.path), seed) },
      ],
    };
  }
  if (src.ref === 'request' || src.ref === 'const') return { stubs: {}, input: [] };
  const prefix = list.at.split('.').slice(0, -1);
  const target = [...prefix, src.ref].join('.');
  const base = generated(target);
  return {
    stubs: {
      [target]: setPath(
        base,
        src.path,
        satisfy(want, getPath(base, src.path), typeAtPath(typeOf(target), src.path), seed),
      ),
    },
    input: [],
  };
}

/** Does this call hand its callee the caller's `in` untouched, field for field? Then the trigger's input still reaches inside. */
function forwardsIn(n: Record<string, unknown>): boolean {
  const given = n.in as Record<string, unknown> | undefined;
  if (!given || typeof given !== 'object') return false;
  return Object.entries(given).every(([k, v]) => {
    const src = v as { ref?: string; path?: string[] } | undefined;
    return src?.ref === 'in' && Array.isArray(src.path) && src.path.length === 1 && src.path[0] === k;
  });
}

/**
 * The rehearsal cases for one switch: one per rule plus the else, each with the stubs that steer the run
 * into that branch. `generated` answers what the seed produced for a node path, so a case only overrides
 * the fields its rule reads.
 */
export function casesFor(
  found: FoundSwitch,
  generated: (nodePath: string) => unknown,
  typeOf: (nodePath: string) => Type | undefined = () => undefined,
  seed = 1,
  inputSeed?: unknown,
  inType?: Type,
): Case[] {
  const { node, prefix } = found;
  const steerable = found.fromTriggerIn ?? !prefix.length;
  const branches = branchesOf(
    node.rules.map(r => ({ when: r.label, to: r.to })),
    node.else,
  );
  return branches.map(branch => {
    const stubs: Record<string, unknown> = {};
    const input: { path: string[]; value: unknown }[] = [];
    const unreachable: string[] = [];
    if (!branch.unsolved) {
      for (const [dotted, domain] of Object.entries(branch.demands)) {
        const [inputName, ...within] = dotted.split('.');
        const src = sourceOf(node.in[inputName]);
        if (!src) {
          unreachable.push(dotted);
          continue;
        }
        // a switch in the top-level graph reading `in` is steered by the trigger's input, not a stub
        if (src.ref === 'in' && steerable) {
          const full = [...src.path, ...within];
          input.push({ path: full, value: satisfy(domain, getPath(inputSeed, full), typeAtPath(inType, full), seed) });
          continue;
        }
        if (src.ref === 'in' || src.ref === 'request' || src.ref === 'const') {
          unreachable.push(dotted);
          continue;
        }
        // an operation met by a delegation lowers to a wrapper spec holding one node `op`, so what the seed recorded for it sits one level deeper
        const direct = [...prefix, src.ref].join('.');
        const target =
          generated(direct) === undefined &&
          !typeOf(direct) &&
          (generated(`${direct}.op`) !== undefined || typeOf(`${direct}.op`))
            ? `${direct}.op`
            : direct;
        const full = [...src.path, ...within];
        const base = target in stubs ? stubs[target] : generated(target);
        const want = satisfy(domain, getPath(base, full), typeAtPath(typeOf(target), full), seed);
        stubs[target] = setPath(base, full, want);
      }
    }
    return {
      at: found.at,
      branch,
      stubs,
      ...(input.length ? { input } : {}),
      ...(unreachable.length ? { unreachable } : {}),
    };
  });
}

/** The declared type at a path within a node's output type, as far as the type system can follow it. */
function typeAtPath(t: Type | undefined, path: string[]): Type | undefined {
  if (!t) return undefined;
  // typeAt answers a string when the path cannot be followed into the type
  try {
    const r = typeAt(t, path);
    return typeof r === 'string' ? undefined : r.type;
  } catch {
    return undefined;
  }
}
