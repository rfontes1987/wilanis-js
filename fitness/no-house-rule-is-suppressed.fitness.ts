/**
 * Claim: no house rule is suppressed.
 * Why: `biome.jsonc` says the house rules and `npm run lint` holds every file to them, but a suppression
 *   comment exempts one line without touching the configuration at all -- the diff is a comment, and
 *   nothing reads it. `CLAUDE.md` answers the temptation directly: "a rule that bites is a design signal,
 *   not an obstacle: split the function along the steps it takes and name each, or the file along the rule
 *   families it holds". There are none today, and nothing kept it so.
 * Retire when: a suppression is the right answer to something, and `ALLOWED` names the line and the reason.
 *   An empty list is the claim; a list with entries is a decision about each of them.
 */
import { entriesUnder, textOf } from './lib/sources.js';

/** Where a suppression would be allowed, and why. It is empty: every rule so far was a design signal. */
const ALLOWED: string[] = [];

/** The directories held to the house rules, so a suppression anywhere in them is found. */
const HELD = ['packages', 'libraries', 'fitness'];

/**
 * The directive the linter obeys, spelled from its parts rather than written out: a file that judges
 * suppressions must not carry one, or it refuses itself.
 */
const DIRECTIVE = `${'biome'}-${'ignore'}`;

/** The claim this module holds, and the title the runner gives its test. */
export const claim = 'no house rule is suppressed';

/** Every line of every held file that suppresses a rule, with the file and the line it sits on. */
export const gather = () =>
  HELD.flatMap(dir => entriesUnder(dir, ['.ts', '.js', '.jsonc']).flatMap(file => suppressionsIn(file, textOf(file))));

/** Every suppression nobody decided on, one sentence each, naming the line and what to do instead. */
export const judge = (found: ReturnType<typeof gather>): string[] =>
  found.filter(one => !ALLOWED.includes(`${one.file}:${one.line}`)).map(one => fault(one));

/** Every suppression one file's text carries, as the line it sits on and the text of that line. */
function suppressionsIn(file: string, text: string) {
  return text
    .split('\n')
    .flatMap((line, index) => (suppresses(line) ? [{ file, line: index + 1, text: line.trim() }] : []));
}

/** Whether a line carries the directive as a comment, which is the only form the linter obeys. */
function suppresses(line: string): boolean {
  const commented = line.includes('//') || line.includes('/*');
  return commented && line.includes(DIRECTIVE);
}

/** One violation, as a sentence naming the line, the rule it exempts, and what to do instead. */
function fault(one: { file: string; line: number; text: string }): string {
  const named = new RegExp(`${DIRECTIVE}\\s+([^:]+):`).exec(one.text)?.[1]?.trim() ?? 'a rule';
  return `${one.file}:${one.line} suppresses ${named}; a rule that bites is a design signal -- split the code, or name the line in ALLOWED with its reason`;
}

/** The proof that the judge bites: a suppression nobody decided on. */
export const sabotage = [
  {
    input: [
      {
        file: 'packages/core/src/model.ts',
        line: 42,
        text: `// ${DIRECTIVE} lint/suspicious/noExplicitAny: it was quicker`,
      },
    ],
    violation:
      'packages/core/src/model.ts:42 suppresses lint/suspicious/noExplicitAny; a rule that bites is a design signal -- split the code, or name the line in ALLOWED with its reason',
  },
];
