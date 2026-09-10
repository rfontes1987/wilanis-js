import { describe, expect, it } from 'vitest';
import type { KernelSpec } from '../src/index.js';
import { Kernel } from '../src/index.js';
import { handlers } from './handlers.js';

describe('the scheduler', () => {
  it('runs ready nodes, routes, cancels the other branch, answers the first settled candidate', async () => {
    const spec: KernelSpec = {
      name: 't',
      output: ['big', 'small'],
      nodes: {
        route: {
          kind: 'switch',
          in: { x: { ref: 'in', path: ['x'] } },
          rules: [{ when: values => Number(values.x) > 10, to: 'big', label: 'x > 10' }],
          else: 'small',
        },
        big: { kind: 'call', handler: 'double', in: { x: { ref: 'in', path: ['x'] } } },
        small: { kind: 'call', handler: 'echo', in: { x: { ref: 'in', path: ['x'] } } },
      },
    };
    const report = await new Kernel(handlers).run(spec, { initial: { in: { x: 21 } } });
    expect(report.status).toBe('done');
    expect(report.output).toBe(42);
    expect(report.nodes.small.status).toBe('cancelled');
    expect(report.nodes.route.selected).toBe('big');
  });
  it('reports blocked with needs when an input is never supplied', async () => {
    const spec: KernelSpec = {
      name: 't',
      output: ['a'],
      nodes: { a: { kind: 'call', handler: 'double', in: { x: { ref: 'in', path: ['x'] } } } },
    };
    const report = await new Kernel(handlers).run(spec, {});
    expect(report.status).toBe('blocked');
    expect(report.needs).toEqual(['in.x']);
  });
  it('replays a seeded node without calling its handler', async () => {
    const spec: KernelSpec = {
      name: 't',
      output: ['b'],
      nodes: {
        a: { kind: 'call', handler: 'boom', in: {} },
        b: { kind: 'call', handler: 'double', in: { x: { ref: 'a', path: [] } } },
      },
    };
    const report = await new Kernel(handlers).run(spec, { initial: { a: 5 } });
    expect(report.status).toBe('done');
    expect(report.output).toBe(10);
    expect(report.nodes.a.status).toBe('seeded');
  });
  it('runs independent nodes concurrently: three sleeps take the longest, not the sum', async () => {
    const spec: KernelSpec = {
      name: 't',
      output: ['join'],
      nodes: {
        slow: { kind: 'call', handler: 'sleep', in: { ms: { value: 1000 }, tag: { value: 'slow' } } },
        quick: { kind: 'call', handler: 'sleep', in: { ms: { value: 500 }, tag: { value: 'quick' } } },
        mid: { kind: 'call', handler: 'sleep', in: { ms: { value: 800 }, tag: { value: 'mid' } } },
        join: {
          kind: 'call',
          handler: 'echo',
          in: { a: { ref: 'slow', path: [] }, b: { ref: 'quick', path: [] }, c: { ref: 'mid', path: [] } },
        },
      },
    };
    const began = Date.now();
    const report = await new Kernel(handlers).run(spec, {});
    const elapsed = Date.now() - began;
    expect(report.status).toBe('done');
    expect(report.output).toEqual({ a: 'slow', b: 'quick', c: 'mid' });
    // The sum is 2300ms; concurrent, the graph is bounded by its longest node. No lower bound on the
    // elapsed time: `setTimeout` promises the timer's own clock, not `Date.now()`, so a 1000ms sleep can
    // measure 999 and did on CI. What the nodes' own timestamps say below is the evidence either way.
    expect(elapsed).toBeLessThan(1500);
    // The report is the evidence: all three were in flight at once.
    const started = ['slow', 'quick', 'mid'].map(id => report.nodes[id].startedAt!);
    expect(Math.max(...started) - Math.min(...started)).toBeLessThan(100);
    expect(Math.min(...['slow', 'quick', 'mid'].map(id => report.nodes[id].endedAt!))).toBeLessThan(
      report.nodes.slow.endedAt!,
    );
    // The dependent node waited for the last of them.
    expect(report.nodes.join.startedAt!).toBeGreaterThanOrEqual(report.nodes.slow.endedAt!);
  });
  it('starts a dependent node as soon as its own dependency settles, not at a round boundary', async () => {
    const spec: KernelSpec = {
      name: 't',
      output: ['after'],
      nodes: {
        slow: { kind: 'call', handler: 'sleep', in: { ms: { value: 1000 }, tag: { value: 'slow' } } },
        quick: { kind: 'call', handler: 'sleep', in: { ms: { value: 200 }, tag: { value: 'quick' } } },
        after: { kind: 'call', handler: 'echo', in: { of: { ref: 'quick', path: [] } } },
      },
    };
    const report = await new Kernel(handlers).run(spec, {});
    expect(report.status).toBe('done');
    // `after` follows `quick` while `slow` is still in flight.
    expect(report.nodes.after.endedAt!).toBeLessThan(report.nodes.slow.endedAt!);
  });
  it('lets in-flight nodes finish when a sibling fails, and cancels only what is still pending', async () => {
    const spec: KernelSpec = {
      name: 't',
      output: ['after'],
      nodes: {
        slow: { kind: 'call', handler: 'sleep', in: { ms: { value: 600 }, tag: { value: 'slow' } } },
        bad: { kind: 'call', handler: 'boom', in: {} },
        after: { kind: 'call', handler: 'echo', in: { of: { ref: 'slow', path: [] } } },
      },
    };
    const report = await new Kernel(handlers).run(spec, {});
    expect(report.status).toBe('failed');
    // `bad` throws immediately; `slow` was already running and is not aborted.
    expect(report.nodes.slow.status).toBe('done');
    expect(report.nodes.slow.endedAt! - report.nodes.bad.endedAt!).toBeGreaterThan(400);
    // `after` was still pending when the failure landed, so it never ran.
    expect(report.nodes.after.status).toBe('cancelled');
  });
});
