/** Tokens of an expression: numbers, quoted strings, identifiers, and the operators. */
import { ExprError } from './ast.js';

export type Token =
  | { kind: 'num'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'id'; value: string }
  | { kind: 'op'; value: string };

const OPS = ['==', '!=', '<=', '>=', '&&', '||', '<', '>', '!', '(', ')', '.'];
const SPACE = /\s/;
const DIGIT = /[0-9]/;
const NUMBER = /^-?[0-9]+(\.[0-9]+)?/;
const WORD_START = /[A-Za-z_]/;
const WORD = /^[A-Za-z_][A-Za-z0-9_]*/;

/** One token read at a position, and where the next one starts. */
interface Step {
  token: Token;
  next: number;
}

function numberAt(src: string, index: number): Step | undefined {
  const char = src[index];
  const starts = DIGIT.test(char) || (char === '-' && DIGIT.test(src[index + 1] ?? ''));
  const match = starts ? NUMBER.exec(src.slice(index)) : null;
  return match ? { token: { kind: 'num', value: Number(match[0]) }, next: index + match[0].length } : undefined;
}

function stringAt(src: string, index: number): Step | undefined {
  const quote = src[index];
  if (quote !== '"' && quote !== "'") return undefined;
  const end = src.indexOf(quote, index + 1);
  if (end < 0) throw new ExprError(`unterminated string at ${index}`);
  return { token: { kind: 'str', value: src.slice(index + 1, end) }, next: end + 1 };
}

function wordAt(src: string, index: number): Step | undefined {
  const match = WORD_START.test(src[index]) ? WORD.exec(src.slice(index)) : null;
  return match ? { token: { kind: 'id', value: match[0] }, next: index + match[0].length } : undefined;
}

function operatorAt(src: string, index: number): Step {
  const op = OPS.find(candidate => src.startsWith(candidate, index));
  if (!op) throw new ExprError(`unexpected '${src[index]}' at ${index}`);
  return { token: { kind: 'op', value: op }, next: index + op.length };
}

export function lex(src: string): Token[] {
  const out: Token[] = [];
  let index = 0;
  while (index < src.length) {
    if (SPACE.test(src[index])) {
      index++;
      continue;
    }
    const step = numberAt(src, index) ?? stringAt(src, index) ?? wordAt(src, index) ?? operatorAt(src, index);
    out.push(step.token);
    index = step.next;
  }
  return out;
}
