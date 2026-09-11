# RFC 0019: Diagnostics designed for an agent's repair loop

- **Status:** accepted
- **Areas:** `area:core`, `area:compiler`, `area:runtime`, `area:view`
- **Tracking issue:** #21
- **Depends on:** none. RFC 0018 restructures what `rehearse` and `regress` answer (a recorded branch, a scenario's
  `reason`); this RFC prints whatever they answer as JSON, so whichever lands second adds its fields to the other's
  envelope; `scenarios --check --json` reads RFC 0018's `wilanis scenarios --check` and lands after it. RFC 0026's
  manifest is a separate command that this RFC's output does not embed; the two share the stability promise written
  here. RFC 0014 gives a *run's* refusal its word; this RFC is about the *checker's* refusals, and says so under
  *Words*.

## Summary

`wilanis check --json` prints every refusal of a tree as one sorted JSON object, and `rehearse --json`, `regress
--json` and `scenarios --check --json` print what those commands already compute -- decisions and branches, scenarios
and diffs, the stale files RFC 0018's check finds -- instead of the lines they render from it. A refusal in that
output is the `Refusal` the checker makes today (`code`, `file`, `at`, `message`, `hint`) plus its `family`, a `url`
to a page about the code, and, where the rule can prove the edit, `fixes`:
one or more alternative edits against the JSON document -- `set`, `add`, `remove` a value at a path, or `move` a file --
that an agent applies without reading the message. Three rules carry fixes in the first cut: L003 adds the effect the
feature does not allow, R001 sets a misspelled operation name to the nearest one, D008 moves a document into the one
directory its kind may live in; a fix is offered only where the test suite proves it repairs the sabotaged example.
Every code gets a page, `docs/refusals/<CODE>.md`, and the pages are the inventory a fitness function holds the code
to: a code with no page, a page whose rule is gone, or a retired code that reappears is a failing test. From 1.0 on,
the codes, the `at` grammar, the fix grammar and the envelope's fields are promised stable; the wording of a message
or a hint is not.
The template's `CLAUDE.md` tells an agent to loop on the JSON: apply a fix when one is offered, read the hint when
none is, re-check after every edit, and fix the first refusal in a file before the ones below it.

## Motivation

The checker already speaks to an agent, and the README's claim that "a small, cheap model does this correctly and
fast" rests on that speech: 62 codes in 11 families, each with a `hint` the type requires (the fitness function
`a-refusal-says-how-to-fix-it` holds `Refusal.hint` and `Refuser.hint` to it). What is missing is the difference between a
habit and a contract.

- **The output is prose, parsed by regex or not at all.** `check` in `packages/runtime/src/cli.ts` prints
  `RefusalList.format()` to stderr -- `L003  @features/monitor/data/get-row.graph.json#nodes/asked`, the message
  indented, the hint after an arrow -- then `6 refusal(s)` and exits 1. An agent that wants the code and the path
  splits on two spaces and a `#`. `rehearse` and `regress` answer `{ ok, lines }` (`Rehearsal` in `rehearse.ts`,
  `regress` in `fuzz.ts`), and the `Decision[]` that `rehearse` gathers -- graph, switch, triggers, branches, what
  each settled to -- is rendered by `format` in `rehearsal-report.ts` and thrown away.
- **Nothing says a code means the same thing tomorrow.** The 62 codes are string literals spread over
  `packages/compiler/src/check/`, `packages/core/src/` and the plugins' `check`. Three numbers are skipped -- D002,
  G002, L004 are produced by no rule (`D002` survives in a doc comment on `Registry.add`) -- and nothing records
  whether they were retired or never used, so nothing stops the next rule from taking one and giving an old
  transcript a new meaning. The one inventory in words is the rule list in `packages/runtime/templates/CLAUDE.md`,
  and it has already drifted: the template, `packages/plugin-auth/docs/session.port.json` and
  `libraries/access/features/access/data/write-theme.graph.json` all cite an **X104** for a session write outside the
  shape, and the rule shipped as X103 (`packages/plugin-auth/src/rules.ts`). No test could have caught it, because no
  file is the list.
- **`at` has two grammars.** The checker addresses a graph's node by id -- `nodes/asked/in`, `nodes/route/rules/0/when`
  -- so a reorder of nodes moves nothing. D001, made from the schema validator's `instancePath` in
  `packages/core/src/validate.ts` (`groupByPath`), addresses the same node by index: `nodes/0/in`. An agent that
  learns one form from a checker refusal applies it to a schema refusal and edits the wrong node.
