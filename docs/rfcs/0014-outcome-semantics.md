# RFC 0014: Outcome semantics: refusals, failures and faults, end to end

- **Status:** accepted
- **Areas:** `area:engine`, `area:core`, `area:compiler`, `area:runtime`, `area:plugin-http`, `area:view`
- **Tracking issue:** #16
- **Depends on:** none to accept. The run id a fault's answer quotes is RFC 0006's `Fired.id`, and the span statuses
  it adds sit in 0006's `traceOf`; both steps land after 0006's and are marked in the plan. RFC 0011's retried node
  and RFC 0012's cancelled run are placed here in the model; neither RFC changes.

## Summary

A run ends one of five ways, and this RFC gives each its word and says what every part of the tree does with it.
A run **answers**, or it **fails**; a failure is a **refusal** when the node that failed gave a `reason` -- the graph
deciding, on purpose, declared with `refuses` and mapped by the trigger -- and a **fault** when it gave none: a handler
threw, a nested run broke, a map's element broke, RFC 0011's timeout struck. Beside these, RFC 0012's **cancelled** run
and the engine's **blocked** one. Two things a tree can say after this that it cannot today: a data graph's `switch`
may `catch` a node's fault and route it, so the network being down becomes the declared `upstream` a route already
answers 502 rather than a 500 with `fetch failed` in the body; and a scenario pins the reason a node refused with, so
`regress` tells a refusal that became a fault from the same refusal. Everything else here is the tree saying once what
it already does in five places: one `outcomeOf(report)` that every kind, `rehearse`, `regress`, the startup runner
and the trace read; a caller who is never told what broke, only that something did and which run it was; and a log
line that says `refused: missing` where it says `failed` today.

## Motivation

The model is built and it is written in pieces. `@std/outcome.port.json#refuse` ends a graph on purpose with a
`reason`; `refuses` on an operation marks the ones that do; `refusalsReachable` in
`packages/compiler/src/refusals.ts` walks from a trigger through its binding into every graph and finds every
literal reason, and T005 holds the trigger to mapping each; `http.trigger-kind.json` says "A fault is a 500";
`templates/CLAUDE.md` says "A node that breaks where no refusal is declared is a fault, and a 500". Four accepted
RFCs lean on the same two words -- RFC 0004 rolls back "on a refusal or a fault", RFC 0009's queue trigger has an
`onFault` setting, RFC 0011 retries "a fault, never a refusal", RFC 0012 answers a cancelled run "as the kind's
fault" -- and each of them stops at the same sentence: what a fault means to a `switch` is RFC 0014's.

What the writing finds, read against the code:

- **The distinction lives in one optional field and is re-derived seven times.** `Report.status` in
  `packages/engine/src/spec.ts` is `'done' | 'failed' | 'blocked'`; a refusing node and a broken node are both
  `failed`, and the one difference is `NodeReport.reason`, set by `noteRefusal` in `run.ts` when the thrown error
  is `instanceof Refusal`. `refusalOf` in `kernel.ts` reads it for the kinds; `failureOf` in
  `packages/runtime/src/serve.ts` reads it again for the startup runner; `whyFailed` in `rehearse.ts` a third time,
  and distinguishes a refusal that arrived from a nested graph; `encodeTrouble` in
  `packages/plugin-http/src/answer.ts` a fourth. Three more find "the first `failed` node" for themselves:
  `nestedFailure` in `compiler.ts` to name what a nested run broke in, `wholeOf` in `rehearse.ts` for a trigger
  with no switch under it, and `challenged` in `embed.ts` to carry the guard's challenge on the node that denied.
  They do not agree on which node ended the run: `refusalOf` takes the first `failed` node in declaration order,
  `failedLeaf` in `stubbing.ts` recurses into `sub`.
- **A fault cannot be routed.** A failed node never enters the run's values, never settles, and `Run.fail` cancels
  everything pending; a `switch` downstream of it never runs. So `@monitor/data/get-row.graph.json` decides what a
  404 and a 500 from the upstream mean and cannot decide what *no answer at all* means: `fetch` rejecting, a
  connection refused, a timeout. Those are answered 500 with the platform's message in the body, and the trigger's
  `response.refusals`, which already maps `upstream` to 502, never sees them.
- **A caller is told what broke.** `encodeTrouble` answers `500 { error: "asked: fetch failed" }`: the node id and
  the raw exception message, which is a plugin's prose and may carry a URL, a host, a path on disk. `wilanis run`
  is worse: `cli.ts` prints `JSON.stringify(answer ?? report)`, so a fault dumps the entire report on stdout where a
  refusal prints two fields. Neither carries an id an operator can find in a log.
- **The log does not say which.** The listener's one line prints `report.status`, so a 404 as `missing` and a 500
  as a fault both read `failed`; a request that never reached a trigger (no route, 400, 413, 415) prints nothing.
- **`regress` cannot tell them apart.** `pick` in `fuzz.ts` records a node's `status`, `selected` and `out`, never
  its `reason`; a `refuse` node replaced by a crash at the same id replays as `same`, and so does a reason changing
  from `missing` to `conflict`, which changes the status a route answers.
- **`blocked` has no place.** A run whose root read (`in`, `request`) was never supplied is a fourth status that the
  http kind answers 500, `rehearse` prints as `BLOCKED`, and a nested runner turns into its caller's fault
  (`nestedFailure` in `compiler.ts`). The scenario schema says it is what "a policy or the guard" produce, which is
  wrong: those produce `failed` with a reason.

What this RFC does not do. It does not give faults kinds a graph can read (a `timeout` beside a `network`): a
fault is what the graph did not declare, and a fault with a name a graph routes on is a reason, which the author
declares with `refuse`; RFC 0011's `timed out after <n>ms` and RFC 0012's `map 'm': 4 elements, limit 3` stay
messages. It does not let a graph catch a callee's *refusal*: a refusal is a declared outcome the trigger maps, and a
graph that swallowed one would take a reason out of what `refusalsReachable` finds without the checker knowing.
It does not change exit codes, add a fourth `Report.status` here (RFC 0012 adds `cancelled`), add a `refused`
status, or add a `fault` operation to `@std/outcome`. It does not move the checker's `Refusal` -- a document the
checker will not accept, with a code -- away from the engine's `Refusal`, a run ending on purpose with a reason:
both are the tree saying no and why, one at check time and one at run time, and the house has one word for it.

