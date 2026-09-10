/**
 * Claim: the engine imports nothing.
 * Why: the engine knows nodes, sources and handlers and nothing else; a file, a socket or a document kind it
 *   imports is a concern that belongs to core, to a plugin or to the runtime. Today its `src` has no import
 *   from outside itself, not even `node:`, and that is the strongest form of the orthogonality rule in
 *   `CLAUDE.md`: "the engine knows nodes, sources and handlers; it never learns about files, shapes or
 *   triggers".
 * Retire when: the engine gains a concern that cannot be handed in through a handler or a source, and an RFC
 *   says which. Until then, weakening this is a design signal, not a dependency problem.
 */
import { importsOf, sourceFiles, textOf } from './lib/sources.js';

/** The claim this module holds, and the title the runner gives its test. */
export const claim = 'the engine imports nothing';

/** Every file under the engine's `src`, with the specifiers it imports. */
export const gather = () =>
  sourceFiles('packages/engine/src').map(file => ({ file, imports: importsOf(textOf(file)) }));

/** Every import that reaches outside the engine, one sentence each, naming the file and the fix. */
export const judge = (files: ReturnType<typeof gather>): string[] =>
  files.flatMap(({ file, imports }) =>
    imports
      .filter(specifier => !specifier.startsWith('.'))
      .map(specifier => `${file} imports ${specifier}; hand the concern in through a handler or a source`),
  );

/** The proof that the judge bites: a node module in the kernel, and the violation it must name. */
export const sabotage = [
  {
    input: [{ file: 'packages/engine/src/kernel.ts', imports: ['node:fs', './spec.js'] }],
    violation: 'packages/engine/src/kernel.ts imports node:fs; hand the concern in through a handler or a source',
  },
  {
    input: [{ file: 'packages/engine/src/run.ts', imports: ['@wilanis/core'] }],
    violation: 'packages/engine/src/run.ts imports @wilanis/core; hand the concern in through a handler or a source',
  },
];
