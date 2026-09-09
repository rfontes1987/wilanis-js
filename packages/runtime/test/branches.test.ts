import { describe, expect, it } from 'vitest';
import { type Branch, branchesOf, satisfy } from '../src/branches.js';

/** The demands of one case, by the node it routes to. */
const to = (bs: Branch[], target: string) => bs.find(b => b.to === target)!;

describe('solving a switch to its branches', () => {
  it('gives one case per rule and one for the else', () => {
    const bs = branchesOf(
      [
        { when: 'a == 1', to: 'x' },
        { when: 'a == 2', to: 'y' },
      ],
      'z',
    );
    expect(bs.map(b => b.to)).toEqual(['x', 'y', 'z']);
    expect(bs.map(b => b.rule)).toEqual([0, 1, -1]);
  });

  it('solves the example rule: an equality and a presence together', () => {
    const bs = branchesOf([{ when: 'status == 200 && has(body)', to: 'rows' }], 'failed');
    expect(to(bs, 'rows').demands).toEqual({ status: { eq: 200, present: true }, body: { present: true } });
    // the else needs only the equality to fail; body may be anything
    expect(to(bs, 'failed').demands).toEqual({ status: { ne: [200] } });
  });

  it('narrows a later rule against the rules before it', () => {
    const bs = branchesOf(
      [
        { when: 'n > 10', to: 'big' },
        { when: 'n > 5', to: 'mid' },
      ],
      'small',
    );
    expect(to(bs, 'mid').demands).toEqual({ n: { gt: 5, present: true, lte: 10 } });
    expect(to(bs, 'small').demands).toEqual({ n: { lte: 5, present: true } });
  });

  it('treats a missing path as satisfying an inequality', () => {
    const bs = branchesOf(
      [
        { when: 'kind == "urgent"', to: 'a' },
        { when: '!has(kind)', to: 'b' },
      ],
      'c',
    );
    expect(to(bs, 'b').demands.kind.absent).toBe(true);
  });

  it('solves len() to a length rather than a value', () => {
    const bs = branchesOf([{ when: 'len(rows) > 50', to: 'page' }], 'whole');
    expect(to(bs, 'page').demands).toEqual({ rows: { minLen: 51, present: true } });
    expect(to(bs, 'whole').demands).toEqual({ rows: { maxLen: 50, present: true } });
  });

  it('takes one side of a disjunction', () => {
    const bs = branchesOf([{ when: 'status == 200 || status == 201', to: 'ok' }], 'bad');
    expect(to(bs, 'ok').demands.status.eq).toBe(200);
    expect(to(bs, 'bad').demands.status.ne).toEqual([200, 201]);
  });

  it('reports a rule shadowed by an earlier one as uncovered', () => {
    const bs = branchesOf(
      [
        { when: 'status >= 200', to: 'rows' },
        { when: 'status == 200', to: 'also' },
      ],
      'failed',
    );
    expect(to(bs, 'also').unsolved).toMatch(/no inputs satisfy/);
  });

  it('reports a self-contradictory rule as uncovered', () => {
    const bs = branchesOf([{ when: 'n > 10 && n < 5', to: 'never' }], 'always');
    expect(to(bs, 'never').unsolved).toMatch(/contradicts itself/);
  });

  it('reports a comparison of two paths as unnameable', () => {
    const bs = branchesOf([{ when: 'a == b', to: 'same' }], 'diff');
    expect(to(bs, 'same').unsolved).toMatch(/cannot name/);
  });
});

describe('turning a demand into a value', () => {
  it('keeps what the seed generated when it already satisfies the demand', () => {
    expect(satisfy({ gt: 100, present: true }, 200)).toBe(200);
    expect(satisfy({ ne: [200] }, 404)).toBe(404);
  });
  it('replaces a value the demand excludes', () => {
    expect(satisfy({ eq: 201, present: true }, 500)).toBe(201);
  });
  it('excludes a status with a failure, not with the next success code', () => {
    // 201 satisfies != 200 arithmetically, but a branch testing the error path must not see a success
    expect(satisfy({ ne: [200] }, 200)).toBe(500);
    expect(satisfy({ ne: [200] }, 201)).toBe(500);
    expect(satisfy({ ne: [201] }, undefined)).toBe(500);
  });
  it('deletes the key for an absence', () => {
    expect(satisfy({ absent: true }, 'anything')).toBeUndefined();
  });
  it('pads a list out to a demanded length', () => {
    expect(satisfy({ minLen: 3, present: true }, ['a'])).toHaveLength(3);
    expect(satisfy({ maxLen: 1, present: true }, ['a', 'b', 'c'])).toHaveLength(1);
  });
  it('generates a value of the declared type for a bare presence', () => {
    const list = satisfy({ present: true }, undefined, { kind: 'list', of: { kind: 'string' } });
    expect(Array.isArray(list)).toBe(true);
  });
  it('replaces an empty list for a presence, which reads as present but breaks its readers', () => {
    const list = satisfy({ present: true }, [], { kind: 'list', of: { kind: 'string' } }) as unknown[];
    expect(list.length).toBeGreaterThan(0);
  });
});
