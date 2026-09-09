/** Evaluating an expression over the node's input values, the way the kernel does at run time. */
import type { Comparison, Expr } from './ast.js';
import { parse } from './parse.js';

type Values = Record<string, unknown>;

function readValue(values: Values, path: string[]): unknown {
  let current: unknown = values[path[0]];
  for (const segment of path.slice(1)) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = Array.isArray(current) ? current[Number(segment)] : (current as Values)[segment];
  }
  return current;
}

function compare(op: Comparison, left: never, right: never): boolean {
  switch (op) {
    case '==':
      return left === right;
    case '!=':
      return left !== right;
    case '<':
      return left < right;
    case '<=':
      return left <= right;
    case '>':
      return left > right;
    case '>=':
      return left >= right;
  }
}

function evaluateBinary(expr: Extract<Expr, { kind: 'bin' }>, values: Values): unknown {
  if (expr.op === '&&') return Boolean(evaluate(expr.left, values)) && Boolean(evaluate(expr.right, values));
  if (expr.op === '||') return Boolean(evaluate(expr.left, values)) || Boolean(evaluate(expr.right, values));
  const left = evaluate(expr.left, values) as never;
  const right = evaluate(expr.right, values) as never;
  if (expr.op === 'in') return Array.isArray(right) && (right as unknown[]).includes(left);
  return compare(expr.op, left, right);
}

export function evaluate(expr: Expr, values: Values): unknown {
  switch (expr.kind) {
    case 'lit':
      return expr.value;
    case 'path':
      return readValue(values, expr.path);
    case 'has':
      return readValue(values, expr.path) !== undefined;
    case 'len': {
      const value = evaluate(expr.arg, values);
      return Array.isArray(value) || typeof value === 'string' ? value.length : 0;
    }
    case 'not':
      return !evaluate(expr.arg, values);
    case 'bin':
      return evaluateBinary(expr, values);
  }
}

/** Compile to a predicate for the kernel. */
export function compilePredicate(src: string): (values: Values) => boolean {
  const expr = parse(src);
  return values => Boolean(evaluate(expr, values));
}
