/**
 * Every fitness function, handed a minimal input that violates its claim. A fitness function that has never
 * failed is unproved: it may be reading the wrong directory, or judging nothing at all, and the suite would
 * still be green. So each claim's `judge` gets a violating input here and the violation it names is expected.
 * The judges are imported by name and nothing re-runs, because a fitness file is a module: it exports
 * `claim`, `gather` and `judge`, and registers no test of its own. One `describe` per fitness function.
 */
import { describe, expect, it } from 'vitest';
import { judge } from './a-fitness-function-is-one-claim.fitness.js';

const HEADER = ['Claim: a claim', 'Why: a reason', 'Retire when: a condition'];
const EXPORTS = "export const claim = 'a claim';\nexport const gather = () => [];\nexport const judge = () => [];\n";
const FILE = 'fitness/a-claim.fitness.ts';

/** A fitness module's text, from its header lines and the body that follows them. */
function fileText(header: string[], body = EXPORTS): string {
  return `/**\n${header.map(line => ` * ${line}`).join('\n')}\n */\n${body}`;
}

/** What the judge says about one file of the given text. */
function faultsOf(text: string, file = FILE): string[] {
  return judge([{ file, text }]);
}

describe('a fitness function is one claim', () => {
  it('names a missing header line', () => {
    expect(faultsOf(fileText(['Claim: a claim', 'Why: a reason']))).toEqual([
      `${FILE} has no Retire when: in its header; open the file with Claim, Why and Retire when`,
    ]);
  });

  it('names a header written out of order', () => {
    const header = ['Why: a reason', 'Claim: a claim', 'Retire when: a condition'];
    expect(faultsOf(fileText(header))).toEqual([
      `${FILE} orders its header Why:, Claim:, Retire when:; write Claim, then Why, then Retire when`,
    ]);
  });

  it('names the exports a fitness module owes the runner', () => {
    expect(faultsOf(fileText(HEADER, "export const claim = 'a claim';\n"))).toEqual([
      `${FILE} exports no gather, judge; a fitness module exports claim, gather and judge`,
    ]);
  });

  it('names a fourth export, since a module exports exactly three', () => {
    const body = `${EXPORTS}export interface Extra {\n  field: string;\n}\n`;
    expect(faultsOf(fileText(HEADER, body))).toEqual([
      `${FILE} also exports Extra; keep a helper unexported, or move it to fitness/lib/`,
    ]);
  });

  it('names a claim that registers its own test', () => {
    const body = `${EXPORTS}describe('fitness', () => {});\n`;
    expect(faultsOf(fileText(HEADER, body))).toEqual([
      `${FILE} registers its own test; a fitness module holds no describe and no it`,
    ]);
  });

  it('names an exported claim that is not the stated one', () => {
    const body = EXPORTS.replace("'a claim'", "'something else'");
    expect(faultsOf(fileText(HEADER, body))).toEqual([
      `${FILE} exports the claim "something else" but its header states "a claim"; make the two one sentence`,
    ]);
  });

  it('passes a module in the shape it asks for', () => {
    expect(faultsOf(fileText(HEADER))).toEqual([]);
  });
});
