import { describe, expect, it } from 'vitest';
import { Kernel, Refusal, refusalOf } from '../src/index.js';
import type { KernelSpec } from '../src/index.js';

const handlers = {
  double: async ({ in: i }: { in: Record<string, unknown> }) => Number(i.x) * 2,
  boom: async () => { throw new Error('boom'); },
  refuse: async ({ in: i }: { in: Record<string, unknown> }) => { throw new Refusal(String(i.reason), `no ${i.what}`); },
  echo: async ({ in: i }: { in: Record<string, unknown> }) => i,
  sleepOrBoom: async ({ in: i }: { in: Record<string, unknown> }) => {
    await new Promise(res => setTimeout(res, Number(i.ms)));
    if (i.tag === 'boom') throw new Error('boom');
    return i.tag;
  },
  sleep: async ({ in: i }: { in: Record<string, unknown> }) => {
    await new Promise(res => setTimeout(res, Number(i.ms)));
    return i.tag;
  },
};

describe('kernel', () => {
  it('runs ready nodes, routes, cancels the other branch, answers the first settled candidate', async () => {
    const spec: KernelSpec = {
      name: 't', output: ['big', 'small'],
      nodes: {
        route: { kind: 'switch', in: { x: { ref: 'in', path: ['x'] } }, rules: [{ when: v => Number(v.x) > 10, to: 'big', label: 'x > 10' }], else: 'small' },
        big: { kind: 'call', handler: 'double', in: { x: { ref: 'in', path: ['x'] } } },
        small: { kind: 'call', handler: 'echo', in: { x: { ref: 'in', path: ['x'] } } },
      },
    };
    const r = await new Kernel(handlers).run(spec, { initial: { in: { x: 21 } } });
    expect(r.status).toBe('done'); expect(r.output).toBe(42);
    expect(r.nodes.small.status).toBe('cancelled'); expect(r.nodes.route.selected).toBe('big');
  });
  it('reports blocked with needs when an input is never supplied', async () => {
    const spec: KernelSpec = { name: 't', output: ['a'], nodes: { a: { kind: 'call', handler: 'double', in: { x: { ref: 'in', path: ['x'] } } } } };
    const r = await new Kernel(handlers).run(spec, {});
    expect(r.status).toBe('blocked'); expect(r.needs).toEqual(['in.x']);
  });
  it('replays a seeded node without calling its handler', async () => {
    const spec: KernelSpec = { name: 't', output: ['b'], nodes: { a: { kind: 'call', handler: 'boom', in: {} }, b: { kind: 'call', handler: 'double', in: { x: { ref: 'a', path: [] } } } } };
    const r = await new Kernel(handlers).run(spec, { initial: { a: 5 } });
    expect(r.status).toBe('done'); expect(r.output).toBe(10); expect(r.nodes.a.status).toBe('seeded');
  });
  it('runs independent nodes concurrently: three sleeps take the longest, not the sum', async () => {
    const spec: KernelSpec = {
      name: 't', output: ['join'],
      nodes: {
        slow: { kind: 'call', handler: 'sleep', in: { ms: { value: 1000 }, tag: { value: 'slow' } } },
        quick: { kind: 'call', handler: 'sleep', in: { ms: { value: 500 }, tag: { value: 'quick' } } },
        mid: { kind: 'call', handler: 'sleep', in: { ms: { value: 800 }, tag: { value: 'mid' } } },
        join: { kind: 'call', handler: 'echo', in: { a: { ref: 'slow', path: [] }, b: { ref: 'quick', path: [] }, c: { ref: 'mid', path: [] } } },
      },
    };
    const began = Date.now();
    const r = await new Kernel(handlers).run(spec, {});
    const elapsed = Date.now() - began;
    expect(r.status).toBe('done');
    expect(r.output).toEqual({ a: 'slow', b: 'quick', c: 'mid' });
    // The sum is 2300ms; concurrent, the graph is bounded by its longest node.
    expect(elapsed).toBeGreaterThanOrEqual(1000);
    expect(elapsed).toBeLessThan(1500);
    // The report is the evidence: all three were in flight at once.
    const started = ['slow', 'quick', 'mid'].map(id => r.nodes[id].startedAt!);
    expect(Math.max(...started) - Math.min(...started)).toBeLessThan(100);
    expect(Math.min(...['slow', 'quick', 'mid'].map(id => r.nodes[id].endedAt!)))
      .toBeLessThan(r.nodes.slow.endedAt!);
    // The dependent node waited for the last of them.
    expect(r.nodes.join.startedAt!).toBeGreaterThanOrEqual(r.nodes.slow.endedAt!);
  });
  it('starts a dependent node as soon as its own dependency settles, not at a round boundary', async () => {
    const spec: KernelSpec = {
      name: 't', output: ['after'],
      nodes: {
        slow: { kind: 'call', handler: 'sleep', in: { ms: { value: 1000 }, tag: { value: 'slow' } } },
        quick: { kind: 'call', handler: 'sleep', in: { ms: { value: 200 }, tag: { value: 'quick' } } },
        after: { kind: 'call', handler: 'echo', in: { of: { ref: 'quick', path: [] } } },
      },
    };
    const r = await new Kernel(handlers).run(spec, {});
    expect(r.status).toBe('done');
    // `after` follows `quick` while `slow` is still in flight.
    expect(r.nodes.after.endedAt!).toBeLessThan(r.nodes.slow.endedAt!);
  });
  it('runs map elements concurrently: the slowest element bounds the node', async () => {
    const spec: KernelSpec = {
      name: 't', output: ['m'],
      nodes: {
        m: {
          kind: 'map', handler: 'sleep', over: { value: [{ ms: 1000, tag: 'a' }, { ms: 500, tag: 'b' }, { ms: 800, tag: 'c' }] },
          in: {}, bind: { ms: ['ms'], tag: ['tag'] }, onItemFailure: 'fail',
        },
      },
    };
    const began = Date.now();
    const r = await new Kernel(handlers).run(spec, {});
    const elapsed = Date.now() - began;
    expect(r.status).toBe('done');
    expect(r.output).toEqual(['a', 'b', 'c']);
    expect(elapsed).toBeGreaterThanOrEqual(1000);
    expect(elapsed).toBeLessThan(1500);
  });
  it('lets in-flight nodes finish when a sibling fails, and cancels only what is still pending', async () => {
    const spec: KernelSpec = {
      name: 't', output: ['after'],
      nodes: {
        slow: { kind: 'call', handler: 'sleep', in: { ms: { value: 600 }, tag: { value: 'slow' } } },
        bad: { kind: 'call', handler: 'boom', in: {} },
        after: { kind: 'call', handler: 'echo', in: { of: { ref: 'slow', path: [] } } },
      },
    };
    const r = await new Kernel(handlers).run(spec, {});
    expect(r.status).toBe('failed');
    // `bad` throws immediately; `slow` was already running and is not aborted.
    expect(r.nodes.slow.status).toBe('done');
    expect(r.nodes.slow.endedAt! - r.nodes.bad.endedAt!).toBeGreaterThan(400);
    // `after` was still pending when the failure landed, so it never ran.
    expect(r.nodes.after.status).toBe('cancelled');
  });
  it('lets every map element settle before a failing map node reports', async () => {
    const spec: KernelSpec = {
      name: 't', output: ['m'],
      nodes: {
        m: {
          kind: 'map', handler: 'sleepOrBoom',
          over: { value: [{ ms: 0, tag: 'boom' }, { ms: 600, tag: 'late' }] },
          in: {}, bind: { ms: ['ms'], tag: ['tag'] }, onItemFailure: 'fail',
        },
      },
    };
    const began = Date.now();
    const r = await new Kernel(handlers).run(spec, {});
    const elapsed = Date.now() - began;
    expect(r.status).toBe('failed');
    expect(r.nodes.m.error).toContain("map 'm' element 0");
    // the slow sibling was awaited rather than abandoned at the first rejection
    expect(elapsed).toBeGreaterThanOrEqual(600);
  });
  it('fails the graph when a node throws and maps concurrently', async () => {
    const spec: KernelSpec = { name: 't', output: ['m'], nodes: { m: { kind: 'map', handler: 'double', over: { value: [1, 2, 3] }, in: {}, bind: { x: [] }, onItemFailure: 'fail' }, z: { kind: 'call', handler: 'boom', in: {} } } };
    const r = await new Kernel(handlers).run(spec, {});
    expect(r.status).toBe('failed'); expect(r.nodes.m.out).toEqual([2, 4, 6]);
  });
  it('a map settles only once every element has, so a failure never cuts the others short', async () => {
    const done: number[] = [];
    const slow = async ({ in: i }: { in: Record<string, unknown> }) => {
      const x = i.x as number;
      await new Promise(r => setTimeout(r, x * 10));
      if (x === 1) throw new Error('first one fails');
      done.push(x); return x;
    };
    const spec: KernelSpec = { name: 't', output: ['m'], nodes: { m: { kind: 'map', handler: 'slow', over: { value: [1, 2, 3] }, in: {}, bind: { x: [] }, onItemFailure: 'fail' } } };
    const r = await new Kernel({ slow }).run(spec, {});
    expect(r.status).toBe('failed');
    expect(r.nodes.m.error).toBe("map 'm' element 0: first one fails");
    // the slower elements finished before the node reported
    expect(done).toEqual([2, 3]);
  });
  it('a failed map reports every element: the ones that answered, their values, and the one that did not', async () => {
    const pick = async ({ in: i }: { in: Record<string, unknown> }) => { if (i.x === 2) throw new Error('two is bad'); return Number(i.x) * 10; };
    const spec: KernelSpec = { name: 't', output: ['m'], nodes: { m: { kind: 'map', handler: 'pick', over: { value: [1, 2, 3] }, in: {}, bind: { x: [] }, onItemFailure: 'fail' } } };
    const r = await new Kernel({ pick }).run(spec, {});
    expect(r.status).toBe('failed');
    expect(r.nodes.m.items!.map(e => [e.status, e.out, e.error])).toEqual([['done', 10, undefined], ['failed', undefined, 'two is bad'], ['done', 30, undefined]]);
    expect(r.nodes.m.items![1]).toMatchObject({ handler: 'pick', in: { x: 2 } });
    expect(r.nodes.m.items!.every(e => e.startedAt! <= e.endedAt!)).toBe(true);
  });
  it('seeds one element of a map from initial, runs the rest, and answers the whole list', async () => {
    const ran: unknown[] = [];
    const pick = async ({ in: i }: { in: Record<string, unknown> }) => { ran.push(i.x); return Number(i.x) * 10; };
    const spec: KernelSpec = { name: 't', output: ['m'], nodes: { m: { kind: 'map', handler: 'pick', over: { value: [1, 2, 3] }, in: {}, bind: { x: [] }, onItemFailure: 'fail' } } };
    // the elements that answered in the failed run above are seeded from its items; only the one that failed runs
    const r = await new Kernel({ pick }).run(spec, { initial: { 'm.0': 10, 'm.2': 30 } });
    expect(ran).toEqual([2]);
    expect(r.status).toBe('done'); expect(r.output).toEqual([10, 20, 30]);
    expect(r.nodes.m.status).toBe('done');
    expect(r.nodes.m.items!.map(e => e.status)).toEqual(['seeded', 'done', 'seeded']);
    expect(r.nodes.m.items![0]).toEqual({ status: 'seeded', out: 10 });
  });
  it('a seeded element counts as its own result under collect too', async () => {
    const spec: KernelSpec = { name: 't', output: ['m'], nodes: { m: { kind: 'map', handler: 'boom', over: { value: ['a', 'b'] }, in: {}, onItemFailure: 'collect' } } };
    const r = await new Kernel(handlers).run(spec, { initial: { 'm.1': 'kept' } });
    expect(r.status).toBe('done');
    expect(r.output).toEqual([{ ok: false, error: 'boom' }, { ok: true, value: 'kept' }]);
    expect(r.nodes.m.items!.map(e => e.status)).toEqual(['failed', 'seeded']);
  });
  it('a handler that refuses records its reason on the node, and refusalOf answers it; a fault has none', async () => {
    const spec: KernelSpec = { name: 't', output: ['a'], nodes: { a: { kind: 'call', handler: 'refuse', in: { reason: { value: 'missing' }, what: { value: 'entry 7' } } } } };
    const r = await new Kernel(handlers).run(spec, {});
    expect(r.status).toBe('failed');
    expect(r.nodes.a).toMatchObject({ status: 'failed', reason: 'missing', error: 'no entry 7' });
    expect(refusalOf(r)).toEqual({ reason: 'missing', message: 'no entry 7' });
    const fault = await new Kernel(handlers).run({ name: 't', output: ['a'], nodes: { a: { kind: 'call', handler: 'boom', in: {} } } }, {});
    expect(fault.nodes.a.reason).toBeUndefined();
    expect(refusalOf(fault)).toBeUndefined();
  });
  it('a map element that refuses refuses the map with its reason; an element that breaks is the map\'s fault', async () => {
    const over = { value: [{ reason: 'missing', what: 'a' }, { reason: 'conflict', what: 'b' }] };
    const spec: KernelSpec = { name: 't', output: ['m'], nodes: { m: { kind: 'map', handler: 'refuse', over, in: {}, bind: { reason: ['reason'], what: ['what'] }, onItemFailure: 'fail' } } };
    const r = await new Kernel(handlers).run(spec, {});
    expect(r.nodes.m.items?.map(e => e.reason)).toEqual(['missing', 'conflict']);
    expect(refusalOf(r)).toEqual({ reason: 'missing', message: 'no a' });
    const broke = await new Kernel(handlers).run({ name: 't', output: ['m'], nodes: { m: { kind: 'map', handler: 'boom', over: { value: [1] }, in: {}, onItemFailure: 'fail' } } }, {});
    expect(refusalOf(broke)).toBeUndefined();
    expect(broke.nodes.m.error).toBe("map 'm' element 0: boom");
  });
});
