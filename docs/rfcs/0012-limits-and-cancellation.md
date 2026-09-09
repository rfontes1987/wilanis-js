# RFC 0012: Resource limits, timeouts and cancellation of a run

- **Status:** draft
- **Areas:** `area:engine`, `area:core`, `area:compiler`, `area:runtime`, `area:plugin-http`, `area:plugin-blob`, `area:view`
- **Tracking issue:** #14
- **Depends on:** none to accept. RFC 0011 names the seam this RFC takes (what the scheduler does when the run's
  signal fires) and its handler wrapper gains one line here (a cancelled try is not tried again); that step lands on
  0011's `attempts.ts`. RFC 0004's rollback on cancellation is a consequence of its `settle`, tested here once its
  `AtomicScope` exists. Both steps are marked in the plan.

## Summary

A run has a deadline, a fan-out has a ceiling, a body has a size, and a run that is cancelled ends with a report
that says so. The engine stays clockless: it never waits on time and never decides to run again. What it gains is
one observation -- when the `AbortSignal` it already accepts fires, it starts nothing more, settles every node that
had not started as `cancelled`, waits for what was in flight, and answers a report whose status is `cancelled` --
and one scheduling fact, that a `map` may run at most so many elements at once. Every limit is written where its
vocabulary lives: the deadline and the body's size on an http trigger and in the plugin's settings, the most a
list may hold on the edge shape that receives it, the ceiling and the pace of a fan-out on the `map` node. A
cancelled run answers the kind's fault (a 504 for http), never a partial answer; and cancellation cannot undo an
effect that already ran, which this RFC says plainly rather than implies away.

## Motivation

A production service is judged by what happens when something hangs. Today, in the tree as it stands:

- **A run has no deadline.** `FireOptions.signal` in `packages/runtime/src/embed.ts` has existed since the
  embedder was written, and nothing supplies it: `FireArgs` in `packages/core/src/plugin.ts` has no `signal`, so
  `Served.serving().fire` in `packages/runtime/src/serve.ts` passes `{ blobs }` alone and the http listener's
  `answerFor` (`packages/plugin-http/src/serve.ts`) could not hand one if it wanted to. A route waits on its graph
  for as long as the graph takes.
- **The engine ignores the signal it is given.** `Run` in `packages/engine/src/run.ts` forwards `opts.signal` to
  every handler through `contextFor` and never reads it. A handler that honours the signal rejects, its node fails
  as a fault with the platform's message (`This operation was aborted`), and `Run.fail` cancels what is pending --
  so the run *looks* cancelled, by accident, and reports `failed`. A handler that ignores the signal -- and the http
  `request` handler does, its context type being `{ env }` alone (`packages/plugin-http/src/request.ts`) -- lets
  the run start every node that becomes ready until quiescence. RFC 0004 wrote that "an `AbortSignal` that fires
  mid-run fails the run, so `settle(false)` rolls back"; RFC 0011 read `run.ts` and found the first half is not
  what the code does, and handed the question here. This RFC answers it.
- **A fan-out has no ceiling.** `Run.runMap` does `Promise.all(over.map(...))`: every element at once, however
  many. `DELETE /monitor` (`example/features/monitor/edge/delete-entries.trigger.json`) fans one `monitor.remove`
  out per id in the body, and nothing in the tree bounds the body's list. The connection's `throttle`
  (`packages/plugin-http/src/throttle.ts`) paces the *requests* against one upstream; it cannot bound how many
  nested graph runs a map holds in flight, nor how long the list is.
- **A body has no size.** `readBody` in `packages/plugin-http/src/serve.ts` hands the request stream to the codec,
  and `json`, `text` and `form` (`packages/plugin-http/src/codecs.ts`) `readAll` it. The blob codec streams into
  the registry, which keeps the bytes out of memory but not off the disk. Nothing refuses a body for its size, in
  either direction: `readBody` in `request.ts` buffers an upstream's answer the same way.

What an author cannot express today: that a route gives up after five seconds; that a body of ids may hold at
most a hundred; that a fan-out runs eight at a time; that an upload is a megabyte at most. What the runtime cannot
do: stop starting nodes, and say in the report which ones never ran.

