/**
 * Every fitness function, handed a minimal input that violates its claim. A fitness function that has never
 * failed is unproved: it may be reading the wrong directory, or judging nothing at all, and the suite would
 * still be green. So each claim's `judge` gets a violating input here and the violation it names is expected.
 * The judges are imported by name and nothing re-runs, because a fitness module is a module: it exports
 * `claim`, `gather` and `judge`, and registers no test of its own. One `describe` per fitness function.
 */
import { describe, expect, it } from 'vitest';
import { judge } from './a-fitness-function-is-one-claim.fitness.js';

const HEADER = ['Claim: a claim', 'Why: a reason', 'Retire when: a condition'];
const EXPORTS = "export const claim = 'a claim';\nexport function gather() {}\nexport function judge() {}\n";
const FILE = 'fitness/a-claim.fitness.ts';

/** A fitness module's text, from its header lines and the body that follows them. */
function fileText(header: string[], body = EXPORTS): string {
  return `/**\n${header.map(line => ` * ${line}`).join('\n')}\n */\n${body}`;
}

describe('a fitness function is one claim', () => {
  it('names a missing header line', () => {
    const faults = judge([{ file: FILE, text: fileText(['Claim: a claim', 'Why: a reason']) }]);
    expect(faults).toEqual([
      `${FILE} has no Retire when: in its header; open the file with Claim, Why and Retire when`,
    ]);
  });

  it('names a header written out of order', () => {
    const header = ['Why: a reason', 'Claim: a claim', 'Retire when: a condition'];
    expect(judge([{ file: FILE, text: fileText(header) }])).toEqual([
      `${FILE} orders its header Why:, Claim:, Retire when:; write Claim, then Why, then Retire when`,
    ]);
  });

  it('names the exports a fitness module owes the runner', () => {
    const body = "export const claim = 'a claim';\n";
    expect(judge([{ file: FILE, text: fileText(HEADER, body) }])).toEqual([
      `${FILE} exports no gather, judge; a fitness module exports claim, gather and judge`,
    ]);
  });

  it('names a claim that registers its own test', () => {
    const body = `${EXPORTS}describe('fitness', () => {});\n`;
    expect(judge([{ file: FILE, text: fileText(HEADER, body) }])).toEqual([
      `${FILE} registers its own test; a fitness module holds no describe and no it`,
    ]);
  });

  it('names an exported claim that is not the stated one', () => {
    const body = "export const claim = 'something else';\nexport function gather() {}\nexport function judge() {}\n";
    expect(judge([{ file: FILE, text: fileText(HEADER, body) }])).toEqual([
      `${FILE} exports the claim "something else" but its header states "a claim"; make the two one sentence`,
    ]);
  });

  it('names a file not named after its claim', () => {
    const file = 'fitness/named-otherwise.fitness.ts';
    expect(judge([{ file, text: fileText(HEADER) }])).toEqual([
      `${file} states "a claim"; name the file after the claim, as named otherwise is read`,
    ]);
  });

  it('passes a module in the shape it asks for', () => {
    expect(judge([{ file: FILE, text: fileText(HEADER) }])).toEqual([]);
  });
});