- **The fix is said, never given.** L003's hint is `add "@http/http.port.json#request" to @features/monitor/feature.json
  → effects`: a file, a path and a value, written as a sentence. R001's message lists the operations the port has
  (`operations: request`) and its hint says `wilanis ls port`, leaving a one-letter typo for the reader to spot.
  D008's hint spells the destination path in full. For each, the rule computed the edit and then wrote it in words;
  a cheap model reads the words back into an edit and sometimes gets it wrong.
- **A refusal has no long form.** A hint is one line, and the sentence that explains a rule lives in the doc comment
  of the function that makes it and in the title of the sabotage test that proves it (`it('A005 a policy reading the
  caller on a trigger that gives the guard nothing')`). Neither is where an agent, or a person on a pull request, can
  be pointed.
- **Cascades look like six problems.** Misspell one `run` and `check` prints R001 and two G011s (the switch's rules
  read `status`, which the unresolved node no longer provides); move one graph and it prints D008, R001 and two
  T006s. An agent that fixes all four at once removes a refusal map that was right. The order the rules run in,
  and the file a refusal names, already say which one is the cause; nothing tells the agent to use that.

The roadmap's M13 is "break the example, run `wilanis check --json`, and a small model repairs it in a loop from the
diagnostics". This RFC is the `--json`, the contract behind it, and the pages the contract points at.

**What this does not try to solve.** It does not apply fixes: no `wilanis check --fix`; an agent (or the test that
proves a fix) applies an edit, and whether the CLI should is an open question below. It does not add a refusal code
or change what any rule refuses; it changes how a refusal is carried. It does not make messages or hints stable, and
says so. It does not print a run's outcome as JSON (`wilanis run` already writes the report with `--out`; RFC 0006 and
RFC 0014 own that). It does not embed the manifest (RFC 0026) in `check --json`. It does not adopt SARIF; the
alternative is weighed at the end.

## Guide-level explanation

**Words.** A *refusal* here is what the checker makes when it will not accept a tree: a `Refusal` object with a
`code`, the `file` it is about, where in the file (`at`), what is wrong (`message`) and the direction of the fix
(`hint`). This is a different thing from a run's refusal in RFC 0014 -- a graph deciding `missing` on purpose -- and
where the two could be confused this RFC says *checker refusal*. A *code* is the rule's name, a family letter and three
digits; the *family* is the letter. A *fix* is one edit to one document, or one file move, that removes the refusal;
`fixes` is a list of alternative fixes, the first preferred. A *page* is the long form of a code, one file under
`docs/refusals/`. The *envelope* is the JSON object a `--json` command prints. A *transcript* is the sequence of
envelopes an agent sees while repairing a tree; because each is sorted, two are diffable.

**The loop, today and after.** Remove `@http/http.port.json#request` from the monitor feature's `effects` and run
the checker:

```
$ wilanis check example
L003  @features/monitor/data/create-row.graph.json#nodes/asked
    node 'asked' runs effectful '@http/http.port.json#request' which the feature does not allow
    → add "@http/http.port.json#request" to @features/monitor/feature.json → effects
L003  @features/monitor/data/delete-row.graph.json#nodes/asked
    ...
6 refusal(s)
```

That output stays exactly as it is. Beside it:

```
$ wilanis check example --json
{
  "format": 1,
  "runtime": "0.1.0",
  "command": "check",
  "root": "example",
  "ok": false,
  "documents": 140,
  "refusals": [
    {
      "code": "L003",
      "family": "L",
      "file": "@features/monitor/data/create-row.graph.json",
      "at": "nodes/asked",
      "message": "node 'asked' runs effectful '@http/http.port.json#request' which the feature does not allow",
      "hint": "add \"@http/http.port.json#request\" to @features/monitor/feature.json → effects",
      "url": "https://github.com/wilanis/wilanis-js/blob/main/docs/refusals/L003.md",
      "fixes": [
        { "file": "@features/monitor/feature.json", "at": "effects", "add": "@http/http.port.json#request" }
      ]
    },
    { "code": "L003", "family": "L", "file": "@features/monitor/data/delete-row.graph.json", "...": "the same fix" },
    { "code": "L003", "family": "L", "file": "@features/monitor/data/get-row.graph.json", "...": "the same fix" },
    { "code": "L003", "family": "L", "file": "@features/monitor/data/list-rows-by-method.graph.json", "...": "..." },
    { "code": "L003", "family": "L", "file": "@features/monitor/data/list-rows.graph.json", "...": "..." },
    { "code": "L003", "family": "L", "file": "@features/monitor/data/update-row.graph.json", "...": "..." }
  ]
}
```

Six refusals, one fix: every one names the same edit to the same file, and `add` is idempotent -- applying it six
times appends the value once. An agent reads `fixes[0]`, opens `@features/monitor/feature.json`, appends the string
to the list at `effects`, and runs `check` again: `{ "ok": true, "documents": 140, "refusals": [] }`. It read no
message.

**A fix that is a guess made honest.** Misspell the operation in `get-row`'s `asked` node as `#requst`:

```json
{
  "refusals": [
    {
      "code": "R001", "family": "R",
      "file": "@features/monitor/data/get-row.graph.json", "at": "nodes/asked/run",
      "message": "port '@http/http.port.json' has no operation 'requst' (operations: request)",
      "hint": "wilanis ls port",
      "url": "https://github.com/wilanis/wilanis-js/blob/main/docs/refusals/R001.md",
      "fixes": [ { "file": "@features/monitor/data/get-row.graph.json", "at": "nodes/asked/run", "set": "@http/http.port.json#request" } ]
    },
    {
      "code": "G011", "family": "G",
      "file": "@features/monitor/data/get-row.graph.json", "at": "nodes/route/rules/0/when",
      "message": "rule 0: 'status' is not an input of this node (inputs: none)",
      "hint": "write when as an expression over this node's inputs",
      "url": "https://github.com/wilanis/wilanis-js/blob/main/docs/refusals/G011.md"
    },
    { "code": "G011", "family": "G", "file": "@features/monitor/data/get-row.graph.json", "at": "nodes/route/rules/1/when", "...": "..." }
  ]
}
```

R001 offers `request` because it is the one operation of the port within two edits of what was written; had the port
had `request` and `requests`, or nothing near, it would offer none and the hint would stand alone. The two G011s carry
no fix and need none: they are the same typo seen from the switch that reads the node. The template tells the agent
what the sort order already says -- in one file, take the first refusal, apply it, check again -- and the second run
is empty. Had it "fixed" the G011s by rewriting the rules, it would have broken the graph to satisfy a symptom.

**A fix that moves a file.** Put `monitor-api.connection.json` under `features/monitor/data/`:

```json
{
  "code": "D008", "family": "D",
  "file": "features/monitor/data/monitor-api.connection.json",
  "message": "a connection lives under connections/",
  "hint": "a connection is a channel to an external system, shared across features; move it to connections/monitor-api.connection.json",
  "url": "https://github.com/wilanis/wilanis-js/blob/main/docs/refusals/D008.md",
  "fixes": [ { "file": "features/monitor/data/monitor-api.connection.json", "move": "connections/monitor-api.connection.json" } ]
}
```

A kind with one home gets the move. A graph in `edge/` gets none: its hint says `domain/ or data/`, and which is right
is a decision about the graph -- a data graph moved to `domain/` would only trade D008 for L002 -- so the rule offers
nothing it cannot prove, and the hint does the talking. That is the one rule of `fixes`: **a fix is offered only where
the test suite proves that applying it to the sabotaged example removes the refusal and adds none.** D001 shows why
the rule is worth having. The schema validator knows "the one value a `const` wanted", and every `const` in the
schemas is a discriminator inside a `oneOf` -- a node's `type` is `run`, `switch` or `map`, a codec's is `declared`
or a fixed type -- so a node of an unknown type fails all three constants at once, and "set it to `run`" would
rewrite the author's intent to silence the validator. D001 offers nothing.

**The rehearsal and the regression as data.** `rehearse --json` prints what `rehearse -v` renders, before rendering:

```json
{
  "format": 1, "runtime": "0.1.0", "command": "rehearse", "root": "example", "ok": true, "seed": 1,
  "refusals": [],
  "decisions": [
    {
      "graph": "@features/monitor/data/get-row.graph.json", "node": "route",
      "triggers": ["@features/monitor/edge/get-entry.trigger.json"],
      "branches": [
        { "when": "status == 404", "to": "missing", "settled": { "status": "failed", "blocked": false, "declared": { "reason": "missing", "message": "no entry hotel403" } } },
        { "when": "status == 200 && has(body)", "to": "row", "settled": { "status": "done", "blocked": false } },
        { "when": "else", "to": "failed", "settled": { "status": "failed", "blocked": false, "declared": { "reason": "upstream", "message": "..." } } }
      ]
    }
  ],
  "plain": [
    { "trigger": "@features/access/edge/sign-out.trigger.json", "graph": "…", "status": "done" },
    { "...": "the hello greeting and the two preference operations: the other runs of graphs without a switch" }
  ],
  "lines": [ "get-row  switch 'route'  3/3 branches  [via get-entry]", "..." ]
}
```

`decisions` is the `Decision[]` `rehearse` already builds; `plain` the branchless runs it already keeps; `lines` the
words it prints, kept because an agent reads prose well and a diff of two transcripts reads better in words. `regress
--json` prints the same envelope with `"command": "regress"` and, beside `lines`:

```json
"results": [ { "scenario": "@scenarios/get-entry.1.scenario.json", "same": true, "diffs": [] } ]
```

`scenarios --check --json` -- the one CI step RFC 0018 adds, `rehearse --check` and `fuzz --edges --check` over the
directories they own -- prints the same envelope with `"command": "scenarios"` and, beside `lines`, the three lists
its `--check` already computes:

