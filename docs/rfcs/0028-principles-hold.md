# RFC 0028: The principles hold: four sentences of `CLAUDE.md` that nothing held, and the two claims not to write

- **Status:** draft
- **Areas:** `area:process`, `area:core`, `area:compiler`, `area:plugin-blob`
- **Tracking issue:** #111
- **Depends on:** RFC 0027

## Summary

Four more fitness functions under `fitness/`, each holding a sentence `CLAUDE.md` states under "Principles"
and nothing enforces today: a refusal says how to fix it (`hint` becomes required on `Refusal` and `Refuser`,
and 56 refusals that pass none are given one); a schema describes every property (90 properties under
`packages/core/schemas/` are described); a blob is never read whole outside the codecs that need a body
entire (one call in `@wilanis/plugin-blob` is fixed or named); and only the guard knows who is calling (no
other plugin and no trigger kind spells `principal`, `session`, `challenge`, `credential` or `policy`). One
existing claim, `a-fitness-function-is-one-claim`, gains a rule about `fitness/lib/`: an export a claim does
not name is a reader nobody reads. Two claims that were proposed alongside these are recorded here as
rejected, with the measurements that rejected them: a structural-similarity threshold over function bodies,
and a cross-check that feeds every claim's sabotage cases to every other claim's judge. Nothing changes in a
tree, a document kind or the runtime; two published TypeScript types change shape.

## Motivation

RFC 0027 turned twelve sentences of `CLAUDE.md` into tests. Reviewing what it left out began from three DRY
violations found *by reading* the suite it had just built: `sourceFiles` and `entriesUnder` in
`fitness/lib/sources.ts` were the same recursive walk with a different filter, written four tasks apart;
`fileExists` and `statOf` both wrapped `statSync` in a `try`; `statementsOf` and `Manifest` were exported and
used by nothing outside `lib/`. Pull request #110 folded them. The question that followed was whether the
three principles themselves -- DRY, Orthogonality, Discoverability -- could be held the way the import rules
now are, and the first answer offered was that DRY has a mechanical signature (duplication) while the other
two do not.

Measured against the code, that answer is wrong in both directions, and this RFC records why. Duplication
does not have a clean signature: at any threshold that catches the `sourceFiles`/`entriesUnder` pair it
also catches the compiler's designed entry points (the numbers are under "Drawbacks and alternatives").
But four sentences under "Principles" do have one, none of them import-shaped, and each is false or
unguarded today:

- "Every refusal has a code, a file, an `at` path and a hint that names the command or the edit that fixes
  it." `Refusal.hint` is optional in `packages/core/src/registry.ts` and so is the fourth parameter of
  `Refuser` in `packages/compiler/src/check/judge.ts`. Under `packages/compiler/src/check`, 46 of the 118
  `refuse(...)` calls that spell a code pass no hint (`bindings.ts` 12 of 17, `graph-nodes.ts` 9 of 10,
  `triggers.ts` 7 of 18, `graph-whole.ts` 5 of 9, `project.ts` 4 of 13); in core, 10 of the 23 refusal
  literals do (`documents.ts` 6, `load.ts` 4). An agent in a repair loop reads `B001 operation 'x' of 'p'
  is not bound` and is left to guess the edit.
- "Every document kind has a schema with descriptions." Under `packages/core/schemas/` and its `node/`
  directory there are 195 properties; 116 carry no `description` of their own. 26 of those are a `$ref` to
  a definition that describes itself, which is a description by reference; 90 are not: 78 plain
  properties (`feature.dependsOn`, `binding.operations`, `graph.out`, every kind's own `description`
  field) and 12 `$ref`s to a definition that says nothing either (`policy.decide.in`,
  `port.operations.*.accepts`, `common.$defs.field.type`). 3 of the 11 `$defs` are undescribed. These are
  the files an agent reads to write a document.
- "Never buffer a blob whole beside the store." `readAll` in `packages/core/src/plugin.ts` says in its own
  doc comment "A blob codec never calls this." `packages/plugin-blob/src/index.ts:126`, the handler of
  `@blob/text#read`, calls it on a blob opened from the store. Whether that is a violation or the one
  operation whose answer *is* the whole text is a decision nobody has made in a place that holds.
