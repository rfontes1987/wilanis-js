/**
 * The one runner of the suite, and its only test file. Every `fitness/*.fitness.ts` is a module -- it exports
 * `claim`, `gather`, `judge` and `sabotage`, and registers nothing -- so this file is where a claim becomes a
 * test: it loads them all, eagerly, and gives each two. The claim, titled with its sentence, judges what was
 * gathered and expects no violation. The proof, "<claim> bites", feeds the judge every sabotage case and
 * expects the violation it names, since a fitness function that has never failed is unproved. "One claim, one
 * test, one proof" then holds for every file by construction, with no central file of proofs to grow.
 */
import { basename } from 'node:path';
import { expect, it } from 'vitest';

/** One proof that a judge bites: an input that violates the claim, and the violation it must name. */
interface Sabotage<Gathered> {
  input: Gathered;
  violation: string;
}

/** What every fitness module exports: the sentence, the reading, the judgement, and the proof. */
interface Fitness<Gathered> {
  claim: string;
  gather: () => Gathered;
  judge: (gathered: Gathered) => string[];
  sabotage: Sabotage<Gathered>[];
}

const found = import.meta.glob<Record<string, unknown>>('./*.fitness.ts', { eager: true });

/** Whether a loaded module exports the four names a fitness module owes, so the runner may run it. */
function isFitness(module: Record<string, unknown>): module is Record<string, unknown> & Fitness<unknown> {
  const { claim, gather, judge, sabotage } = module;
  const callable = typeof gather === 'function' && typeof judge === 'function';
  return typeof claim === 'string' && callable && Array.isArray(sabotage);
}

it('the suite holds at least one claim', () => {
  expect(Object.keys(found).length).toBeGreaterThan(0);
});

for (const path of Object.keys(found).sort()) {
  const module = found[path] ?? {};
  const file = `fitness/${basename(path)}`;
  if (!isFitness(module)) {
    it(`${file} is a fitness module`, () => {
      expect.fail(`${file} exports no claim, gather, judge and sabotage; a fitness module exports all four`);
    });
    continue;
  }
  it(module.claim, () => {
    expect(module.judge(module.gather()), `see ${file}`).toEqual([]);
  });
  it(`${module.claim} bites`, () => {
    expect(module.sabotage.length, `see ${file}`).toBeGreaterThan(0);
    for (const { input, violation } of module.sabotage) {
      expect(module.judge(input), `see ${file}`).toContain(violation);
    }
  });
}