What this RFC does not do. It does not bound a *call*: `timeoutMs` at a node or a binding operation is RFC 0011's,
and a timed-out node is a failure of that node, routable by a `switch` once RFC 0014 says how. It does not undo
anything: a cancelled run's effects that ran, ran (see *Drawbacks*). It does not give the command-line kind a
deadline (nothing at a terminal asks for one), does not cancel a run when an http client disconnects (a POST whose
caller gave up is the case where finishing the write is the safer choice; the deadline is the operator's decision
and the disconnect the caller's, and this RFC takes the first), and does not give the guard's `identify` a signal
(`GuardArgs` in `packages/core/src/plugin.ts` stays as it is). It does not shed load, rate-limit callers, or
bound memory per value (*Open questions*, third). It changes nothing about how ready nodes are scheduled: every
ready node still starts at once; the ceiling is inside one node.

## Guide-level explanation

**A deadline** is the most a run may take, in milliseconds, counted from the moment the trigger fires -- after the
body is read and the input judged -- until the answer. When it passes, the run is **cancelled**: no node that has
not started will start, the nodes in flight are told through their signal and finish as they finish, and the
report says which nodes ran, which never did, and that the run was cancelled. An http route answers a cancelled run
with 504 and no body of the answer, whatever had settled.

An http route writes its deadline in its own settings, and the plugin's settings in `project.json` give every
route of the tree one. The tighter of the two is not chosen: the route's, when written, *is* the deadline, and the
plugin's is what a route that writes none gets. `GET /monitor/{id}`, bounded to two seconds:

```json
{
  "$schema": "https://raw.githubusercontent.com/wilanis/wilanis-js/main/packages/core/schemas/trigger.schema.json",
  "label": "GET /monitor/{id}",
  "description": "GET /monitor/{id} → the entry; 404 { reason: missing, message: `no entry {id}` } when there is none, 502 as upstream when the monitor API broke, 504 after two seconds.",
  "settings": {
    "route": "/monitor/{id}",
    "method": "GET",
    "produces": "application/json",
    "deadlineMs": 2000,
    "response": {
      "refusals": {
        "missing": 404,
        "upstream": 502
      }
    }
  },
  "in": "@monitor/edge/IdRequest.shape.json",
  "out": "@monitor/edge/EntryView.shape.json",
  "kind": "@http/http.trigger-kind.json",
  "fire": {
    "run": "@monitor/domain/monitor.port.json#get",
    "in": {
      "id": "{{request.params.id}}"
    }
  }
}
```

and the tree's default for every other route, with the most a body may weigh, in `example/project.json`:

```json
{
  "use": "@http",
  "from": "@wilanis/plugin-http",
  "settings": {
    "port": 8080,
    "deadlineMs": 30000,
    "maxBodyBytes": 1048576,
    "codecs": {
      "application/json": "@http/codecs/json.codec.json",
      "text/csv": "@http/codecs/blob.codec.json"
    }
  }
}
```

A reader of the trigger knows its deadline; a reader of `project.json` knows the tree's; `wilanis describe` says
which one a route ends up with. A route with neither has none, as today.

**A body has a size.** `maxBodyBytes` is written the same two places. A body that passes it is answered 413 before
any codec has finished with it, whichever codec: a JSON body is not parsed, a CSV upload is not stored.

**A list has a most.** A field of a shape whose type is a list may say `maxItems`, and the edge judges it when the
body arrives, the way it judges every other field (`conforms`, in `packages/core/src/values.ts`). The body of
`DELETE /monitor`, bounded:

```json
{
  "$schema": "https://raw.githubusercontent.com/wilanis/wilanis-js/main/packages/core/schemas/shape.schema.json",
  "label": "Delete request",
  "layer": "edge",
  "description": "DELETE /monitor body: the ids of every entry to remove, a hundred at most. Closed: an undeclared field is a 400.",
  "fields": {
    "ids": {
      "type": "string[]",
      "maxItems": 100,
      "description": "the entries to remove, each by id"
    }
  }
}
```

A public trigger -- one with no `policies`, so anyone may call it -- must bound every list its edge shapes take,
because an unbounded list from an anonymous caller is the request-shaped denial of service. `DELETE /monitor` is
gated, so `maxItems` there is good manners; take its policies away and leave the bound off, and the checker says:

```
T0nn  @features/monitor/edge/delete-entries.trigger.json#in
    public trigger takes '@monitor/edge/DeleteRequest.shape.json', whose field 'ids' is a list with no maxItems
    → add "maxItems" to ids in DeleteRequest.shape.json: the most an anonymous caller may send; or gate the
      trigger with a policy
```

**A fan-out has a ceiling and a pace.** A `map` may say `limit`, the most elements it will run over -- more is a
fault of the node before any element starts -- and `concurrency`, how many elements run at once; the rest wait
their turn, in index order. The map behind `DELETE /monitor`
(`example/features/monitor/domain/remove-entries.graph.json`), eight removals at a time:

```json
{
  "type": "@wilanis/node/map.schema.json",
  "id": "removed",
  "label": "Remove each entry",
  "description": "monitor.remove once per id, eight at a time; the element is the id itself",
  "run": "@monitor/domain/monitor.port.json#remove",
  "over": "{{in}}",
  "limit": 100,
  "concurrency": 8,
  "bind": {
    "id": ""
  }
}
```

The domain graph is where these two live, and that is right: how many removals run at once is a statement about
the business operation (the upstream is paced by the connection's `throttle` either way), and `limit` says what the
graph is for -- a batch, not a bulk load. `maxItems` on the edge shape and `limit` on the map say the same number
here on purpose: the first refuses the caller at the door with a 400, the second is the graph's own guarantee
whoever calls it, from a trigger or from another graph.

**What a cancelled run looks like.** `DELETE /monitor` with twenty ids, `concurrency: 8`, an upstream that has
stopped answering, and a deadline of two seconds. The route answers `504 { "error": "cancelled: the deadline
passed" }`, and the report, summarised the way `wilanis run --verbose` prints one (`summarize` in
`packages/runtime/src/stubbing.ts`):

```
@monitor/data/monitor-rest.binding.json#removeMany: cancelled
  op: failed -- @monitor/domain/remove-entries.graph.json: cancelled
    @monitor/domain/remove-entries.graph.json: cancelled
      removed: failed -- map 'removed' element 8: This operation was aborted
        removed.0: done
        ...
        removed.7: done
        removed.8: failed -- This operation was aborted
        ...
        removed.15: failed -- This operation was aborted
        removed.16: cancelled
        ...
        removed.19: cancelled
```

Eight removals were done before the deadline, eight were in flight when it struck and were told to stop, four
never started. The first eight entries are gone from the upstream; the caller was told 504. That is the honest
state of things, and the report is how an operator learns it.

## Reference

### Documents and schemas

**`node/map.schema.json`** gains two optional properties:

- `limit` (integer, minimum 1): "The most elements this map will run over. A longer list fails the node as a fault
  before any element starts. Absent: any length."
- `concurrency` (integer, minimum 1): "How many elements run at once; the rest wait for a slot, in index order.
  Absent: every element at once, as today."

`MapNode` in `packages/core/src/model.ts` gains `limit?: number` and `concurrency?: number`.

**`common.schema.json`, `$defs/field`** gains `maxItems` (integer, minimum 1): "For lists: the most items a value
may hold. Judged wherever the type is judged at run time -- a body at the edge, a trigger's answer -- and refused
where it is written on a field that is not a list (C0nn)." `Field` in `model.ts` gains `maxItems?: number`. The
list type in `packages/core/src/types.ts` gains the bound -- `{ kind: 'list'; of: Type; max?: number }` -- set by
`TypeResolver.field` the way `enum` is set on a string there; `conformsList` in `values.ts` refuses a longer list
with `$.ids: at most 100 items`; `generate` in `generate.ts` draws a length at most `max`. `assignable` in
`assign.ts` ignores the bound: a bounded list is a list, and T002's judgement of an edge shape against a core
contract does not change because the edge says how many. Whether `show` prints the bound is decided during
implementation; `describe` prints it either way.

**`scenario.schema.json`**: `expect.status` gains `cancelled`, and the document gains `cancelAt` (string, optional):
"The dotted node path of one stubbed effect at which the replay cancels the run: `regress` aborts the run's signal
when that node is reached, and the node rejects the way an aborted call does. Must be a key of `stubs` (S0nn).
`fuzz` never writes it; an author does, to pin a deadline." `ScenarioDoc` in `model.ts` gains `cancelAt?: string`
and `'cancelled'` in `expect.status`.

**`packages/runtime/templates/CLAUDE.md`**: the `graph` row gains "a `map` may say `limit` (the most elements) and
`concurrency` (how many at once)"; the `shape` row gains "a list field may say `maxItems`"; the `scenario` row gains
"`cancelAt` pins a cancellation"; the *Many at once* paragraph gains a sentence on `concurrency`; the http
paragraph gains one on `deadlineMs` and `maxBodyBytes`, and on a public route bounding its lists.

**Placement**: unchanged; `HOME` in `packages/core/src/placement.ts` is not touched. **`wilanis new`**: unchanged;
every field here is one an author adds.

**`trigger-kind.schema.json`**: unchanged. The deadline is a setting of the http kind's own vocabulary, written in
the kind's document (below), not a field every kind carries.

### Ports, operations and kinds granted

No new port, operation or codec. Three documents of `@wilanis/plugin-http` change:

- `packages/plugin-http/docs/http.trigger-kind.json`, `settings.fields` gain `deadlineMs` (number, optional: "the
  most this route's run may take, in milliseconds, from firing to answer; past it the run is cancelled and answered
  504. Absent: the plugin's setting, else none") and `maxBodyBytes` (number, optional: "the most a body may weigh;
  past it the request is answered 413 before the codec finishes. Absent: the plugin's setting, else none"). Both sit
  beside `route`, `method`, `body` and `response`, not inside `response`: `response` says how the route answers;
  these say what it accepts and how long it works.
- `packages/plugin-http/docs/plugin.json`, `settings.fields` gain the same two, the defaults for every route of the
  tree, read the way `listen` reads `port` (`input.port ?? settings.port ?? 8080`): the route's, else the
  plugin's, else none.
- `packages/plugin-http/docs/http.connection-kind.json`, `settings.fields` gain `maxBodyBytes` (number, optional:
  "the most an answer from this connection may weigh; past it the request node fails as a fault"). The same
  limiter, in the other direction.

`packages/runtime/docs/cli/cli.trigger-kind.json` declares none: `wilanis run` hands no signal and a command-line
run is never cancelled.

### Checker rules

Codes are placeholders (`T0nn`, `C0nn`, `S0nn`, `X0nn`); the implementing pull request takes the next free code of
each family as the tree stands when it lands, and no number here should be read as reserved. Existing codes named
in this RFC (T001, T002, T005, G004, G006, G012, X003, S001, L008, B006) were checked against the source.

| Code | Where it lives | Refuses when | Hint |
|---|---|---|---|
| T0nn | `check/triggers.ts`, `TriggerCheck` | a trigger with no `policies` declares an edge shape -- its `in`, or a setting of its kind typed `type` (the ones `checkTypeSetting` already walks) -- with a field, at any depth, whose type is a list without `maxItems`. `unknown` and open objects are not judged: lists only | `add "maxItems" to <field> in <shape>: the most an anonymous caller may send; or gate the trigger with a policy` |
| C0nn | `check/contracts.ts`, `checkShape` and `checkPort` | `maxItems` is written on a field of a shape or a contract whose type is not a list | `maxItems bounds a list; this field is <type>` |
| S0nn | `check/triggers.ts`, `checkScenario`, beside S001 | a scenario's `cancelAt` is not a key of its own `stubs` | `cancelAt names a stubbed effect: one of the keys under stubs` |
| X0nn | `packages/plugin-http/src/rules.ts`, beside `judgeThrottle` | `deadlineMs` or `maxBodyBytes` on an http trigger, in the plugin's settings, or `maxBodyBytes` on an http connection, is not a whole number of 1 or more | `set it to 1 or more, or drop it for no limit` |

T001 already refuses a `deadlineMs` that is not a number (the kind's settings type it); X0nn judges the range, as
X003 does a throttle's. `limit` and `concurrency` need no rule beyond the schema's `minimum: 1`: a ceiling is always
safe to declare, and a map inside an atomic graph (RFC 0004) is serial at the store whatever `concurrency` says,
which `describe` may note but the checker need not refuse.

**The rule the stub proposed, and why it moved.** The stub had the checker refuse "a `map` over an unbounded edge
list on a public trigger". The code says that rule is the wrong shape. A map's `over` is typed
(`elementInputs` in `check/graph-nodes.ts`, for G012 and G004) but not *traced*: whether the list it reads came from
the request, from a store, or from a parsed file is a dataflow question through domain operations and their
bindings, and the shapes along the way are related by assignability (T002), not identity -- the `maxItems` an author
writes on the edge shape is not on the core shape the map's graph reads. And the danger is not the map: a public
route that takes ten million ids is a problem for `conforms` before any graph runs. So the rule is on the trigger,
where the edge shape is declared, and it is local: one document, one type walk, no profile. What a graph does with
a bounded list is then the graph's business, and `limit` is how it says so for lists that came from anywhere else.

### Runtime behaviour

**The engine today, precisely.** `Run.execute` loops: start every node `isReady` answers true for, and when none is,
wait for any running node to settle (`wake`), until nothing is running; then `report()`. `isReady` requires
`!this.failed`, `pending`, `dependenciesSettled`, `routedTo` and `rootsSupplied`. `fail` marks the node `failed`,
sets `this.failed`, and turns every `pending` node `cancelled`. `cancel` is the switch's: a pending node and,
transitively, its dependents. `opts.signal` is read in exactly one place, `contextFor`, which copies it onto
`RunContext.signal`. `report()` answers `failed`, or `done` with the first settled output candidate, or `blocked`.
`Report.status` is `'done' | 'failed' | 'blocked'`; `NodeStatus` already has `cancelled`.

**The engine after.** `Report.status` in `packages/engine/src/spec.ts` gains `'cancelled'`. `Run` replaces its
`failed` boolean with one word, `ending: 'failed' | 'cancelled' | undefined`, set once and never changed
(`??=`): the first ending wins. Four small changes to `run.ts`:

- `execute` subscribes to `opts.signal` once (`abort` → `this.wake?.()`, removed when the run ends), and every
  iteration begins with `if (this.opts.signal?.aborted) this.cancelRun()`. A signal that was already aborted when
  the run began cancels everything in the first iteration and calls no handler.
- `cancelRun`: `this.ending ??= 'cancelled'`; every `pending` node becomes `cancelled`; every `pending` element of a
  running map (its `items`) becomes `cancelled`. Nothing else is touched.
- `isReady` requires `!this.ending`. `fail` sets `this.ending ??= 'failed'` and keeps cancelling pending nodes as it
  does.
- `report()`: `if (this.ending) return { ...base, status: this.ending }`. A cancelled run has no `output`, even
  when an output candidate settled before the signal fired: the run did not finish, and a partial answer that
  looks whole is the one thing the report must never say. `blocked` is judged only for a run that ended neither way.

**What happens to the nodes.** The engine records what happened and interprets nothing:

| A node that, when the signal fired, was | ends as |
|---|---|
| `pending` | `cancelled` -- it never started, no handler was called, no `startedAt` |
| `running`, and its handler answers | `done`, with its `out`: it ran, and its effect happened |
| `running`, and its handler rejects (an aborted `fetch`, a nested run that was cancelled) | `failed`, with the handler's message as `error`: what the reader needs is *which* node was in flight, and this says it |
| `done`, `failed`, `seeded`, or `cancelled` by a switch | unchanged |

The run waits for the in-flight nodes to settle before it reports, as it always has -- `Kernel.run` resolves at
quiescence, and RFC 0004's `settle` relies on no handler being in flight when it rolls back. A handler is told
through `ctx.signal`; what it does with that is its own. Nothing in this table is new to the engine: `cancelled`,
`failed` and `done` mean what they meant; the one new fact is the run's status.

**The ending is the first one.** A node that fails at 09:00:00.100 and a deadline that strikes at 09:00:00.200 make
a `failed` run whose pending nodes were cancelled by the failure. A deadline at .100 and a node rejecting at .200
make a `cancelled` run with one `failed` node. A refusal (`Refusal`) that arrives after the signal fired lands on
its node with its `reason`, and the run stays `cancelled`: `refusalOf` in `packages/engine/src/kernel.ts` answers
nothing for a run that is not `failed`, so no trigger kind answers a late refusal as the outcome. The caller has
been waiting past the deadline, and the deadline is what it is told.

**Nested runs.** `Compiler.nestedRunner` in `packages/compiler/src/compiler.ts` passes `ctx.signal` into
`Kernel.run`, so a nested `Run` observes the same signal and cancels itself the same way; its report is attached
through `ctx.attach` as today, and the calling node fails, because the nested run did not answer. `nestedFailure`
gains one line so the calling node's error says `<graph>: cancelled` instead of falling through to `failed`. A
binding operation, which lowers to a wrapper spec of one node `op` (`lowerBindingOp`), reports the same way, which
is what the summary in the guide shows.

**The map's ceiling and pace** (`packages/engine/src/run.ts`, `runMap`). Two fields on `KMap` in `spec.ts`,
`limit?: number` and `concurrency?: number`, lowered from the document by `lowerNode`. `runMap` checks `limit`
after reading `over` and before any element report exists: a longer list throws `map '<id>': <n> elements, limit
<limit>`, which `start` catches as the node's fault. Then, in place of `Promise.all(over.map(...))`, at most
`concurrency` workers pull indices from one cursor in order and each awaits `runElement` for the index it took;
absent `concurrency`, there are as many workers as elements and every element starts at once, exactly as today.
Three rules follow from what the engine already holds:

- a seeded element (`initial['<id>.<index>']`) answers at once in `runElement` and holds a slot for no longer;
- once an element has failed and `onItemFailure` is `fail`, a worker starts no further element and marks the ones
  it would have started `cancelled`: the node's answer is decided, and "a node broke: nothing still pending starts"
  is the rule `fail` already applies to the run. Under `collect`, every element runs, since each outcome is the
  answer. Without `concurrency` there is nothing unstarted, so this changes no run that exists today;
- once the run is `ending`, a worker starts nothing (`cancelRun` has already marked the elements).

This is the one place in this RFC where the scheduler learns to hold something back, and the argument for putting
it here rather than anywhere else is the argument of the report. The alternative was the compiler's handler
wrapper (RFC 0011's `attempting`, which sits around every handler): a semaphore per site could admit `concurrency`
calls at a time and queue the rest, the way the connection's `Throttle.run` already queues requests. It works on
the upstream and lies in the report: the engine would have started every element -- `running`, `startedAt` stamped
-- and the queueing would be inside the handler's duration, invisible; a cancelled run would show the queued
elements `failed` with an abort error rather than `cancelled`, though none of them did anything. Only the engine
knows an element has not started, because only the engine starts it. The change is twelve lines in the module that
already decides when a handler is invoked, adds no clock and no timer, and touches no rule about nodes: `execute`
still fires every ready node at once. `run.ts` stands at 298 lines; the implementing pull request moves the map --
`runMap`, `runElement`, `elementInputs`, `collectMap`, `MapSite`, `ElementResult` -- into `packages/engine/src/map.ts`
(new), a split along a step the file already names. RFC 0011's step 2 moves the report assembly out for the same
reason; whichever lands first makes its split, and the other lands on it.

**The kernel is still clockless.** It never waits on time and never decides to run again. It now waits on a signal
in the one sense that an abort wakes its loop, and the signal's reason -- a deadline, a shutdown, a test -- is not
its business.

**The embedder** (`packages/runtime/src/embed.ts`). `Embedder.fire` already hands `opts.signal` to `runGraph` for
the run and, through `gate` and `decide`, to every policy's decision, so a deadline covers the gate as well as the
operation. What changes is upstream of it: `FireArgs` in `packages/core/src/plugin.ts` gains `signal?: AbortSignal`,
and `Served.serving().fire` in `packages/runtime/src/serve.ts` passes `{ blobs, signal }`. The guard's `identify`
and `challenge` are not given the signal (`GuardArgs` is unchanged; they read the guard's own store). `settle` is
handed a cancelled report as it is handed a failed one; `@auth`'s spends a challenge only on `done`
(`packages/plugin-auth/src/guard.ts`), so a cancelled run leaves it unspent, as a failed run does. The out-type
judgement in `fire` runs only on `done`. `startup` and `runStartup` are given no signal and change nothing: a
startup step that a plugin's teardown interrupts is not this RFC's; `failureOf` already prints `did not finish
(<status>)` for a status it does not name.

**The http kind** (`packages/plugin-http/src/serve.ts`, `answer.ts`, `request.ts`, and `limit.ts`, new).

- *The deadline.* `answerFor` resolves `route.settings.deadlineMs ?? settings.deadlineMs` -- the plugin's settings
  reach it the way they reach `listen`, through `env.plugins[ROOT]`, carried on the `Writer` -- and when there is
  one, makes an `AbortController`, arms `setTimeout(() => control.abort(), deadlineMs)` at the moment it calls
  `serving.fire`, passes `signal: control.signal`, and clears the timer when the report arrives. The clock starts
  at the fire, after `requestOf` has read the body and `inputFor` has judged the input: the body's arrival is
  bounded by its size (below) and by Node's own `server.requestTimeout`, and a deadline that counted a slow upload
  against the graph would answer 504 for what is a 408. The kind waits for the report -- it does not race the
  timer and answer early -- so the answer, the log line and the blob scope's release stay one path, and the 504
  is sent when the last in-flight handler has settled. That is a cost, named under *Drawbacks*: a handler that
  ignores its signal delays the answer by as long as it takes. Until RFC 0011's step 6 lands (the `request`
  handler composes `ctx.signal` with the connection's timer), a deadline that strikes during a request waits for
  the connection's `timeoutMs`, 30 s by default.
- *The answer.* `encode` in `answer.ts` gains one branch before `encodeTrouble`: a report whose status is
  `cancelled` is `{ status: 504, body: { error: 'cancelled: the deadline passed' } }`. Without it today's `encode`
  would answer a cancelled report as it answers a done one -- 200 with an undefined body -- since it treats
  everything not `failed` or `blocked` as answered; the status and the branch land in one step. A cancelled run is
  never read as a refusal (`refusalOf` answers nothing for it), so `response.refusals` needs no entry and T005 is
  not involved: 504 is the kind's own answer, fixed the way 400, 404, 415 and 500 are. The log line
  (`→ 504 (2004ms, ... cancelled)`) already prints the report's status.
- *The body's size.* `readBody` in `serve.ts` resolves `route.settings.maxBodyBytes ?? settings.maxBodyBytes` and,
  when there is one, pipes the request stream through a counting `Transform` (`limit.ts`) that destroys the
  stream with a `TooLarge` error once the count passes the ceiling, then hands *that* stream to the codec. Every
  codec is bounded alike -- JSON is not parsed, a CSV is not stored past the line -- and a `TooLarge` rejection is
  answered `413 { error: 'body exceeds <n> bytes' }` where every other decode error stays a 400. What the blob
  codec put through the request's scope before the cut is released with the scope in `listen`'s `finally`, as
  every blob of a request is.
- *An answer's size.* `readBody` in `request.ts` wraps the upstream's body stream with the same limiter when the
  connection declares `maxBodyBytes`; past it, the node fails as a fault, `answer body exceeds <n> bytes`.
- *X0nn* in `rules.ts`, a sibling of `judgeThrottle`, over the plugin's settings, every http trigger's, and every
  http connection's.

**The compiler's wrapper (RFC 0011).** `attempting` in `packages/compiler/src/attempts.ts` (0011, new) composes the
site's timer with `ctx.signal` through `AbortSignal.any` and, as written, retries any non-`Refusal` rejection --
including one caused by the run's abort. One line lands here on that wrapper: a try that ends after `ctx.signal`
has aborted is not tried again and no backoff is waited; the rejection passes up. A cancelled node's `attempts`
are then what was genuinely tried before the deadline, and nothing runs after it.

**Atomic graphs (RFC 0004).** `settle(report.status === 'done')` rolls back on `cancelled` because `cancelled` is
not `done`; no line of RFC 0004 changes. Its sentence "an `AbortSignal` that fires mid-run fails the run" is now
precise: the run does not fail, it is cancelled, and both roll back. `settle` still runs at quiescence, since the
engine waits for in-flight nodes; a statement in flight when `ROLLBACK` is issued is the driver's ordering, as
RFC 0011 said of a timeout inside a transaction.

**`rehearse`, `fuzz`, `regress`, `run --seed`.** `stubEffects` in `packages/runtime/src/stubbing.ts` replaces
every effectful native handler with a generator that never hangs, and none of these hand a signal, so no rehearsed
or fuzzed run is ever cancelled and `fuzz` never writes a `cancelled` scenario. `regress` gains the one thing that
makes a cancellation replayable: a scenario with `cancelAt`. `regress` builds that scenario's embedder with
`stubEffects` given `{ cancelAt: { path, abort } }` (an options object, since the function already takes three
parameters), fires with the recorded `stubs` *minus* that key, and the stub at that path -- now reached, since
`Run.invoke` answers a stubbed path from `stubs` before any handler and this one is no longer there -- calls
`abort()` and rejects with `cancelled at <path>`, the way an aborted `fetch` rejects. The engine does the rest:
the node is `failed` with that error, every pending node `cancelled`, the run `cancelled`; `pick` in `fuzz.ts`
records each node's status and `diffOf` compares them, so `expect.status: "cancelled"` and the per-node statuses
are what `regress` holds the tree to. Two things are worth saying about *why* this is the shape. A scenario's
`stubs` make a node `done` without running its handler; `initial['<id>']` (`RunOptions`) makes it `seeded` and
never executed at all; `cancelled` is a third thing, a node that was never started because the run ended, and no
pre-supplied value can express it -- only the signal can, so the scenario names where the signal fires. And it
names a *node*, not a time: durations never enter a scenario (RFC 0006), and a deadline replayed as milliseconds
would pass or fail with the machine. The reasoning of S0nn is that the path must be one the recording saw.

**Traces (RFC 0006).** `traceOf` already emits a `cancelled` node as a zero-length span; the root span takes its
status from `report.status`, so a cancelled run's root reads `cancelled` with no change to the table. A node that
was in flight reads `failed` with its error at level `full`, which is the fact.

### Discoverability

- `wilanis describe <trigger>` (`triggerLines` in `packages/runtime/src/discovery.ts`) prints `deadline 2000ms`,
  `deadline 30000ms (from @http settings)`, or `deadline none`, and `body at most 1048576 bytes` the same way.
- `wilanis describe <graph>` (`nodeLines`) appends `at most 100 elements` and `8 at once` to a map's line.
- `wilanis describe <shape>` (`fieldLine`) prints `string[] (at most 100)` for a bounded list field.
- `wilanis describe @http/http.trigger-kind.json` (`kindLines`) lists the two settings with their descriptions, as
  it lists every setting.
- `wilanis map` is unchanged: a limit is not a document.
- The viewer (`packages/view/client/index.html`, `renderDocPage`) shows `limit` and `concurrency` as a badge on a
  map node, `maxItems` beside a list field on a shape page, and the deadline in a trigger's settings; the node
  entries `viewOf` builds in `packages/view/src/model.ts` carry the two numbers.

### Plugin contract

`PluginModule` in `packages/core/src/plugin.ts` does not change, and neither does `Handler`: `ctx.signal` has been
on `HandlerArgs` since the engine was written, and a handler that wants to stop reads it. `FireArgs` gains
`signal?: AbortSignal`, which `Serving.fire` and the `fire` a `TriggerRuntime.start` is handed therefore accept. A
kind that wants a deadline holds the timer and hands the signal; a kind that wants none hands nothing. Where a
kind reads its deadline from is its own vocabulary, in its own document, so a reader of `wilanis describe <kind>`
sees it. Nothing is registered and no hook is added.

## Compatibility

IR v1, compatible. `node/map.schema.json` gains two optional integers; `common.schema.json`'s field gains one;
`scenario.schema.json` gains an optional string and one value in an enum; three documents under
`packages/plugin-http/docs/` gain optional settings. Every document written before this RFC validates and means
what it meant: no deadline, no ceiling, every element at once, any length. `Report.status` gains a value, which a
consumer that types it exhaustively (`fuzz`'s `expect.status`) is updated for in the same step; `KMap` gains two
optional fields the compiler alone writes; `FireArgs` gains an optional field. A report of a run that was not
cancelled is byte-for-byte what it was. No `schemas-v2`.

## Tests

Engine, in `packages/engine/test/kernel.test.ts` and `map.test.ts`, with the handlers in `handlers.ts`:

| What | Asserts |
|---|---|
| a signal aborted before the run starts | every node `cancelled`, status `cancelled`, no handler called |
| a signal aborted mid-run | the in-flight node finishes `done`; nodes not yet started are `cancelled`; status `cancelled`; `output` absent though the candidate settled |
| a node that fails before the abort | status `failed`; the abort changes nothing |
| a node that rejects after the abort | the node `failed` with its message; status `cancelled` |
| a refusal after the abort | the node carries its `reason`; status `cancelled`; `refusalOf` answers nothing |
| `concurrency: 2` over five elements | never more than two handlers in flight (a counter in the handler); elements start in index order; every element `done` |
| a seeded element under `concurrency` | takes no slot longer than a tick; the others run two at a time |
| an element fails under `fail` with `concurrency: 1` | later elements `cancelled`, the node `failed`; under `collect` every element ran |
| `limit: 3` over four elements | the node `failed` with `map 'm': 4 elements, limit 3`; no element report, no handler called |
| a cancelled run with a map in flight | its started elements settle as they settle; its unstarted ones `cancelled` |
| a spec without `limit` or `concurrency` | runs as before: the report equals the pre-RFC report |

Sabotage tests through `sabotage` in `packages/runtime/test/example-harness.ts` (copy the example, edit one
document, answer the codes), in `example.test.ts` and `sabotage.test.ts`:

| Code | The edit |
|---|---|
| T0nn | delete `policies` from `delete-entries.trigger.json` while `DeleteRequest.shape.json` has no `maxItems`; the refusal is at `in` and names `ids`. With `maxItems: 100` restored, or the policies back: `codes(...)` has none |
| C0nn | `"maxItems": 5` on `method` in `ListRequest.shape.json`; on `id` in `@monitor/domain/monitor.port.json#get`'s `accepts` |
| S0nn | a scenario under `scenarios/` whose `cancelAt` is `nope` |
| X0nn | `"deadlineMs": 0` on `get-entry.trigger.json`; `"maxBodyBytes": -1` in `@http`'s settings in `project.json`; `"maxBodyBytes": 1.5` on `monitor-api.connection.json` |
| none | the guide's `deadlineMs`, `maxBodyBytes`, `maxItems`, `limit` and `concurrency` on the example |

Http, in `packages/plugin-http/test/http.test.ts` against `fakeUpstream` in `harness.ts` (which can hold a request
open through `InFlight`):

| What | Asserts |
|---|---|
| a deadline strikes | `GET /monitor/{id}` with `deadlineMs: 50` against an upstream that holds the socket answers 504 with `{ error }` in well under the connection's `timeoutMs`; the log line says `cancelled` (with RFC 0011's step 6; before it, the test is marked pending) |
| the plugin's default applies | no `deadlineMs` on the route, `50` in the plugin's settings: the same 504 |
| a body too large | a JSON body past `maxBodyBytes` answers 413 and the handler is never called; a CSV upload past it answers 413 and the registry holds no blob after the scope is released |
| an answer too large | a connection with `maxBodyBytes: 100` and an upstream answering 1 KB: the node fails with `answer body exceeds 100 bytes`, answered 500 |
| a list too long | `DELETE /monitor` with 101 ids against `maxItems: 100` answers 400 with `$.ids: at most 100 items`; nothing fires |
| a cancelled run is not a refusal | a cancelled run with a `refuse` node in flight answers 504, not the mapped status |

Core, in `packages/core/test/validate.test.ts` and `types.test.ts`: the baseline shape gains a bounded list field,
the baseline map `limit` and `concurrency`, the baseline scenario `cancelAt`; `maxItems: 0`, `limit: 0` and
`concurrency: 0` are refused by the schema; `conforms` refuses a list past `max` and accepts one at it;
`generate` never exceeds it; `assignable` ignores it.

Runtime, in `packages/runtime/test/tools.test.ts`: a hand-written scenario with `cancelAt: "op.asked"` for
`get-entry.trigger.json` replays `same` under `regress`, with `expect.status: "cancelled"`, `op.asked` `failed`
and the rest of `get-row.graph.json` `cancelled`; `describe` of the trigger prints `deadline 2000ms`, of the graph
`8 at once`, of the shape `at most 100`. In `packages/runtime/test/attempts.test.ts` (0011, new), once it exists: a
retried node whose run is cancelled during its first try records no second try.

Blocked on RFC 0004's `AtomicScope`: an atomic data graph whose run is cancelled after its first write leaves the
memory engine's store as it was.

## Implementation plan

1. **Engine, cancellation** (`area:engine`): `'cancelled'` on `Report.status`; `ending` in place of `failed`;
   `execute` observes `opts.signal`; `cancelRun`; `report()`; the map moved into `map.ts`; the kernel tests above.
   Lands on RFC 0011's step 2 (the report assembly moved out) or makes that split itself.
2. **Engine, the map** (`area:engine`): `limit` and `concurrency` on `KMap`; the cursor and workers in `runMap`;
   the map tests.
3. **Core, schemas and model** (`area:core`, `good first issue`): `limit`/`concurrency` on `node/map.schema.json`
   and `MapNode`; `maxItems` on `$defs/field` and `Field`; `max` on the list type, `TypeResolver.field`,
   `conformsList`, `generate`; `cancelled` and `cancelAt` on `scenario.schema.json` and `ScenarioDoc`; the
   template's rows; the baselines.
4. **Core and runtime, the seam** (`area:core`, `area:runtime`, `area:compiler`, `good first issue`):
   `FireArgs.signal`; `Served.serving().fire` passes it; `nestedFailure` says `cancelled`.
5. **Compiler** (`area:compiler`): `lowerNode` lowers the two numbers; C0nn in `contracts.ts`; T0nn and S0nn in
   `triggers.ts`; the sabotage tests.
6. **Http** (`area:plugin-http`): the settings in the three documents; `limit.ts`; the timer and signal in
   `answerFor`; the 504 in `encode`; the 413 in `readBody`; the answer bound in `request.ts`; X0nn; the tests.
7. **Regress** (`area:runtime`): `cancelAt` through `stubEffects`'s options; the scenario test.
8. **Discoverability** (`area:runtime`, `area:view`, `good first issue`): `triggerLines`, `nodeLines`,
   `fieldLine`; the view model and the viewer's badges.
9. **The example**: `deadlineMs` and `maxBodyBytes` in `@http`'s settings, `deadlineMs: 2000` on
   `get-entry.trigger.json`, `maxItems: 100` on `DeleteRequest.shape.json`, `limit` and `concurrency` on `removed`;
   a paragraph in `example/README.md` and one in the root `README.md` on what happens when something hangs.
10. **Blob** (`area:plugin-blob`, `good first issue`): `parse` in `packages/plugin-blob/src/csv.ts` stops between
    rows when `ctx.signal?.aborted`, so a cancelled import does not read the whole file first.
11. **The wrapper** (`area:compiler`): blocked on RFC 0011's step 3 -- `attempting` does not retry a try that ended
    after the run's signal aborted; the `attempts.test.ts` row.
12. **Rollback on cancellation** (`area:runtime`): blocked on RFC 0004's step 4 -- the memory-engine test.

## Drawbacks and alternatives

**Cancellation undoes nothing.** A cancelled run's effects that ran, ran: eight of twenty entries are gone, a mail
was sent, a row was written. Inside one connection an atomic graph rolls them back (RFC 0004); across connections
nothing does (RFC 0011 sent compensation on to RFC 0021). A cancelled run is therefore not a clean run; it is a
run that stopped, with a report honest about where. The route answers 504 and the operator reads the trace. An
author who needs "all or none" writes `atomic`, and the checker tells them when it cannot be had.

**The engine observes a signal.** The stub said the engine "only learns of it through the abort signal it already
accepts", and that is what this is: no clock, no timer, no knowledge of why. The alternative that keeps the engine
untouched -- the compiler's wrapper rejecting every handler call once the signal has aborted -- was rejected
because it lies: every node that becomes ready is still *started*, fails with a manufactured error, and the run
reports `failed`, a fault, when nothing broke. A `switch` has no handler and would still route. The report is the
product, and it has to say `cancelled` about a node that never ran.

**`concurrency` in the engine.** Argued under *Runtime behaviour*. The connection's `throttle` stays what it is --
the transport's gate, shared by every node that names the connection -- and does not make a map's ceiling
redundant: a map of nested graph runs is bounded by nothing else, and the throttle's queueing is inside the
handler's duration where a reader cannot see it. The compiler wrapper was the other candidate and fails on the
report's honesty.

**Waiting for the report at the deadline.** The kind could race the timer and answer 504 the instant it strikes,
letting the run settle in the background. It was not chosen: two log lines per cancelled request, a blob scope
released on a later tick, an observer (RFC 0006) told of the run after the answer, and a second code path in
`answerFor` for the case the first path already handles once handlers honour their signal. The cost is that a
handler which ignores `ctx.signal` delays the 504 by as long as it runs; a deadline is a request to stop, not a
kill, as a `context` is in Go or a `CancellationToken` in .NET. The http `request` honours it after RFC 0011's
step 6, a nested graph is stopped by the engine, and step 10 makes the CSV parser check. A plugin whose handler
never returns is a plugin bug, and no deadline in any runtime saves a process from one.

**Where the deadline layers.** The stub asked whether it is a trigger setting, a kind default, a project default,
or all three. Two of the three exist as places in this repository already, and they are the two used: a trigger's
`settings` (the kind's vocabulary, on the document a reader opens first) and the plugin's `settings` in
`project.json` (read the way `listen` reads `port`). The third, a kind default, would be a number in the kind's
document -- but `Field` has no `default`; the kind's defaults today (`produces` "application/json", `port` 8080) are
applied by code, and a deadline nobody wrote, applied silently, is the runtime deciding what a tree promises. A
route with neither has none, which is today's behaviour, and `describe` says `deadline none` so the omission is
visible. A project-wide setting across kinds (`project.json → settings.deadlineMs`) was rejected: `ProjectDoc` has
no such block, the cli kind wants no deadline, and a rule would then live in two vocabularies. The alternative shape
where the kind's document names a path into its settings, as `refusals` and RFC 0006's `correlation` do, and the
*embedder* holds the timer, was considered: it would give every kind a deadline for the price of one path, but the
embedder would then own a clock for a promise only the kind makes to its caller, and the kind alone knows what to
answer. The timer stays with the socket.

**`maxBodyBytes`, not `maxBody`.** The stub wrote `maxBody`; the house writes the unit in the name (`timeoutMs`,
`deadlineMs`, `maxAge`), and RFC 0011 said why.

**A `cancelled` status for a node that rejected after the abort.** Considered and rejected: the engine would have to
decide that a rejection *after* the signal was *because of* it, and a fault that happened to coincide would be
hidden. The node keeps what it did; the run says it was cancelled; the reader has both.

**`limit` as a refusal with a reason.** A list past `limit` is a fault of the map today because a map has no
`reason` to declare and the trigger has no word to map. RFC 0014 owns the kinds of failure and may give this one a
name; until then it is a 500 that says exactly what happened.

**A cancellation on client disconnect.** Three lines in `listen` (`response.once('close', ...)`). Not taken here,
for the reason under *Motivation*: a caller who gives up on a write has not asked for it to be abandoned halfway.
It is the same seam and a later RFC may take it with the argument written out.

**Cost.** One `aborted` check per scheduler iteration and one listener per run; a map without `concurrency`
allocates as many workers as elements, which is the promise array it allocated before. The counting `Transform`
costs a byte count per chunk on bounded bodies only. `describe` and the viewer read four more fields.

## Open questions

Settled here, with the reasoning in the text:

1. **Where the deadline layers** -- the trigger's settings, then the plugin's settings in `project.json`, then
   none; no kind default and no project-wide block (*Drawbacks*, fifth item; *Ports, operations and kinds
   granted*).
2. **How a cancelled run appears in a scenario** -- `expect.status: "cancelled"` with the per-node statuses `fuzz`
   already records, and `cancelAt` naming the stubbed effect at which `regress` aborts the signal; a node, never a
   duration, because a stubbed node is `done`, a seeded node is `seeded`, and only the signal can make one
   `cancelled` (*Runtime behaviour*, `rehearse`, `fuzz`, `regress`).
3. **A ceiling on the size of a value crossing a node** -- no. A blob's bytes never enter the engine
   (`BlobStore`, the codecs); every other value that enters a graph came through a codec this RFC bounds
   (`maxBodyBytes` on the route and on the connection) or is bounded by its type (`maxItems`); a per-node ceiling
   would serialise every value at every node to measure it, for a bound already enforced at the border, and would
   be the engine judging a value, which nothing else in it does. Should a plugin produce a large value without a
   body -- a storage `list` with no page size -- that is RFC 0002's `limit` on the operation, not the engine's.
4. **What an abort does to a run** (handed here by RFC 0011) -- today nothing, in the engine; after this, the run
   is `cancelled`: nothing more starts, pending nodes are `cancelled`, in-flight nodes settle as they settle and
   are recorded as they did, the first ending wins, and the report carries no output (*Runtime behaviour*, the
   first four headings).

Decided during implementation:

1. The exact text of the 504 body and of the `TooLarge` message.
2. Whether `show` prints a list's bound (`string[≤100]`), or only `describe` does.
3. Whether `describe <trigger>` names the layer the deadline came from (`(from @http settings)`), as written above,
   or prints the number alone.
4. Whether a map inside an atomic graph that declares `concurrency` earns a note from `describe` that the store
   serialises it anyway.
