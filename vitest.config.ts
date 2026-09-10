/**
 * Two test projects. `packages` is what `npm test` has always run: the tests beside each package, over the
 * `dist` a build produced. `fitness` is the suite under `fitness/`, which reads this repository's source as
 * text and needs no build, so `npm run fitness` answers in seconds. Neither project sees the other's files.
 *
 * The fitness project collects `*.test.ts` only: a `*.fitness.ts` is a module, not a test, and
 * `fitness/run.test.ts` is what loads every one of them and registers an `it` per claim.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'packages',
          include: ['packages/*/test/**/*.test.ts', 'libraries/*/test/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'fitness',
          include: ['fitness/**/*.test.ts'],
        },
      },
    ],
  },
});
