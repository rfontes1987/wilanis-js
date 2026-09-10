/**
 * Claim: a refusal says how to fix it.
 * Why: `CLAUDE.md` promises "a hint that names the command or the edit that fixes it" on every refusal, and an
 *   agent in a repair loop reads nothing else -- it has the diagnosis and must guess the edit. The promise was
 *   a sentence: `hint` was optional on `Refusal` and on `Refuser`, and 56 refusals passed none. Requiring it
 *   makes `tsc -b` the enforcement; this file holds the two declarations to that shape, so a pull request
 *   cannot make the field optional again in one line, the way `the-house-rules-hold-everywhere` holds
 *   `biome.jsonc`.
 * Retire when: refusals carry structured fixes -- an edit, a command -- in a field of their own, and an RFC
 *   says which. A string that is sometimes empty is not that, and neither is a hint the type lets a rule omit.
 */

import { textOf } from './lib/sources.js';
import { optionalMembersOf } from './lib/types.js';

/** The two declarations every refusal passes through, and the member each must not make optional. */
const SHAPES = [
  { file: 'packages/core/src/registry.ts', name: 'Refusal', member: 'hint' },
  { file: 'packages/compiler/src/check/judge.ts', name: 'Refuser', member: 'hint' },
];

/** The claim this module holds, and the title the runner gives its test. */
export const claim = 'a refusal says how to fix it';

/** Each declaration a refusal passes through, with the members it declares optional. */
export const gather = () =>
  SHAPES.map(shape => ({ ...shape, optional: optionalMembersOf(textOf(shape.file), shape.name) }));

/** Every declaration that lets a rule omit the fix, one sentence each, naming the file and the edit. */
export const judge = (shapes: ReturnType<typeof gather>): string[] =>
  shapes
    .filter(shape => shape.optional.includes(shape.member))
    .map(
      shape =>
        `${shape.file} declares ${shape.name}.${shape.member} optional; every refusal names its fix, so require it`,
    );

/** The proof that the judge bites: a declaration that makes the fix optional, and the violation it must name. */
export const sabotage = [
  {
    input: [{ file: 'packages/core/src/registry.ts', name: 'Refusal', member: 'hint', optional: ['at', 'hint'] }],
    violation:
      'packages/core/src/registry.ts declares Refusal.hint optional; every refusal names its fix, so require it',
  },
  {
    input: [
      { file: 'packages/compiler/src/check/judge.ts', name: 'Refuser', member: 'hint', optional: ['at', 'hint'] },
    ],
    violation:
      'packages/compiler/src/check/judge.ts declares Refuser.hint optional; every refusal names its fix, so require it',
  },
];