## Guide-level explanation

**The words.** A run of a graph **answers** when it reaches `out`. Otherwise it **fails**, and every failure is one
of two things. A **refusal** is the graph deciding: a node ran `@std/outcome.port.json#refuse` -- or an operation
marked `refuses`, or a policy's graph, or the guard -- and gave a `reason`, one word the trigger maps to how the
caller is answered. A refusal is declared, so the checker can enumerate every reason a trigger can reach and T005
holds the trigger to mapping each; `rehearse` prints it `refused on purpose`. A **fault** is a node breaking where
the graph declared nothing: its handler threw something that is not a refusal, the graph it ran broke or blocked,
one of its map's elements broke, its timeout struck. A fault has no reason, is never mapped, and is answered the
kind's one way: a 500 for http, a line on stderr and exit 1 for the command line, `onFault` for a queue message.
Beside these two, RFC 0012's **cancelled** run (the deadline passed; 504) and a **blocked** one (a root the run
reads was never supplied; a wiring hole the checker should have caught, answered as a fault).

**A switch may catch a fault.** Today `get-row.graph.json` reads what the upstream answered and decides what it
means; when the upstream answers nothing -- the network is down, the socket was refused, the request timed out --
`asked` breaks and the route answers `500 { error: "asked: fetch failed" }`. The graph can now say what that means
too, and the word it says is one the trigger already maps:

```json
{
  "$schema": "https://raw.githubusercontent.com/wilanis/wilanis-js/main/packages/core/schemas/graph.schema.json",
  "label": "Get a row",
  "description": "Data graph behind monitor.get: GET the row. 200 is the entry, 404 is the declared refusal for an id that does not exist, anything else the API says is upstream, and so is the API saying nothing at all.",
  "in": "@monitor/domain/EntryRef.shape.json",
  "out": { "type": "@monitor/domain/Entry.shape.json", "from": ["row", "missing", "failed", "unreachable"] },
  "nodes": [
    {
      "type": "@wilanis/node/run.schema.json",
      "id": "asked",
      "label": "GET the row",
      "run": "@http/http.port.json#request",
      "in": {
        "connection": "@connections/monitor-api.connection.json",
        "method": "GET",
        "path": "/monitor/{{in.id}}",
        "produces": "application/json",
        "returns": "@monitor/edge/EntryRow.shape.json"
      }
    },
    {
      "type": "@wilanis/node/switch.schema.json",
      "id": "route",
      "label": "What did the API say?",
      "in": { "status": "{{asked.status}}", "body": "{{asked.body}}" },
      "rules": [
        { "when": "status == 404", "to": "missing" },
        { "when": "status == 200 && has(body)", "to": "row" }
      ],
      "else": "failed",
      "catch": { "asked": "unreachable" }
    },
    { "type": "@wilanis/node/run.schema.json", "id": "row", "label": "The row", "run": "@std/object.port.json#make",
      "in": { "value": "{{asked.body}}", "type": "@monitor/edge/EntryRow.shape.json" } },
    { "type": "@wilanis/node/run.schema.json", "id": "missing", "label": "No such entry", "run": "@std/outcome.port.json#refuse",
      "in": { "reason": "missing", "message": "no entry {{in.id}}", "type": "@monitor/domain/Entry.shape.json" } },
    { "type": "@wilanis/node/run.schema.json", "id": "failed", "label": "Unexpected answer", "run": "@std/outcome.port.json#refuse",
      "in": { "reason": "upstream", "message": "the monitor API answered {{asked.status}}", "type": "@monitor/domain/Entry.shape.json" } },
    { "type": "@wilanis/node/run.schema.json", "id": "unreachable", "label": "No answer", "run": "@std/outcome.port.json#refuse",
      "in": { "reason": "upstream", "message": "the monitor API could not be reached", "type": "@monitor/domain/Entry.shape.json" } }
  ]
}
```

`catch` says: when `asked` breaks, this switch routes to `unreachable`, as if a rule had held. The rules are not
tried -- there is no `status` to read -- and `else` is not taken; `unreachable` runs, refuses `upstream`, and the
route answers 502 with `{ "reason": "upstream", "message": "the monitor API could not be reached" }`, which is what
`get-entry.trigger.json` has said an `upstream` is since it was written. Nothing in the trigger changes. A refusal
is never caught: had `asked` been a node that runs `refuse`, or a nested graph that refused `missing`, the run ends
with that reason as it does today, because a refusal is the graph's own decision and the trigger is already holding
it. The node that caught the fault is still `failed` in the report, with the message the handler threw, marked as
caught; the operator sees what broke, the caller sees the outcome the graph declared for it.

`unreachable` reads nothing of `asked`: it broke, so it produced nothing. Write `{{asked.status}}` in its message
and the checker refuses:

```
G0n3  @features/monitor/data/get-row.graph.json#nodes/unreachable/in/message
    reads 'asked', whose fault routed here: it produced nothing
    → say it without the value; the report and the trace carry what asked threw
```

**What `rehearse` shows.** A catch is a branch, and the rehearsal walks it by making the stubbed effect break:

```
features/monitor/data/get-row  switch 'route'  4/4 branches
  ok  when status == 404               refused on purpose at 'missing' as missing: "no entry golf"
  ok  when status == 200 && has(body)  answered from 'row'
  ok  anything else                    refused on purpose at 'failed' as upstream: "the monitor API answered 500"
  ok  when asked broke                 refused on purpose at 'unreachable' as upstream: "the monitor API could not be reached"
```

A branch that breaks where nothing is declared is still `BROKE`, and the closing sentence of a passing rehearsal
gains the second word: `"refused on purpose" is a refuse node the graph declares: a designed outcome with a reason the
trigger maps, not a fault. A fault a switch catches is the graph deciding what breaking means.`

**What a caller is told.** For `GET /monitor/golf`:

| the run | status | body |
|---|---|---|
| answers | 200 | the entry |
| refuses `missing` | 404 | `{ "reason": "missing", "message": "no entry golf" }` |
| refuses `upstream` (the API answered 500, or answered nothing and `route` caught it) | 502 | `{ "reason": "upstream", "message": "..." }` |
| faults (a node broke and nothing caught it), or blocked | 500 | `{ "error": "fault", "run": "01J8ZK5R9V3Q" }` |
| cancelled (RFC 0012) | 504 | `{ "error": "cancelled: the deadline passed" }` |

