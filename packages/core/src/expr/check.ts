/**
 * Type-checking an expression against the node's input types (root = input name). A read through a value
 * that may be missing is refused unless a has() on the left of the same && proved it present:
 * `has(principal) && principal.realm == 'employee'` reads what it proved.
 */
import { BOOLEAN, NUMBER, type Read, STRING, show, type Type, UNKNOWN } from '../types.js';
import { typeAt } from '../values.js';
import { type BinaryOp, type Expr, ExprError, ORDERINGS } from './ast.js';

/** What a switch's inputs are typed as: the type, and whether the value may be missing. */
export type Inputs = Record<string, { type: Type; optional?: boolean }>;

const ORDERABLE = new Set(['number', 'string', 'unknown']);

/** The paths a conjunction proves present: every has(p) reachable through && alone. */
export function provedBy(expr: Expr, out = new Set<string>()): Set<string> {
  if (expr.kind === 'has') out.add(expr.path.join('.'));
  else if (expr.kind === 'bin' && expr.op === '&&') {
    provedBy(expr.left, out);
    provedBy(expr.right, out);
  }
  return out;
}

/** Where along a path a has() proved presence: the longest prefix proved, or 1 (the root alone) when none was. */
function provedFrom(path: string[], proved: Set<string>): number | undefined {
  for (let length = path.length; length >= 1; length--) {
    if (proved.has(path.slice(0, length).join('.'))) return length;
  }
  return undefined;
}

/** Type a path read, counting optionality only past the longest prefix a has() proved present. */
function readAt(path: string[], inputs: Inputs, proved: Set<string>): Read {
  const root = inputs[path[0]];
  if (!root) {
    throw new ExprError(
      `'${path[0]}' is not an input of this node (inputs: ${Object.keys(inputs).join(', ') || 'none'})`,
    );
  }
  const from = provedFrom(path, proved);
  const optional = from === undefined && Boolean(root.optional);
  const start = from ?? 1;
  const base = typeAt(root.type, path.slice(1, start));
  if (typeof base === 'string') throw new ExprError(`${path.join('.')}: ${base}`);
  const read = typeAt(base.type, path.slice(start));
  if (typeof read === 'string') throw new ExprError(`${path.join('.')}: ${read}`);
  return { type: read.type, optional: optional || read.optional };
}

/** Type-check against the node's input types. Answers the expression's type. */
export function check(expr: Expr, inputs: Inputs, proved = new Set<string>()): Type {
  switch (expr.kind) {
    case 'lit':
      return literalType(expr.value);
    case 'has':
      readAt(expr.path, inputs, proved);
      return BOOLEAN;
    case 'path':
      return pathType(expr.path, inputs, proved);
    case 'len': {
      const arg = check(expr.arg, inputs, proved);
      if (arg.kind !== 'list' && arg.kind !== 'string')
        throw new ExprError(`len() takes a list or string, not ${show(arg)}`);
      return NUMBER;
    }
    case 'not': {
      const arg = check(expr.arg, inputs, proved);
      if (arg.kind !== 'boolean') throw new ExprError(`! takes a boolean, not ${show(arg)}`);
      return BOOLEAN;
    }
    case 'bin':
      return binaryType(expr.op, expr, inputs, proved);
  }
}

function literalType(value: string | number | boolean): Type {
  if (typeof value === 'string') return STRING;
  return typeof value === 'number' ? NUMBER : BOOLEAN;
}

function pathType(path: string[], inputs: Inputs, proved: Set<string>): Type {
  const read = readAt(path, inputs, proved);
  if (read.optional)
    throw new ExprError(`${path.join('.')} may be missing -- guard it with has(${path.join('.')}) first`);
  return read.type;
}

function binaryType(op: BinaryOp, expr: Extract<Expr, { kind: 'bin' }>, inputs: Inputs, proved: Set<string>): Type {
  // what the left of an && proves present, the right may read
  const left = check(expr.left, inputs, proved);
  const right = check(expr.right, inputs, op === '&&' ? new Set([...proved, ...provedBy(expr.left)]) : proved);
  if (op === '&&' || op === '||') {
    if (left.kind !== 'boolean' || right.kind !== 'boolean') throw new ExprError(`${op} takes booleans`);
    return BOOLEAN;
  }
  if (op === 'in') return membershipType(left, right);
  return comparisonType(op, left, right);
}

/** `x in list`: the list's element type must be x's, and x must be a scalar. */
function membershipType(left: Type, right: Type): Type {
  if (right.kind !== 'list' && right.kind !== 'unknown')
    throw new ExprError(`in looks into a list, not ${show(right)}`);
  const of = right.kind === 'list' ? right.of : UNKNOWN;
  if (!(left.kind === of.kind || left.kind === 'unknown' || of.kind === 'unknown')) {
    throw new ExprError(`a ${show(left)} is never in ${show(right)}`);
  }
  if (left.kind === 'object' || left.kind === 'list') throw new ExprError(`in looks for a scalar, not ${show(left)}`);
  return BOOLEAN;
}

/** Equality compares scalars of one kind; an ordering compares numbers or strings. */
function comparisonType(op: BinaryOp, left: Type, right: Type): Type {
  const same = left.kind === right.kind || left.kind === 'unknown' || right.kind === 'unknown';
  if (!same) throw new ExprError(`cannot compare ${show(left)} with ${show(right)}`);
  const ordering = (ORDERINGS as readonly string[]).includes(op);
  if (ordering && !ORDERABLE.has(left.kind)) throw new ExprError(`${op} orders numbers or strings, not ${show(left)}`);
  if (!ordering && (left.kind === 'object' || left.kind === 'list'))
    throw new ExprError(`${op} compares scalars, not ${show(left)}`);
  return BOOLEAN;
}
