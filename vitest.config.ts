/**
 * Two test projects. `packages` is what `npm test` has always run: the tests beside each package, over the
 * `dist` a build produced. `fitness` is the suite under `fitness/`, which reads this repository's source as
 * text and needs no build, so `npm run fitness` answers in seconds. Neither project sees the other's files.
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
          include: ['fitness/**/*.{fitness,test}.ts'],
        },
      },
    ],
  },
});