- "Who is calling is the guard's business ... no kind ever checks access." True today -- outside the guard,
  `principal`, `session`, `challenge`, `credential`, `policy` appear in `packages/plugin-http/src` only in
  two comments -- and nothing keeps it so. A trigger kind that starts reading a cookie into a session is one
  pull request away, and `dependencies-point-one-way` would not notice: no import changes.

The suite's own `lib/` has the same gap in miniature. RFC 0027 says a reader in `lib/` "never knows a
claim", and #110 showed the converse fails silently: a reader no claim names is dead code that lints clean.

This RFC does not add metrics, for the reason RFC 0027 gave and this review confirmed by measurement. It does
not judge documents or trees: whether a field under an operation's `accepts` must carry a description is a
schema decision (`port.schema.json` already requires one on the port and on each operation), and a plugin's
`docs/` are documents the checker validates, not schemas this suite reads. It does not add a
cross-check of the suite against itself. And it does not adopt the similarity script that produced the
numbers below as a command of the repository; that is argued under "Drawbacks and alternatives".

## Guide-level explanation

Nothing changes for an author of a tree. What changes is what `wilanis check` owes them: every refusal ends
with a line that begins `→` and names a command or an edit, because the type no longer lets a rule omit
one. Today `B001` reads

```
B001  features/orders/domain/orders.port.json
    operation 'cancel' of 'features/orders/domain/orders.port.json' is not bound
```

and after this RFC it reads

```
B001  features/orders/domain/orders.port.json
    operation 'cancel' of 'features/orders/domain/orders.port.json' is not bound
    → add 'cancel' under operations in the binding, or wilanis new binding <feature>/<name> --port <path>
```

For someone changing this repository, each new decision is one file under `fitness/`, in the shape RFC 0027
fixed: three header lines, then `claim`, `gather`, `judge`, `sabotage`. The claim about refusals pins the
enforcement rather than duplicating it -- `tsc -b` is what refuses a hint-less `refuse(...)` once `hint` is
required, and the fitness function holds the two type declarations to that shape, the way
`the-house-rules-hold-everywhere` holds `biome.jsonc`:

```ts
/**
 * Claim: a refusal says how to fix it.
 * Why: `CLAUDE.md` promises "a hint that names the command or the edit that fixes it" on every refusal, and an
 *   agent in a repair loop reads nothing else. The promise was a sentence: `hint` was optional on `Refusal`
 *   and on `Refuser`, and 56 refusals passed none. Requiring it makes `tsc -b` the enforcement; this file
 *   holds the two declarations to it, so a pull request cannot make the field optional again in one line.
 * Retire when: refusals carry structured fixes (an edit, a command) in a field of their own, and an RFC says
 *   which; a string that is sometimes empty is not that.
 */
import { optionalMembersOf, textOf } from './lib/types.js';

/** The two declarations every refusal passes through, and the member each must not make optional. */
const SHAPES = [
  { file: 'packages/core/src/registry.ts', name: 'Refusal', member: 'hint' },
  { file: 'packages/compiler/src/check/judge.ts', name: 'Refuser', member: 'hint' },
];

export const claim = 'a refusal says how to fix it';

export const gather = () =>
  SHAPES.map(shape => ({ ...shape, optional: optionalMembersOf(textOf(shape.file), shape.name) }));

export const judge = (shapes: ReturnType<typeof gather>): string[] =>
  shapes
    .filter(shape => shape.optional.includes(shape.member))
    .map(shape => `${shape.file} declares ${shape.name}.${shape.member} optional; every refusal names its fix, so require it`);

export const sabotage = [
  {
    input: [{ file: 'packages/core/src/registry.ts', name: 'Refusal', member: 'hint', optional: ['at', 'hint'] }],
    violation: 'packages/core/src/registry.ts declares Refusal.hint optional; every refusal names its fix, so require it',
  },
];
```

The claim about the guard's vocabulary reads words, not imports. A trigger kind that begins to spell
`session` fails with the file and the design signal:

```
 FAIL  fitness/run.test.ts > only the guard knows who is calling
AssertionError: see fitness/only-the-guard-knows-who-is-calling.fitness.ts
- Expected  []
+ Received  ["packages/plugin-http/src/serve.ts spells session; a kind hands the credential to the guard through the trigger's policy attachment and never reads who is calling"]
```

## Reference

