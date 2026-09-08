import { describe, expect, it } from 'vitest';
import { Kernel } from '../src/index.js';
import type { KernelSpec } from '../src/index.js';

const handlers = {
  double: async ({ in: i }: { in: Record<string, unknown> }) => Number(i.x) * 2,
  boom: async () => { throw new Error('boom'); },
  echo: async ({ in: i }: { in: Record<string, unknown> }) => i,
};

describe('kernel', () => {
  it('runs ready nodes, routes, cancels the other branch, answers the first settled candidate', async () => {
    const spec: KernelSpec = {
      name: 't', output: ['big', 'small'],
      nodes: {
        route: { kind: 'switch', in: { x: { ref: 'in', path: ['x'] } }, rules: [{ when: v => Number(v.x) > 10, to: 'big', label: 'x > 10' }], else: 'small' },
        big: { kind: 'call', handler: 'double', in: { x: { ref: 'in', path: ['x'] } }, params: {} },
        small: { kind: 'call', handler: 'echo', in: { x: { ref: 'in', path: ['x'] } }, params: {} },
      },
    };
    const r = await new Kernel(handlers).run(spec, { initial: { in: { x: 21 } } });
    expect(r.status).toBe('done'); expect(r.output).toBe(42);
    expect(r.nodes.small.status).toBe('cancelled'); expect(r.nodes.route.selected).toBe('big');
  });
  it('reports blocked with needs when an input is never supplied', async () => {
    const spec: KernelSpec = { name: 't', output: ['a'], nodes: { a: { kind: 'call', handler: 'double', in: { x: { ref: 'in', path: ['x'] } }, params: {} } } };
    const r = await new Kernel(handlers).run(spec, {});
    expect(r.status).toBe('blocked'); expect(r.needs).toEqual(['in.x']);
  });
  it('replays a seeded node without calling its handler', async () => {
    const spec: KernelSpec = { name: 't', output: ['b'], nodes: { a: { kind: 'call', handler: 'boom', in: {}, params: {} }, b: { kind: 'call', handler: 'double', in: { x: { ref: 'a', path: [] } }, params: {} } } };
    const r = await new Kernel(handlers).run(spec, { initial: { a: 5 } });
    expect(r.status).toBe('done'); expect(r.output).toBe(10); expect(r.nodes.a.status).toBe('seeded');
  });
  it('fails the graph when a node throws and maps concurrently', async () => {
    const spec: KernelSpec = { name: 't', output: ['m'], nodes: { m: { kind: 'map', handler: 'double', over: { value: [1, 2, 3] }, in: {}, bind: { x: [] }, params: {}, onItemFailure: 'fail' }, z: { kind: 'call', handler: 'boom', in: {}, params: {} } } };
    const r = await new Kernel(handlers).run(spec, {});
    expect(r.status).toBe('failed'); expect(r.nodes.m.out).toEqual([2, 4, 6]);
  });
});
