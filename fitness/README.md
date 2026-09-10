# fitness

A decision about the TypeScript code of this workspace is one file in this directory. `ls fitness` is the
index, and the file names read as sentences, because a file's name *is* the claim it holds:

```
a-fitness-function-is-one-claim.fitness.ts    the claim: its header, and the one `it` that gathers
a-fitness-function-is-one-claim.judge.ts      its judge: the pure function that decides
```

`CLAUDE.md` states the architecture in sentences -- which way dependencies point, what the engine may import,
that every exported function says what it answers. Biome enforces the house rules and `tsc -b` enforces the
build order; those are fitness functions already. The sentences are not, and a pull request can contradict
one and still pass `npm test`. This directory is where a sentence becomes a test. RFC 0027,
`docs/rfcs/0027-fitness-functions.md`, is the whole design.

## What one looks like

The decision record *is* the test file. It opens with three lines, and holds one `it` whose title is the claim:

```ts
/**
 * Claim: the engine imports nothing.
 * Why: the engine knows nodes, sources and handlers and nothing else; a file, a socket or a document kind it
 *   imports is a concern that belongs to core, to a plugin or to the runtime.
 * Retire when: the engine gains a concern that cannot be handed in through a handler or a source, and an RFC
 *   says which.
 */
```

**Claim** is what holds, and is the test's title. **Why** names the principle it serves, in `CLAUDE.md`'s
words where it can, and the fact about the code that makes the claim true today. **Retire when** says what
would have to become true for the next reader to delete the file with a clear conscience; it is the line that
decides whether a decision is outdated.

## How one is written

- **One claim per file.** A file that needs a second `it` is two decisions, and the edit is a second file.
- **Facts are data, not branches.** The order of the packages, the one package tested through another, the
  rule table Biome must carry: a constant at the top of the file. Where a fact is already declared elsewhere,
  read it there -- dependency direction reads each `package.json`, the kinds read `KINDS` in
  `packages/core/src/model.ts`. Adding a package or a kind then changes a list, not a decision.
- **Gathering is separate from judging, and so are their files.** A claim is two files: `<claim>.fitness.ts`
  holds the header and the one `it`, which gathers; `<claim>.judge.ts` beside it exports the pure function
  that decides. The split is Biome's doing and it is right: a file holding `describe` and `it` is a test file,
  and a test file exports nothing (`noExportsInTest`), while `fitness/sabotage.test.ts` needs each judge by
  name. `packages/runtime/test/example-harness.ts` is the same shape. The judge takes what was read and
  returns one sentence per violation, so sabotage can hand it a minimal violating input and expect the
  violation named -- a fitness function that has never failed is unproved.
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