The 500 says nothing of what broke: the run's id is what a caller quotes and an operator finds. The listener's
log line says the rest, with the outcome's word instead of `failed`:

```
GET /monitor/golf → 404 (12ms, @monitor/domain/monitor.port.json#get refused: missing)
GET /monitor/golf → 500 (143ms, @monitor/domain/monitor.port.json#get failed at 'asked': fetch failed)  run=01J8ZK5R9V3Q
GET /nope → 404 (0ms, no trigger)
```

On the command line the operator is the caller, so a refusal prints `{ reason, message }` on stdout and exits 1 as
today, and a fault prints `fault at 'asked': fetch failed` on stderr, nothing on stdout, and exits 1 -- never the
report, which `--verbose` prints as it does now.

**What a scenario pins.** `fuzz` records the reason a node refused with beside its status, and `regress` diffs it:

```
scenarios/get-entry-seed-3.scenario.json: DIFF missing: reason missing → none
```

is a `refuse` node that became a crash; `reason missing → conflict` is a reason that changed, and with it the
status a route answers.

## Reference

### Documents and schemas

**`node/switch.schema.json`** gains one optional property:

- `catch` (object; keys are node ids of this graph, values are node ids of this graph): "The nodes whose fault this
  switch routes, and where each goes: when a node named here breaks -- its handler threw something that is not a
  refusal, the graph it ran broke, its timeout struck -- the run goes on, this switch routes to the node named for
  it as if a rule had held, and the rules and `else` are not tried. A refusal is never caught. A node named here is
  one this switch reads (G0n1), and everything else that reads it is routed by this switch (G0n2); the node routed
  to reads nothing of it (G0n3). Only a data graph catches (L0n1), and only an effect can be caught (G0n4)." The
  schema's description of a switch gains: "…else the fallback; a `catch` routes a named node's fault."

`SwitchNode` in `packages/core/src/model.ts` gains `catch?: Record<string, string>`.

**`scenario.schema.json`**: `expect.nodes.<id>` gains `reason` (string, optional): "For a node that refused on
purpose, the reason it gave; absent for a node that answered or broke. A replay whose reason differs, or whose
refusal became a fault, is a diff." `expect.status`'s description is corrected: "How the run as a whole ended:
`done`; `failed` (a refusal -- the graph's, a policy's or the guard's -- or a fault); `blocked` (a root it reads was
never supplied)." `ScenarioDoc` in `model.ts` gains `reason?: string` on a node expectation. RFC 0012 adds
`cancelled` and `cancelAt` to the same document; whichever lands first, the other lands on it.

**`packages/runtime/templates/CLAUDE.md`**: the **Refusals** paragraph becomes **Outcomes** and says the words as the
guide does -- a run answers or fails; a failure is a refusal (a reason, mapped) or a fault (none, the kind's one
answer); a data graph's switch may `catch` a node's fault and route it to a refusal it declares; a fault's message
reaches the report, the log and the trace, never the caller. The `graph` row gains "a switch may `catch` a node's
fault"; the rehearse loop's sentence gains `when <node> broke` as a branch that is walked; the rule list gains the
codes below.

**Placement**: unchanged. **`wilanis new`**: unchanged; `catch` is a key an author adds.

### Ports, operations and kinds granted

No new port, operation, kind or codec. Three documents change in what they say, not in what they accept:

- `packages/runtime/docs/std/outcome.port.json`: the port's description gains one sentence -- "A node that breaks
  where the graph declares nothing is a fault, which a data graph's switch may `catch` and route here."
- `packages/plugin-http/docs/http.trigger-kind.json`: "A fault is a 500." becomes "A fault -- a node that broke and
  no switch caught, or a run blocked on a root nothing supplied -- is answered 500 `{ error: 'fault', run }` with
  the run's id and nothing of what broke; the log and the trace say that. A cancelled run is 504." The `refusals`
  field's description gains "a reason this table does not map is answered as a fault, and the log names the reason;
  T005 makes it unreachable except across a reload".
- `packages/runtime/docs/cli/cli.trigger-kind.json`: after "A refusal prints as { reason, message } … and exits 1",
  gains "A fault prints `fault at '<node>': <message>` on stderr, nothing on stdout, and exits 1; `--verbose` prints
  the report."

`@auth`'s `plugin.json` is unchanged: `guard.refuses` already declares `invalid_credential`, and a guard's
`identify` that throws is a fault of the fire, answered as one (below).

### Checker rules

Codes are placeholders (`G0n1`, `L0n1`, `S0n1`); the implementing pull request takes the next free code of each
family as the tree stands when it lands, and no number here should be read as reserved. Existing codes named in
this RFC (G005, G009, G010, G011, L002, T005, T006, A002, A003, S001) were checked against the source.

| Code | Where it lives | Refuses when | Hint |
|---|---|---|---|
| G0n1 | `check/graph-nodes.ts`, `checkSwitch`, at `nodes/<switch>/catch/<id>` | a key of `catch` is not a node of this graph, is the switch itself, or is a node none of this switch's `in` reads; or its value is not a node of this graph, or is the caught node or the switch (the value is then also judged as a route: G009's "routed by exactly one switch" holds for it) | `catch names a node this switch reads and routes its fault to a node of this graph, e.g. "catch": { "asked": "unreachable" }` |
| G0n2 | `check/graph-nodes.ts`, `checkSwitch`, at `nodes/<reader>/in` | a node other than the catching switch reads a caught node and is not routed, directly or through the nodes it depends on, by that switch | `a reader of a node whose fault is caught runs only where the switch routes: move it behind the switch, or drop catch` |
| G0n3 | `check/graph-nodes.ts`, `checkSwitch`, at `nodes/<target>/in/<field>` | the node a `catch` routes to reads the caught node, in any input or template | `say it without the value; the report and the trace carry what <node> threw` |
| G0n4 | `check/graph-nodes.ts`, `checkSwitch`, at `nodes/<switch>/catch/<id>` | the caught node runs a `pure` operation, an operation marked `refuses`, or is a switch | `nothing here breaks but a bug, which rehearse reports as BROKE; delete catch` |
| G0n5 | `check/inputs.ts`, beside G005, at `nodes/<id>/in/message` | a `refuse` node's `message` reads a path whose field is marked `secret` (the same field walk `redactFor` in `compiler.ts` makes for the report) | `a refusal's message is said to the caller; say it without the secret` |
| L0n1 | `check/graph.ts`, `checkOperationFits`, at `nodes/<switch>/catch` | a switch of a domain graph declares `catch` | `the domain says what is done; what an effect breaking means is the data layer's: catch it in the data graph that runs the effect` |
| S0n1 | `check/triggers.ts`, `checkScenario`, beside S001 | a scenario's `expect.nodes.<id>` carries `reason` with a `status` other than `failed` | `a reason belongs to a node that refused; drop it, or let wilanis fuzz write the scenario again` |

