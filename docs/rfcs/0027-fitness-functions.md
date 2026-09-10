# RFC 0027: Fitness functions: decisions about the code, held by the tests that record them

- **Status:** accepted
- **Areas:** `area:process`
- **Tracking issue:** #92
- **Depends on:** none

## Summary

A decision about the TypeScript code of this workspace becomes one file under `fitness/`: a claim in one
sentence, why it holds, the condition under which it should be retired, and the vitest test that holds every
pull request to it. The suite pins what `CLAUDE.md` today only says: which way dependencies point, what the
engine and the compiler may import, that every exported function says what it answers, that a document kind
is mirrored wherever the code lists kinds, and that the Biome and TypeScript configuration still enforces the
house rules. A change to a fitness function is a change of decision: the commit that makes it carries a
`Decision:` line, and the pull request waits for the maintainer's approval in a GitHub Actions environment.
Twelve decisions are taken in this RFC. Nothing changes in a tree, a document, a plugin or the runtime.

## Motivation

`CLAUDE.md` states the architecture in sentences: "dependencies point one way", "a plugin never imports the
compiler or the runtime", "the engine knows nodes, sources and handlers; it never learns about files, shapes
or triggers", "a one-line doc comment on every public function". The house rules that Biome enforces are
fitness functions already, and so is the build order `tsc -b` derives from the project references. The
sentences above are not. Three things go wrong because of it.

A pull request can contradict a sentence and pass `npm test`. `@wilanis/plugin-http` has `@wilanis/runtime`
as a devDependency, for its tests. A change that imports the runtime from `packages/plugin-http/src/index.ts`
resolves, builds, lints and tests green; nothing reads `package.json` to say which section the import was
allowed by. The same holds for `node:http` in `packages/compiler/src`, or `node:fs` in `packages/engine/src`.

A sentence drifts without anyone deciding it should. Today 45 exported functions and arrow constants across
`core`, `compiler`, `runtime`, `view` and `plugin-http` have no doc comment (`schemaRef`, `isRun`,
`stubEffects`, `getPath`, `versionOf` among them). No one decided that rule was over; it was never held.

The enforcement itself is unguarded. Any pull request can raise `maxLines` in `biome.jsonc` from 50 to 80,
add an override that switches `noExplicitAny` off for one package, or narrow `files.includes`, and the diff
is one line in a file no test reads. A `// biome-ignore` comment exempts one line without touching the
configuration at all. There are none today; nothing keeps it so.

The author of a fitness function is most often an agent, and so is the author of the pull request that
trips it. Both need the same thing from the file: the claim, the reason, and the edit that satisfies it, in
one read. An ADR in a separate document is a second place to look and a second thing to keep in step. So the
decision record *is* the test file, and the test's failure message names the offending file and the fix,
the way a refusal carries an `at` and a hint.

This RFC does not add metrics. Biome is the fitness function for size, complexity, naming and nesting, and a
second copy would break the DRY rule the suite exists to defend; the suite pins Biome's configuration
instead. It does not judge documents or trees, which is the checker's job and the `X` rules of a plugin. It
does not adopt an architecture-testing library or a second language for the suite: the reasons are under
"Drawbacks and alternatives". It does not gate pull requests behind a second reviewer, since the repository
has one maintainer and GitHub does not let an author approve their own pull request.

## Guide-level explanation

A **fitness function** is one file, `fitness/<claim>.fitness.ts`, and its name is the claim as a sentence in
kebab case. The file opens with a block comment of three lines and exports exactly three things: `claim`, the
sentence; `gather`, which reads the repository; and `judge`, the pure function from what was gathered to the
violations, each naming the offending file and the edit that fixes it. It holds no `describe` and no `it`. A
fitness file is a module, not a test, so another test can import its judge without registering its test a
second time:

