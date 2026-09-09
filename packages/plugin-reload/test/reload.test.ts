import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Serving } from '@wilanis/core';
import { describe, expect, it } from 'vitest';
import plugin from '../src/index.js';

/** A stand-in for what the runtime hands a `holds` operation: it records the reloads it was asked for. */
function serving(answer: () => Awaited<ReturnType<Serving['reload']>>) {
  const dir = mkdtempSync(join(tmpdir(), 'wilanis-reload-'));
  const logs: string[] = [];
  let reloads = 0;
  const held: { label: string; stop: () => Promise<void> }[] = [];
  const env = {
    plugins: { '@reload': {} },
    hold: (what: { label: string; stop: () => Promise<void> }) => {
      held.push(what);
    },
    serving: {
      root: dir,
      log: (line: string) => logs.push(line),
      reload: async () => {
        reloads++;
        return answer();
      },
    } as unknown as Serving,
  };
  return { dir, logs, held, env, reloads: () => reloads };
}

const watch = (env: unknown, inputs: Record<string, unknown> = {}) =>
  plugin.handlers['@reload/watch.port.json#watch']({
    in: inputs,
    ctx: { env, nodePath: [], attach: () => {} },
  } as never);

const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));

/** Wait for a condition the watcher settles into, rather than a fixed sleep. */
const until = async (ok: () => boolean, ms = 2000) => {
  const end = Date.now() + ms;
  while (!ok() && Date.now() < end) await sleep(10);
  return ok();
};

/** Waits until some line the tree logged matches, so a test never nests a predicate inside a wait. */
const logged = (watcher: { logs: string[] }, pattern: RegExp) =>
  until(() => watcher.logs.some(line => pattern.test(line)));

describe('watching a tree', () => {
  it('holds the watcher, answers what it watches, and closes it on stop', async () => {
    const watcher = serving(() => ({ ok: true, documents: 3 }));
    const answer = await watch(watcher.env);
    expect(answer).toEqual({ watching: watcher.dir });
    expect(watcher.held).toHaveLength(1);
    expect(watcher.held[0].label).toContain(watcher.dir);
    expect(watcher.logs.join('\n')).toMatch(/watching/);
    await watcher.held[0].stop(); // closing twice would throw; the teardown is the only one
  });

  it('serves the tree again when a document changes', async () => {
    const watcher = serving(() => ({ ok: true, documents: 42 }));
    await watch(watcher.env, { debounceMs: 10 });
    writeFileSync(join(watcher.dir, 'thing.json'), '{}');
    expect(await until(() => watcher.reloads() > 0)).toBe(true);
    expect(await logged(watcher, /42 documents/)).toBe(true);
    await watcher.held[0].stop();
  });

  it('keeps the last good tree when the change does not pass the check', async () => {
    const watcher = serving(() => ({ ok: false, refusals: 'G003  broken.graph.json' }));
    await watch(watcher.env, { debounceMs: 10 });
    writeFileSync(join(watcher.dir, 'thing.json'), '{}');
    expect(await logged(watcher, /refused/)).toBe(true);
    expect(watcher.logs.join('\n')).toMatch(/still serving the last good tree/);
    expect(watcher.logs.join('\n')).toMatch(/G003/);
    await watcher.held[0].stop();
  });

  it('ignores what is not a document', async () => {
    const watcher = serving(() => ({ ok: true, documents: 1 }));
    await watch(watcher.env, { debounceMs: 10 });
    writeFileSync(join(watcher.dir, 'notes.txt'), 'not a document');
    await sleep(120);
    expect(watcher.reloads()).toBe(0);
    await watcher.held[0].stop();
  });

  it('refuses to run anywhere but a startup list', async () => {
    await expect(watch({ plugins: {} })).rejects.toThrow(/startup list/);
  });
});
