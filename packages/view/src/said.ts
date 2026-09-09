/**
 * A switch condition said in words: `status == 200 && has(body)` becomes `if status is 200` / `and body exists`, one
 * line per clause of the top-level `&&` (or `||`) chain, so a reader sees the decision without reading the expression.
 */
import { expr } from '@wilanis/core';
import type { VSaid, VSaidPart } from './types.js';

/**
 * A switch condition said in words, one line per clause of its top-level `&&` (or `||`) chain:
 * `status == 200 && has(body)` → `if status is 200` / `and body exists`. Undefined when it does not parse.
 */
export function said(when: string): VSaid[] | undefined {
  let node: expr.Expr;
  try {
    node = expr.parse(when);
  } catch {
    return undefined;
  }
  const top = node.kind === 'bin' && (node.op === '&&' || node.op === '||') ? node.op : '&&';
  const join = top === '&&' ? 'and' : 'or';
  const chain = (part: expr.Expr): expr.Expr[] =>
    part.kind === 'bin' && part.op === top ? [...chain(part.left), ...chain(part.right)] : [part];
  const lead = (index: number) => (index === 0 ? 'if' : join);
  return chain(node).map((part, index) => ({ lead: lead(index), parts: clause(part, false) }));
}

const VERB: Record<string, [string, string]> = {
  '==': ['is', 'is not'],
  '!=': ['is not', 'is'],
  '<': ['is below', 'is at least'],
  '<=': ['is at most', 'is above'],
  '>': ['is above', 'is at most'],
  '>=': ['is at least', 'is below'],
};

/**
 * A comparison or a group in words. A nested group reads inline; under a `!` it flips (De Morgan) so the verbs
 * stay positive.
 */
function binary(node: Extract<expr.Expr, { kind: 'bin' }>, negate: boolean): VSaidPart[] {
  if (node.op !== '&&' && node.op !== '||')
    return [...clause(node.left, false), { text: ` ${VERB[node.op][negate ? 1 : 0]} ` }, ...clause(node.right, false)];
  const both = (node.op === '&&') !== negate;
  return [
    { text: both ? 'both ' : 'either ' },
    ...clause(node.left, negate),
    { text: both ? ' and ' : ' or ' },
    ...clause(node.right, negate),
  ];
}

/** One clause in words; `negate` says the clause sits under a `!`, which is folded into the verb. */
function clause(node: expr.Expr, negate: boolean): VSaidPart[] {
  const path = (segments: string[]): VSaidPart => ({ input: segments[0], text: segments.join(' › ') });
  switch (node.kind) {
    case 'lit':
      return [{ value: JSON.stringify(negate ? !node.value : node.value) }];
    case 'path':
      return negate ? [{ text: 'not ' }, path(node.path)] : [path(node.path)];
    case 'has':
      return [path(node.path), { text: negate ? ' is missing' : ' exists' }];
    case 'not':
      return clause(node.arg, !negate);
    case 'len':
      return [{ text: 'the size of ' }, ...clause(node.arg, false)];
    case 'bin':
      return binary(node, negate);
  }
}