Three things follow from rules that exist. `refusalsReachable` in `refusals.ts` walks every node of a graph
whatever the routing (`graphRefusals`), so the `refuse` node a `catch` routes to contributes its reason with no
change, and T005 holds the trigger to it; the example's `unreachable` says `upstream`, which `get-entry.trigger.json`
maps already, so `codes(EXAMPLE)` stays empty. G010 already asks that every `out.from` candidate answer the
graph's type, and a `refuse` node "declares a type so it can stand as an out.from candidate" (`outcome.port.json`),
so `unreachable` joins `from` as `missing` and `failed` do. `Narrowing` in `check/narrowing.ts` proves nothing for
the node a `catch` routes to: no rule held, so no `has()` is proved, and G0n3 has already refused every read of
the broken node.

**Why a fault has no kind.** RFC 0011 asked whether `timed out after <n>ms` becomes a kind, and RFC 0012 the same of
`map 'm': 4 elements, limit 3`. It does not. `catch` routes a node's fault whatever broke it, and the target says
what that means in a word the trigger maps. A `catch` that could say `{ "asked": { "timeout": "slow", "network":
"unreachable" } }` would be a graph routing on strings a plugin threw -- prose, undeclared, unenumerable -- and the
first place in the tree where a message is a contract. The message stays where it is useful: the report, the log
line, the trace at `full`.

### Runtime behaviour

**The engine's words, precisely.** `NodeStatus` is `pending | running | done | failed | cancelled | seeded`;
`Report.status` is `done | failed | blocked` (RFC 0012 adds `cancelled`). `Refusal` in `packages/engine/src/spec.ts`
is the one thrown error the engine reads: `noteRefusal` in `run.ts` copies its `reason` and `detail` onto the node,
and every other throw leaves `error` alone. Nothing about that changes. Two things are added to the engine, and one
is made sturdier.

**One accessor.** `kernel.ts` gains, beside `refusalOf`:

```ts
/** How a run ended, in the tree's words: read by every trigger kind, the startup runner, rehearse and the trace. */
export type Outcome =
  | { kind: 'answered'; output: unknown }
  | { kind: 'refused'; reason: string; message: string; detail?: Record<string, unknown>; at: string }
  | { kind: 'faulted'; at: string; error: string }
  | { kind: 'blocked'; needs: string[] }
  | { kind: 'cancelled' };
export function outcomeOf(report: Report): Outcome;
```

`at` is the id of the node that ended the run: for a refusal, the first `failed` node carrying a `reason`; for a
fault, the first `failed` node carrying none and not marked `caught` (below); a nested run's ending has already
reached the node that ran it through `nestedFailure` in `compiler.ts`, so the top level answers for the run, as
`refusalOf` says today. `refusalOf` stays, as the `refused` case of `outcomeOf`, since RFC 0009 and RFC 0010 name
it. `failureOf` in `serve.ts`, `whyFailed` and `wholeOf` in `rehearse.ts`, `challenged` in `embed.ts`,
`nestedFailure` in `compiler.ts` and `encodeTrouble` in `answer.ts` are rewritten over `outcomeOf` and their own
search for the first `failed` node goes; `rehearse` keeps its `propagated` case, which is not an ending
but a credit -- a refusal that arrived from a graph this one calls -- and reads `failedBelow` for it as today.

**The discriminator.** `noteRefusal` tests `error instanceof Refusal`. A plugin depends on `@wilanis/engine` and
normally shares the one copy in the tree's `node_modules`, but a plugin that bundles its own copy would throw a
`Refusal` the engine cannot recognise and every declared outcome of that plugin would be a fault. `spec.ts` gains
`isRefusal(error): error is Refusal` -- `instanceof`, or an `Error` whose `name` is `Refusal` and whose `reason` is a
string -- and `noteRefusal`, `collectMap`, `nestedFailure` and RFC 0011's wrapper read it.

**Catching.** `KSwitch` in `spec.ts` gains `catch?: Record<string, string>`, lowered from the document by
`lowerNode` in `compiler.ts`; `NodeReport` gains `caught?: string` -- "call or map: the switch that routed this
node's fault; the run went on" -- and, on a switch, `selected` already says where it went. In `run.ts`:

- The `Run` constructor indexes `catchers: Map<nodeId, switchId>` from every switch's `catch`.
- `fail(report, error)`: when the node is in `catchers` and `!isRefusal(error)`, the node is `failed` with its
  `error`, `report.caught` is set to the switch, and nothing else happens: no ending, no cancellation. Every other
  path through `fail` is as today. A refusal thrown by a caught node ends the run.