```ts
/**
 * Claim: the engine imports nothing.
 * Why: the engine knows nodes, sources and handlers and nothing else; a file, a socket or a document kind it
 *   imports is a concern that belongs to core, to a plugin or to the runtime. Today its `src` has no import from
 *   outside itself, not even `node:`, and that is the strongest form of the orthogonality rule in CLAUDE.md.
 * Retire when: the engine gains a concern that cannot be handed in through a handler or a source, and an RFC
 *   says which. Until then, weakening this is a design signal, not a dependency problem.
 */
import { importsOf, sourceFiles } from './lib/sources.js';

export const claim = 'the engine imports nothing';

export const gather = () => sourceFiles('packages/engine/src').map(file => ({ file, imports: importsOf(file) }));

export const judge = (files: ReturnType<typeof gather>): string[] =>
  files.flatMap(({ file, imports }) =>
    imports
      .filter(spec => !spec.startsWith('.'))
      .map(spec => `${file} imports ${spec}; move the concern behind a handler or a source`),
  );
```

One runner, `fitness/run.test.ts`, loads every fitness file through an eager `import.meta.glob` and registers
one test per file, titled with its claim, so the property "one claim, one test" holds for every file by
construction:

```ts
const found = import.meta.glob<Fitness>('./*.fitness.ts', { eager: true });
for (const [path, fitness] of Object.entries(found)) {
  it(fitness.claim, () => expect(fitness.judge(fitness.gather()), `see fitness/${basename(path)}`).toEqual([]));
}
```

The three header lines are the whole decision record. **Claim** is what holds, and is the test's title.
**Why** names the principle it serves, in `CLAUDE.md`'s words where it can, and the fact about the code that
makes the claim true today. **Retire when** says what would have to become true for the next reader to
delete this file with a clear conscience. It is the line that decides whether a decision is outdated.

Facts a fitness function needs are data at the top of the file, never branches in its logic: the order of
the packages, the one package tested through another, the rule table Biome must carry. Where a fact is
already declared elsewhere, the function reads it there: dependency direction reads each `package.json`,
the kinds read `KINDS` in `packages/core/src/model.ts`. Adding a package or a kind changes a list, not a
decision.

A failing fitness function reads like a refusal:

```
 FAIL  fitness/run.test.ts > dependencies point one way
AssertionError: see fitness/dependencies-point-one-way.fitness.ts
- Expected  []
+ Received  ["packages/plugin-http/src/index.ts imports @wilanis/runtime, which plugin-http names only under devDependencies; import it from test/ or declare it"]
```

The suite runs on source text, never on `dist`, so `npx vitest run --project fitness` answers in seconds
without a build, and `npm test` runs it with everything else.

**Changing a decision.** A commit that touches `fitness/` must carry a `Decision:` line in its message,
saying which of `adds`, `reconfigures` or `retires`, which file, and why:

```
Retire the engine's import ban in favour of the handler contract

Decision: retires fitness/the-engine-imports-nothing.fitness.ts because RFC 00NN moves sources into the engine.
```

A versioned `commit-msg` hook refuses the commit without the line. In CI, a `decision` job checks the same
line on every such commit and then waits in an Actions environment named `decisions` for the maintainer to
approve the run. The line is the maintainer's to write: `CLAUDE.md` tells an agent that a fitness function
that bites is a design signal, and that the edit goes to the code, not to `fitness/`.

## Reference

### Documents and schemas

None.

### Ports, operations and kinds granted

None.

### Checker rules

None. A fitness function judges this repository's code, not a tree; it produces no refusal code.

### The fitness functions

One file each. "Data" is the constant at the top of the file that a fact lives in; "today" says whether the
claim holds on `main` at the time of writing, which the implementing task confirms or repairs.

