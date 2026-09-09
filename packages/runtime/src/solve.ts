/**
 * From a switch's expressions to the demands a branch makes: each rule solved for what its inputs must hold, and the
 * cases that reach each target -- the rule true and every earlier rule false, plus one case where all are false.
 */
import { expr } from '@wilanis/core';
import { type Branch, type Demands, type Domain, key, type Maybe, narrow, UNSAT } from './domains.js';

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
    case 'bin':
      return e.op === '&&' || e.op === '||' ? group(e, want) : compare(e, want);
  }
}

/**
 * A group: under the operator it reads as, either side alone satisfies it, or both must hold at once -- and where both
 * must hold, every pair of their demands that can be merged is one alternative.
 */
function group(e: expr.Expr & { kind: 'bin' }, want: boolean): Demands[] {
  const together = (e.op === '&&') === want;
  const left = solve(e.left, want);
  const right = solve(e.right, want);
  if (!together) return [...left, ...right];
  const out: Demands[] = [];
  for (const one of left)
    for (const other of right) {
      const merged = merge(one, other);
      if (merged !== UNSAT) out.push(merged);
    }
  return out;
}

const MIRROR = { '<': '>', '<=': '>=', '>': '<', '>=': '<=', '==': '==', '!=': '!=' } as const;
const NEGATE = { '==': '!=', '!=': '==', '<': '>=', '<=': '>', '>': '<=', '>=': '<' } as const;
type Cmp = keyof typeof NEGATE;

/** `lit in path`: the list must hold the literal, or must not. */
function membership(e: expr.Expr & { kind: 'bin' }, want: boolean): Demands[] {
  if (e.left.kind !== 'lit' || e.right.kind !== 'path') return [];
  return [{ [key(e.right.path)]: want ? { has: [e.left.value], present: true } : { lacks: [e.left.value] } }];
}

/** What one comparison demands of the path it names: its length when written under len(), else its value. */
function demandOf(target: expr.Expr, truth: Cmp, lit: unknown): Demands[] {
  // len(path) <op> n constrains the path's length; path <op> lit constrains its value
  if (target.kind === 'len') {
    const inner = target.arg;
    if (inner.kind !== 'path' || typeof lit !== 'number') return [];
    return [{ [key(inner.path)]: lenDomain(truth, lit) }];
  }
  if (target.kind !== 'path') return [];
  return [{ [key(target.path)]: valueDomain(truth, lit) }];
}

/** Solve one comparison. One side must be a literal; comparing two paths has no canonical answer. */
function compare(e: expr.Expr & { kind: 'bin' }, want: boolean): Demands[] {
  // `lit in path`: the list must hold the literal, or must not
  if (e.op === 'in') return membership(e, want);
  const sides: [expr.Expr, expr.Expr] = [e.left, e.right];
  const at = sides.findIndex(side => side.kind === 'lit');
  if (at < 0) return []; // path vs path: unsolvable, no alternatives
  const lit = (sides[at] as expr.Expr & { kind: 'lit' }).value;
  // the operator is written against the left operand; with the literal on the left it mirrors
  const op: Cmp = at === 0 ? MIRROR[e.op as Cmp] : (e.op as Cmp);
  return demandOf(sides[1 - at], want ? op : NEGATE[op], lit);
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
function nameableBin(e: expr.Expr & { kind: 'bin' }): boolean {
  if (e.op === '&&' || e.op === '||') return nameable(e.left) || nameable(e.right);
  if (e.op === 'in') return e.left.kind === 'lit' && e.right.kind === 'path';
  // a comparison names something when one side is a literal and the other a path or len(path)
  const sides = [e.left, e.right];
  const at = sides.findIndex(side => side.kind === 'lit');
  if (at < 0) return false;
  const target = sides[at === 0 ? 1 : 0];
  return target.kind === 'path' || (target.kind === 'len' && target.arg.kind === 'path');
}

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
    case 'bin':
      return nameableBin(e);
  }
}

/**
 * Why a rule could not be solved: no alternatives at all means the expression itself names nothing solvable;
 * alternatives that all contradict mean the rule is either self-contradictory or shadowed by an earlier one.
 */
function whyUnsolved(when: string, found: { nameable: boolean; mine: number; before: number }): string {
  if (!found.nameable) return `'${when}' compares values the rehearsal cannot name`;
  if (!found.mine) return `no inputs satisfy '${when}' -- the rule contradicts itself`;
  if (!found.before) return `the rules before it already cover every input, so '${when}' is unreachable`;
  return `no inputs satisfy '${when}'`;
}

/** Every alternative in which one more rule is false, on top of the alternatives so far. */
function alsoFalse(alternatives: Demands[], rule: expr.Expr): Demands[] {
  const next: Demands[] = [];
  for (const soFar of alternatives)
    for (const negated of solve(rule, false)) {
      const merged = merge(soFar, negated);
      if (merged !== UNSAT) next.push(merged);
    }
  return next;
}

/** Every alternative in which rules [0, upto) are all false. A rule that does not parse cannot be negated. */
function negatedThrough(parsed: (expr.Expr | undefined)[], upto: number): Demands[] {
  let alternatives: Demands[] = [{}];
  for (let at = 0; at < upto; at++) {
    const rule = parsed[at];
    if (!rule) return [];
    alternatives = alsoFalse(alternatives, rule);
    if (!alternatives.length) return [];
  }
  return alternatives;
}

/** The first pairing of one rule's demand with a case where the earlier rules are false that can hold at once. */
function firstBoth(mine: Demands[], before: Demands[]): Demands | undefined {
  for (const demand of mine)
    for (const earlier of before) {
      const merged = merge(demand, earlier);
      if (merged !== UNSAT) return merged;
    }
  return undefined;
}

/** One rule's branch: the case that reaches its target, or why none could be solved. */
function branchFor(
  rule: { when: string; to: string },
  at: number,
  parsed: expr.Expr | undefined,
  before: Demands[],
): Branch {
  const base = { rule: at, when: rule.when, to: rule.to };
  if (!parsed) return { ...base, demands: {}, unsolved: 'the expression does not parse' };
  const mine = solve(parsed, true);
  const hit = firstBoth(mine, before);
  if (hit) return { ...base, demands: hit };
  return {
    ...base,
    demands: {},
    unsolved: whyUnsolved(rule.when, { nameable: nameable(parsed), mine: mine.length, before: before.length }),
  };
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
  const allFalseBefore = (upto: number) => negatedThrough(parsed, upto);
  for (let i = 0; i < rules.length; i++) out.push(branchFor(rules[i], i, parsed[i], allFalseBefore(i)));
  const none = allFalseBefore(rules.length);
  out.push(
    none.length
      ? { rule: -1, when: 'else', to: elseTo, demands: none[0] }
      : { rule: -1, when: 'else', to: elseTo, demands: {}, unsolved: 'no inputs make every rule false at once' },
  );
  return out;
}