- Readiness: a switch's dependency counts as settled when it is `done`, `seeded`, or `failed` and caught by *this*
  switch (`dependenciesSettled` takes the switch's id). Nothing else reads a caught node before the switch has
  routed -- G0n2 has seen to it -- so no other readiness rule changes.
- `runSwitch`: when a read node is `failed` and caught by this switch, `selected` is `catch[id]`, the rules are not
  evaluated, `report.in` records the inputs that were present, and the other targets are cancelled as today.
  A switch that catches two nodes and finds both broken routes on the first in `catch` order. A switch whose
  caught node is `done` runs exactly as before.
- `report()`: unchanged. A run whose caught node's target answered is `done`; whose target refused is `failed` with
  a reason; `outcomeOf` skips the caught node because it is marked.

Three interactions are already decided by the RFCs that own them. RFC 0011's wrapper retries a fault before the
engine sees it, so what `catch` routes is the fault that stood after the last try, and the node's `attempts` are
in its report. RFC 0012's cancellation: once the run is `ending`, nothing starts, so a fault that lands after the
deadline is caught -- the node is marked -- but the switch never runs, and the run is `cancelled`. RFC 0004's atomic
graph: a caught fault does not end the run, so `settle` is not called for it; a statement that broke inside a
transaction has aborted the transaction, and RFC 0004's rule refusing a non-transactional effect inside an atomic graph (its L0n1) already refuses the http request that would be the
usual thing to catch. Whether `catch` inside an atomic graph is refused outright is left to RFC 0004, whose L0n1
already refuses the effects one would catch there; a rule here would judge that RFC's kind of graph from this one.
This RFC adds no rule for it.

**The map.** `collectMap` in `run.ts` is unchanged: under `fail`, an element that refused refuses the map with its
reason and an element that broke is the map's fault, and either reaches the map node as today -- so a `catch` on a
map node catches the map's fault. Under `collect`, every element's outcome is the map's *answer*, as data
(`{ ok: true, value } | { ok: false, error, reason?, detail? }`), and that is the one place a graph reads a
failure as a value. The `error` string of a broken element therefore flows wherever the graph sends the answer,
including to a caller through an edge shape the author declared. That is right by the rule below: what reaches a
caller through a typed answer is the author's document saying so.

**What reaches a caller, and what does not.** The rule that every kind applies: *a refusal's `reason`, `message`
and `detail` are said to the caller; a fault's message is not.* A `reason` is a word the author declared in
`refuses`, a closed set; a `message` is prose the author wrote for the caller (`"no entry {{in.id}}"`), and G0n5
refuses one that reads a secret; `detail` is what the guard built for the caller, a challenge's id and how to
answer it. A fault's `error` is prose a plugin or the platform wrote for nobody -- `fetch failed`,
`ECONNREFUSED 10.0.0.7:5432`, `no blob '…' in the registry` -- and it goes to the report, the log and RFC 0006's trace
at level `full`, never into a kind's fixed answer. `redactValue` in `packages/engine/src/redact.ts` keeps blanking
the paths a document marked in `in` and `out`, and is not applied to messages: the rule above makes it unnecessary
where a message can travel.

**The embedder** (`packages/runtime/src/embed.ts`). `fire` answers a `Report` and keeps doing so. What it does
already is now stated: the guard's `identify` refusing builds a report of one `failed` node `identify` with the
reason (`refused` in `values.ts`); a policy's graph refusing is that policy's report, `deny` changing nothing and
`challenge` rewriting the failed node's `message` and `detail` from the guard; a policy's graph *breaking* is the
run's fault, answered as one (`decide` returns the report when `refusalOf` finds nothing); an answer that does not
fit the trigger's `out` is a fault at a node named `out`. One gap is closed: `fire` and `startup` can throw for
what a checked tree cannot have (`unknown policy '<ref>'`), and the kind's own catch is what answers it. That stays
-- a checked tree never reaches it, and a throw is the honest thing for a tree changed under a running server --
and the http listener's catch is where it is answered (below).

**The http kind** (`packages/plugin-http/src/answer.ts`, `serve.ts`). `encode` reads `outcomeOf`:

| outcome | status | body |
|---|---|---|
| `answered` | `response.status` from the answer, else 200 | the answer, through the `produces` codec, cookies set |
| `refused`, reason mapped | `response.refusals[reason]` | `{ reason, message, ...detail }` |
| `refused`, reason not mapped | 500 | `{ error: 'fault', run }`; the log line names the reason |
| `faulted`, `blocked` | 500 | `{ error: 'fault', run }` |
| `cancelled` | 504 | `{ error: 'cancelled: the deadline passed' }` (RFC 0012) |

`run` is RFC 0006's `Fired.id`, which `answerFor` reads from the record the embedder hands its observers; until that
step lands the body is `{ error: 'fault' }`. The listener's catch in `serve.ts` -- the runtime itself throwing
inside a request: `fire` on an unknown policy, a codec's `encode` breaking, a blob the registry no longer holds
opened while writing the answer -- answers the same `{ error: 'fault' }` and logs `error: <message>` as today, with
the method and path added. The edge's own answers are unchanged and are not outcomes: `404 { error: 'no trigger for
GET /nope' }`, `400` for a body or input that does not conform, `413` past `maxBodyBytes` (RFC 0012), `415` for a
content type the route does not consume. They carry the runtime's own words, not a plugin's, and say what the
caller can fix.

The one log line prints the outcome in the trace's words (RFC 0006's span statuses, so a reader sees the same
vocabulary in both): `ok`, `refused: <reason>`, `denied: <reason>` and `challenged: <reason>` when the gate ended
the run, `failed at '<node>': <message>`, `blocked: needs <roots>`, `cancelled`. A fault's line appends `run=<id>`
so the body's id is found. A request that never reached a trigger is logged too -- `GET /nope → 404 (0ms, no
trigger)`, `POST /monitor → 400 (1ms, body does not conform: …)` -- where today `answerFor` returns without a
report and the `if (answer.report)` guard prints nothing.

**The command-line kind** (`packages/runtime/src/plugins/cli-trigger.ts`, `cli.ts`). `encode` answers the output
or `{ reason, message, ...detail }` as today, and `undefined` for anything else. `run` in `cli.ts` prints what
`encode` answered on stdout when there is one; otherwise it prints the outcome on stderr in the startup runner's
words -- `fault at 'asked': fetch failed`, `blocked: needs in.id`, `cancelled` -- and nothing on stdout. The
`answer ?? report` fallback goes; `--verbose` prints `summarize(report)` on stderr as it does now. Exit codes are
unchanged: 0 for an answer, 1 for anything else. A script telling a refusal from a fault reads stdout: the tree
spoke, or it did not.

**Startup** (`packages/runtime/src/serve.ts`). `runStartup` reads `outcomeOf` and prints `startup 1/3 <label>:
refused as 'unreachable': the database is unreachable` or `failed at 'open': …` or `blocked: needs …`; a required
step's throw carries the same words and the same one-based index as the log line (today the throw says `startup
step 0` where the log said `1/3`). A step's reasons are not mapped and need no rule: there is no caller, and every
non-answer stops the start unless `required: false`. Two fixes to what surrounds a run: `postLoad` runs inside
`start`'s `try`, so a plugin whose `postLoad` throws tears down what earlier plugins held and the blob store before
the error leaves (`bye` today runs only for a startup step's throw), and the error names the plugin --
`plugin '@x' postLoad: <message>`; and a teardown that throws does not stop the teardowns after it, each being
logged. The RFC states, because nothing did, that what happens outside a run is not an outcome: a plugin that does
not load is D006 at check; `postLoad` throwing and a required step not answering stop the start and exit 1; the
edge's own answers are the kind's; and a fault of the runtime inside a request is answered as a fault of the run.

**`rehearse`** (`packages/runtime/src/branches.ts`, `rehearse.ts`, `rehearsal-report.ts`, `stubbing.ts`).
`casesFor` in `branches.ts` yields one case per rule and one for `else`; it yields one more per `catch` entry,
labelled `when <node> broke`, whose stubbing makes the caught node's effect throw instead of answering.
`stubEffects(seed, record, types)` stands at three parameters and gains an options object
(`{ record, types, broken: Set<nodePath>, cancelAt }`, the same object RFC 0012 gives it for `cancelAt`); a
stubbed handler at a broken path throws `Error('broke in rehearsal')`. The branch settles as any other: at a
`refuse` node it is `refused on purpose`; at a node that answers it is `answered from`; a target that itself breaks
is `BROKE`. `failedLeaf` and `failedBelow` skip a node marked `caught`, so the caught node is never the `BROKE` the
report names. The `n/n branches` count includes catch branches, and `example.test.ts`'s regular expressions gain
one line for `unreachable`. A `catch` whose node is not an effect never reaches the rehearsal: G0n4 refused it.
The closing sentence of a passing rehearsal gains the second word, as the guide shows.

**`fuzz` and `regress`** (`packages/runtime/src/fuzz.ts`). `pick` records `reason` on a `failed` node that has one;
`nodeDiffs` prints `<id>: reason <was> → <now>`, with `none` for a node that broke, so a refusal that became a fault
and a reason that changed are both diffs. `fuzz` stays a recorder of what the tree does with one exception: a run
whose `outcomeOf` is `faulted` under stubs is the tree's own bug (the stubbed world never throws, so what broke is a
`make` whose value does not fit, a `refuse` whose reason is not a string, a wiring hole) and `fuzz` writes no
scenario for it, prints `<trigger> under seed <n>: FAULT at '<node>': <message>`, and exits 1 -- a scenario that
pinned a fault would make `regress` hold the tree to breaking. `regress` is otherwise unchanged; a scenario from
before this RFC has no `reason` on any node and replays as it did.

**Traces (RFC 0006).** `traceOf` gains: a `run` node or map element marked `caught` has status `failed (caught)`
and its error at `full`; the catching switch's span carries `wilanis.caught` at `summary`, beside
`wilanis.selected`, which is at `summary` today -- both are node ids the tree's author wrote, and nothing a node
carried can leak through one; the root
span's status gains `blocked` beside `refused`, `denied`, `challenged`, `failed`, `cancelled` and `ok`, so the
trace, the log line and `outcomeOf` say the same words. Nothing else in 0006 changes: the rule that `summary`
carries a reason and never a message is this RFC's rule seen from the trace.

**Queue and scheduled triggers (RFC 0009, RFC 0010).** Unchanged. A queue message's `outcomes` table maps a
refusal's reason to `ack | retry | dead` and `onFault` says what a fault becomes; a scheduled tick logs
`→ refused <reason>` or `→ failed`. Both read `refusalOf`, which stays, and both may read `outcomeOf` when it
exists; a fault a switch caught is not a fault of the run, so `onFault` does not see it.

### Discoverability

- `wilanis describe <graph>` (`nodeLines` in `packages/runtime/src/discovery.ts`): a switch's line gains
  `catches asked → unreachable` after its rules.
- `wilanis describe <port>#<op>` is unchanged: `(refuses on purpose)` already marks a refusing operation.
- `wilanis describe <trigger-kind>` prints the kind's description, which now says how a fault is answered.
- `wilanis describe <trigger>` prints one closing line after its refusal table, the same sentence the viewer's
  trigger page closes with: the kind's fixed answers (`a fault: 500`, `cancelled: 504`) are what a reader of that
  table needs next, and leaving them to `describe <trigger-kind>` asks a second command for the other half.
