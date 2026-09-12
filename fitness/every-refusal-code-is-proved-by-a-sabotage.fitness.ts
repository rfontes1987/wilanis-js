/**
 * Claim: every refusal code is proved by a sabotage.
 * Why: `CLAUDE.md` tells anyone adding a rule to "add a sabotage test in
 *   `packages/runtime/test/example.test.ts` that breaks the example and expects the code", and that was a
 *   sentence: 18 codes were produced under `src/` and named by no test, so 18 rules could have been deleted
 *   with the suite still green. A rule nobody would notice the loss of is not a guarantee, and the tests
 *   that prove the others are what makes the checker's refusals mean anything. This is the `sabotage` rule
 *   of RFC 0027 -- "a fitness function that has never failed is unproved" -- asked of the checker, whose
 *   unit of behaviour is the code, not the line.
 * Retire when: a refusal is proved somewhere other than a test that names its code, and an RFC says where.
 *   A code that no tree can reach is not an exemption: it is a rule to delete, which is what this claim asks
 *   for when it names one.
 */
import { entriesUnder, packageDirs, sourceFiles, textOf } from './lib/sources.js';

const CODE = /'[A-Z]\d{3}'/g;

/**
 * Where a test may prove a code: the suite beside every package, and the tree under `libraries/`. Derived
 * rather than listed, because a plugin that has rules of its own proves them in its own test directory --
 * RFC 0002 puts `@storage`'s X rules there -- so a list would need editing for each new plugin, and editing
 * this file is meant to be a change of decision rather than a consequence of adding a package.
 */
const suites = () => [...packageDirs().map(dir => `${dir}/test`), 'libraries/access/test'];

/** The claim this module holds, and the title the runner gives its test. */
export const claim = 'every refusal code is proved by a sabotage';

/** Every code produced under a package's `src`, and every code a test names, each as a bare code. */
export const gather = () => ({
  made: [
    ...new Set(packageDirs().flatMap(dir => sourceFiles(`${dir}/src`).flatMap(file => codesIn(textOf(file))))),
  ].sort(),
  named: [
    ...new Set(suites().flatMap(dir => entriesUnder(dir, ['.test.ts']).flatMap(file => codesIn(textOf(file))))),
  ].sort(),
});

/** Every code a rule produces that no test expects, one sentence each, naming the code and the fix. */
export const judge = ({ made, named }: ReturnType<typeof gather>): string[] =>
  made
    .filter(code => !named.includes(code))
    .map(code => `${code} is produced by a rule and expected by no test; ${PROVE}`);

const PROVE =
  'add a sabotage in packages/runtime/test/sabotage-unproved.test.ts that breaks the example and expects it, or delete the rule';

/** Every refusal code a text spells as a string literal, without its quotes. */
function codesIn(text: string): string[] {
  return [...new Set(text.match(CODE) ?? [])].map(quoted => quoted.replaceAll("'", ''));
}

/** The proof that the judge bites: a code no test names, alone and beside one a test does. */
export const sabotage = [
  {
    input: { made: ['G001'], named: [] },
    violation: `G001 is produced by a rule and expected by no test; ${PROVE}`,
  },
  {
    input: { made: ['G001', 'X001'], named: ['G001'] },
    violation: `X001 is produced by a rule and expected by no test; ${PROVE}`,
  },
];
