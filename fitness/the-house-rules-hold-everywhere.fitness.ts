/**
 * Claim: the house rules hold everywhere.
 * Why: `biome.jsonc` is the whole enforcement of the house rules, and any pull request can raise `maxLines`
 *   from 50 to 80, switch `noExplicitAny` off for one package with an override, or narrow `files.includes`
 *   so a directory stops being checked -- each is one line in a file no test reads. The numbers live twice
 *   on purpose: `biome.jsonc` enforces them and this file is the decision, with its reason and its
 *   retirement condition, so changing one without the other fails. `CLAUDE.md` says the two overrides "are
 *   not exemptions from the design but facts about the code"; a third is a rule going quiet.
 * Retire when: the house rules change, and an RFC says which and why -- then RULES changes with
 *   `biome.jsonc`, in one commit, and the `Decision:` line says what was decided.
 */
import { at, readJsonc, record } from './lib/jsonc.js';

/** The house rules, each at its level with its option: the table `CLAUDE.md` states in prose. */
const RULES: Record<string, unknown> = {
  'complexity.noExcessiveCognitiveComplexity': { level: 'error', options: { maxAllowedComplexity: 10 } },
  'complexity.noExcessiveLinesPerFunction': { level: 'error', options: { maxLines: 50, skipBlankLines: true } },
  'complexity.useMaxParams': { level: 'error', options: { max: 4 } },
  'nursery.noExcessiveNestedCallbacks': { level: 'error', options: { max: 3 } },
  'style.noExcessiveLinesPerFile': { level: 'error', options: { maxLines: 300, skipBlankLines: true } },
  'style.noNestedTernary': 'error',
  'style.noNonNullAssertion': 'error',
  'suspicious.noExplicitAny': 'error',
};

/** What `files.includes` must cover, so no directory quietly stops being checked. */
const COVERED = ['packages/*/src', 'packages/*/test', 'libraries/*/test', 'fitness'];

/** The two overrides the file justifies: a test body is one function, and the view model names a `then`. */
const OVERRIDES = ['**/test/**', 'packages/view/**'];

/** The claim this module holds, and the title the runner gives its test. */
export const claim = 'the house rules hold everywhere';

/** The linter's configuration as it stands: the rules it carries, what it covers, and its overrides. */
export const gather = () => {
  const config = readJsonc('biome.jsonc');
  return {
    rules: Object.fromEntries(Object.keys(RULES).map(name => [name, at(config, `linter.rules.${name}`)])),
    includes: listOf(at(config, 'files.includes')),
    overrides: (Array.isArray(at(config, 'overrides')) ? (at(config, 'overrides') as unknown[]) : []).map(one =>
      listOf(record(one)?.includes),
    ),
  };
};

/** Every way the enforcement has been loosened, one sentence each, naming the rule and the fix. */
export const judge = (found: ReturnType<typeof gather>): string[] => [
  ...Object.entries(RULES).flatMap(([name, want]) => ruleFault(name, want, found.rules[name])),
  ...COVERED.flatMap(path => coverFault(path, found.includes)),
  ...negatedFaults(found.includes),
  ...overrideFaults(found.overrides),
];

/** The violation a rule is when the file carries it at another level, with another option, or not at all. */
function ruleFault(name: string, want: unknown, got: unknown): string[] {
  if (got === undefined) return [`biome.jsonc carries no ${name}; the house rules are enforced there or nowhere`];
  if (JSON.stringify(got) === JSON.stringify(want)) return [];
  return [
    `biome.jsonc sets ${name} to ${JSON.stringify(got)}, not ${JSON.stringify(want)}; change RULES too, and say why`,
  ];
}

/** The violation a directory is when no pattern in `files.includes` reaches it. */
function coverFault(path: string, includes: string[]): string[] {
  if (includes.some(pattern => pattern.startsWith(path))) return [];
  return [`biome.jsonc does not check ${path}; add it to files.includes so the rules reach it`];
}

/** The violation a negated pattern is: it takes a directory back out of what the rules reach. */
function negatedFaults(includes: string[]): string[] {
  return includes
    .filter(pattern => pattern.startsWith('!'))
    .map(pattern => `biome.jsonc excludes ${pattern} from files.includes; the rules hold everywhere, so drop it`);
}

/** The violation an override is when it is not one of the two the file justifies. */
function overrideFaults(overrides: string[][]): string[] {
  const found = overrides.map(one => one.join(','));
  const want = OVERRIDES;
  const extra = found.filter(one => !want.includes(one));
  const missing = want.filter(one => !found.includes(one));
  return [
    ...extra.map(
      one => `biome.jsonc overrides ${one}; an override is a fact about the code, so name it in OVERRIDES and say why`,
    ),
    ...missing.map(one => `biome.jsonc no longer overrides ${one}; drop it from OVERRIDES too, and say why`),
  ];
}

/** A value as the list of strings it is, or nothing where it is not one. */
function listOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : [];
}

/** The proof that the judge bites: a raised limit, a rule switched off, a narrowed scope, a third override. */
export const sabotage = [
  {
    input: {
      rules: {
        ...allRules(),
        'complexity.noExcessiveLinesPerFunction': { level: 'error', options: { maxLines: 80, skipBlankLines: true } },
      },
      includes: COVERED,
      overrides: [['**/test/**'], ['packages/view/**']],
    },
    violation:
      'biome.jsonc sets complexity.noExcessiveLinesPerFunction to {"level":"error","options":{"maxLines":80,"skipBlankLines":true}}, not {"level":"error","options":{"maxLines":50,"skipBlankLines":true}}; change RULES too, and say why',
  },
  {
    input: {
      rules: allRules(),
      includes: ['packages/*/src', 'packages/*/test', 'libraries/*/test'],
      overrides: [['**/test/**'], ['packages/view/**']],
    },
    violation: 'biome.jsonc does not check fitness; add it to files.includes so the rules reach it',
  },
  {
    input: {
      rules: allRules(),
      includes: [...COVERED, '!packages/view/src'],
      overrides: [['**/test/**'], ['packages/view/**']],
    },
    violation: 'biome.jsonc excludes !packages/view/src from files.includes; the rules hold everywhere, so drop it',
  },
  {
    input: {
      rules: allRules(),
      includes: COVERED,
      overrides: [['**/test/**'], ['packages/view/**'], ['packages/runtime/**']],
    },
    violation:
      'biome.jsonc overrides packages/runtime/**; an override is a fact about the code, so name it in OVERRIDES and say why',
  },
];

/** Every rule as RULES wants it, so a sabotage case changes one thing and nothing else. */
function allRules(): Record<string, unknown> {
  return { ...RULES };
}