- `wilanis map` is unchanged: an outcome is not a document.
- The viewer (`packages/view/client/index.html`, `renderDocPage`; `packages/view/src/model.ts`): a graph page draws
  a `catch` as an edge from the switch to its target labelled `<node> broke`, dashed, beside the rule edges, and the
  side panel of a caught node says `its fault is caught by <switch>`. The trigger page's *Refusals it answers* table
  gains one closing line: "Anything that breaks and no switch catches is a fault: answered the kind's one way, never
  mapped." The node entries `viewOf` builds carry `catch` on a switch and `caughtBy` on a node.

### Plugin contract

`PluginModule` and `Handler` in `packages/core/src/plugin.ts` do not change. What a handler owes is written down,
in the doc comment on `Handler` in `packages/engine/src/spec.ts` and in the plugins' README: *answer what your `returns` types, throw
`Refusal` for what your operation declares with `refuses`, and throw anything else only for what you did not
expect.* `@http/http.port.json#request` is the model: it answers a 404 as `{ status: 404 }` and lets a switch
decide, judges the body against `returns` on a 2xx only, and throws for a socket that never answered. A plugin
that throws for an expected case has taken a decision from the graph. `TriggerRuntime.encode` receives the report
as today and reads `outcomeOf` from `@wilanis/engine`, which every plugin already depends on.

## Compatibility

IR v1, compatible. `node/switch.schema.json` gains an optional `catch`; `scenario.schema.json` gains an optional
`reason` on a node expectation and a corrected description; three plugin documents change in prose. Every document
written before this RFC validates and means what it meant: no catch, a fault ends the run. `KSwitch` gains an
optional field the compiler alone writes; `NodeReport` gains an optional `caught`; `kernel.ts` gains `outcomeOf`
and `Outcome`, `spec.ts` gains `isRefusal`. A report of a run with no `catch` is byte-for-byte what it was.