### Documents and schemas

No kind and no field changes. Every `*.schema.json` under `packages/core/schemas/` and
`packages/core/schemas/node/` gains a `description` on each property that has none and is not a `$ref` to a
definition that has one, and the three undescribed `$defs` in `common.schema.json` gain theirs. A
description is an annotation: validation of every document is unchanged.

### Ports, operations and kinds granted

None.

### Checker rules

None new. Every existing rule that refuses without a hint gains one; the code, the message and the `at` are
unchanged. The hint names the command (`wilanis describe <path>`, `wilanis ls port`, `wilanis new ...`) or
the edit, in the form the rules that already carry one use.

### Runtime behaviour

None, unless the open question on `@blob/text#read` is decided as a fix, in which case that handler
changes and nothing else does. `formatRefusal` in `packages/core/src/registry.ts` prints the `→` line
unconditionally once the field is required.

### Discoverability

`wilanis check` prints a fix under every refusal. The viewer already lists each document's refusals
(`packages/view/src/model.ts` filters `checkTree` by file) and draws the hint when there is one
(`client/index.html`, the `.hint` line under a refusal); after this the line is there on every refusal, since
the field is no longer sometimes absent. The schemas, served from `main` and linked from every document's
`$schema`, describe every property a reader can write.

### Plugin contract

