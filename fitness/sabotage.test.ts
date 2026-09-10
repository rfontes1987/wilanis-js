/**
 * Every fitness function, handed a minimal input that violates its claim. A fitness function that has never
 * failed is unproved: it may be reading the wrong directory, or judging nothing at all, and the suite would
 * still be green. So each claim's exported judge gets a violating input here, and the violation it names is
 * expected. One `it` per fitness function, in the order the directory lists them.
 */
import { describe, expect, it } from 'vitest';
import { judge } from './a-fitness-function-is-one-claim.judge.js';

const HEADER = ['Claim: a claim', 'Why: a reason', 'Retire when: a condition'];

/** A fitness file's text, from its three header lines and the `it` titles it holds. */
function fileText(header: string[], titles: string[]): string {
  const lines = header.map(line => ` * ${line}`).join('\n');
  const blocks = titles.map(title => `  it('${title}', () => {});`).join('\n');
  return `/**\n${lines}\n */\nimport { describe, it } from 'vitest';\n\ndescribe('fitness', () => {\n${blocks}\n});\n`;
}

describe('sabotage', () => {
  it('a fitness function is one claim: a missing header line is named', () => {
    const text = fileText(['Claim: a claim', 'Why: a reason'], ['a claim']);
    const faults = judge([{ file: 'fitness/a-claim.fitness.ts', text }]);
    expect(faults).toEqual([
      'fitness/a-claim.fitness.ts has no Retire when: in its header; open the file with Claim, Why and Retire when',
    ]);
  });

  it('a fitness function is one claim: a header out of order is named', () => {
    const text = fileText(['Why: a reason', 'Claim: a claim', 'Retire when: a condition'], ['a claim']);
    const faults = judge([{ file: 'fitness/a-claim.fitness.ts', text }]);
    expect(faults).toEqual([
      'fitness/a-claim.fitness.ts orders its header Why:, Claim:, Retire when:; write Claim, then Why, then Retire when',
    ]);
  });

  it('a fitness function is one claim: a second it is named as a second decision', () => {
    const text = fileText(HEADER, ['a claim', 'another claim']);
    const faults = judge([{ file: 'fitness/a-claim.fitness.ts', text }]);
    expect(faults).toEqual([
      'fitness/a-claim.fitness.ts holds 2 it blocks; a fitness function is one claim, so split or join the file',
    ]);
  });

  it('a fitness function is one claim: a title that is not the claim is named', () => {
    const text = fileText(HEADER, ['something else']);
    const faults = judge([{ file: 'fitness/a-claim.fitness.ts', text }]);
    expect(faults).toEqual([
      'fitness/a-claim.fitness.ts titles its it "something else" but claims "a claim"; make the two one sentence',
    ]);
  });

  it('a fitness function is one claim: a name that is not the claim is named', () => {
    const text = fileText(HEADER, ['a claim']);
    const faults = judge([{ file: 'fitness/named-otherwise.fitness.ts', text }]);
    expect(faults).toEqual([
      'fitness/named-otherwise.fitness.ts claims "a claim"; name the file after the claim, as named otherwise is read',
    ]);
  });

  it('a fitness function is one claim: the suite as it stands is clean', () => {
    const text = fileText(HEADER, ['a claim']);
    expect(judge([{ file: 'fitness/a-claim.fitness.ts', text }])).toEqual([]);
  });
});