Two things a caller can see change, both the runtime's own answers and neither a document: the http kind's 500 body
is `{ error: 'fault', run }` where it was `{ error: '<node>: <message>' }` (and the unmapped-reason 500 likewise,
where it echoed the message), pinned today by `http.test.ts` ("a fault stays a 500 that says where it broke"), which
is rewritten to say the opposite; and `wilanis run` prints a fault on stderr where it printed the report on stdout.
No `schemas-v2`.

The wording of RFC 0011 ("what a failure means to a switch") and RFC 0012 ("a timed-out node is a failure of that
node, routable by a switch once RFC 0014 says how") reads correctly under this RFC's words, a failure being either
ending and a fault the one a switch may catch; neither file changes.

## Tests

Engine, in `packages/engine/test/kernel.test.ts` and a new `catch.test.ts`, with the handlers in `handlers.ts`:

| What | Asserts |
|---|---|
| `outcomeOf` names every ending | a done spec: `answered` with the output; a refusing handler: `refused` with reason, message, detail and `at`; a throwing handler: `faulted` with `at` and the message; an unsupplied root: `blocked` with `needs`; a `Refusal` from a nested run reaching the caller node: `refused` at the caller |
| `isRefusal` reads a foreign copy | an `Error` with `name: 'Refusal'` and a string `reason` is noted as a refusal; one without `reason` is a fault |
| a caught fault routes | `asked` throws; the switch's `selected` is the catch target, the target ran, the run is `done` or refuses as the target says; `asked` is `failed` with `caught: 'route'`; no node is `cancelled` but the switch's other targets |
| a refusal is never caught | `asked` throws `Refusal('missing', …)`; the run is `failed` with reason `missing`; the switch never ran |
| `outcomeOf` skips the caught node | a caught fault whose target refuses `upstream`: `refused` with `upstream`, not `faulted` at `asked` |
| a caught node that answers | `asked` answers; the rules are tried as before; the report equals the pre-RFC report but for no `caught` |
| a map's fault is caught whole | an element breaks under `fail`; the map node is `failed`, `caught`, the switch routes; under `collect` the map answers and nothing is caught |
| after the deadline (RFC 0012, once it lands) | a fault landing after the abort is marked `caught`; the switch never runs; the run is `cancelled` |

Sabotage tests through `sabotage` in `packages/runtime/test/example-harness.ts` (copy the example, edit one
document, answer the codes), in `example.test.ts` and `sabotage.test.ts`:

| Code | The edit |
|---|---|
| G0n1 | `"catch": { "nope": "unreachable" }` on `route`; `{ "row": "unreachable" }` (a node the switch does not read); `{ "asked": "asked" }`; `{ "asked": "nope" }` |
| G0n2 | a node `logged` reading `{{asked.status}}` added to `get-row.graph.json` outside the switch's routes |
| G0n3 | `"message": "the API said {{asked.status}}"` on `unreachable` |
| G0n4 | `"catch": { "row": "unreachable" }` with `row` read by the switch (`@std/object.port.json#make`, pure); `{ "missing": … }` (a `refuse` node) |
| G0n5 | a `refuse` node in `sign-in-customer.graph.json` whose message reads the password field |
| L0n1 | `"catch": { "recorded": "failed" }` on the switch of a domain graph |
| S0n1 | a scenario whose `expect.nodes.row` carries `reason: "missing"` with `status: "done"` |
| none | the guide's `get-row.graph.json`: `codes(EXAMPLE)` is empty; `rehearse` prints `4/4 branches` for `route` and the `when asked broke` line |

Runtime, in `packages/runtime/test/`:

| Test | Where | What it does |
|---|---|---|
| a caught branch is rehearsed | `example.test.ts` | the `unreachable` line matches `refused on purpose at 'unreachable' as upstream`; the `BROKE` regular expression still matches nothing |
| a target that breaks is BROKE, the caught node is not | `rehearse.test.ts` (new, with a fake plugin whose effect is caught and whose target throws) | one `BROKE at 'target'`; no line names the caught node |
| `fuzz` records the reason, `regress` diffs it | `tools.test.ts` | fuzz the example; a scenario's `missing` node carries `reason: 'missing'`; edit the graph's reason to `conflict` and regress prints `missing: reason missing → conflict`; replace the `refuse` with a throwing fake and it prints `reason missing → none` |
| `fuzz` writes no scenario of a fault | `tools.test.ts` | a fake trigger whose graph runs a `make` with a value that does not fit: `fuzz` prints `FAULT at 'made'`, writes nothing, answers not ok |
| the cli prints a fault on stderr | `tools.test.ts` | `runTrigger` on a trigger whose effect is a throwing fake: stdout empty, stderr `fault at 'asked': boom`; a refusing one: stdout `{ reason, message }` |
| startup words and index | `startup.test.ts` | a required step at index 0 that refuses throws `startup step 1/3 … refused as '…'`; an optional fault logs `failed at '…'` |
| `postLoad` throwing tears down | `startup.test.ts` | the second plugin's `postLoad` throws; the first plugin's teardown ran; the message names `@second` |
| a teardown that throws does not stop the rest | `startup.test.ts` | two held things, the first's `stop` throws; the second's ran; both logged |

Http, in `packages/plugin-http/test/http.test.ts` against the fake upstream in `harness.ts`: an upstream that
refuses the socket, with the guide's `catch` on `get-row.graph.json`, answers `GET /monitor/{id}` 502
`{ reason: 'upstream', message: 'the monitor API could not be reached' }`; without the catch, 500 `{ error: 'fault' }`
and a body that contains neither `asked` nor `fetch`; the unmapped-reason test asserts `{ error: 'fault' }` and a log
line naming `conflict`; the log line for a 404 reads `refused: missing`; `GET /nope` logs `→ 404 (…, no trigger)`;
a policy graph that throws answers 500 `{ error: 'fault' }`, not 403. Once RFC 0006's step 3 lands: the 500 body's
`run` equals the trace's id.

Core, in `packages/core/test/validate.test.ts`: the baseline switch gains a `catch`; `catch: []` and
`catch: { asked: 1 }` are refused by the schema; a scenario node with `reason` validates.

Viewer, in `packages/view/test/view.test.ts`: the example's `get-row` view carries `catch` on `route` and
`caughtBy: 'route'` on `asked`.

## Implementation plan

1. Engine: `Outcome`, `outcomeOf`, `isRefusal`; `refusalOf` as the `refused` case; `noteRefusal`, `collectMap` and
   `nestedFailure` read `isRefusal`, and `nestedFailure` names the faulted node through `outcomeOf`. Tests.
   (`good first issue`)
2. Engine: `KSwitch.catch`, `NodeReport.caught`, `catchers`, the readiness and `fail` changes, `runSwitch` routing
   a caught node. `run.ts` stands at the file limit: this lands on whichever of RFC 0011's report split or RFC
   0012's `map.ts` split has landed, or makes RFC 0011's if neither has.
3. Core and compiler: `catch` on `SwitchNode` and its schema; `lowerNode` lowers it; G0n1, G0n2, G0n3, G0n4 in
   `check/graph-nodes.ts` and L0n1 in `check/graph.ts`, with the sabotage tests; `Narrowing` proves nothing for a
   catch target.
4. Compiler: G0n5 in `check/inputs.ts`, a `refuse` message that reads a secret, with its sabotage test.
   (`good first issue`)
5. Runtime: `failureOf`, `whyFailed`, `wholeOf`, `challenged` and `encodeTrouble` over `outcomeOf`, so no consumer
   searches for the first `failed` node itself; `runStartup`'s words and index; `postLoad` inside `start`'s `try`,
   named, and teardowns that go on. Tests.
6. Http: `encode` over `outcomeOf`, the `{ error: 'fault' }` body, the log line's outcome words and the edge's
   answers logged; `http.test.ts` rewritten where it pinned the message. After RFC 0006's step 3: `run` in the body
   and `run=` on the line.
7. Cli: a fault on stderr, the `?? report` fallback gone; `cli.trigger-kind.json`'s sentence. Test in
   `tools.test.ts`. (`good first issue`)
8. Runtime: `stubEffects` options object with `broken`; `casesFor` yields catch branches; `failedLeaf` and
   `failedBelow` skip `caught`; the report's closing sentence; `example.test.ts`.
9. Runtime: `pick` records `reason`; `nodeDiffs` diffs it; `fuzz` refuses to write a fault; `scenario.schema.json`
   and `ScenarioDoc`; S0n1 in `check/triggers.ts`.
10. Documents: the example's `get-row.graph.json` gains `unreachable` and the `catch` (the M09 demo shows it against
    an upstream that is down); `outcome.port.json`, `http.trigger-kind.json`, `templates/CLAUDE.md`; the README's
    "Anything you did not name goes to `failed`" paragraph gains one sentence on `catch`, and its rehearsal listing
    the fourth line.
