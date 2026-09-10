/**
 * Claim: tests live beside what they test.
 * Why: `CLAUDE.md` says "tests live next to what they test" and then lists, for each package, what its test
 *   directory holds. A package whose tests sit elsewhere is a package whose tests are found by knowing where
 *   someone put them rather than by looking beside the code. The one exception is deliberate and named: the
 *   compiler has no test directory of its own because "every checker rule is exercised through the example
 *   and its sabotaged variants" in the runtime's tests, where a real tree can be sabotaged.
 * Retire when: a second package is better tested through another, and the table says which and why. A
 *   package that simply has no tests is not that case.
 */
import { dirExists, packageDirs } from './lib/sources.js';

/** The package tested through another's tests, and where those tests live. */
const TESTED_THROUGH: Record<string, string> = { compiler: 'packages/runtime/test' };

/** The claim this module holds, and the title the runner gives its test. */
export const claim = 'tests live beside what they test';

/** Every package with a `src`, and whether a `test` sits beside it. */
export const gather = () =>
  packageDirs()
    .filter(dir => dirExists(`${dir}/src`))
    .map(dir => ({ dir, tests: dirExists(`${dir}/test`) }));

/** Every package whose tests are not beside it, one sentence each, naming the package and the fix. */
export const judge = (packages: ReturnType<typeof gather>): string[] =>
  packages.flatMap(({ dir, tests }) => {
    if (tests) return [];
    const through = TESTED_THROUGH[dir.replace('packages/', '')];
    if (through) return [];
    return [`${dir} has no test/ beside its src/; put its tests there, or name what tests it in TESTED_THROUGH`];
  });

/** The proof that the judge bites: a package with neither its own tests nor a named home for them. */
export const sabotage = [
  {
    input: [{ dir: 'packages/core', tests: false }],
    violation:
      'packages/core has no test/ beside its src/; put its tests there, or name what tests it in TESTED_THROUGH',
  },
];