```json
"stale": ["@scenarios/rehearsed/get-entry/monitor.get-row.route.missing.scenario.json"], "missing": [], "extra": []
```

`ok` is whether all three are empty. Nothing is added to what `--check` knows: the words it prints and these lists
come from the one comparison of bytes.

When the tree is refused, none of the four commands runs, and every one prints the same envelope `check` would, with
`command` set to what was asked and `ok: false` -- never an error of a shape of its own, so one parser serves them all.

**The promise.** From 1.0 (RFC 0008's line, when `schemas-v1` is cut), a reader of the envelope may rely on: a code
names one rule, and a rule that changes what it is about gets a new code while the old one is retired and never
reused; `at` is one grammar; a fix has one of four verbs and no verb is ever reinterpreted; a field of the envelope
is added, never removed or retyped, and `format` says which envelope this is. A reader may not rely on the wording
of `message` or `hint`, on `documents`, or on an order of refusals finer than the sort. Before 1.0 nothing is
promised and the pages record what changed, so that 1.0 ships with a history rather than a clean slate.

**A page.** `docs/refusals/L003.md`:

```markdown
# L003

- **Family:** L -- layers, effects and visibility
- **Status:** live, since 0.1.0
- **Made in:** `packages/compiler/src/check/graph.ts`, `packages/compiler/src/check/bindings.ts`
- **Proved by:** `packages/runtime/test/sabotage.test.ts`

## Refuses when

A data graph's node, or a binding's operation, runs an operation that is not `pure` and that the feature's
`feature.json → effects` does not list. A feature says once which effects it reaches; a graph cannot widen that
from inside.

## Example

    L003  @features/monitor/data/get-row.graph.json#nodes/asked
        node 'asked' runs effectful '@http/http.port.json#request' which the feature does not allow
        → add "@http/http.port.json#request" to @features/monitor/feature.json → effects

## Fix

Add the operation to the feature's `effects`, if the feature should reach it; `fixes` offers that edit. If it
should not, the node is in the wrong feature, or the operation should be met by a domain port the feature exports.

## History

- 0.1.0: introduced.
```

The page is written by a person, once, from the rule's doc comment, its message and hint, and the sabotage test that
proves it. It is not generated: a message is a template with holes, and the sentence under *Refuses when* is what the
holes mean. What is checked mechanically is that the page exists, that its status agrees with the code, and that a
retired page's code is not made again -- the fitness function under *Tests*.

**The refusal an author meets.** None: this RFC adds no rule and changes what none refuses. The one visible change
to an existing refusal is D001's `at` inside a graph, `nodes/asked/in` where it said `nodes/0/in`.

## Reference

### Documents and schemas

No document kind changes, and no field is added to any kind. `HOME` in `placement.ts`, the template's kind table and
`wilanis new` are untouched.

**The envelope's schema** is `packages/runtime/schemas/diagnostics.schema.json`, `$id`
`https://raw.githubusercontent.com/wilanis/wilanis-js/main/packages/runtime/schemas/diagnostics.schema.json`, listed
in the runtime package's `files`. It lives in the runtime, not `packages/core/schemas/`, because that directory is
the kinds' -- `a-kind-is-declared-once-and-mirrored` reads every `*.schema.json` there as a kind and would refuse one
that is not -- and because the envelope is what the runtime's commands print, not a document a tree holds. Every
property carries a `description`, as `a-schema-describes-every-property` asks of core's schemas; that function's
`SCHEMAS` list gains `packages/runtime/schemas` so the same claim holds here.

**`Refusal`** in `packages/core/src/registry.ts` gains `fixes?: Fix[]`, and `Fix` is declared beside it:

```ts
/** One edit that removes a refusal: a value set, added to a list or removed at a path of a document, or a file moved. */
export type Fix =
  | { file: string; at: string; set: unknown }
  | { file: string; at: string; add: unknown }
  | { file: string; at: string; remove: true }
  | { file: string; move: string };
```

`file` is the document the edit is made to, spelled as the refusal spells files (`@`-rooted when canonical, tree-relative
when the loader has not yet named it, as D008 does). `at` follows the grammar below and names the value to `set`, the
list to `add` to (created when absent; a value already present is not appended), or the member or element to
`remove`. `move` is a tree-relative destination. One verb per fix; a refusal whose repair needs two edits together
offers none. `fixes` lists alternatives, each sufficient alone, the first preferred. `text` output ignores `fixes`.

**The `at` grammar**, promised from 1.0 and made uniform now: a path from the document's root, segments joined by `/`;
an object member by its name; an array element by its index; and a graph's node by its `id` -- `nodes/asked/in`,
`nodes/route/rules/0/when` -- the one keyed array, so that reordering nodes moves no `at`. `refusalsOf` in
`packages/core/src/validate.ts` rewrites the validator's `instancePath` accordingly when the document is a graph: a
segment that indexes `nodes` becomes the node's `id` when the node at that index has one. Absent `at` means the
refusal is about the file as a whole.

### Ports, operations and kinds granted

None.

### Checker rules

None new. No code changes meaning. Three rules gain `fixes`, made where the rule is made
(`a-refusal-code-is-made-where-its-family-lives` holds):

| Code | Where the fix is made | Offers | When |
|---|---|---|---|
| L003 | `check/graph.ts`, `check/bindings.ts` | `{ file: <feature.json>, at: "effects", add: <operation> }` | always; `Effects` in `judge.ts` gains `file` and `path` beside the prose `at` it carries today, so the hint and the fix are spelled from one source |
| R001 | `Judge.opAt` in `check/judge.ts` | `{ file, at, set: "<port>#<nearest>" }` | the port exists and exactly one of its operations is within Levenshtein distance 2 of the name written; `nearest(word, candidates)` is a pure function in `check/nearest.ts`. An unknown *port* offers nothing: the space of ports is the tree's, and a wrong alias is not a typo |
| D008 | `packages/core/src/placement.ts` | `{ file, move }` for `wrongDirectory` and for `wrongLayer` when the kind has one layer; for a shape whose `layer` disagrees with its directory, two alternatives: `{ file, at: "layer", set: <the directory's layer> }` then `{ file, move }` | never for a kind with two layers (`domain/` or `data/`): which is right is the author's |

**`Refuser`** in `check/judge.ts` keeps its four parameters (the house rule) and widens the last:

```ts
/** The direction of the fix: the words every refusal carries, and the edits a rule can prove. */
export type Hint = string | { text: string; fixes: Fix[] };
export type Refuser = (code: string, message: string, at: string | undefined, hint: Hint) => void;
```

`Judge.refuser(file)` splits the object into `hint` and `fixes` on the `Refusal` it adds. Every call site that passes a
string is unchanged, so the diff is the three rules; `Refusal.hint` stays a required string and
`a-refusal-says-how-to-fix-it` keeps holding both declarations as it does today (its `Retire when` -- "refusals carry
structured fixes in a field of their own" -- is not met, since `fixes` is the exception a rule earns, not the form
every refusal takes). A plugin's `check` receives a `Refusal` through `PluginCheckContext.refuse` and may fill `fixes`
the same way; none does in this RFC.

### Runtime behaviour

**`--json`.** `packages/runtime/src/cli.ts` reads a bare `--json` flag on `check`, `rehearse`, `regress` and
`scenarios --check` (`parse` already gives a flag with no value the string `'true'`). Under it a command prints one
JSON object to stdout and nothing to stderr, and exits as it does today: 1 when the tree is refused, the rehearsal or
regression fails or a recorded directory is stale, 0 otherwise. A missing `project.json` is not a diagnostic about a
tree and stays what it is: a line on stderr and exit 2. USAGE gains `--json` on the four lines.

**The envelope** is built by a new module, `packages/runtime/src/diagnostics.ts`, exported from `tools.ts` so it is
callable without the CLI:

- `diagnosticsOf(load: LoadResult, refusals: RefusalList, how: { command, root }): Diagnostics` -- pure. `format` is
  the literal `1`; `runtime` the runtime package's version alone, read once from its `package.json` -- it is the
  package that prints, and its version implies every sibling's through the workspace; `command` what was
  asked; `root` as given on the command line; `ok` whether `refusals` is empty; `documents` the registry's file
  count; `refusals` sorted by `file`, then `at` (absent first), then `code`, then `message`, each carrying
  `family` (the code's first letter) and `url`.
- `pageUrl(code: string): string | undefined` lives in `packages/core/src/model.ts` beside `schemaUrl`, sharing its
  repository base: `https://github.com/wilanis/wilanis-js/blob/main/docs/refusals/<CODE>.md`, for the ten checker
  families and for the X codes of the plugins this workspace ships. Any other code (a plugin from elsewhere) has no
  `url`; how such a plugin names its pages is an open question below.
- `withRehearsal(diag, rehearsal)`, `withRegression(diag, regression)` and `withStaleness(diag, checked)` add `seed`,
  `decisions`, `plain`, `lines`; `results`, `lines`; and `stale`, `missing`, `extra`, `lines` respectively; `ok`
  becomes the command's.

**`rehearse`** in `rehearse.ts` answers `Rehearsal` with two more members it already has in hand: `decisions:
Decision[]` and `plain: PlainRun[]` (the `settledGraphs` array, given a name and exported from `rehearsal-report.ts`
beside `Decision`). `format` is unchanged; `lines` stays. **`regress`** in `fuzz.ts` answers `results: { scenario:
string; same: boolean; diffs: string[] }[]` beside `ok` and `lines`; `diffOf`'s strings are the diffs, and RFC 0018
structures them further if it lands after this. **`scenarios --check`** (RFC 0018's command; this part of the RFC
lands after it) answers what `checkRecorded` computes for the two directories, the three lists merged, each path
`@`-rooted and sorted.

**The check the commands share.** `check()` in `cli.ts` takes the `json` flag: on a refused tree under `--json` it
prints `diagnosticsOf(...)` and exits 1, so `rehearse --json` on a broken tree prints refusals with `command:
"rehearse"`, never text and never an error object of its own: the check envelope is the one shape a consumer parses.

**Determinism.** Two runs of `check --json` on the same tree print the same bytes: the sort above, and
`JSON.stringify` with two-space indentation and no timestamps. `rehearse --json` under the same seed likewise --
`Settled` carries no time; `regress --json` likewise, since `diffOf` reads a report `pick` has already stripped of
`startedAt` and `endedAt`; `scenarios --check --json` likewise, since a recorded directory is a function of the tree
under seed 1. This is what makes a transcript diffable.

**The embedder, the engine, `start`, `run`, `fuzz`, plugins**: unchanged.

### Discoverability

- **The viewer.** `viewOf` in `packages/view/src/model.ts` already attaches to a document view the refusals whose
  `file` is that document; `client/index.html` shows their count as a badge. The badge opens the list -- code, `at`,
  message, hint -- with each code linked to its `url`, and a fix shown as the edit it is (`add "…" to effects`). The
  index's `refusals` count (`serve.ts`, `/api/index`) is unchanged.
- **`wilanis describe`, `map`, `ls`**: unchanged. `describe <CODE>` is not added: the pages live in this repository's
  `docs/`, not in the published package, and an agent that wants the long form has the `url`.
- **The pages' index.** `docs/refusals/README.md` states the promise in full, lists every code with its family, status
  and one-line meaning, and holds the page template above. It is the one inventory; the template `CLAUDE.md`'s rule
  list stays what it is, prose for an agent writing documents, and cites codes it must get right.

### Plugin contract

`PluginModule` and `PluginCheckContext` in `packages/core/src/plugin.ts` are unchanged in shape. `refuse` takes a
`Refusal`, and `Refusal` has gained an optional `fixes`; a plugin may fill it under the same rule (proved by a test that
applies it), and X codes of the workspace's plugins get pages and a `url` like every other code.

## Compatibility

IR v1, compatible: no schema under `packages/core/schemas/` changes; every document validates and means what it did.
`Refusal` gains an optional member; `Refuser`'s last parameter widens; every existing call compiles. The text output
of `check`, `rehearse`, `regress` and `scenarios --check` is byte-identical to today's with one exception: a D001
inside a graph reports `nodes/<id>/…` where it reported `nodes/<index>/…`, which is the grammar the checker's own
refusals already use.
The envelope is new, `format: 1`; its stability, like the codes', is promised from 1.0 and not before, and RFC 0008's
gate (`npm run release` refuses without the `schemas-v1` tag) is when the promise begins. The manifest (RFC 0026)
takes the same promise when it lands and is not embedded here.

## Tests

**Core**, `packages/core/test/validate.test.ts`: a graph with a wrong-typed `in` on its second node is refused as D001
at `nodes/<second id>/in`, not `nodes/1/in`; a node without an `id` keeps its index; a node of an unknown `type` is
refused as D001 with no `fixes`; `pageUrl('L003')` is the blob URL and `pageUrl('Z001')` is undefined. D008's fixes
are tested where D008 is tested today, through `relocate` in the runtime's sabotage suite (below).

**Compiler**, through the sabotage suites in `packages/runtime/test/` as every family, in a new
`sabotage-fixes.test.ts`. The harness (`example-harness.ts`) gains `refusalsAfter(change)` (the `Refusal[]`, not
only the codes) and `applyFix(dir, fix)` -- `set`, `add`, `remove` on the parsed document at `at` under the grammar,
`move` as a rename -- so a fix is proved, not described:

| Rule | The sabotage | Asserts |
|---|---|---|
| L003 | `@http/http.port.json#request` removed from the monitor feature's `effects` | six refusals, each with the one fix `{ file: '@features/monitor/feature.json', at: 'effects', add: '@http/http.port.json#request' }`; applying `fixes[0]` of the first leaves `codes` empty; applying all six leaves `effects` with the value once |
| R001 | `get-row`'s `asked` runs `#requst`; then `#reqeust`; then `#xyz`; then a planted port with `get` and `set` and a node running `#sit` | `set: '@http/http.port.json#request'` for the first two and applying it leaves `codes` empty (the G011s go with it); no `fixes` for the third and fourth |
| D008 | `monitor-api.connection.json` relocated under `features/monitor/data/`; `get-row.graph.json` relocated to `edge/`; `Entry.shape.json` given `"layer": "edge"` | one `move` and applying it leaves `codes` empty; no `fixes`; two alternatives in that order, and applying either leaves `codes` empty |
| every rule | the whole suite | no refusal of any sabotage in the existing suites carries a `fixes` that, applied, leaves a refusal of the same code behind -- a guard that the rule of `fixes` holds for whatever a later pull request adds |

**Runtime**, `packages/runtime/test/tools.test.ts`, on copies of the example:

| What | Asserts |
|---|---|
| the envelope | `diagnosticsOf` on the L003 copy: `format: 1`, `runtime` equals the package's version, `command: 'check'`, `ok: false`, `documents` is the registry's count, six refusals sorted by file, each with `family: 'L'` and the L003 `url`; validates against `diagnostics.schema.json` |
| determinism | two calls give equal JSON; a copy whose refusals the loader found in another order (two files renamed to swap their walk order) gives the same JSON |
| the sort | a copy with the R001 typo: R001 before the two G011s (same file, `nodes/asked/run` before `nodes/route/…`) |
| the untouched tree | `ok: true`, `refusals: []`, `documents: 140` and no other member |
| `rehearse --json` | `decisions` has 15 entries and 37 branches in all, `plain` the four branchless runs, `ok: true`, `seed: 1`; every `settled` has `status` and `blocked` |
| `regress --json` | after `fuzz` on a copy, `results` has one entry per scenario with `same: true`; the `missing` rule changed to 410, the `get-entry` entries have `same: false` and non-empty `diffs` |
| `scenarios --check --json` | on a copy with its directories recorded, `ok: true` and the three lists empty; with the `missing` rule's threshold moved, `stale` names the recorded `missing` scenario and `ok: false`; `missing` and `extra` after a deleted and a hand-added file |
| the CLI | `wilanis check <copy> --json` exits 1, writes nothing to stderr, and stdout parses to the envelope; `wilanis rehearse <copy> --json` on the refused copy prints `command: 'rehearse'` with the refusals and exits 1; on the good copy exits 0 with `decisions` |

**Viewer**, `packages/view/test/view.test.ts`: the document view of a refused graph lists its refusals with `url`, and
a fix renders as its edit.

**Fitness**, `fitness/a-refusal-code-is-never-reused.fitness.ts` -- the claim `a refusal code is never reused`.
`gather` reads every code made under a package's `src` (as `every-refusal-code-is-proved-by-a-sabotage` does) and every
page under `docs/refusals/*.md` with the status its `**Status:**` line spells. `judge` names: a code made with no page
(`write docs/refusals/<CODE>.md; a code without a page cannot be told from a reused one`); a live page whose code no
rule makes (`mark it retired, never delete it`); a retired page whose code a rule makes again (`<CODE> was retired; a
number is never reused, take the next of the family`). `sabotage` proves each. The claim is a decision of the
maintainer's and lands with its `Decision:` line, as RFC 0027 requires; skipped numbers (D002, G002, L004) have no page
and are not a violation -- the claim is about what shipped, and nothing has.

**Docs**, in `packages/runtime/test/tools.test.ts` or a small `docs/refusals/pages.test.ts` registered with the
workspace's vitest: every page's first heading is its file name's code, and every page has the four header lines and
the four sections.

## Implementation plan

1. Core: the `at` grammar for D001 inside a graph (`refusalsOf`); `Fix` and `Refusal.fixes`; `pageUrl`; the
   validate tests. (`good first issue`)
2. Compiler: `Hint` on `Refuser` and the split in `Judge.refuser`; `Effects` gains `file` and `path`; L003's fix in
   `graph.ts` and `bindings.ts`; the harness's `refusalsAfter` and `applyFix`; `sabotage-fixes.test.ts` with L003 and
   the every-rule guard.
3. Compiler: `nearest.ts`; R001's fix in `Judge.opAt`; its tests.
4. Core: D008's fixes in `placement.ts`; their tests through `relocate` and `sabotage`.
5. Runtime: `diagnostics.ts` and `diagnostics.schema.json`; `Rehearsal.decisions` and `plain`; `regress`'s `results`;
   `--json` on `check`, `rehearse` and `regress` and in `check()`; USAGE; the runtime and CLI tests.
   `scenarios --check --json` (`withStaleness`, its schema members, its test) follows once RFC 0018's step 7 has landed
   `wilanis scenarios --check`.
6. Docs: `docs/refusals/README.md` with the promise, the index and the page template; the pages, one pull request per
   family, each written from the rule, its message and hint and the test that proves it. The X pages correct X104
   to X103 in the template, `session.port.json` and `write-theme.graph.json`. (`good first issue`, per family)
7. Fitness: `a-refusal-code-is-never-reused`, with the maintainer's `Decision:` line; `a-schema-describes-every-property`
   reads the runtime's `schemas/` too (a reconfiguration, its own `Decision:` line).
8. Viewer: the refusal list with links and rendered fixes; the view test. (`good first issue`)
9. The template's `CLAUDE.md`: step 1 of the loop gains "`wilanis check --json` gives the same refusals as data; a
   refusal that carries `fixes` is repaired by applying the first fix as written, one that carries none by reading
   `hint`; after every edit, check again; in one file, fix the first refusal before the ones below it, since a
   later one is often the first one's shadow." `CONTRIBUTING.md`'s *The rules the code follows* gains the paragraph on
   codes, pages and the promise. The hook in `dot-claude/settings.json` stays text: a model reads forty lines of
   prose well, and the JSON is for the loop an agent writes on purpose.
10. At 1.0: the README and every page say `since 1.0.0` where the promise begins; `format: 1` is frozen with the
    `schemas-v1` tag (RFC 0008, step 6).

## Drawbacks and alternatives

- **`fixes` is a surface that can be wrong, and a wrong fix applied blindly is worse than a hint read.** The rule of
  `fixes` -- offered only where a test proves that applying it removes the refusal and adds none -- and the
  every-rule guard in the sabotage suite are the answer: a fix is a claim the suite checks on the example, not a
  hint in a different syntax. The cost is that the three rules chosen are the ones whose fix is a fact the rule
  already computed; a rule whose fix is a design choice (a graph in the wrong layer, a reason a trigger does not
  map) keeps to prose, and that is right.
- **Pages by hand can drift from the rule.** The fitness function holds existence and status, not meaning; a page
  that describes a rule the code has since narrowed is a review's to catch. Generating pages from source would tie
  them to a message template full of holes and to the location of a string literal; the sentence under *Refuses
  when* is worth a person writing once. The alternative of no pages is what exists, and the X104 slip is what it
  costs.
- **Two outputs to keep aligned.** The words and the data both come from the same objects -- `RefusalList.items`,
  `Decision[]`, `diffOf`'s strings -- so there is one source and two renderings, and the tests assert the JSON against
  what the lines say. Nothing is computed twice.
- **The promise binds.** From 1.0, retiring a code costs a page kept forever and a number never used again, and
  splitting a rule costs two new codes. That is what a contract with a tool costs, and it is the same price RFC 0008
  charges schemas.
- **SARIF.** The Static Analysis Results Interchange Format is the established envelope for a checker's findings,
  with rules, results, locations and fixes, and editors read it. It was not chosen: its locations are line and column
  in a text file and its fixes are byte-range replacements, while a wilanis refusal points into a JSON document by
  path and its fix is an edit by path, which is what an agent editing documents applies; wrapping ours in SARIF's
  would carry two grammars for one thing. A `--sarif` rendering of the same envelope is a small later addition if an
  editor integration wants it, and nothing here prevents it.
- **`--fix`.** Applying fixes in the CLI is one function away once `applyFix` exists in the harness. It is not in
  this RFC because the loop this RFC serves is an agent's, whose job is to apply edits and re-check, and because a
  command that rewrites a tree deserves its own decision about what it may touch.
- **Leaving the hint as prose** is what exists and works for capable models. The point of `fixes` is the cheap ones,
  and of the promise, the tools that will be written against the output.

## Open questions

None open. Settled at acceptance, with the edits in the text above:

1. **One shape.** A refused tree under `rehearse --json`, `regress --json` or `scenarios --check --json` prints the
   check envelope with `command` set to what was asked, never an error of another shape: one parser serves every
   command.
2. **`runtime` is the runtime's version alone.** It is the package that prints, and the workspace pins its siblings;
   a map of every package's version would spell what one number already implies.
3. **The manifest is not embedded.** RFC 0026's stub said `check --json` may embed it; it does not. The manifest is
   its own command's output and takes the stability promise written here when it lands. The stub is amended to say so.
4. **`scenarios --check --json`.** RFC 0018 expects this RFC's `--json` on the one CI step and hands it the question of
   a hook that runs a tool on an edit. The flag is added above and lands after RFC 0018's step 7; no hook is proposed:
   the template's `CLAUDE.md` stays prose, as step 9 says, and a hook that rewrites or re-checks a tree on an edit
   is a decision about what a tool may touch, like `--fix`, and deserves an RFC of its own if one is wanted.

During implementation:

- The threshold for R001's `nearest`: two edits, unique. A shorter operation name may want one.
- Whether `lines` stays in `rehearse --json` once RFC 0018 records every branch as a scenario, or the words become
  redundant with the documents.
- How a plugin outside this workspace names the pages for its X codes -- a field in its `plugin.json`, or none until
  such a plugin exists. Nothing is added for it here.
- Whether the page's `**Made in:**` and `**Proved by:**` lines are checked by the fitness function against the source
  and the test suites, once the pages exist and the cost of drift is seen.
