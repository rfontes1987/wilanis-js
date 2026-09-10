/**
 * Claim: every public function says what it answers.
 * Why: `CLAUDE.md` asks for "a one-line doc comment on every public function saying what it answers", and
 *   names the engine and the compiler as the reference. A reader who opens a module should learn what each
 *   export is for without reading its body, and an agent that must choose between two functions has only
 *   their names and those lines to go on. The rule was stated and never held: nothing read the source to
 *   check, so exports drifted in undocumented over time, and no one decided the rule was over.
 * Retire when: the comments are generated from the types, or an RFC says a public export may stand
 *   unexplained. A comment that only restates the signature is a signal the name or the function is wrong,
 *   not that this claim should go.
 */
import { exportsOf, packageDirs, sourceFiles, textOf } from './lib/sources.js';

/** The claim this module holds, and the title the runner gives its test. */
export const claim = 'every public function says what it answers';

/** Every file under a package's `src`, with the exports it declares and whether a comment leads each. */
export const gather = () =>
  packageDirs().flatMap(dir => sourceFiles(`${dir}/src`).map(file => ({ file, exports: exportsOf(textOf(file)) })));

/** Every export that says nothing about what it answers, one sentence each, naming the file and the fix. */
export const judge = (files: ReturnType<typeof gather>): string[] =>
  files.flatMap(({ file, exports }) =>
    exports
      .filter(each => !each.documented)
      .map(each => `${file} exports ${each.name} with no doc comment; say in one line what it answers`),
  );

/** The proof that the judge bites: an undocumented function, and the violation it must name. */
export const sabotage = [
  {
    input: [
      {
        file: 'packages/core/src/model.ts',
        exports: [
          { name: 'schemaRef', documented: false },
          { name: 'kindOf', documented: true },
        ],
      },
    ],
    violation: 'packages/core/src/model.ts exports schemaRef with no doc comment; say in one line what it answers',
  },
  {
    input: [
      {
        file: 'packages/core/src/registry.ts',
        exports: [{ name: 'Registry.add', documented: false }],
      },
    ],
    violation:
      'packages/core/src/registry.ts exports Registry.add with no doc comment; say in one line what it answers',
  },
];
