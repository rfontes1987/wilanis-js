/**
 * Claim: a refusal code is made where its family lives.
 * Why: `CLAUDE.md` gives each refusal family one home -- "refusal codes are produced by the checker (D R L G
 *   P B T A C S) or a plugin's `check` (X); never duplicate a check in the runtime" -- and tells anyone
 *   adding a rule to put it in its family's module under `packages/compiler/src/check/`. A code made
 *   somewhere else is the same judgement in two places, which is the DRY rule this repository states first,
 *   and it is how a rule quietly stops being the checker's. Only `src/` is judged: a test carries codes of
 *   every family on purpose, since sabotaging the example is how the checker's rules are proved.
 * Retire when: a family is given a second home on purpose, and the table names it and says why -- as it
 *   already does for the two `D` literals in the runtime's project loader.
 */
import { packageDirs, sourceFiles, textOf } from './lib/sources.js';

/**
 * Where each family is made. A directory covers what is under it; a file names itself. `D` has two homes:
 * the loader in core, and the runtime's project loader, which refuses a plugin (D006) or an include (D010)
 * it cannot resolve -- resolving an npm package is the runtime's knowledge, not the loader's.
 */
const HOME: Record<string, string[]> = {
  D: ['packages/core/src', 'packages/runtime/src/project.ts'],
  R: ['packages/compiler/src/check'],
  L: ['packages/compiler/src/check'],
  G: ['packages/compiler/src/check'],
  P: ['packages/compiler/src/check'],
  B: ['packages/compiler/src/check'],
  T: ['packages/compiler/src/check'],
  A: ['packages/compiler/src/check'],
  C: ['packages/compiler/src/check'],
  S: ['packages/compiler/src/check'],
  X: ['packages/plugin-'],
};

/** One refusal code as this claim reads it: the file that spells it, and the code itself. */
interface Made {
  file: string;
  code: string;
}

/** The claim this module holds, and the title the runner gives its test. */
export const claim = 'a refusal code is made where its family lives';

/** Every refusal code spelled as a string literal under a package's `src`, with the file that spells it. */
export const gather = (): Made[] =>
  packageDirs().flatMap(dir =>
    sourceFiles(`${dir}/src`).flatMap(file =>
      [...new Set(textOf(file).match(/'[A-Z]\d{3}'/g) ?? [])].map(quoted => ({
        file,
        code: quoted.replaceAll("'", ''),
      })),
    ),
  );

/** Every code made outside its family's home, one sentence each, naming the file and the fix. */
export const judge = (made: Made[]): string[] =>
  made.flatMap(({ file, code }) => {
    const family = code[0] ?? '';
    const homes = HOME[family];
    if (!homes) return [`${file} makes ${code}, of no known family; give the family a home in HOME, or use its code`];
    if (homes.some(home => file.startsWith(home))) return [];
    return [`${file} makes ${code}, which is made in ${homes.join(' or ')}; move the rule to its family's module`];
  });

/** The proof that the judge bites: a checker code made in the runtime, and a family with no home. */
export const sabotage = [
  {
    input: [{ file: 'packages/runtime/src/serve.ts', code: 'G001' }],
    violation:
      "packages/runtime/src/serve.ts makes G001, which is made in packages/compiler/src/check; move the rule to its family's module",
  },
  {
    input: [{ file: 'packages/core/src/load.ts', code: 'Z001' }],
    violation:
      'packages/core/src/load.ts makes Z001, of no known family; give the family a home in HOME, or use its code',
  },
];
