/**
 * The one runner of the suite. Every `fitness/*.fitness.ts` is a module -- it exports `claim`, `gather` and
 * `judge` and registers nothing -- so this file is the only place a claim becomes a test: it loads them all,
 * eagerly, and gives each one test, titled with the claim, asserting that judging what was gathered leaves no
 * violation. "One claim, one test" then holds for every file by construction. That a fitness module holds no
 * `describe` and no `it` is also why `fitness/sabotage.test.ts` may import a judge by name: nothing it
 * imports is a test file, so no claim re-runs under the sabotage file's name.
 */
import { basename } from 'node:path';
import { expect, it } from 'vitest';

/** What every fitness module exports: the sentence, the reading of the repository, and the judgement. */
interface Fitness<Gathered> {
  claim: string;
  gather: () => Gathered;
  judge: (gathered: Gathered) => string[];
}

const found = import.meta.glob<Record<string, unknown>>('./*.fitness.ts', { eager: true });

/** Whether a loaded module exports the three names a fitness module owes, so the runner may run it. */
function isFitness(module: Record<string, unknown>): module is Record<string, unknown> & Fitness<unknown> {
  const { claim, gather, judge } = module;
  return typeof claim === 'string' && typeof gather === 'function' && typeof judge === 'function';
}

it('the suite holds at least one claim', () => {
  expect(Object.keys(found).length).toBeGreaterThan(0);
});

for (const path of Object.keys(found).sort()) {
  const module = found[path] ?? {};
  const file = basename(path);
  if (!isFitness(module)) {
    it(`fitness/${file} is a fitness module`, () => {
      expect.fail(`fitness/${file} exports no claim, gather and judge; a fitness module exports all three`);
    });
    continue;
  }
  it(module.claim, () => {
    expect(module.judge(module.gather()), `see fitness/${file}`).toEqual([]);
  });
}
