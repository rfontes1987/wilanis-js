/**
 * The one expression grammar, used by switch rules (and list.filter/sort params). Deliberately small and
 * statically typed against the node's inputs: has(path), comparisons, && || !, len(x), literals, paths.
 *
 *   expr := or ; or := and ('||' and)* ; and := unary ('&&' unary)* ; unary := '!' unary | cmp
 *   cmp  := primary (('=='|'!='|'<'|'<='|'>'|'>=') primary)?
 *   primary := number | string | true | false | path | has '(' path ')' | len '(' expr ')' | '(' expr ')'
 */
import { BOOLEAN, NUMBER, STRING, typeAt, show, type Type } from './types.js';

export type Expr =
  | { t: 'lit'; v: string | number | boolean }
  | { t: 'path'; p: string[] }
  | { t: 'has'; p: string[] }
  | { t: 'len'; e: Expr }
  | { t: 'not'; e: Expr }
  | { t: 'bin'; op: '&&' | '||' | '==' | '!=' | '<' | '<=' | '>' | '>='; l: Expr; r: Expr };

type Tok = { k: 'num'; v: number } | { k: 'str'; v: string } | { k: 'id'; v: string } | { k: 'op'; v: string };

const OPS = ['==', '!=', '<=', '>=', '&&', '||', '<', '>', '!', '(', ')', '.'];

export class ExprError extends Error {}

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c) || (c === '-' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^-?[0-9]+(\.[0-9]+)?/.exec(src.slice(i))!; out.push({ k: 'num', v: Number(m[0]) }); i += m[0].length; continue;
    }
    if (c === '"' || c === "'") {
      const end = src.indexOf(c, i + 1);
      if (end < 0) throw new ExprError(`unterminated string at ${i}`);
      out.push({ k: 'str', v: src.slice(i + 1, end) }); i = end + 1; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!; out.push({ k: 'id', v: m[0] }); i += m[0].length; continue;
    }
    const op = OPS.find(o => src.startsWith(o, i));
    if (!op) throw new ExprError(`unexpected '${c}' at ${i}`);
    out.push({ k: 'op', v: op }); i += op.length;
  }
  return out;
}

export function parse(src: string): Expr {
  const toks = lex(src);
  let i = 0;
  const peek = () => toks[i];
  const take = () => toks[i++];
  const isOp = (v: string) => peek()?.k === 'op' && (peek() as { v: string }).v === v;
  const expect = (v: string) => { if (!isOp(v)) throw new ExprError(`expected '${v}' at token ${i} in '${src}'`); i++; };

  const path = (): string[] => {
    const t = take();
    if (!t || t.k !== 'id') throw new ExprError(`expected a path in '${src}'`);
    const p = [t.v];
    while (isOp('.')) { i++; const n = take(); if (!n || (n.k !== 'id' && n.k !== 'num')) throw new ExprError(`bad path in '${src}'`); p.push(String(n.v)); }
    return p;
  };
  const primary = (): Expr => {
    const t = peek();
    if (!t) throw new ExprError(`unexpected end of '${src}'`);
    if (t.k === 'num') { i++; return { t: 'lit', v: t.v }; }
    if (t.k === 'str') { i++; return { t: 'lit', v: t.v }; }
    if (t.k === 'op' && t.v === '(') { i++; const e = or(); expect(')'); return e; }
    if (t.k === 'id') {
      if (t.v === 'true' || t.v === 'false') { i++; return { t: 'lit', v: t.v === 'true' }; }
      if (t.v === 'has' && toks[i + 1]?.k === 'op' && (toks[i + 1] as { v: string }).v === '(') { i += 2; const p = path(); expect(')'); return { t: 'has', p }; }
      if (t.v === 'len' && toks[i + 1]?.k === 'op' && (toks[i + 1] as { v: string }).v === '(') { i += 2; const e = or(); expect(')'); return { t: 'len', e }; }
      return { t: 'path', p: path() };
    }
    throw new ExprError(`unexpected '${(t as { v: unknown }).v}' in '${src}'`);
  };
  const cmp = (): Expr => {
    const l = primary();
    for (const op of ['==', '!=', '<=', '>=', '<', '>'] as const) if (isOp(op)) { i++; return { t: 'bin', op, l, r: primary() }; }
    return l;
  };
  const unary = (): Expr => { if (isOp('!')) { i++; return { t: 'not', e: unary() }; } return cmp(); };
  const and = (): Expr => { let l = unary(); while (isOp('&&')) { i++; l = { t: 'bin', op: '&&', l, r: unary() }; } return l; };
  const or = (): Expr => { let l = and(); while (isOp('||')) { i++; l = { t: 'bin', op: '||', l, r: and() }; } return l; };
  const e = or();
  if (i !== toks.length) throw new ExprError(`trailing tokens in '${src}'`);
  return e;
}