`PluginCheckContext.refuse` in `packages/core/src/plugin.ts` takes a `Refusal`; with `hint` required, a
plugin's `check` must name the fix for every X rule. The four in-tree plugins already do (`plugin-http/src/
rules.ts`, `plugin-auth/src/rules.ts` pass a hint on every refusal). No other member of `PluginModule`
changes.

### The fitness functions

One file each, in the form of RFC 0027's table. "Data" is the constant at the top of the file; "Today" says
whether the claim holds on `main` at the time of writing, which the implementing task confirms or repairs.

| File | Claim | Data | Today |
|---|---|---|---|
| `a-refusal-says-how-to-fix-it` | `Refusal` in `packages/core/src/registry.ts` and `Refuser` in `packages/compiler/src/check/judge.ts` do not declare `hint` optional | `SHAPES` (the two declarations and the member) | fails: both declare `hint?`; 46 of 118 `refuse(` calls under `compiler/src/check` and 10 of 23 refusal literals in `core/src` pass none (the 12 literals in the runtime's loader and the plugins' X rules all carry one). The implementing task writes the 56 hints, then requires the member. `at` stays optional: 12 of the 23 core literals refuse a file as a whole (unreadable, of no known kind), where no path into the document exists |
| `a-schema-describes-every-property` | every property of every `*.schema.json` under `packages/core/schemas/` and `node/` carries a `description`, or is a `$ref` to a definition that does; every `$defs` entry carries one | `SCHEMAS = ['packages/core/schemas', 'packages/core/schemas/node']` | fails: 195 properties, 90 violations (78 plain, 12 `$ref` to an undescribed definition), 3 of 11 `$defs` undescribed. The implementing task writes them |
| `a-blob-is-never-read-whole` | under `packages/*/src`, `readAll` is imported from `@wilanis/core` only by the files the table names | `MAY_READ_WHOLE = { 'packages/plugin-http/src/codecs.ts': 'the JSON, text and form codecs need the body entire; the blob codec streams' }`, plus the entry the open question decides | fails on `packages/plugin-blob/src/index.ts` until the open question is decided; the http codecs are the only other importer |
| `only-the-guard-knows-who-is-calling` | no identifier and no string literal under `packages/plugin-*/src` other than the guard's, nor under `packages/runtime/src/plugins/`, is one of the guard's words | `GUARD = 'packages/plugin-auth'`, `KINDS_OF_THE_RUNTIME = 'packages/runtime/src/plugins'`, `WORDS = ['principal', 'session', 'challenge', 'credential', 'credentials', 'policy', 'policies']` | holds: `plugin-http/src` carries `policy` in two comments (`serve.ts:177`, `answer.ts:121`), which a reader of identifiers passes over. The embedder, `discovery.ts`, `stubbing.ts`, `scaffolds.ts` and the view know the words because they run, print, rehearse, scaffold and show the gate; they are outside the claim's scope by design, not exempted by data |
| `a-fitness-function-is-one-claim` (amended) | as today, and: every export of `fitness/lib/*.ts` is imported by a `*.fitness.ts`, or is a type named in the signature of an export that is | none | holds: `Export` in `lib/sources.ts` is the one export no claim imports, and it is the return type of `exportsOf`, which `every-public-function-says-what-it-answers` imports |

Each claim reads the repository through a reader in `fitness/lib/`, which answers a question and never a
claim, and each reader lands with the first claim that needs it, since the amended one-claim rule refuses a
reader nobody reads:

- `optionalMembersOf(text, name)`: the members an interface or a function-type alias declares optional, by
  Babel's `TSInterfaceDeclaration` and `TSTypeAliasDeclaration` nodes. In a new `lib/types.ts`, since
  `sources.ts` is at 169 lines and answers questions about imports and exports.
- `propertiesOf(schemas)`: every property of a set of parsed schemas as `{ file, path, described, ref }`,
  walking `properties`, `items`, `additionalProperties`, `patternProperties`, `oneOf`/`anyOf`/`allOf`,
  `then`/`else`/`not` and `$defs`, with each `$ref` resolved within the set. In a new `lib/schemas.ts`.
- `namedImportsOf(text)`: each import statement as `{ from, names }`, so a claim can ask who imports one
  name of a package. In `sources.ts`, beside `importsOf`.
- `wordsOf(text)`: every identifier and every string literal of a file, comments excluded, so a claim can
  hold a vocabulary. In `sources.ts`.

The amended one-claim rule needs no reader beyond `textOf` and `entriesUnder`: it matches `export` lines in
`lib/` and `import { ... } from './lib/` lines in the claims, as its `exportedNames` already does for the
four owed exports.

## Compatibility

No schema, document or IR changes; a document written before this RFC validates and means the same, and
gains descriptions in the schema it points at.

**Requiring `hint` is a breaking change to two published TypeScript types.** `Refusal` is exported by
`@wilanis/core` and is the parameter of `PluginCheckContext.refuse`, so a third-party plugin whose `check`
refuses without a hint stops compiling against the new core. `Refuser` is internal to the compiler's
checker and not re-exported, so its change is felt inside `packages/compiler/src/check` alone -- the 46
call sites task 2 gives a hint. The cost is cheap now for one reason
only: nothing is published. Every package is at `0.1.0`, `npm run release` refuses until HEAD is tagged
`schemas-v1` (RFC 0008), and there is no plugin outside this workspace to break. After
1.0 the same edit is a major version of `@wilanis/core` and `@wilanis/compiler` and a migration note for
every plugin author. That is why it goes in before the tag, and why the fitness function exists: to make the
field's shape a decision that is changed on purpose, not a line that drifts back to optional.

## Tests

The fitness functions are the tests, registered by `fitness/run.test.ts`: one test under each claim and one
proof, "<claim> bites", over its `sabotage` cases. The cases: a `registry.ts` text declaring `hint?: string`;
a schema with a plain undescribed property, one with a `$ref` to an undescribed definition, and an
undescribed `$defs` entry; a file under `packages/plugin-blob/src` importing `readAll` from `@wilanis/core`;
a file under `packages/plugin-http/src` with the identifier `session`; a `lib/` file exporting `unused`
that no claim imports, and one exporting a type named in an imported function's signature, which passes.

The 56 hints are not tested for content: `packages/runtime/test/example.test.ts` already sabotages the
example into every code, and `formatRefusal` prints whatever hint the rule passed. What the type holds is
that there is one. The 90 descriptions are held the same way: `validate.ts` still validates every document
against the changed schemas, and `packages/core/test/validate.test.ts` still passes, which is the proof an
annotation changed nothing else.

## Implementation plan

Every task that adds or amends a fitness function carries a `Decision: adds fitness/<file>` or
`Decision: reconfigures fitness/<file>` line, and waits in the `decisions` environment once RFC 0027's step
6 (#108) has landed. Tasks 2 and 4 change shipped code, not only the suite. The two `good first issue`
tasks of RFC 0027 were taken in-house by the maintainer; the two below are marked all the same.

1. **Amend `a-fitness-function-is-one-claim`** with the `lib/` export rule and its two sabotage cases.
   `Decision: reconfigures`. Holds today. (`good first issue`.)
2. **Write the 56 hints**: 46 under `packages/compiler/src/check` (`bindings.ts`, `graph-nodes.ts`,
   `triggers.ts`, `graph-whole.ts`, `project.ts`, `graph.ts`, `inputs.ts`, `judge.ts`, `graph-reads.ts`),
   10 in `packages/core/src/documents.ts` and `load.ts`. Each names the command or the edit, in the form
   the rules that already carry one use (`wilanis describe`, `wilanis ls port`, `wilanis new`, or the field
   to write). No type changes yet, so it merges on its own. (`good first issue`.)
3. **`a-refusal-says-how-to-fix-it`**: `hint` required on `Refusal` and `Refuser`; `lib/types.ts` with
   `optionalMembersOf`; the claim. Depends on 2. `Decision: adds`.
4. **`a-blob-is-never-read-whole`**: `namedImportsOf` in `lib/sources.ts`; the claim, with
   `MAY_READ_WHOLE` as the open question decides it, and the `@blob/text#read` handler changed if the
   decision is a fix. `Decision: adds`.
5. **Write the 90 descriptions** and the three on `$defs`, then **`a-schema-describes-every-property`**:
   `lib/schemas.ts` with `propertiesOf`; the claim. One pull request, since the schemas are served from
   `main` and the claim fails until they are written. `Decision: adds`.
6. **`only-the-guard-knows-who-is-calling`**: `wordsOf` in `lib/sources.ts`; the claim. Holds today.
   `Decision: adds`.

Task 1 first, since it changes what tasks 3 to 6 may leave exported. Tasks 4, 5 and 6 are independent of
each other and of 2 and 3.

## Drawbacks and alternatives

**Two more `lib/` files and four readers** for four claims. RFC 0027 bounded `lib/` to readers that answer
one question each, and these do; the amended one-claim rule is what keeps them from outliving the claim
that needed them.

**`hint` could stay optional and a claim count the call sites instead**, by parsing every `refuse(...)` and
`{ code, file, message }` literal for a fourth argument or a `hint` key. That is a second copy of what the
type checker does for free once the member is required, and it misses a refusal built any other way. The
type is the enforcement; the claim pins the type.

**A structural-similarity claim was proposed and is rejected.** The proposal: normalise every function body
to a skeleton (identifiers to `N`, string literals to `S`, comments stripped), compare pairs within
`fitness/lib/` and each `packages/*/src`, refuse pairs above a threshold, with `ALIKE_ON_PURPOSE = []` as
data. Measured on `main` (Dice coefficient over token bigrams of the normalised bodies, bodies of at least
12 tokens):

| scope | bodies | ≥ 0.9 | ≥ 0.8 | ≥ 0.7 | ≥ 0.6 |
|---|---|---|---|---|---|
| `fitness/` | 58 | 2 | 2 | 6 | 12 |
| `packages/compiler/src/check` | 137 | 6 | 12 | 38 | 220 |
| `packages/core/src` | 143 | 2 | 4 | 11 | 63 |
| `packages/runtime/src` | 190 | 2 | 3 | 14 | 142 |
| `packages/plugin-http/src` | 51 | 0 | 1 | 5 | 17 |

At 0.9, the six compiler pairs are every pairing of the three-line family entry points `checkPolicy`,
`checkTrigger`, `checkAccess`, `checkGraph` and `checkInputs` -- `new Family(judge, doc).check()` -- which
are the seam `judgeTree` runs and the shape `CLAUDE.md` asks for, not duplication. `fileExists` and
`dirExists` in `fitness/lib/sources.ts` score 1.00 and differ in `isFile` against `isDirectory`;
`parse.ts:or` and `parse.ts:and` in core score 1.00 and are two precedence levels of one parser. The pair
that motivated the proposal, `sourceFiles`/`entriesUnder`, needed a threshold near 0.9 to be caught at all,
and at that threshold the exemption list fills on the first run. Below 0.8 the compiler alone yields 38 to
220 pairs. The claim would need two constants -- the threshold and the minimum body length -- and its
violation would read "A resembles B at 0.91", which names no edit. RFC 0027 says "this RFC does not add
metrics"; a tunable similarity number is one, and Biome's lack of clone detection does not exempt it. The
genuine finds the measurement made (`fuzz.ts:fakeEnvFor` against `stubbing.ts:fakeEnv` at 0.96;
`a-kind-is-declared-once-and-mirrored.fitness.ts:listed` against `keyed` at 1.00; `discovery.ts:
graphWriters` against `bindingWriters` at 0.92) are the kind a reviewer reads once, not a gate a pull
request fails.

**The measurement script is not adopted as `npm run alike`.** It was considered as a report with no
threshold and no gate. A script under `fitness/` that is neither a claim nor a reader breaks the rule that
directory states, and a `scripts/` directory would be a new home for one file. The three finds above go to
issues; the script is sixty lines anyone can write again from the description in the previous paragraph.

**A cross-check of the suite against itself was proposed and is rejected.** The proposal: feed every
claim's `sabotage` inputs to every other claim's `judge` (12 × 12 = 144 pure calls) and refuse where two
judges fire on one input, with the known overlaps as data. On the twelve files as written, the judges take
eleven distinct input shapes: `{ file, imports }[]` is shared by the engine and compiler import claims, and
the rest are `Package[]`, `{ file, exports }[]`, `Mirrors`, `{ dir, manifest, files }[]`, `Made[]`,
`{ file, text }[]`, `{ file, line, text }[]`, `{ dir, tests }[]`, `{ rules, includes, overrides }` and
`{ strict, references, packages }`. Cross-feeding is a type error under `strict` without an `as never`, and
at runtime it produces false overlaps rather than nothing: `the-house-rules-hold-everywhere.judge` given
any array reads `found.rules[name]` as `undefined` and reports eight "biome.jsonc carries no ..." violations;
`typescript-is-strict-in-every-package.judge` reports a missing `strict`; `a-kind-is-declared-once-and-
mirrored.judge` throws on `mirrors.kinds.flatMap`. The one real overlap -- an import from the engine or the
compiler is refused by its own claim and by `dependencies-point-one-way`, which the maintainer chose to keep
-- is invisible to it, because the engine claim's sabotage input is not a `Package[]`. What would remain is
a hand-maintained list of intended overlaps: a changelog, not a decision.

**The argument that DRY alone is mechanical, and Orthogonality and Discoverability are not,** was the
premise of both rejected claims. The table above is the case against the first half; the four claims of
this RFC are the case against the second. What is true is narrower: a sentence like "the compiler never
learns about HTTP" has an import-shaped shadow (RFC 0027 holds it), a sentence like "no kind ever checks
access" has a vocabulary-shaped one (this RFC holds it), and a sentence like "the request is read in three
places only" is a rule about trees, which the checker holds (`graph-reads.ts`, A001) and no fitness function
should. Green on the whole suite means every sentence with a shadow still casts it; it does not mean the
principles hold, and no claim's header should say otherwise.

## Open questions

- **`@blob/text#read`: fix or name?** `packages/plugin-blob/docs/text.port.json` already says of the port
  "read whole as one string ... for anything larger than a value should be, prefer an operation that reads
  the blob as rows", and the operation's answer *is* the whole text: there is no copy beside the store, the
  string is the value the caller asked for. The recommendation is to name it in `MAY_READ_WHOLE` with that
  reason, so `readAll`'s doc comment is corrected to "a blob *codec* never calls this; the one operation
  that answers a file as text does". The alternative is a fix -- a static `limit` on `read`, refused beyond
  -- which is a feature `CLAUDE.md` says to stop and ask about. Decide before `accepted`.
- **Does `at` stay optional?** Yes as proposed: 12 refusals in core refuse a file as a whole (it cannot be
  read; its kind is unknown), and a path into a document that could not be parsed is a fiction. The claim
  pins `hint` alone. If the maintainer prefers `CLAUDE.md`'s sentence taken literally, `SHAPES` gains
  `at` and the 12 gain a path of `/`; that is a `Decision: reconfigures`, not a new claim.
- **Is a `$ref` to a described definition a description?** Yes as proposed; 26 properties rely on it, and
  the alternative is 26 sentences repeating what `common.schema.json` says once. Decide before `accepted`.
- **The word list.** `token` is not among the guard's words on purpose: core's expression lexer speaks of
  tokens and a trigger kind may too. Whether `cookie` belongs there -- the http kind hands one to the guard
  and must be able to spell it -- is settled the same way: it does not. May be decided during
  implementation.
