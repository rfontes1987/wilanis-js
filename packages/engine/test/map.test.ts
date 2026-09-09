import { describe, expect, it } from 'vitest';
import type { KernelSpec } from '../src/index.js';
import { Kernel } from '../src/index.js';
import { handlers } from './handlers.js';

describe('a map node', () => {
  it('runs map elements concurrently: the slowest element bounds the node', async () => {
    const spec: KernelSpec = {
      name: 't',
      output: ['m'],
      nodes: {
        m: {
          kind: 'map',
          handler: 'sleep',
          over: {
            value: [
              { ms: 1000, tag: 'a' },
              { ms: 500, tag: 'b' },
              { ms: 800, tag: 'c' },
            ],
          },
          in: {},
          bind: { ms: ['ms'], tag: ['tag'] },
          onItemFailure: 'fail',
        },
      },
    };
    const began = Date.now();
    const report = await new Kernel(handlers).run(spec, {});
    const elapsed = Date.now() - began;
    expect(report.status).toBe('done');
    expect(report.output).toEqual(['a', 'b', 'c']);
    expect(elapsed).toBeGreaterThanOrEqual(1000);
    expect(elapsed).toBeLessThan(1500);
  });
  it('lets every map element settle before a failing map node reports', async () => {
    const spec: KernelSpec = {
      name: 't',
      output: ['m'],
      nodes: {
        m: {
          kind: 'map',
          handler: 'sleepOrBoom',
          over: {
            value: [
              { ms: 0, tag: 'boom' },
              { ms: 600, tag: 'late' },
            ],
          },
          in: {},
          bind: { ms: ['ms'], tag: ['tag'] },
          onItemFailure: 'fail',
        },
      },
    };
    const began = Date.now();
    const report = await new Kernel(handlers).run(spec, {});
    const elapsed = Date.now() - began;
    expect(report.status).toBe('failed');
    expect(report.nodes.m.error).toContain("map 'm' element 0");
    // the slow sibling was awaited rather than abandoned at the first rejection
    expect(elapsed).toBeGreaterThanOrEqual(600);
  });
  it('fails the graph when a node throws and maps concurrently', async () => {
    const spec: KernelSpec = {
      name: 't',
      output: ['m'],
      nodes: {
        m: {
          kind: 'map',
          handler: 'double',
          over: { value: [1, 2, 3] },
          in: {},
          bind: { x: [] },
          onItemFailure: 'fail',
        },
        z: { kind: 'call', handler: 'boom', in: {} },
      },
    };
    const report = await new Kernel(handlers).run(spec, {});
    expect(report.status).toBe('failed');
    expect(report.nodes.m.out).toEqual([2, 4, 6]);
  });
  it('a map settles only once every element has, so a failure never cuts the others short', async () => {
    const done: number[] = [];
    const slow = async ({ in: input }: { in: Record<string, unknown> }) => {
      const size = input.x as number;
      await new Promise(resolve => setTimeout(resolve, size * 10));
      if (size === 1) throw new Error('first one fails');
      done.push(size);
      return size;
    };
    const spec: KernelSpec = {
      name: 't',
      output: ['m'],
      nodes: {
        m: { kind: 'map', handler: 'slow', over: { value: [1, 2, 3] }, in: {}, bind: { x: [] }, onItemFailure: 'fail' },
      },
    };
    const report = await new Kernel({ slow }).run(spec, {});
    expect(report.status).toBe('failed');
    expect(report.nodes.m.error).toBe("map 'm' element 0: first one fails");
    // the slower elements finished before the node reported
    expect(done).toEqual([2, 3]);
  });
  it('a failed map reports every element: the ones that answered, their values, and the one that did not', async () => {
    const pick = async ({ in: input }: { in: Record<string, unknown> }) => {
      if (input.x === 2) throw new Error('two is bad');
      return Number(input.x) * 10;
    };
    const spec: KernelSpec = {
      name: 't',
      output: ['m'],
      nodes: {
        m: { kind: 'map', handler: 'pick', over: { value: [1, 2, 3] }, in: {}, bind: { x: [] }, onItemFailure: 'fail' },
      },
    };
    const report = await new Kernel({ pick }).run(spec, {});
    expect(report.status).toBe('failed');
    expect(report.nodes.m.items!.map(element => [element.status, element.out, element.error])).toEqual([
      ['done', 10, undefined],
      ['failed', undefined, 'two is bad'],
      ['done', 30, undefined],
    ]);
    expect(report.nodes.m.items![1]).toMatchObject({ handler: 'pick', in: { x: 2 } });
    expect(report.nodes.m.items!.every(element => element.startedAt! <= element.endedAt!)).toBe(true);
  });
  it('seeds one element of a map from initial, runs the rest, and answers the whole list', async () => {
    const ran: unknown[] = [];
    const pick = async ({ in: input }: { in: Record<string, unknown> }) => {
      ran.push(input.x);
      return Number(input.x) * 10;
    };
    const spec: KernelSpec = {
      name: 't',
      output: ['m'],
      nodes: {
        m: { kind: 'map', handler: 'pick', over: { value: [1, 2, 3] }, in: {}, bind: { x: [] }, onItemFailure: 'fail' },
      },
    };
    // the elements that answered in the failed run above are seeded from its items; only the one that failed runs
    const report = await new Kernel({ pick }).run(spec, { initial: { 'm.0': 10, 'm.2': 30 } });
    expect(ran).toEqual([2]);
    expect(report.status).toBe('done');
    expect(report.output).toEqual([10, 20, 30]);
    expect(report.nodes.m.status).toBe('done');
    expect(report.nodes.m.items!.map(element => element.status)).toEqual(['seeded', 'done', 'seeded']);
    expect(report.nodes.m.items![0]).toEqual({ status: 'seeded', out: 10 });
  });
  it('a seeded element counts as its own result under collect too', async () => {
    const spec: KernelSpec = {
      name: 't',
      output: ['m'],
      nodes: { m: { kind: 'map', handler: 'boom', over: { value: ['a', 'b'] }, in: {}, onItemFailure: 'collect' } },
    };
    const report = await new Kernel(handlers).run(spec, { initial: { 'm.1': 'kept' } });
    expect(report.status).toBe('done');
    expect(report.output).toEqual([
      { ok: false, error: 'boom' },
      { ok: true, value: 'kept' },
    ]);
    expect(report.nodes.m.items!.map(element => element.status)).toEqual(['failed', 'seeded']);
  });
});
