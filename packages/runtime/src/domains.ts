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
  if (d.has && d.lacks && d.has.some(x => d.lacks?.some(y => JSON.stringify(x) === JSON.stringify(y)))) return UNSAT;
  // an exact value must survive every bound and exclusion gathered for the path
  if (d.absent && (d.eq !== undefined || d.present || d.truthy || d.minLen !== undefined)) return UNSAT;
  if (d.eq !== undefined && !fits(d.eq, d)) return UNSAT;
  if (d.eq === undefined && emptyRange(d)) return UNSAT;
  if (d.minLen !== undefined && d.maxLen !== undefined && d.minLen > d.maxLen) return UNSAT;
  return d;
}

/** Whether a concrete value satisfies a domain's bounds and exclusions. */
export function fits(v: unknown, d: Domain): boolean {
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
