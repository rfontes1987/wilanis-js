/**
 * The table an engine registers itself in. The claim worth pinning is that no order is required of anyone: a
 * tree that names its engine before @storage works exactly as one that names it after, because the table is
 * made by whichever side reaches it first and @storage builds nothing in its own postLoad.
 */
import { describe, expect, it } from 'vitest';
import { engines } from '../src/index.js';
import { FakeEngine } from './fake-engine.js';

const KIND = '@fake/fake.connection-kind.json';

describe('finding the engine that keeps the records', () => {
  it('the table is the same one whichever side reaches it first', () => {
    const engineFirst = {};
    const engine = new FakeEngine();
    engines(engineFirst).register(KIND, engine);
    expect(engines(engineFirst).for(KIND)).toBe(engine);

    const storageFirst = {};
    expect(engines(storageFirst).for(KIND)).toBeUndefined();
    engines(storageFirst).register(KIND, engine);
    expect(engines(storageFirst).for(KIND)).toBe(engine);
  });

  it('one table per environment, so a reload starts clean and two trees never share an engine', () => {
    const one = {};
    const other = {};
    engines(one).register(KIND, new FakeEngine());
    expect(engines(other).for(KIND)).toBeUndefined();
    expect(engines(one).kinds).toEqual([KIND]);
    expect(engines(other).kinds).toEqual([]);
  });

  it('a kind nothing registered for has no engine, whatever else did', () => {
    const env = {};
    engines(env).register(KIND, new FakeEngine());
    expect(engines(env).for('@other/other.connection-kind.json')).toBeUndefined();
  });
});
