/**
 * Claim: the compiler imports only core and engine.
 * Why: the compiler knows documents and the engine, and `CLAUDE.md` says to keep it that way: "the compiler
 *   knows documents and the engine; it never learns about HTTP". A `node:` module would give it a file system
 *   or a socket, which is the runtime's business, and any other package would make it depend on what it
 *   judges. Today its `src` imports `@wilanis/core`, `@wilanis/engine` and itself, and nothing else.
 * Retire when: the compiler is asked to judge something it cannot reach through a document or the engine's
 *   spec, and an RFC says what. A checker rule that seems to need a socket is a design signal.
 */
import { importsOf, packageOf, sourceFiles, textOf } from './lib/sources.js';

const ALLOWED = ['@wilanis/core', '@wilanis/engine'];

/** The claim this module holds, and the title the runner gives its test. */
export const claim = 'the compiler imports only core and engine';

/** Every file under the compiler's `src`, with the specifiers it imports. */
export const gather = () =>
  sourceFiles('packages/compiler/src').map(file => ({ file, imports: importsOf(textOf(file)) }));

/** Every import the compiler may not have, one sentence each, naming the file and the fix. */
export const judge = (files: ReturnType<typeof gather>): string[] =>
  files.flatMap(({ file, imports }) => imports.flatMap(specifier => fault(file, specifier)));

/** The one violation a specifier is, or nothing where the compiler may import it. */
function fault(file: string, specifier: string): string[] {
  if (specifier.startsWith('.')) return [];
  if (specifier.startsWith('node:')) {
    return [`${file} imports ${specifier}; the compiler knows documents and the engine, never a file or a socket`];
  }
  const named = packageOf(specifier);
  if (named !== null && ALLOWED.includes(named)) return [];
  return [`${file} imports ${specifier}; the compiler imports only ${ALLOWED.join(' and ')}`];
}

/** The proof that the judge bites: a node module and a package the compiler may not name. */
export const sabotage = [
  {
    input: [{ file: 'packages/compiler/src/checker.ts', imports: ['node:http', '@wilanis/core'] }],
    violation:
      'packages/compiler/src/checker.ts imports node:http; the compiler knows documents and the engine, never a file or a socket',
  },
  {
    input: [{ file: 'packages/compiler/src/lower.ts', imports: ['@wilanis/runtime'] }],
    violation:
      'packages/compiler/src/lower.ts imports @wilanis/runtime; the compiler imports only @wilanis/core and @wilanis/engine',
  },
];
