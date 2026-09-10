/**
 * Claim: a fitness function is one claim.
 * Why: a decision record that holds two decisions is two records filed in one place, and a reader who trips
 *   one of them reads the other's reason. `CLAUDE.md` asks the same of a rule family and of an RFC: one file
 *   per thing decided. So every `fitness/*.fitness.ts` opens with Claim, Why and Retire when, in that order,
 *   and holds exactly one `it`, whose title is the claim the file name spells in kebab case.
 * Retire when: a decision is recorded somewhere other than a test file, and an RFC says where. Until then a
 *   file that needs a second `it` is two decisions, and the edit is a second file, not a longer test.
 */
import { describe, expect, it } from 'vitest';
import { judge } from './a-fitness-function-is-one-claim.judge.js';
import { fitnessFiles, textOf } from './lib/sources.js';

describe('fitness', () => {
  it('a fitness function is one claim', () => {
    const files = fitnessFiles().map(file => ({ file, text: textOf(file) }));
    const hint = 'a decision is one file: Claim, Why, Retire when, and one it titled with the claim';
    expect(judge(files), hint).toEqual([]);
  });
});
