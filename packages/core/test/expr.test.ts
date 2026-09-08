import { describe, expect, it } from 'vitest';
import { check, evaluate, parse, ExprError } from '../src/expr.js';
import { BOOLEAN, STRING, type Type } from '../src/types.js';

const principal: Type = { kind: 'object', fields: { realm: { type: STRING, required: true }, roles: { type: { kind: 'list', of: STRING }, required: true } }, open: false };

describe('membership', () => {
  it('parses `x in list`, types it boolean, and evaluates it against the list', () => {
    const e = parse("'admin' in p.roles");
    expect(check(e, { p: { type: principal } })).toEqual(BOOLEAN);
    expect(evaluate(e, { p: { roles: ['admin', 'x'] } })).toBe(true);
    expect(evaluate(e, { p: { roles: ['x'] } })).toBe(false);
    expect(evaluate(e, { p: {} })).toBe(false);
  });
  it('refuses a non-list on the right and a value that could never be in the list', () => {
    expect(() => check(parse("'a' in p.realm"), { p: { type: principal } })).toThrow(ExprError);
    expect(() => check(parse('1 in p.roles'), { p: { type: principal } })).toThrow(/never in/);
  });
  it('keeps `in` as an input name: in.x is a path, `in` after a value is the operator', () => {
    const e = parse("'admin' in in.roles");
    expect(check(e, { in: { type: principal } })).toEqual(BOOLEAN);
    expect(evaluate(e, { in: { roles: ['admin'] } })).toBe(true);
  });
});

describe('what has() proves', () => {
  it('a read through a value that may be missing is refused alone, and allowed to the right of the has() that proved it', () => {
    const inputs = { p: { type: principal, optional: true } };
    expect(() => check(parse("p.realm == 'employee'"), inputs)).toThrow(/may be missing/);
    expect(check(parse("has(p) && p.realm == 'employee'"), inputs)).toEqual(BOOLEAN);
    expect(check(parse("has(p) && 'admin' in p.roles"), inputs)).toEqual(BOOLEAN);
    // an || proves nothing: either side may be the one that held
    expect(() => check(parse("has(p) || p.realm == 'employee'"), inputs)).toThrow(/may be missing/);
    // and the proof does not travel leftward
    expect(() => check(parse("p.realm == 'employee' && has(p)"), inputs)).toThrow(/may be missing/);
  });
});