/** Type-check against the node's input types (root = input name). Answers the expression's type. */
export function check(e: Expr, inputs: Record<string, { type: Type; optional?: boolean }>): Type {
  const at = (p: string[]): { type: Type; optional: boolean } => {
    const root = inputs[p[0]];
    if (!root) throw new ExprError(`'${p[0]}' is not an input of this node (inputs: ${Object.keys(inputs).join(', ') || 'none'})`);
    const r = typeAt(root.type, p.slice(1));
    if (typeof r === 'string') throw new ExprError(`${p.join('.')}: ${r}`);
    return { type: r.type, optional: r.optional || Boolean(root.optional) };
  };
  switch (e.t) {
    case 'lit': return typeof e.v === 'string' ? STRING : typeof e.v === 'number' ? NUMBER : BOOLEAN;
    case 'has': at(e.p); return BOOLEAN;
    case 'path': {
      const r = at(e.p);
      if (r.optional) throw new ExprError(`${e.p.join('.')} may be missing -- guard it with has(${e.p.join('.')}) first`);
      return r.type;
    }
    case 'len': { const t = check(e.e, inputs); if (t.kind !== 'list' && t.kind !== 'string') throw new ExprError(`len() takes a list or string, not ${show(t)}`); return NUMBER; }
    case 'not': { const t = check(e.e, inputs); if (t.kind !== 'boolean') throw new ExprError(`! takes a boolean, not ${show(t)}`); return BOOLEAN; }
    case 'bin': {
      const l = check(e.l, inputs), r = check(e.r, inputs);
      if (e.op === '&&' || e.op === '||') {
        if (l.kind !== 'boolean' || r.kind !== 'boolean') throw new ExprError(`${e.op} takes booleans`);
        return BOOLEAN;
      }
      const same = l.kind === r.kind || l.kind === 'unknown' || r.kind === 'unknown';
      if (!same) throw new ExprError(`cannot compare ${show(l)} with ${show(r)}`);
      if ((e.op === '<' || e.op === '<=' || e.op === '>' || e.op === '>=') && !['number', 'string', 'unknown'].includes(l.kind)) throw new ExprError(`${e.op} orders numbers or strings, not ${show(l)}`);
      if ((e.op === '==' || e.op === '!=') && (l.kind === 'object' || l.kind === 'list')) throw new ExprError(`${e.op} compares scalars, not ${show(l)}`);
      return BOOLEAN;
    }
  }
}

function readP(values: Record<string, unknown>, p: string[]): unknown {
  let cur: unknown = values[p[0]];
  for (const seg of p.slice(1)) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = Array.isArray(cur) ? cur[Number(seg)] : (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

export function evaluate(e: Expr, values: Record<string, unknown>): unknown {
  switch (e.t) {
    case 'lit': return e.v;
    case 'path': return readP(values, e.p);
    case 'has': return readP(values, e.p) !== undefined;
    case 'len': { const v = evaluate(e.e, values); return Array.isArray(v) || typeof v === 'string' ? v.length : 0; }
    case 'not': return !evaluate(e.e, values);
    case 'bin': {
      if (e.op === '&&') return Boolean(evaluate(e.l, values)) && Boolean(evaluate(e.r, values));
      if (e.op === '||') return Boolean(evaluate(e.l, values)) || Boolean(evaluate(e.r, values));
      const l = evaluate(e.l, values) as never, r = evaluate(e.r, values) as never;
      switch (e.op) {
        case '==': return l === r; case '!=': return l !== r;
        case '<': return l < r; case '<=': return l <= r; case '>': return l > r; case '>=': return l >= r;
      }
    }
  }
}

/** Compile to a predicate for the kernel. */
export function compilePredicate(src: string): (values: Record<string, unknown>) => boolean {
  const e = parse(src);
  return values => Boolean(evaluate(e, values));
}
