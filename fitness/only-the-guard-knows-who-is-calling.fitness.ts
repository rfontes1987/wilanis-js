/**
 * Claim: only the guard knows who is calling.
 * Why: `CLAUDE.md` divides the two questions -- "Who is calling is the guard's business and what they may do
 *   is a policy's" -- and says of a kind that "no graph ever validates a token or a code, and no kind ever
 *   checks access". One plugin has a `guard`; it verifies a credential before any graph runs and hands
 *   `request.principal`, `request.session` and `request.challenge` to every kind's context. A trigger kind
 *   that starts reading a cookie into a session is one pull request away, and `dependencies-point-one-way`
 *   would not notice, because no import changes -- the drift is in the vocabulary, not the graph of modules.
 * Retire when: a second plugin is granted a `guard`, or a kind is given a reason to know the caller, and an
 *   RFC says which. A word this claim should not hold belongs out of `WORDS` with its reason, as `token` and
 *   `cookie` already are; a plugin that needs one is the violation this claim exists to name.
 */
import { packageDirs, sourceFiles, textOf, wordsOf } from './lib/sources.js';

/** The one plugin with a `guard`, whose business these words are. */
const GUARD = 'packages/plugin-auth';

/** The trigger kinds the runtime ships, which fire an operation and never ask who is calling. */
const KINDS_OF_THE_RUNTIME = 'packages/runtime/src/plugins';

/**
 * The guard's vocabulary. `token` is not among them: core's expression lexer speaks of tokens and a trigger
 * kind may too. `cookie` is not either: the http kind hands one to the guard and must be able to spell it.
 */
const WORDS = ['principal', 'session', 'challenge', 'credential', 'credentials', 'policy', 'policies'];

/** The claim this module holds, and the title the runner gives its test. */
export const claim = 'only the guard knows who is calling';

/** Every file that may not know the caller, with the guard's words it spells in code rather than in prose. */
export const gather = () => filesOutsideTheGuard().map(file => ({ file, words: guardWordsIn(textOf(file)) }));

/** Every plugin but the guard, and the runtime's own trigger kinds. */
function filesOutsideTheGuard(): string[] {
  const plugins = packageDirs().filter(dir => dir.startsWith('packages/plugin-') && dir !== GUARD);
  return [...plugins.flatMap(dir => sourceFiles(`${dir}/src`)), ...sourceFiles(KINDS_OF_THE_RUNTIME)];
}

/** The guard's words a file's text spells as an identifier, a literal or a key, each named once. */
function guardWordsIn(text: string): string[] {
  const spelled = new Set(wordsOf(text).filter(word => WORDS.includes(word)));
  return [...spelled];
}

/** Every file that has begun to know the caller, one sentence each, naming the word and the seam to use. */
export const judge = (files: ReturnType<typeof gather>): string[] =>
  files.flatMap(({ file, words }) =>
    words.map(
      word =>
        `${file} spells ${word}; a kind hands the credential to the guard through the trigger's policy attachment and never reads who is calling`,
    ),
  );

/** The proof that the judge bites: a kind that has begun to read the caller, and the violation it must name. */
export const sabotage = [
  {
    input: [{ file: 'packages/plugin-http/src/serve.ts', words: ['session'] }],
    violation:
      "packages/plugin-http/src/serve.ts spells session; a kind hands the credential to the guard through the trigger's policy attachment and never reads who is calling",
  },
  {
    input: [{ file: 'packages/runtime/src/plugins/cli-trigger.ts', words: ['principal'] }],
    violation:
      "packages/runtime/src/plugins/cli-trigger.ts spells principal; a kind hands the credential to the guard through the trigger's policy attachment and never reads who is calling",
  },
];