| File | Claim | Data | Today |
|---|---|---|---|
| `dependencies-point-one-way` | a file under `src/` imports only packages its `package.json` names under `dependencies`, a test only those plus `devDependencies`; among `@wilanis/*`, a package imports only packages earlier in the order; a `plugin-*` imports only `core` and `engine` | `ORDER = ['engine', 'core', 'compiler', 'runtime', 'view']` | holds |
| `the-engine-imports-nothing` | `packages/engine/src` has no import from outside itself | none | holds |
| `the-compiler-imports-only-core-and-engine` | `packages/compiler/src` imports nothing but `@wilanis/core`, `@wilanis/engine` and itself; no `node:` module | none | holds |
| `every-public-function-says-what-it-answers` | every exported function, exported arrow constant and public class method under `src/` has a leading doc comment | none | 45 undocumented; the implementing task documents them |
| `a-kind-is-declared-once-and-mirrored` | every entry of `KINDS` has a schema file under `packages/core/schemas/`, a `case` in the viewer's `renderDocPage` unless the table names the function that renders it instead, and, unless a plugin ships it, a row in `packages/runtime/templates/CLAUDE.md` and a home in `HOME` or the top-level list | `SHIPPED_BY_PLUGINS = ['plugin', 'trigger-kind', 'connection-kind', 'codec']`, `TOP_LEVEL = ['project', 'feature']`, `RENDERED_BY = { graph: <the graph page's function> }` | holds; `graph` has its own page outside `renderDocPage` |
| `a-plugin-grants-files-not-objects` | every `packages/plugin-*` has `docs/plugin.json` and lists `docs` in its `files` | none | holds |
| `tests-live-beside-what-they-test` | every `packages/*/src` has a sibling `test/`, except the packages the table says are tested through another | `TESTED_THROUGH = { compiler: 'packages/runtime/test' }` | holds |
| `a-refusal-code-is-made-where-its-family-lives` | under `src/` only, a string literal shaped `[A-Z]\d{3}` appears only in the directories its family letter names; tests carry codes of every family on purpose | `HOME = { D: core/src, runtime/src/project.ts; R L G P B T A C S: compiler/src/check; X: plugin-*/src }` | holds; the two `D` literals in the runtime's project loader (`badPlugin`, D006, and `badInclude`, D010, in `project.ts`) stay where they are and the table names them, since resolving an npm package is the runtime's knowledge, not the loader's |
| `a-fitness-function-is-one-claim` | every `fitness/*.fitness.ts` opens with the three header lines in order, exports exactly `claim`, `gather` and `judge`, has a `claim` equal to the header's Claim line, and holds no `describe` or `it` | none | new |
| `the-house-rules-hold-everywhere` | `biome.jsonc` carries every rule in the table at level `error` with its option; `files.includes` covers every `packages/*/src`, every `test/` and `fitness/`, with no negated pattern; the overrides are exactly the two the file justifies | `RULES` (complexity 10, 50 lines per function, 300 per file, 4 parameters, 3 nested callbacks, no nested ternary, no `!`, no `any`, names of 2 characters) | holds |
| `no-house-rule-is-suppressed` | no `biome-ignore` comment under `packages/`, `libraries/` or `fitness/` | `ALLOWED = []` | holds |
| `typescript-is-strict-in-every-package` | `tsconfig.base.json` has `strict: true`; every `packages/*/tsconfig.json` extends it and sets no `compilerOptions` but `rootDir` and `outDir`; every package is a reference of the root `tsconfig.json` | none | holds |

Each function separates gathering from judging: reading files is `gather`, and `judge` is a pure function over
what was gathered, so `fitness/sabotage.test.ts` can hand each judge a minimal violating input and expect the
named violation. Because a fitness file is a module and never a test, importing it registers nothing; that is
what lets the sabotage test import a judge, and it is the same reason Biome's `noExportsInTest` stands over
`fitness/` with no override. A fitness function that has never failed is unproved.

### Tooling

- **Parsing.** Two new devDependencies at the workspace root, both pure JavaScript: `@babel/parser`, for
  import specifiers, exported declarations and their leading comments, and `jsonc-parser`, for
  `biome.jsonc`. Neither is in the tree today. The installed `typescript` is the
  native 7.x compiler and exposes no parsing API. Shared helpers live in `fitness/lib/`.
- **Runner.** A root `vitest.config.ts` declares two projects: `packages`, the existing default pattern, and
  `fitness`, `fitness/**/*.test.ts`, which is `run.test.ts` and `sabotage.test.ts`; the fitness files are
  modules the runner loads. `npm run fitness` runs the second project alone.
- **Lint.** `biome.jsonc` adds `fitness/**/*.ts` to `files.includes` with no override: a fitness function
  is held to the full house rules, so one that grows past 50 lines is refused by the tool it defends.
- **Hook.** `.githooks/commit-msg`, a POSIX shell script; `package.json` gains
  `"prepare": "git config core.hooksPath .githooks"`, so `npm install` switches it on. It refuses a commit
  whose staged files include `fitness/` and whose message has no `^Decision: (adds|reconfigures|retires) fitness/`
  line. `--no-verify` bypasses it; that is the limit of a local hook, and the CI job is the one that binds.
- **CI.** `ci.yml` gains two jobs. `fitness` runs `npx vitest run --project fitness` after `npm ci`, with no
  build. `decision` is always present and skips itself, through an `if:` on the diff, when the pull request
  touches nothing under `fitness/`; otherwise it checks every such commit for the `Decision:` line and
  declares `environment: decisions`. The environment, created once in the repository's settings with the
  maintainer as required reviewer, holds the run until they approve it in the Actions tab. Environments allow
  self-review, which pull request review does not. Neither job blocks a merge until it is on the ruleset's
  list of required status checks, beside `lint, build, test` and `branch name`: unlisted, a failed `fitness`
  or a waiting `decision` is a badge the merge button ignores; listed, the pull request cannot merge until the
  check succeeds. GitHub counts a skipped required job as satisfied, which is why `decision` must exist on
  every run rather than be filtered out by path. Both are required: without it the approval is a notice, and
  the point of the design is that a change of decision is never merged past. Listing them is the maintainer's
  step, after each has run once on the repository, since GitHub offers only check names it has seen.
- **Template.** `.github/PULL_REQUEST_TEMPLATE.md` gains a line: `**Decision:** none` or the same sentence
  the commit carries. The commits are the record and the `decision` job reads them alone; the body line is a
  summary for the reader and is checked against nothing.

### Runtime behaviour

None.

### Discoverability

`ls fitness` is the index; the file names read as sentences. `fitness/README.md` says what a fitness
function is, how one is written, and how one is retired, and holds no table, since a table would drift from
the directory. `CLAUDE.md` gains one entry under "How to change things": a decision about the code is a
file under `fitness/`, a fitness function that bites is a design signal, and the `Decision:` line is the
maintainer's to write. `CONTRIBUTING.md` names the hook and the `decisions` approval under "Commits and pull
requests". Every failing fitness function names the offending file and the edit that fixes it.

### Plugin contract

None.

## Compatibility

None. No schema, document or IR changes. A consumer tree is unaffected; the suite is not published.

## Tests

The fitness functions are the tests, one each, registered by `fitness/run.test.ts` under the file's claim.
`fitness/sabotage.test.ts` proves each one bites: one `it` per fitness
function, feeding its exported judge a minimal input that violates the claim (a file text importing
`@wilanis/runtime` from a plugin's `src`, a `biome.jsonc` with `maxLines: 80`, an exported function without a
comment) and expecting the violation named. `fitness/a-fitness-function-is-one-claim.fitness.ts` holds the
suite to its own shape. The `commit-msg` hook is exercised by hand in the implementing pull request and its
behaviour stated in `fitness/README.md`; the CI jobs are seen to run on that pull request.

## Implementation plan

1. Scaffold: `vitest.config.ts` with the two projects, `fitness/run.test.ts`, `fitness/**/*.ts` in Biome's includes, the two
   devDependencies, `fitness/lib/` with the source and JSONC readers, `fitness/README.md`, and
   `a-fitness-function-is-one-claim`.
2. The import claims: `dependencies-point-one-way`, `the-engine-imports-nothing`,
   `the-compiler-imports-only-core-and-engine`, with their sabotage cases.
3. `every-public-function-says-what-it-answers`, and the doc comments on the 45 exports it finds.
   (`good first issue`: each comment says what the function answers, in one line.)
4. The structure claims: `a-kind-is-declared-once-and-mirrored`, `a-plugin-grants-files-not-objects`,
   `tests-live-beside-what-they-test`, `a-refusal-code-is-made-where-its-family-lives`.
5. The configuration claims: `the-house-rules-hold-everywhere`, `no-house-rule-is-suppressed`,
   `typescript-is-strict-in-every-package`. (`good first issue`.)
6. The gate: `.githooks/commit-msg` and the `prepare` script, the `fitness` and `decision` jobs, the
   pull request template line, the `CLAUDE.md` entry and the `CONTRIBUTING.md` paragraph. `CLAUDE.md`'s
   "no generated trailers" sentence under Commits gains the one exception: the `Decision:` line, which the
   maintainer writes by hand and no tool adds.
7. Maintainer's steps, not a pull request: create the `decisions` environment with themselves as required
   reviewer; add `fitness` and `decision` to the ruleset's required status checks once both have run on
   `main`, beside `lint, build, test` and `branch name`.

Tasks 2 to 5 depend on 1 and are independent of each other.

## Drawbacks and alternatives

**The numbers live twice.** `maxLines: 50` is in `biome.jsonc` and in `the-house-rules-hold-everywhere`.
This is the mirror this repository already uses between `model.ts` and the schemas, with `validate.ts` as
the join; the fitness function is the join here. One file is the enforcement and the other is the decision
with its reason and its retirement condition, and the test exists so that changing one without the other
fails.

**A sibling `*.adr.md` per fitness function** was considered. The pairing by file name is itself a rule
that needs enforcing and drifts, and an agent that trips the test would open a second file to learn why.
The docstring cannot be separated from the check, and one file per decision matches one file per RFC and
one module per rule family.

**dependency-cruiser, `tsarch` and `archunit` (ArchUnitTS)** express dependency rules between folders well,
and ArchUnitTS also finds import cycles inside a package. They were not adopted for three reasons. Both
ArchUnit ports parse with the TypeScript compiler API and declare `typescript` as a dependency (`tsarch` 5.4.1
pins `^3.8`, last published December 2024; `archunit` 2.4.0 pins `^5.9`), so either installs a second
TypeScript beside the native 7.x this workspace builds with. They cover three of the twelve claims, the
import rules; the other nine need a parser for comments, exports and configuration regardless, so Babel's
parser is in the tree either way. And the direction rule here is data-driven from nine `package.json` files,
which a fluent chain restates by hand, one pair at a time, when the RFC wants the fact read where it lives.
A cycle check inside a package, should it be wanted, is a depth-first search over the same import graph and
a thirteenth fitness function.

**CODEOWNERS on `fitness/` with required code owner review** is the native gate and was the first
proposal. With one maintainer it deadlocks: GitHub never lets an author approve their own pull request, so
the maintainer's own changes to `fitness/` could not merge without a bypass actor, and a bypass is a habit.
An Actions environment with a required reviewer allows self-approval and is free on a public repository,
so the `decision` job is the gate instead.

**A pre-push hook** instead of `commit-msg` was suggested. `commit-msg` fires when the decision is made
and has the message in hand; `pre-push` would re-derive the commits in the range. Either is bypassable;
the CI job is what binds.

**TypeScript 6 for its compiler API** would restore a parser without a new dependency, at the cost of the
last JavaScript-based release: a clean build measured 2.58 s under 6.0.3 against 0.38 s under 7.0.2, and
the 7.x API to come has a different shape. The suite needs a parser, not a type checker.

**Python** for the suite would add a second runtime, package manager, lockfile, linter and CI step to a
repository whose whole test story is `npm test`, and would still need a TypeScript parser (tree-sitter, a
native binding). It would also lose the property that Biome holds the fitness functions to the rules they
pin.

**A hook is bypassable and an approval is a click.** Neither stops a determined maintainer from changing a
decision on a whim; nothing mechanical can, since the token is theirs. What the design guarantees is that
the change is never silent: it is named in a commit, listed in the pull request, and approved by a hand
outside any agent's reach.

## Decided during implementation

None. Every question this RFC raised was settled before acceptance: commits are the record of a decision,
the runtime's two `D` literals stay where they are, and both jobs are required status checks. The
review before acceptance corrected four facts: Babel's parser is a new dependency, 45 exports lack a doc
comment, the viewer renders `graph` outside `renderDocPage`, and the refusal-code claim is scoped to `src/`.

Amended once task 1 began: a fitness file was first specified as a test file exporting its judge. Biome's
`noExportsInTest` refused the first one, and rightly: importing a vitest test file registers its tests again
in the importer. A fitness file is now a module exporting `claim`, `gather` and `judge`, and one runner
registers the tests. One file per decision, no override, and the sabotage test imports nothing that runs.