11. Viewer and `describe`: the catch edge and the caught node's panel; the trigger page's closing line and the
    same line from `wilanis describe <trigger>`; a switch's `catches` line in `nodeLines`; `viewOf` carries the
    two fields. Test.
12. After RFC 0006: `traceOf`'s `failed (caught)`, `wilanis.caught` and the root's `blocked`.

## Drawbacks and alternatives

- **Two words where the stub had three.** The stub sketched *failure* as a node's unexpected ending and *fault* as
  the runtime's own, outside every node. The code, `http.trigger-kind.json`, `templates/CLAUDE.md`, the engine's
  `Refusal` comment and RFCs 0004, 0009, 0011 and 0012 already say *fault* for the node's, and RFC 0009 wrote it into
  a setting (`onFault`). Renaming what a reader can open in five plugin documents and four accepted RFCs, to make
  room for a word for the runtime's own trouble, is the wrong trade: that trouble is not an outcome of a run at all
  -- it is the edge's own answer, or the start refusing -- and this RFC says so in a paragraph instead of a noun.
  *Failure* keeps the meaning the engine gives it: the status `failed`, which a refusal and a fault both produce.
- **`catch` on the switch, not on the node.** `"onFault": "answer"` on the `run` node -- the node answering
  `{ fault: { error } }` instead of its `returns` -- was considered: it would change the node's type wherever it is
  read and put a plugin's message into the graph's values. A `failed(asked)` predicate in a rule was considered: a
  rule is typed over the switch's `in`, which reads values, and a node that broke has none; the predicate would be
  the one thing in the grammar not about a value. A separate `catch` keeps the rules about values and the routing
  about outcomes, and gives the solver one more branch to walk with nothing to solve.
- **A caller loses the message.** An operator debugging against a deployed tree with only a browser sees
  `{ error: 'fault', run }` where they saw `fetch failed`. The log has the message and the id, the trace has both
  at `full`, and `wilanis run` prints it, because there the operator is the caller. The alternative -- keep the
  message in the body -- is the alternative every framework took before it leaked a connection string.
- **A `refused` status on `Report`** was considered and rejected: `failed` plus `reason` is what every consumer,
  every scenario written by `fuzz` and every accepted RFC reads today; `outcomeOf` gives the name without changing
  the report, and a scenario from before this RFC still replays.
- **Catching a refusal** (a typed `catch` by reason, `{ "asked": { "missing": "made-empty" } }`) would let a graph
  handle a callee's declared outcome the way a caller handles a typed error. It is deferred, not refused: it needs
  `refusalsReachable` to know routing, since a caught reason no longer reaches the trigger, and the syntactic walk
  that makes T005 an over-approximation would have to become a dataflow one. RFC 0021 may want it for a state
  machine's transitions.
- **Exit codes** that tell a refusal from a fault were considered for `wilanis run`; stdout carrying the tree's
  answer or its refusal and stderr carrying what broke is the same information without a convention to learn.

## Open questions

Settled here, with the reasoning in the text: a fault has no kinds; a refusal is never caught; the catch target
reads nothing of the broken node; a fault's message never enters a kind's fixed answer; a collected element's
`error` is the author's typed answer; `fuzz` writes no scenario of a fault; `blocked` is answered as a fault and
placed as a wiring hole.

Settled on acceptance, with the reasoning in the text: `catch` inside an atomic graph is RFC 0004's to refuse
or allow, and this RFC adds no rule for it; the trace carries `wilanis.caught` at `summary`, beside
`wilanis.selected`; and `wilanis describe <trigger>` closes its refusal table with the kind's fixed answers, the
sentence the viewer's trigger page closes with.

None left open.
