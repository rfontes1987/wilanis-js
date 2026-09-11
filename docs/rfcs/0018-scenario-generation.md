# RFC 0018: Scenario generation from the branch solver

- **Status:** draft
- **Areas:** `area:core`, `area:compiler`, `area:runtime`, `area:view`
- **Tracking issue:** #20
- **Depends on:** none. RFC 0006 (accepted) adds `handler` to a scenario's `expect.nodes`; the two compose, and
  whichever lands second edits `pick` in `packages/runtime/src/fuzz.ts` beside the other's field. RFC 0019 reads this
  RFC's output (`regress` diffs, `--check` staleness) as JSON; nothing here waits for it.

## Summary

The cases `wilanis rehearse` solves -- for every switch a trigger reaches, the input and stubs that take each rule
and the else -- are written to the tree as scenario documents, one per trigger and branch, under
`scenarios/rehearsed/`. Each carries the branch it proves (`branch`), the run it produced (`expect`, now with the
declared refusal's `reason`), and the mark that a command wrote it (`generated`). The solver is deterministic, so the
directory is a function of the tree: `wilanis rehearse --record` writes it, `wilanis rehearse --check` says whether it
is what the tree would write today, and `wilanis regress` replays it as it replays any scenario. A branch the solver
cannot reach (`NEVER RUN`) is recorded as a scenario that expects to stay unreachable, so the fix that reaches it is a
diff. A policy's decision, which the rehearsal already walks as a root of its own, becomes a scenario that names the
policy beside the trigger. What the solver cannot vary -- the caller's values that no rule reads -- `wilanis fuzz
--edges` covers with fixed cases drawn from the trigger's input type: an empty and a long string, each member of an
enum, zero and a negative number, an empty and a one-element list, a missing optional. A tree's regression suite is
then written by the tools, reviewed as a diff in a pull request, and regenerated rather than edited; the few
scenarios that matter to a person sit beside them, hand-written, under `scenarios/` itself.

## Motivation

Two commands already do most of this, and neither keeps what the other needs.

- **The rehearsal throws its runs away.** `branchOf` in `packages/runtime/src/rehearse.ts` fires the trigger once per
  case -- input patched by `setPath`, effects stubbed by `{ ...steer.downstream, ...steer.pre.stubs, ...one.stubs }` --
  and keeps only what `settle` reads off the report: a status, a declared reason, a misroute. The `Rehearsal` it
  answers is `{ ok, lines }`, words for a person. The 37 branches it walks in the example (`wilanis rehearse example
  -v`: 15 decisions in 15 graphs, several reached from two or three triggers) are re-solved on every run and pinned
  nowhere, so a graph that starts routing its 404 to `failed` is caught only while someone reads the lines.
- **Fuzz keeps runs nobody chose.** `fuzz` in `fuzz.ts` fires each trigger under seeds 1..N with `generatedFire` and
  writes `<trigger>.<seed>.scenario.json`. For `get-entry` under seed 1 the recorded upstream answer is
  `{ "status": 3.5, "headers": {} }` and the request's body is `200`: values `generate` drew from the shapes, taking
  whichever branch they happened to satisfy (here the else). Five seeds of seventeen triggers are 85 files, and the
  `missing` branch of `get-row` may be in none of them. The suite is neither complete nor readable, and a reader
  cannot tell from a file what it is for.
- **A scenario cannot say what it proves, or which refusal it expects.** `scenario.schema.json` has `trigger`, `seed`,
  `in`, `request`, `stubs` and `expect`; `pick` records each node's `status`, `selected` and `out`. A refuse node's
  `reason` is not in its `out` (`refusalOf` in `packages/engine/src/kernel.ts` reads it off the node), so a graph that
  changes `"reason": "missing"` to `"reason": "gone"` replays as `same`. Nothing in the document names the switch,
  the rule or the target a run was meant to exercise, so a `DIFF` line says which node changed and not which
  decision.
- **A policy's decision has no scenario.** `policyRoots` in `stubbing.ts` rehearses every policy as a trigger of each
  kind that attaches it (the four `require-*` decisions in the output above), but a scenario's `trigger` must name a
  trigger document -- `checkScenario` in `packages/compiler/src/check/triggers.ts` refuses anything else as S001 --
  so the gate's branches, the ones an access bug lives in, cannot be recorded.
- **What exists is half-wired.** The viewer's scenario page (`renderDocPage` in `packages/view/client/index.html`,
  `case 'scenario'`) links `d.graph`, a field no scenario has; `describe` has no `scenarioLines` and prints the
  envelope; `wilanis new` knows no `scenario`; the template's `CLAUDE.md` tells an agent to run `fuzz` then `regress`
  after any change, which records whatever the change did as the new truth.

The roadmap's M13 says "solved branches become committed scenarios". This RFC is that sentence, and the smallest
set of changes that makes the committed directory trustworthy: written by one command, checked stale by the same
command, and never the thing an agent edits to make a diff go away.

**What this does not try to solve.** It does not test engines or upstreams: every scenario runs against stubs, as
`rehearse`, `fuzz` and `regress` do today (RFC 0002, RFC 0005), and what a store or an API really answers is the
plugin suite's business. It does not generate scenarios from a shape's semantics beyond the fixed edges listed under
*Runtime behaviour*: no property testing, no shrinking. It does not make `regress` judge a run right or wrong beyond
"the same as recorded"; the rehearsal judges, and its verdict travels in the scenario's `expect`. It does not emit
JSON; RFC 0019 does, over the lines this RFC produces.

## Guide-level explanation

**Words.** A *scenario* is one recorded run of a trigger: its input, the values every effect answered, and the
report the run produced, replayed by `wilanis regress` and diffed node by node. A *recorded rehearsal* is a scenario
the branch solver wrote: it carries the *branch* it proves -- a graph, a switch, a rule and the node the rule routes
to -- and its input and stubs are the smallest change to a seed's values that takes that branch. An *edge case* is a
scenario `wilanis fuzz --edges` wrote: one field of the trigger's input at a fixed boundary value, everything else
the seed's. A *hand-written scenario* is one a person wrote or copied and kept, because it says something the
generated ones do not. The three live apart:

```
scenarios/
  rehearsed/            written by wilanis rehearse --record; owned by it: regenerate, never edit
    get-entry/
      monitor.get-row.route.missing.scenario.json
      monitor.get-row.route.row.scenario.json
      monitor.get-row.route.failed.scenario.json
    list-entries/
      monitor.list-entries.route.byMethod.scenario.json
      ...
    policies/
      employees-only/
        access.require-employee.decide.granted.scenario.json
        access.require-employee.decide.forbidden.scenario.json
        access.require-employee.decide.anonymous.scenario.json
    hello-gated/
      whole.scenario.json                       a trigger whose graph has no switch: one run is the whole of it
  edges/                written by wilanis fuzz --edges; owned by it
    get-entry/
      id.empty.scenario.json
      id.long.scenario.json
  fuzz/                 written by wilanis fuzz; owned by it
    get-entry.1.scenario.json
  first-customer-signs-in.scenario.json         hand-written: yours, kept until you delete it
```

`HOME` in `packages/core/src/placement.ts` already puts a scenario under `scenarios/` and looks only at the first
path segment, so the subdirectories are home; the loader reads every `*.json` under the root, so they load.

**Recording.** `wilanis rehearse example --record` runs the rehearsal it runs today and, beside the lines, writes one
file per trigger and branch. The `missing` branch of `get-row`, reached from `GET /monitor/{id}`:

```json
{
  "$schema": "https://raw.githubusercontent.com/wilanis/wilanis-js/main/packages/core/schemas/scenario.schema.json",
  "description": "get-entry: get-row 'route' when status == 404 routes to missing, which refuses as missing. Written by wilanis rehearse --record; regenerate it, do not edit it.",
  "generated": "rehearse",
  "trigger": "@features/monitor/edge/get-entry.trigger.json",
  "branch": {
    "graph": "@features/monitor/data/get-row.graph.json",
    "node": "route",
    "when": "status == 404",
    "to": "missing"
  },
  "seed": 1,
  "in": { "id": "hotel403" },
  "request": {
    "method": "juliet527",
    "path": "Zulu-9",
    "headers": { "extra6": "kilo" },
    "cookies": {},
    "query": {},
    "params": { "id": "hotel403" },
    "body": 200,
    "principal": { "subject": "foxtrot", "realm": "echo42", "roles": ["india"], "claims": { "extra2": "x" } }
  },
  "stubs": {
    "op.asked": { "status": 404, "headers": {} }
  },
  "expect": {
    "status": "failed",
    "reason": "missing",
    "nodes": {
      "op": { "status": "failed" },
      "op.asked": { "status": "done", "out": { "status": 404, "headers": {} } },
      "op.route": { "status": "done", "selected": "missing", "out": "missing" },
      "op.row": { "status": "cancelled" },
      "op.missing": { "status": "failed" },
      "op.failed": { "status": "cancelled" }
    }
  }
}
```

Everything but `branch`, `generated` and `expect.reason` is what `fuzz` writes today; the seed's request is the one
`generatedFire` produced, kept as it was. The stub is the seed's answer for `op.asked` (`{ "status": 3.5, ... }`)
with `status` set to the one value the rule demands, which is what `satisfy` in `stubs.ts` does for a `{ eq: 404 }`
domain. The file says what it proves in its first line and in `branch`, and `expect.reason` says the refusal the
graph declared.

**Replaying.** `wilanis regress example` replays every scenario under `scenarios/`, whoever wrote it. Change the
rule to `status == 410` and:

```
scenarios/rehearsed/get-entry/monitor.get-row.route.missing.scenario.json: DIFF branch 'status == 404' → missing no longer routes there: op.route routed missing → failed; op.missing: failed → cancelled; op.failed: cancelled → failed; reason missing → upstream
scenarios/rehearsed/get-entry/monitor.get-row.route.row.scenario.json: same
scenarios/rehearsed/get-entry/monitor.get-row.route.failed.scenario.json: same
```

The first clause is new: a scenario with a `branch` says the decision that moved, before the nodes that moved with
it. The recorded file is now stale as well as failing, and the second command says so:

```
$ wilanis rehearse example --check
stale    scenarios/rehearsed/get-entry/monitor.get-row.route.missing.scenario.json
missing  scenarios/rehearsed/get-entry/monitor.get-row.route.missing.1.scenario.json
2 file(s) differ from what the solver writes for this tree -- run wilanis rehearse --record and review the diff
```

`--check` runs the solver, renders every file it would write, and compares bytes: it never writes. In CI it is the
step that keeps `scenarios/rehearsed/` honest; the diff it asks for is the pull request's, where a reviewer sees that
the 404 branch is gone and a 410 branch has appeared, in two files named after them.

**A branch nothing reaches.** Reorder `list-rows`'s rules so `status >= 200` comes before `status == 200 &&
has(body)`, as `packages/runtime/test/example.test.ts` does to provoke `NEVER RUN`. The rehearsal fails, as today, and
`--record` still writes the branch:

```json
{
  "$schema": "https://raw.githubusercontent.com/wilanis/wilanis-js/main/packages/core/schemas/scenario.schema.json",
  "description": "list-entries: list-rows 'route' when status == 200 && has(body) routes to rows, and no input reaches it: the rules before it already cover every input, so 'status == 200 && has(body)' is unreachable. Written by wilanis rehearse --record; regenerate it, do not edit it.",
  "generated": "rehearse",
  "trigger": "@features/monitor/edge/list-entries.trigger.json",
  "branch": {
    "graph": "@features/monitor/data/list-rows.graph.json",
    "node": "route",
    "when": "status == 200 && has(body)",
    "to": "rows"
  },
  "seed": 1,
  "expect": {
    "status": "unreachable",
    "nodes": {},
    "unreachable": "the rules before it already cover every input, so 'status == 200 && has(body)' is unreachable"
  }
}
```

There is nothing to run, so there is no `in` and no `stubs`; `regress` re-solves the branch instead of firing it,
answers `same` while it stays unreachable, and `DIFF branch 'status == 200 && has(body)' → rows is reachable now`
once someone fixes the order -- at which point `--check` asks for the directory to be regenerated and the fix lands
with its scenario. A tree with such a file is a tree whose rehearsal fails; the file is the record of that, not a
licence for it.

**A policy's decision.** `employees-only` is rehearsed as a root of its own under the kind of each trigger that
attaches it -- five of the monitor's triggers, all HTTP, so one root. Its scenario names the first of them in path
order, whose kind and settings the root borrows, and the policy whose `decide` it fires instead of the trigger's
`fire`:

```json
{
  "$schema": "https://raw.githubusercontent.com/wilanis/wilanis-js/main/packages/core/schemas/scenario.schema.json",
  "description": "employees-only as attached by delete-entries: require-employee 'decide' when has(principal) && principal.realm == 'employee' routes to granted. Written by wilanis rehearse --record; regenerate it, do not edit it.",
  "generated": "rehearse",
  "trigger": "@features/monitor/edge/delete-entries.trigger.json",
  "policy": "@features/access/edge/employees-only.policy.json",
  "branch": {
    "graph": "@features/access/domain/require-employee.graph.json",
    "node": "decide",
    "when": "has(principal) && principal.realm == 'employee'",
    "to": "granted"
  },
  "seed": 1,
  "in": { "principal": { "subject": "foxtrot", "realm": "employee", "roles": ["india"], "claims": { "extra2": "x" } } },
  "request": { "...": "the seed's, as above, with principal.realm set to 'employee'" },
  "stubs": {},
  "expect": {
    "status": "done",
    "output": { "allowed": true },
    "nodes": {
      "op": { "status": "done", "out": { "allowed": true } },
      "op.decide": { "status": "done", "selected": "granted", "out": "granted" },
      "op.granted": { "status": "done", "out": { "allowed": true } },
      "op.forbidden": { "status": "cancelled" },
      "op.anonymous": { "status": "cancelled" }
    }
  }
}
```

**Edges.** `wilanis fuzz example --edges` writes, per trigger, one scenario per field of its input type and per edge
that type has. `get-entry`'s input is `IdRequest`, one string field, so three files: `id.empty`, `id.one`, `id.long`.
Each is the seed's input with that one field replaced, run and recorded like any scenario, `"generated": "edges"`. An
edge is a fixed value, so the directory is as deterministic as the rehearsed one, and `fuzz --edges --check` says
whether it is current.

**The refusal an author meets.** Rename `get-row`'s `missing` node to `gone` and forget the scenarios:

```
S0n2  @scenarios/rehearsed/get-entry/monitor.get-row.route.missing.scenario.json#branch/to
    the branch names node 'missing' of switch 'route' in @features/monitor/data/get-row.graph.json, which no rule of the switch routes to
    → wilanis rehearse --record rewrites scenarios/rehearsed/ from the tree as it stands; a hand-written scenario names a node the switch has
```

`check` refuses before `regress` runs, with the command that fixes it, as S001 does today for a trigger that is gone.

## Reference

### Documents and schemas

**`scenario.schema.json`** (`packages/core/schemas/`) gains, all optional:

- `generated` (enum `rehearse`, `edges`, `fuzz`): "The command that wrote this scenario. A generated scenario is
  regenerated by that command and never edited: `wilanis rehearse --check` and `wilanis fuzz --edges --check` refuse
  a directory that differs from what the tree yields. Absent: written by hand, kept as it is."
- `policy` (path): "A policy this scenario replays instead of the trigger's fire: its `decide` is fired under the
  trigger's kind and settings, the way `wilanis rehearse` walks a policy's decision. The trigger must attach it
  (S0n3)."
- `branch` (object: `graph` path, `node` identifier, `when` string, `to` identifier; all required when `branch` is):
  "The decision this scenario proves: the graph that declares the switch, the switch's node id, the rule's
  expression (`else` for the else), and the node the rule routes to. `wilanis regress` names it first when the run
  differs; `wilanis check` refuses one the tree no longer has (S0n2)."
- `expect.status` gains the member `unreachable`; `expect` gains `unreachable` (string): "Why the solver could reach
  no input for this branch, in its words. Present exactly when `status` is `unreachable`; the scenario then has no
  `in` and no `stubs`, and `regress` re-solves instead of running." The schema says so with `if`/`then`.
- `expect.reason` (string): "For a run that failed at a refuse node the graph declares, its reason (`refusalOf`), so
  a replay says when the declared outcome changed and not only that a node did."

`ScenarioDoc` in `packages/core/src/model.ts` gains `generated?: 'rehearse' | 'edges' | 'fuzz'`, `policy?: string`,
`branch?: { graph: string; node: string; when: string; to: string }`, and in `expect`: `status` widened with
`'unreachable'`, `unreachable?: string`, `reason?: string`. The `$id`, `required` list and `additionalProperties`
stay as they are. The baseline in `packages/core/test/validate.test.ts` gains a rehearsed, an unreachable and a policy
scenario; an `unreachable` without the status, a `branch` missing `to`, and `generated: "hand"` are refused.

**Placement**: unchanged. `HOME.scenario` is `{ dir: 'scenarios' }`, and `misplacedDir` compares the first segment,
so `scenarios/rehearsed/get-entry/x.scenario.json` is home. The three generated directories are not a rule of the
checker: they are where the three commands write and what `--check` owns.

**`packages/runtime/templates/CLAUDE.md`**: the `scenario` row becomes "a recorded run: `wilanis rehearse --record`
writes one per branch under `scenarios/rehearsed/`, `wilanis fuzz --edges` one per input edge under
`scenarios/edges/`, and `wilanis regress` replays them all; a generated scenario is regenerated, never edited". Step 3
of the loop becomes: "`wilanis regress` replays the scenarios; a `DIFF` is a change in behaviour. If the change is
intended, `wilanis rehearse --record` rewrites the recorded ones and the diff goes into the commit for review; do not
edit a file under `scenarios/rehearsed/` or `scenarios/edges/`." The rule list's `S scenarios` gains "(S001, a
trigger the tree does not have; S0n2, a branch the graph does not have; S0n3, a policy the trigger does not attach)".

**`wilanis new scenario`**: not added. A scenario is written by a command or copied from one that was; the
template's `CLAUDE.md` says to copy a rehearsed file into `scenarios/`, give it a description and drop `generated`.

### Ports, operations and kinds granted

None.

### Checker rules

Codes are placeholders; the implementing pull request takes the next free code of the S family. S001 exists and is
unchanged in meaning. The family moves from `check/triggers.ts`, where `checkScenario` sits today beside the T rules,
to its own `check/scenarios.ts`, since it grows from one rule to three and `triggers.ts` is the T family's; `judgeTree`
in `checker.ts` calls it where it called `checkScenario`, after the triggers and graphs are judged, since S0n2 reads a
graph's switch and S0n3 a trigger's policies.

| Code | Where it lives | Refuses when | Hint |
|---|---|---|---|
| S001 | `check/scenarios.ts` (moved), at `trigger` | the trigger named does not exist | `wilanis ls trigger` (as today) |
| S0n2 | `check/scenarios.ts`, at `branch/graph`, `branch/node` or `branch/to` | `branch.graph` names no graph document (R001's judgement, this code); `branch.node` is not a `switch` node of that graph; `branch.to` is neither a rule's `to` nor the `else` of that switch. The message names what exists: for `to`, the switch's targets | `wilanis rehearse --record rewrites scenarios/rehearsed/ from the tree as it stands; a hand-written scenario names a node the switch has` |
| S0n3 | `check/scenarios.ts`, at `policy` | `policy` names no policy document, or one the scenario's trigger does not attach under `policies` (by canonical path, as `policyRoots` matches) | `a policy scenario replays the decision under a trigger that attaches it: wilanis describe <trigger>` |

`branch.when` is not judged: a rule's text is the solver's to compare, and a hand-written scenario may carry
`"when": "else"` or a paraphrase. Whether a recorded file is *current* is not a checker rule either -- the checker
judges documents against the tree, and staleness is the solver's answer, so it is `--check`'s (below). A generated
scenario that was edited by hand is caught there, and only there.

### Runtime behaviour

**The record.** `rehearse` in `packages/runtime/src/rehearse.ts` gains `record?: string` (a directory, relative to
the root; `scenarios/rehearsed` by default when the flag is bare) and `check?: boolean` in its options. The writing
lives in a new module, `packages/runtime/src/record.ts`, so `rehearse.ts` keeps to the walk: `record.ts` exports
`scenarioOf(run: RecordedRun): ScenarioDoc` (pure, from one run's inputs and report to the document), `fileOf(run):
string` (pure, the path below), `writeRecorded(root, dir, docs)` (writes every file, removes every
`*.scenario.json` under `dir` it did not write, answers the paths written) and `checkRecorded(root, dir, docs)`
(renders each document as `writeRecorded` would and compares bytes to what is on disk; answers `{ stale, missing,
extra }` and never writes).

What `branchOf` runs is what is recorded. It fires with an embedder that records
(`embedderFor(load, { seed, record, profile })` -- `record` is the map `stubEffects` fills with every generated
answer) and hands back the report beside the `Settled`; a node the case stubbed is not recorded by `stubEffects`,
because the kernel does not call a handler when `RunContext.stubs` has its path, so the scenario's `stubs` are the run's
record with the case's stubs written over it: `{ ...recorded, ...steer.downstream, ...steer.pre.stubs, ...one.stubs
}`. `in` is `fired`, the seed's input with the case's patches applied. `expect` is `pick(report)` as `fuzz` builds it,
plus `reason` from `refusalOf(report)` when the run failed with a declared reason. `wholeOf` records its one run the
same way, without `branch`. A branch `casesFor` could not solve (`one.branch.unsolved`) or steer
(`one.unreachable`) is recorded with `expect.status: 'unreachable'` and the sentence `branchLine` prints after
`NEVER RUN`. A policy root records `policy: <the policy's path>` and `trigger: <the first attaching trigger in path
order, whose kind the root borrowed>`; `policyRoots` gains that trigger's path on the root it builds so the recorder
can name it.

**Naming.** Files are named from what they prove, so a reorder of rules moves nothing and a change of target renames
one file:

```
scenarios/rehearsed/<trigger stem>/<feature>.<graph stem>.<switch id>.<to>[.<n>].scenario.json
scenarios/rehearsed/<trigger stem>/whole.scenario.json
scenarios/rehearsed/policies/<policy stem>/<feature>.<graph stem>.<switch id>.<to>[.<n>].scenario.json
```

`<feature>` is the graph's feature (`monitor`, `access`), so two features' `get-row` graphs do not collide; `<n>` is
the rule's index and appears only when two rules of the switch route to the same node, so the common case has none.
A decision reached from three triggers (`list-rows` via `digest`, `export-entries` and `list-entries`) is three
files, since a scenario replays a way in and the three runs differ in their inputs; the rehearsal's lines still
report it once, as `gather` does today.

**Ownership.** `writeRecorded` removes every `*.scenario.json` under the directory it did not write on this run and
touches nothing outside it, so a renamed branch leaves no orphan and a hand-written scenario one level up is safe.
`--check` lists `stale` (on disk, different bytes), `missing` (would be written, not on disk) and `extra` (on disk
under the directory, not written), exits 1 on any, and prints the one hint. Determinism holds because every value in a
scenario is a function of the tree and the seed: stubs come from `generate(type, rng(seed ^ hash(nodePath)))`, the
input from `generate(types.in, rng(seed))`, the case's patches from `satisfy`, and `pick` drops the report's
`startedAt` and `endedAt`. `packages/runtime/test/tools.test.ts` already relies on this when it replays every fuzz
scenario as `same`; the record test below asserts it byte for byte.

**`fuzz --edges`.** `packages/core/src/generate.ts` gains `edges(type: Type): { at: string[]; name: string; value:
unknown }[]` beside `generate`: every field path of an object type, with the edge values of the field's type --

| Type | Edges |
|---|---|
| `string` | `empty` (`""`), `one` (`"x"`), `long` (256 characters) |
| `string` with `enum` | one per member, `enum.<member>` |
| `number` | `zero`, `negative` (`-1`), `fraction` (`0.5`), `max` (`Number.MAX_SAFE_INTEGER`) |
| `boolean` | `true`, `false` |
| `list` | `empty`, `one` (one generated element) |
| an optional field | `absent` (the key removed), beside its type's edges |
| `object` | its fields' edges, paths dotted; `open` extra keys are not varied |
| `unknown`, `blob`, `type`, `var` | none |

`fuzz(load, { edges: true })` fires each trigger once per edge: the seed's input with `setPath(input, at, value)`,
the seed's request, effects stubbed and recorded as under `fuzz` today, `generated: 'edges'`, written to
`scenarios/edges/<trigger stem>/<dotted field>.<edge>.scenario.json` and owned like the rehearsed directory
(`--check` on `fuzz --edges` reuses `checkRecorded`). It varies the trigger's `in` only: `regress` fires
`emb.fire(trigger.doc, sc.doc.in, sc.doc.request, ...)` with the input directly, so the request's own fields are the
seed's and are read only by resolvers and policies. Boundaries a switch reads are not repeated here: the solver already
places `n > 10`'s cases at 11 and 10 (`withinRange`, `firstFinite` in `stubs.ts`), and an edge that a rule reads would
duplicate a rehearsed file. The plain `fuzz` moves its output to `scenarios/fuzz/` and marks `generated: 'fuzz'`;
`fuzz --out <dir>` keeps its meaning.

**`regress`.** `regress` in `fuzz.ts` replays every scenario as today, with four additions. A scenario with `policy`
is fired through the root `policyRoots` builds -- the construction moves to an exported `policyRoot(load, policy,
trigger)` in `stubbing.ts` and both callers use it. A scenario with `expect.status: 'unreachable'` is not fired: the
switches of its trigger are found as `rehearseTrigger` finds them (the probe run, `switchesOf`, `casesFor`; the
discovery is factored into `switchesReached(load, trigger, seed)` in `rehearse.ts` and shared), the case whose
`branch.to` and rule text match the scenario's `branch` is read, and the replay is `same` when it is still unsolved or
unsteerable and `DIFF branch '<when>' → <to> is reachable now` when it is not. `diffOf` compares `expect.reason` to
`refusalOf(report)?.reason` and says `reason <was> → <now>`. When the scenario has a `branch` and the switch's
`selected` at the recorded path differs from `branch.to`, the diff line opens with `branch '<when>' → <to> no longer
routes there:` before the node diffs, so the decision is named before its consequences. `regress` still exits 1 on
any `DIFF`, and the empty-directory message becomes `no scenarios -- run wilanis rehearse --record or wilanis fuzz`.

**`run --seed`, `start`, the embedder, the engine, plugins**: unchanged.

**The CLI.** `packages/runtime/src/cli.ts`: `rehearse [root] [--seed n] [-v] [--record [dir]] [--check]`; `fuzz [root]
[--runs n] [--edges] [--check] [--out dir]`; `regress` as today. `--record` and `--check` together is `--check`.
USAGE's three lines are rewritten to the sentences above.

### Discoverability

- `wilanis ls scenario` lists every scenario, generated ones marked `(rehearse)`, `(edges)`, `(fuzz)` after the path.
- `wilanis describe <scenario>` gains `scenarioLines` in `packages/runtime/src/discovery.ts`, the case `kindBody` has
  no arm for today: the trigger (and policy), `proves get-row 'route' when status == 404 → missing` from `branch`, the
  seed, `expects failed as missing` (or `done`, `blocked`, `unreachable -- <why>`), and one line per node with a
  `selected`, since the routing is what a reader wants; `generated by wilanis rehearse --record: regenerate, do not
  edit` when `generated` is set.
- `wilanis describe <trigger>` gains, after its policies, `scenarios  N recorded, M edge(s), K by hand` with the
  directory, so the count of branches a trigger carries is one command away.
- The viewer's scenario page (`renderDocPage`, `case 'scenario'`) links `trigger` (and `policy`) where it links
  `d.graph` today, which is undefined for every scenario; shows `branch` as a chain `graph → switch → when → to` with
  the graph linked; shows `expect.reason` and `expect.unreachable`; and marks a generated scenario with the sentence
  above. The trigger page lists its scenarios, grouped as `ls` groups them.
- `wilanis map`: unchanged.

### Plugin contract

`PluginModule` and `PluginCheckContext` in `packages/core/src/plugin.ts` are unchanged. Nothing here reaches a
plugin; stubs replace every effect before a handler could run.

## Compatibility

IR v1, compatible. `scenario.schema.json` gains optional fields and one enum member; every scenario written before
this RFC validates and replays as it did. `ScenarioDoc` gains optional members. `HOME` is untouched. The one
observable change to an existing command is where plain `fuzz` writes: `scenarios/fuzz/` instead of `scenarios/`,
so the flat files it wrote before are still loaded and replayed but are no longer owned by anything -- the template's
`CLAUDE.md` says to delete or move them. RFC 0006's `handler` in `expect.nodes` and this RFC's `reason` on `expect`
are independent fields of `pick`'s output. No `schemas-v2`.

## Tests

Sabotage tests through `planted` in `packages/runtime/test/sabotage-unproved.test.ts`, where S001 is tested today
(plant a scenario document, answer the codes):

| Code | The edit |
|---|---|
| S0n2 | a recorded scenario whose `branch.graph` is `@monitor/data/no-such.graph.json`; whose `branch.node` is `asked` (a run node, not a switch); whose `branch.to` is `gone`; the message for `to` names `missing, row, failed` |
| S0n3 | `policy` naming `@features/access/edge/signed-in.policy.json` on a `delete-entry` scenario (attaches `employees-only` and `can-record`); `policy` on a `get-entry` scenario, which attaches none; `policy` naming no document |
| S001 | as today, from `check/scenarios.ts` after the move |
| none | a hand-written scenario with `"when": "else"` and no `generated`; a policy scenario naming a trigger that attaches it |

Runtime, in `packages/runtime/test/tools.test.ts`, on a copy of the example (`cpSync` as the fuzz test does):

| What | Asserts |
|---|---|
| the record is complete | `rehearse(load, { record: 'scenarios/rehearsed' })` writes one file per trigger and branch plus one per branchless trigger -- 50 for the example as it stands (37 branches over 15 decisions, four of them reached by more than one trigger; four `whole` runs) -- and the count moves with the tree, not a literal in the test: it equals the sum over the rehearsal's decisions of branches × triggers, plus its plain runs |
| the record is deterministic | a second `--record` on the untouched copy writes byte-identical files; `check` answers `{ stale: [], missing: [], extra: [] }` |
| the record is a passing suite | the copy loads with 50 scenarios, `checkTree` answers no refusal, `regress` answers `same` for every one |
| a routing change is a diff and a stale file | `get-row`'s first rule changed to `status == 410`: `regress` prints `DIFF branch 'status == 404' → missing no longer routes there` for the `missing` file; `check` lists it `stale` |
| a renamed target | `missing` renamed `gone` in `get-row` (rule and `out.from` too): `check` answers one `missing` (`...route.gone`) and one `extra` (`...route.missing`); `checkTree` refuses the extra as S0n2 |
| ownership | a hand-written `scenarios/mine.scenario.json` survives `--record`; a stray `scenarios/rehearsed/old.scenario.json` is removed |
| a policy's decision | `policies/employees-only/access.require-employee.decide.anonymous.scenario.json` exists with `policy` set, `trigger` naming `delete-entries` and `expect.reason: 'anonymous'`; `regress` replays it `same`; with `require-employee`'s `anonymous` node changed to refuse as `nobody`, `DIFF reason anonymous → nobody` |
| unreachable | `list-rows` reordered as `example.test.ts` reorders it: `rehearse` is not ok, the `rows` branch is written with `status: 'unreachable'` and no `in`; `regress` answers `same`; the order restored, `regress` on the stale directory answers `DIFF ... is reachable now` and `check` lists the file stale |
| edges | `fuzz(load, { edges: true })` writes `get-entry/id.empty`, `id.one`, `id.long`; `record-entry`'s `RecordRequest` yields three for `url` and five `method.enum.<member>`; `list-entries`'s `ListRequest`, whose `method` is optional, yields the five members and `method.absent`; every file has `generated: 'edges'`; a second run is byte-identical; `regress` replays them `same` |
| the CLI | `wilanis rehearse <copy> --check` exits 1 on a stale directory and prints the hint; `--record --check` behaves as `--check` |

Core, in `packages/core/test/validate.test.ts` (the schema cases above) and a new `packages/core/test/edges.test.ts`:
`edges` of `IdRequest` is three; of a shape with an enum, an optional number and a list is the table's rows, in field
order; of `unknown` is none. Compiler: the S rules through the sabotage tests, as every family. Discoverability, in
`tools.test.ts`: `describe` of a recorded scenario prints `proves` and `regenerate`; `ls scenario` marks `(rehearse)`.
Viewer, in `packages/view/test/view.test.ts`: the scenario page's chain links the trigger and the branch's graph.

`libraries/access/test/access.test.ts`: `rehearse` with `record` on the access tree alone writes its 20 branches and
three branchless runs under its own `scenarios/rehearsed/` (its own triggers, through the `-dev` binding), and
`regress` replays them; the directory is committed with the library.

## Implementation plan

1. Core: `scenario.schema.json` and `ScenarioDoc` gain `generated`, `policy`, `branch`, `expect.reason`,
   `expect.unreachable` and the `unreachable` status; the validate baseline; the template row. (`good first issue`)
2. Runtime: `pick` and `diffOf` carry and compare `expect.reason`; `fuzz` writes `generated: 'fuzz'` under
   `scenarios/fuzz/`. Test. (`good first issue`)
3. Compiler: `check/scenarios.ts` with S001 moved and S0n2, S0n3 added; `judgeTree` calls it; sabotage tests.
4. Runtime: `record.ts` -- `scenarioOf`, `fileOf`, `writeRecorded`, `checkRecorded`; `branchOf` and `wholeOf` hand
   back their reports and records; `rehearse` takes `record` and `check`; the CLI flags. The completeness,
   determinism, passing-suite, routing-change, renamed-target and ownership tests.
5. Runtime: `policyRoot` factored out of `policyRoots` and used by `regress`; the root carries its attaching trigger;
   policy scenarios recorded under `policies/`. Test.
6. Runtime: `switchesReached` factored out of `rehearseTrigger`; unreachable branches recorded; `regress` re-solves
   them. Test.
7. Core and runtime: `edges` in `generate.ts`; `fuzz --edges` and its `--check`. Tests.
8. Runtime and viewer: `scenarioLines`, the `ls` marks, the trigger's `scenarios` line; the viewer's scenario page
   fixed and extended. Tests. (`good first issue`)
9. The trees: `example/scenarios/rehearsed/` and `example/scenarios/edges/` committed; `libraries/access/scenarios/rehearsed/`
   committed; the workspace's `npm test` runs `regress` and `rehearse --check` on both (a test in `tools.test.ts` and
   `access.test.ts` against the committed directories, not a copy); the template's `CLAUDE.md` step 3 and row.
   This is M13's "solved branches become committed scenarios".

## Drawbacks and alternatives

- **Files.** Fifty for the example, more for a real tree, each a few kilobytes of stubs and node reports. They are the
  cost of a suite a reviewer can read one decision at a time and a diff can name. The alternative -- one
  `rehearsal.json` snapshot per tree, or one per trigger -- is smaller and worse: not a document (no S rule, no
  `describe`, no page in the viewer), and a diff in it is a diff in a blob a reviewer scrolls. The directory per
  trigger and the name per branch are the design.
- **A record pins behaviour, bugs included.** A recorded rehearsal of a tree whose `route` misroutes records the
  misroute, and `regress` will defend it. That is what a regression suite is; what makes it safe is that `rehearse`
  still judges every branch and fails on a misroute, a block or an undeclared failure, so the pinned bug is red in
  the same run that pinned it, and the unreachable scenario is written *because* the rehearsal failed, not instead of
  it. The alternative, refusing to record a tree whose rehearsal is not ok, would leave the trees that most need a
  baseline without one.
- **An agent will edit an expectation to make a diff go away.** The stub named this, and it is the reason for three
  things here: `generated` marks the file, `--check` catches the edit (a hand edit is stale bytes), and the
  template's `CLAUDE.md` says in the loop's own step that the fix is `--record` and the diff goes to review. What is
  not done: a checker rule that a generated file is current. The checker judges documents against the tree; running
  the solver inside `check` would make `check` as slow as `rehearse` and make S a family that runs graphs. The CI
  step is the enforcement, as a formatter's `--check` is.
- **Edges are fixed and shallow.** Three strings, four numbers, two lists, an enum's members, an absent optional, one
  level of object. No shrinking, no combination of two edges, no edge derived from a `pattern` or a `minLength` the
  shape may one day declare. That is the point: a fixed list is deterministic, reviewable and small, and a value that
  a switch actually reads is already the solver's. Property testing is a different tool and not this RFC.
- **Naming by target, not by rule text or index.** The rule text changes when a threshold does, and an index changes
  when a rule is inserted above; the target changes only when the branch's meaning does. A collision (two rules to
  one node) takes the index as a suffix, which is the rare case paying for the common one. The stub's first open
  question is settled this way.
- **Not a replacement for `fuzz --seed`.** Random runs still find what neither the solver nor the fixed edges look
  for; they live in their own directory, marked, and `regress` replays them alike. The stub's second question is
  settled by keeping both and telling them apart.
- **An include's scenarios stay with the include.** `libraries/access` records its own rehearsal under its
  `scenarios/rehearsed/`, through its `-dev` binding, and its tests replay them; the loader leaves an include's
  `scenarios/` behind as it leaves its connections (`load.ts`: features and aliases come along, nothing else). The
  host records the included decisions again under its own triggers -- `policies/employees-only/...` in the example
  names `delete-entries`, a host trigger -- because a scenario replays a way in, and the way in is the host's. The stub's third
  question is settled so; the cost is that a decision in a library is recorded twice, once per side of the seam,
  which is also what the seam means.

## Open questions

Settled here, with the reasoning in the text: naming by target with an index only on collision; recorded rehearsals
beside fuzz, each in its own owned directory; an include records its own and the host records what it reaches;
unreachable branches are recorded and re-solved; a policy's decision is a scenario naming the policy and an attaching
trigger; staleness is `--check`'s and not a checker rule.

To decide during implementation:

1. Whether `--check` is one flag on `rehearse` and `fuzz`, as written, or one command (`wilanis scenarios --check`)
   over every owned directory at once, which CI would prefer and which would be the natural home for RFC 0019's
   `--json` of staleness.
2. The `long` string's length (256 as written) and whether an `enum` of many members caps its edges.
3. Whether the template's `wilanis init` hooks run `regress` on every graph or binding edit, as its step 3 tells the
   agent to, or leave it to the agent; the loop is faster with the hook and noisier.
4. Whether a scenario's `description` is regenerated with the file (as written: it names the branch and the outcome)
   or kept when a person edits it, which would make the description the one field `--check` ignores.
