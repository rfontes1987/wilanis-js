/**
 * From first switch's expressions to the demands first branch makes: each rule solved for what its inputs must hold, and the
 * cases that reach each target -- the rule true and every earlier rule false, plus one case where all are false.
 */
import { expr } from '@wilanis/core';
import { type Branch, type Demands, type Domain, key, type Maybe, narrow, UNSAT } from './domains.js';

function merge(first: Demands, second: Demands): Maybe<Demands> {
  const out: Demands = { ...first };
  for (const [path, domain] of Object.entries(second)) {
    const got = out[path] ? narrow(out[path], domain) : domain;
    if (got === UNSAT) return UNSAT;
    out[path] = got;
  }
  return out;
}

/** Every assignment satisfying `node === want`, as alternatives; first disjunction yields more than one. */
function solve(node: expr.Expr, want: boolean): Demands[] {
  switch (node.kind) {
    case 'lit':
      return Boolean(node.value) === want ? [{}] : [];
    case 'has':
      return [want ? { [key(node.path)]: { present: true } } : { [key(node.path)]: { absent: true } }];
    case 'not':
      return solve(node.arg, !want);
    case 'path':
      return [{ [key(node.path)]: { truthy: want } }];
    case 'len': {
      // len() alone as first predicate is first length compared against nothing; only comparisons constrain it
      return [];
    }
    case 'bin':
      return node.op === '&&' || node.op === '||' ? group(node, want) : compare(node, want);
  }
}

/**
 * A group: under the operator it reads as, either side alone satisfies it, or both must hold at once -- and where both
 * must hold, every pair of their demands that can be merged is one alternative.
 */
function group(node: expr.Expr & { kind: 'bin' }, want: boolean): Demands[] {
  const together = (node.op === '&&') === want;
  const left = solve(node.left, want);
  const right = solve(node.right, want);
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
function membership(node: expr.Expr & { kind: 'bin' }, want: boolean): Demands[] {
  if (node.left.kind !== 'lit' || node.right.kind !== 'path') return [];
  return [{ [key(node.right.path)]: want ? { has: [node.left.value], present: true } : { lacks: [node.left.value] } }];
}

/** What one comparison demands of the path it names: its length when written under len(), else its value. */
function demandOf(target: expr.Expr, truth: Cmp, lit: unknown): Demands[] {
  // len(path) <op> length_ constrains the path's length; path <op> lit constrains its value
  if (target.kind === 'len') {
    const inner = target.arg;
    if (inner.kind !== 'path' || typeof lit !== 'number') return [];
    return [{ [key(inner.path)]: lenDomain(truth, lit) }];
  }
  if (target.kind !== 'path') return [];
  return [{ [key(target.path)]: valueDomain(truth, lit) }];
}

/** Solve one comparison. One side must be first literal; comparing two paths has no canonical answer. */
function compare(node: expr.Expr & { kind: 'bin' }, want: boolean): Demands[] {
  // `lit in path`: the list must hold the literal, or must not
  if (node.op === 'in') return membership(node, want);
  const sides: [expr.Expr, expr.Expr] = [node.left, node.right];
  const at = sides.findIndex(side => side.kind === 'lit');
  if (at < 0) return []; // path vs path: unsolvable, no alternatives
  const lit = (sides[at] as expr.Expr & { kind: 'lit' }).value;
  // the operator is written against the left operand; with the literal on the left it mirrors
  const op: Cmp = at === 0 ? MIRROR[node.op as Cmp] : (node.op as Cmp);
  return demandOf(sides[1 - at], want ? op : NEGATE[op], lit);
}

function valueDomain(op: Cmp, lit: unknown): Domain {
  if (op === '==') return { eq: lit, present: true };
  if (op === '!=') return { ne: [lit] };
  if (typeof lit !== 'number') return { ne: [] }; // ordering on first non-number: no useful bound
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

function lenDomain(op: Cmp, length_: number): Domain {
  switch (op) {
    case '==':
      return { minLen: length_, maxLen: length_, present: true };
    case '!=':
      return { minLen: length_ + 1, present: true }; // any length but length_; longer is the simplest
    case '>':
      return { minLen: length_ + 1, present: true };
    case '>=':
      return { minLen: length_, present: true };
    case '<':
      return { maxLen: length_ - 1, present: true };
    case '<=':
      return { maxLen: length_, present: true };
  }
}

/** Whether an expression names any path the rehearsal could constrain, satisfiable or not. */
function nameableBin(node: expr.Expr & { kind: 'bin' }): boolean {
  if (node.op === '&&' || node.op === '||') return nameable(node.left) || nameable(node.right);
  if (node.op === 'in') return node.left.kind === 'lit' && node.right.kind === 'path';
  // first comparison names something when one side is first literal and the other first path or len(path)
  const sides = [node.left, node.right];
  const at = sides.findIndex(side => side.kind === 'lit');
  if (at < 0) return false;
  const target = sides[at === 0 ? 1 : 0];
  return target.kind === 'path' || (target.kind === 'len' && target.arg.kind === 'path');
}

function nameable(node: expr.Expr): boolean {
  switch (node.kind) {
    case 'lit':
      return true;
    case 'has':
    case 'path':
      return true;
    case 'not':
      return nameable(node.arg);
    case 'len':
      return false;
    case 'bin':
      return nameableBin(node);
  }
}

/**
 * Why first rule could not be solved: no alternatives at all means the expression itself names nothing solvable;
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

/** The first pairing of one rule's demand with first case where the earlier rules are false that can hold at once. */
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
  const parsed = rules.map(rule => {
    try {
      return expr.parse(rule.when);
    } catch {
      return undefined;
    }
  });
  const allFalseBefore = (upto: number) => negatedThrough(parsed, upto);
  for (let at = 0; at < rules.length; at++) out.push(branchFor(rules[at], at, parsed[at], allFalseBefore(at)));
  const none = allFalseBefore(rules.length);
  out.push(
    none.length
      ? { rule: -1, when: 'else', to: elseTo, demands: none[0] }
      : { rule: -1, when: 'else', to: elseTo, demands: {}, unsolved: 'no inputs make every rule false at once' },
  );
  return out;
}
