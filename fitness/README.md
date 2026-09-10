# fitness

A decision about the TypeScript code of this workspace is one file in this directory. `ls fitness` is the
index, and the file names read as sentences, because a file's name *is* the claim it holds:

```
a-fitness-function-is-one-claim.fitness.ts
```

`CLAUDE.md` states the architecture in sentences -- which way dependencies point, what the engine may import,
that every exported function says what it answers. Biome enforces the house rules and `tsc -b` enforces the
build order; those are fitness functions already. The sentences are not, and a pull request can contradict
one and still pass `npm test`. This directory is where a sentence becomes a test. RFC 0027,
`docs/rfcs/0027-fitness-functions.md`, is the whole design.

## What one looks like

The decision record *is* the file. It opens with three lines:

```ts
/**
 * Claim: the engine imports nothing.
 * Why: the engine knows nodes, sources and handlers and nothing else; a file, a socket or a document kind it
 *   imports is a concern that belongs to core, to a plugin or to the runtime.
 * Retire when: the engine gains a concern that cannot be handed in through a handler or a source, and an RFC
 *   says which.
 */
```

**Claim** is what holds, and is the title the runner gives its test. **Why** names the principle it serves,
in `CLAUDE.md`'s words where it can, and the fact about the code that makes the claim true today. **Retire
when** says what would have to become true for the next reader to delete the file with a clear conscience;
it is the line that decides whether a decision is outdated.

Below the header, a fitness function is a **module, not a test**. It exports three names and registers
nothing:

```ts
/** The claim this module holds, and the title the runner gives its test. */
export const claim = 'the engine imports nothing';

/** Every file under the engine's `src`, with the specifiers it imports. */
export const gather = () => sourceFiles('packages/engine/src').map(file => ({ file, imports: importsOf(file) }));

/** Every import the engine may not have, one sentence each, naming the file and the fix. */
export const judge = (files: ReturnType<typeof gather>): string[] => ...;
```

Exactly those three, and nothing else: a shared shape is derived with `ReturnType<typeof gather>` rather than
exported as a type, and a helper stays unexported or moves to `fitness/lib/`.

`fitness/run.test.ts` is the suite's one runner and its only test file besides sabotage. It loads every
`*.fitness.ts` with `import.meta.glob`, eagerly, and registers one test per module, titled with its `claim`,
asserting that judging what was gathered leaves no violation -- so "one claim, one test" holds for every file
by construction. A module that does not export all three is failed by name rather than skipped. A failure
reads as `FAIL fitness/run.test.ts > <the claim>` with `see fitness/<the file>` as its message.

This is why `fitness/sabotage.test.ts` imports judges freely: nothing it imports is a test file, so no claim
re-runs under the sabotage file's name. (Importing from a file that holds `describe`/`it` re-runs its tests
in the importer -- which is what Biome's `noExportsInTest` exists to prevent, and why a claim registers
nothing of its own.)

## How one is written

- **One claim per file.** A file that needs a second `claim` is two decisions, and the edit is a second file.
- **Facts are data, not branches.** The order of the packages, the one package tested through another, the
  rule table Biome must carry: a constant at the top of the file. Where a fact is already declared elsewhere,
  read it there -- dependency direction reads each `package.json`, the kinds read `KINDS` in
  `packages/core/src/model.ts`. Adding a package or a kind then changes a list, not a decision.
- **Gathering is separate from judging.** `gather` reads the repository and `judge` is pure: it takes what
  was read and returns one sentence per violation, naming the offending file and the edit that fixes it. So
  `fitness/sabotage.test.ts` can hand a judge a minimal violating input and expect the violation named --
  a fitness function that has never failed is unproved.
- **A failure reads like a refusal.** It names the offending file and the edit that fixes it, the way a
  checker refusal carries an `at` and a hint.
- **The full house rules apply.** `biome.jsonc` includes `fitness/**/*.ts` with no override, so a fitness
  function that grows past 50 lines is refused by the tool it defends.

Shared readers live in `fitness/lib/`: `sources.ts` reads TypeScript as text with Babel's parser (import
specifiers, exported declarations, the comments that lead them), and `jsonc.ts` reads `biome.jsonc` and the
plain JSON of a `package.json` or a `tsconfig.json`.

## Running them

```
npm run fitness      # this suite alone, no build: it reads source text, never dist
npm test             # lint, build, then every project, this one among them
```

`fitness/tsconfig.json` typechecks this directory, since vitest transpiles without checking types and
`tsc -b` covers the packages only. It emits nothing and is not a project reference; both commands above run
it. `npm run fitness` needs no build of its own: delete every `dist` and it still answers, because a claim
reads source text.


## How one is retired

A fitness function is retired when its **Retire when** line has come true -- not when it is inconvenient. A
rule that bites is a design signal: the edit goes to the code, not to this directory.

A commit that touches `fitness/` carries a `Decision:` line saying which of `adds`, `reconfigures` or
`retires`, which file, and why:

```
Retire the engine's import ban in favour of the handler contract

Decision: retires fitness/the-engine-imports-nothing.fitness.ts because RFC 00NN moves sources into the engine.
```

The line is the maintainer's to write, in their own words; no tool adds it, and it is the one exception to
`CLAUDE.md`'s "no generated trailers". A `commit-msg` hook refuses a commit that lacks it, and in CI a
`decision` job checks the same line and then waits for the maintainer's approval in an Actions environment
named `decisions`. The hook and the job arrive with step 6 of RFC 0027; until then the line is written by
hand and checked by eye.
