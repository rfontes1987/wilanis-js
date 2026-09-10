/**
 * The one runner of the suite. Every `fitness/*.fitness.ts` is a plain module -- it exports `claim`, `gather`
 * and `judge` and registers nothing -- so this file is the only place a claim becomes a test: it loads them
 * all, eagerly, and gives each one `it`, titled with the claim, asserting that judging what was gathered
 * leaves no violation. That a fitness module holds no `describe` and no `it` is also why
 * `fitness/sabotage.test.ts` may import every judge by name: nothing it imports is a test file, so no claim
 * re-runs under the sabotage file's name.
 */
import { describe, expect, it } from 'vitest';

/** What every fitness module exports: the sentence, the reading of the repository, and the judgement. */
interface Fitness<Gathered> {
  claim: string;
  gather: () => Gathered;
  judge: (gathered: Gathered) => string[];
}

const modules = import.meta.glob<Record<string, unknown>>('./*.fitness.ts', { eager: true });

/** Whether a loaded module exports the three names a fitness module owes, so the runner may run it. */
function isFitness(module: Record<string, unknown>): module is Record<string, unknown> & Fitness<unknown> {
  const { claim, gather, judge } = module;
  return typeof claim === 'string' && typeof gather === 'function' && typeof judge === 'function';
}

describe('fitness', () => {
  const files = Object.keys(modules).sort();

  it('the suite holds at least one claim', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const module = modules[file] ?? {};
    if (!isFitness(module)) {
      it(`${file} is a fitness module`, () => {
        expect.fail(`${file} exports no claim, gather and judge; a fitness module exports all three`);
      });
      continue;
    }
    it(module.claim, () => {
      const hint = `${file} says why it holds and when to retire it; the edit goes to the code, not to fitness/`;
      expect(module.judge(module.gather()), hint).toEqual([]);
    });
  }
});
