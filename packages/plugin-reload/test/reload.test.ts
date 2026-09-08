import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Serving } from '@wilanis/core';
import plugin from '../src/index.js';

/** A stand-in for what the runtime hands a `holds` operation: it records the reloads it was asked for. */
function serving(answer: () => Awaited<ReturnType<Serving['reload']>>) {
  const dir = mkdtempSync(join(tmpdir(), 'wilanis-reload-'));
  const logs: string[] = [];
  let reloads = 0;
  const held: { label: string; stop: () => Promise<void> }[] = [];
  const env = {
    plugins: { '@reload': {} },
    hold: (what: { label: string; stop: () => Promise<void> }) => { held.push(what); },
    serving: { root: dir, log: (s: string) => logs.push(s), reload: async () => { reloads++; return answer(); } } as unknown as Serving,
  };
  return { dir, logs, held, env, reloads: () => reloads };
}

const watch = (env: unknown, i: Record<string, unknown> = {}) =>
  plugin.handlers['@reload/watch.port.json#watch']({ in: i, ctx: { env, nodePath: [], attach: () => {} } } as never);

/** Wait for a condition the watcher settles into, rather than a fixed sleep. */
const until = async (ok: () => boolean, ms = 2000) => {
  const end = Date.now() + ms;
  while (!ok() && Date.now() < end) await new Promise(r => setTimeout(r, 10));
  return ok();
};

describe('watching a tree', () => {
  it('holds the watcher, answers what it watches, and closes it on stop', async () => {
    const s = serving(() => ({ ok: true, documents: 3 }));
    const answer = await watch(s.env);
    expect(answer).toEqual({ watching: s.dir });
    expect(s.held).toHaveLength(1);
    expect(s.held[0].label).toContain(s.dir);
    expect(s.logs.join('\n')).toMatch(/watching/);
    await s.held[0].stop(); // closing twice would throw; the teardown is the only one
  });

  it('serves the tree again when a document changes', async () => {
    const s = serving(() => ({ ok: true, documents: 42 }));
    await watch(s.env, { debounceMs: 10 });
    writeFileSync(join(s.dir, 'thing.json'), '{}');
    expect(await until(() => s.reloads() > 0)).toBe(true);
    expect(await until(() => s.logs.some(l => /42 documents/.test(l)))).toBe(true);
    await s.held[0].stop();
  });

  it('keeps the last good tree when the change does not pass the check', async () => {
    const s = serving(() => ({ ok: false, refusals: 'G003  broken.graph.json' }));
    await watch(s.env, { debounceMs: 10 });
    writeFileSync(join(s.dir, 'thing.json'), '{}');
    expect(await until(() => s.logs.some(l => /refused/.test(l)))).toBe(true);
    expect(s.logs.join('\n')).toMatch(/still serving the last good tree/);
    expect(s.logs.join('\n')).toMatch(/G003/);
    await s.held[0].stop();
  });

  it('ignores what is not a document', async () => {
    const s = serving(() => ({ ok: true, documents: 1 }));
    await watch(s.env, { debounceMs: 10 });
    writeFileSync(join(s.dir, 'notes.txt'), 'not a document');
    await new Promise(r => setTimeout(r, 120));
    expect(s.reloads()).toBe(0);
    await s.held[0].stop();
  });

  it('refuses to run anywhere but a startup list', async () => {
    await expect(watch({ plugins: {} })).rejects.toThrow(/startup list/);
  });
});
