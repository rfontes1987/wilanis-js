import { describe, expect, it } from 'vitest';
import type { KernelSpec } from '../src/index.js';
import { Kernel, refusalOf } from '../src/index.js';
import { handlers } from './handlers.js';

describe('a refusal', () => {
  it('a handler that refuses records its reason on the node, and refusalOf answers it; a fault has none', async () => {
    const spec: KernelSpec = {
      name: 't',
      output: ['a'],
      nodes: {
        a: { kind: 'call', handler: 'refuse', in: { reason: { value: 'missing' }, what: { value: 'entry 7' } } },
      },
    };
    const report = await new Kernel(handlers).run(spec, {});
    expect(report.status).toBe('failed');
    expect(report.nodes.a).toMatchObject({ status: 'failed', reason: 'missing', error: 'no entry 7' });
    expect(refusalOf(report)).toEqual({ reason: 'missing', message: 'no entry 7' });
    const fault = await new Kernel(handlers).run(
      { name: 't', output: ['a'], nodes: { a: { kind: 'call', handler: 'boom', in: {} } } },
      {},
    );
    expect(fault.nodes.a.reason).toBeUndefined();
    expect(refusalOf(fault)).toBeUndefined();
  });
  it('a refusal may carry detail beside its words -- a challenge id, how to answer -- and refusalOf hands it on, through a map too', async () => {
    const detail = { value: { challenge: { id: 'K7Q2' }, how: 'again with --code' } };
    const spec: KernelSpec = {
      name: 't',
      output: ['a'],
      nodes: {
        a: { kind: 'call', handler: 'refuse', in: { reason: { value: 'otp' }, what: { value: 'code' }, detail } },
      },
    };
    const report = await new Kernel(handlers).run(spec, {});
    expect(report.nodes.a.detail).toEqual({ challenge: { id: 'K7Q2' }, how: 'again with --code' });
    expect(refusalOf(report)).toEqual({
      reason: 'otp',
      message: 'no code',
      detail: { challenge: { id: 'K7Q2' }, how: 'again with --code' },
    });
    const over = { value: [{ reason: 'otp', what: 'code', detail: { challenge: { id: 'X' } } }] };
    const mapped = await new Kernel(handlers).run(
      {
        name: 't',
        output: ['m'],
        nodes: {
          m: {
            kind: 'map',
            handler: 'refuse',
            over,
            in: {},
            bind: { reason: ['reason'], what: ['what'], detail: ['detail'] },
            onItemFailure: 'fail',
          },
        },
      },
      {},
    );
    expect(refusalOf(mapped)).toEqual({ reason: 'otp', message: 'no code', detail: { challenge: { id: 'X' } } });
  });
  it("a map element that refuses refuses the map with its reason; an element that breaks is the map's fault", async () => {
    const over = {
      value: [
        { reason: 'missing', what: 'a' },
        { reason: 'conflict', what: 'b' },
      ],
    };
    const spec: KernelSpec = {
      name: 't',
      output: ['m'],
      nodes: {
        m: {
          kind: 'map',
          handler: 'refuse',
          over,
          in: {},
          bind: { reason: ['reason'], what: ['what'] },
          onItemFailure: 'fail',
        },
      },
    };
    const report = await new Kernel(handlers).run(spec, {});
    expect(report.nodes.m.items?.map(element => element.reason)).toEqual(['missing', 'conflict']);
    expect(refusalOf(report)).toEqual({ reason: 'missing', message: 'no a' });
    const broke = await new Kernel(handlers).run(
      {
        name: 't',
        output: ['m'],
        nodes: { m: { kind: 'map', handler: 'boom', over: { value: [1] }, in: {}, onItemFailure: 'fail' } },
      },
      {},
    );
    expect(refusalOf(broke)).toBeUndefined();
    expect(broke.nodes.m.error).toBe("map 'm' element 0: boom");
  });
});
