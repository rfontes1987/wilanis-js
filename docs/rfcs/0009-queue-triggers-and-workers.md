# RFC 0009: Queue messages as triggers, and workers

- **Status:** accepted
- **Areas:** `area:core` (two optional fields on two kind schemas), `area:compiler` (two T rules), `area:runtime` (the example, `describe`, `map`), `area:view`, a new plugin `@wilanis/plugin-queue` with a development broker `@wilanis/plugin-queue-memory`, and `area:plugin-storage` for the table broker
- **Tracking issue:** #11
- **Depends on:** RFC 0011 (the word `idempotent` on an operation, which T0n1 reads: this RFC accepts after it, and its step 1 lands before step 2 here); RFC 0002 (the default broker is a table in the storage engine's connection, and the `storage` marker on a connection kind is the precedent for the `delivery` marker; the broker step is blocked on its implementation); RFC 0004 (a `publish` that joins the transaction of an atomic graph; that step is blocked on its implementation). RFC 0006's `correlation` and RFC 0007's access invariants need nothing here and apply to a queue trigger as they apply to a route. RFC 0013 is what a worker *process* waits on (below).

## Summary

A message arriving on a queue fires a trigger the way an HTTP request or a command line does today, and a data
graph publishes a message through a port operation. A worker is nothing new: it is `wilanis start` on a tree
whose startup names a `holds` operation that consumes the tree's queues. Which broker a queue lives on is a
connection, and how many times that broker may deliver one message is a fact its connection kind declares;
where it may deliver twice, the checker holds the fired operation to the `idempotent` promise RFC 0011 gives
it. A message is gated like a request: the credential rides in its headers and the guard verifies it before
any graph runs. What a refusal means to a message -- acknowledge it, redeliver it, park it -- is a table on
the trigger, judged by T005 and T006 the way a route's status table is. The engine learns nothing.

## Motivation

A tree today answers only what arrives on a socket (`@http/server.port.json#listen`) or a command line
(`wilanis run`). Work that must outlive a request -- sending a receipt, recomputing a digest, removing a batch
of rows without holding the caller's socket while every DELETE settles -- has nowhere to go. An author would
have to leave the tree and write a consumer in TypeScript, which is exactly the code the platform exists to
remove, and the consumer would be invisible to `wilanis check`, `rehearse`, `map` and the viewer.

The example shows the small form of it. `DELETE /monitor` (`example/features/monitor/edge/delete-entries.trigger.json`)
fires `monitor.port.json#removeMany`, whose domain graph `remove-entries.graph.json` fans one removal out per id
and answers when the last has settled, paced by the connection's `throttle` of four. A hundred ids is a
hundred DELETEs against the upstream while the caller waits, and one that refuses `missing` refuses the whole
batch after the others are already gone. The natural shape is one message per id, acknowledged when the row
is deleted, acknowledged too when it was already gone, and retried when the upstream broke -- and nothing in
the tree can say that.

What this RFC does not do. It does not schedule (RFC 0010: a tick is not a message, and a scheduler across
instances is its lease question). It does not give a run a deadline or cancel one (RFC 0012); a message's run
is bounded the way any run is. It does not decide what a fault means to a `switch` (RFC 0014). It does not
scope queues per tenant (RFC 0015), and it does not judge whether a token in a message is safe to carry
(RFC 0020 names the question; this RFC names the mechanism). It does not order messages, partition a queue,
or promise exactly-once delivery: it makes at-least-once safe by construction and says why the alternative
was not taken (*Drawbacks*). It does not ship a RabbitMQ or SQS broker: it says what one is, so that either is
a package and not a change here. And it does not add a `job` document kind: a trigger fires a port, and a
message is a trigger's business (the stub's alternative, still rejected).

## Guide-level explanation

**A message** is a value of an edge shape, with headers, on a named **queue** of a **broker**. A broker is a
connection, of a kind a plugin grants: in development the in-process broker of `@wilanis/plugin-queue-memory`,
in production a table in the same database the tree's stores use (the storage engine's connection kind of
RFC 0002 grants the broker too, so a tree with a store needs no second service to have a queue). Swapping
brokers is swapping the connection's `kind`, as swapping storage engines is.

**A queue trigger** is a trigger of kind `@queue/queue.trigger-kind.json`. Its settings say which connection
and which queue, the edge type of the message, and what each refusal reason the run can reach means to the
message: `ack` (the work is done, or is not worth doing: drop it), `retry` (deliver it again, later), `dead`
(park it where an operator can find it). Its context hands `request.message` (typed), `request.headers`,
`request.id`, `request.attempt` and `request.queue`; its `fire` runs a domain port operation with inputs read
from that context, exactly as a route's does. Its `out`, where the operation answers something, is judged and
recorded, and goes nowhere: nobody is waiting.

**Publishing** is an effect: `@queue/queue.port.json#publish`, run from a data graph, listed under
`feature.json → effects` like any effect, stubbed by `rehearse` like any effect.

**A worker** is `wilanis start` on a tree whose `project.json → startup` names `@queue/worker.port.json#consume`.
Delete the step and no queue is consumed, as deleting `listen` closes the port.

The example, made asynchronous for removals. A connection for the broker, at the tree's root:

```json
{
  "$schema": "https://raw.githubusercontent.com/wilanis/wilanis-js/main/packages/core/schemas/connection.schema.json",
  "label": "Jobs",
  "description": "The broker the monitor's queued work goes through. In development the in-process broker; production names the storage engine's kind instead, so the queue is a table beside the entries and nothing else runs.",
  "kind": "@queue-memory/memory.connection-kind.json",
  "settings": {}
}
```

The trigger that consumes, `example/features/monitor/edge/remove-queued.trigger.json`. It fires the same
`monitor.port.json#remove` that `DELETE /monitor/{id}` fires, reads the id from the message instead of the
route, and attaches the same two policies -- with the token read from the message's headers instead of the
request's:

```json
{
  "$schema": "https://raw.githubusercontent.com/wilanis/wilanis-js/main/packages/core/schemas/trigger.schema.json",
  "label": "removals queue",
  "description": "One message per entry to remove. missing is acknowledged (the entry is already gone: the work is done); upstream is retried up to five times, a second apart and then doubling, and then dead-lettered. Employees holding the recorder role only, as for DELETE /monitor/{id}: the token rides in the message's headers, and a message whose token does not verify is dead, since redelivering it cannot help.",
  "kind": "@queue/queue.trigger-kind.json",
  "settings": {
    "connection": "@connections/jobs.connection.json",
    "queue": "removals",
    "message": "@monitor/edge/IdRequest.shape.json",
    "maxAttempts": 5,
    "backoffMs": 1000,
    "outcomes": {
      "missing": "ack",
      "upstream": "retry",
      "anonymous": "dead",
      "invalid_credential": "dead",
      "forbidden": "dead"
    }
  },
  "in": "@monitor/edge/IdRequest.shape.json",
  "out": "@monitor/edge/EntryView.shape.json",
  "policies": [
    {
      "policy": "@access/edge/employees-only.policy.json",
      "in": { "token": "{{request.headers.authorization}}" }
    },
    "@access/edge/can-record.policy.json"
  ],
  "fire": {
    "run": "@monitor/domain/monitor.port.json#remove",
    "in": { "id": "{{request.message.id}}" }
  }
}
```

The route that publishes, `POST /monitor/{id}/removal` (`enqueue-removal.trigger.json`), fires a new domain
operation `monitor.port.json#enqueueRemoval { id }` that answers nothing, and the route answers 202. Under
the `live` profile the binding meets it with one data graph, `example/features/monitor/data/publish-removal.graph.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/wilanis/wilanis-js/main/packages/core/schemas/graph.schema.json",
  "label": "Publish a removal",
  "description": "Data graph behind monitor.enqueueRemoval: one message on the removals queue, carrying the caller's token so the worker's gate judges the same caller.",
  "reads": { "token": "@monitor/edge/request.resolvers.json#token" },
  "in": "@monitor/domain/EntryRef.shape.json",
  "nodes": [
    {
      "type": "@wilanis/node/run.schema.json",
      "id": "published",
      "label": "Publish the id",
      "run": "@queue/queue.port.json#publish",
      "in": {
        "connection": "@connections/jobs.connection.json",
        "queue": "removals",
        "type": "@monitor/edge/IdRequest.shape.json",
        "message": { "id": "{{in.id}}" },
        "headers": { "authorization": "{{token}}" }
      }
    }
  ]
}
```

`{{token}}` is a resolver, bound under `reads` (RFC 0029) -- `request.resolvers.json` gains `token: { "read":
"request.headers.authorization" }` beside `agent` -- because the request is read in three places only, and a data graph is not one of them.
`feature.json → effects` gains `"@queue/queue.port.json#publish"`, and `project.json` names the two plugins
and one more step:

```json
"startup": [
  { "label": "Reach the entry store", "run": "@monitor/domain/monitor.port.json#listAll", "required": true },
  { "label": "Watch for changes", "run": "@reload/watch.port.json#watch" },
  { "label": "Work the queues", "run": "@queue/worker.port.json#consume" },
  { "label": "Listen", "run": "@http/server.port.json#listen" }
]
```

`wilanis start example` now logs `queue: consuming removals on @connections/jobs.connection.json → @monitor/domain/monitor.port.json#remove`
beside `http: listening on :8080`, and each message one line:
`queue removals 01J9… attempt 1 → ack (61ms, @monitor/domain/monitor.port.json#remove done)`.

**The refusal an author meets first.** The memory broker, like the table broker, delivers at least once: a
worker that dies between the DELETE and the acknowledgement sees the message again. So the operation a queue
trigger fires must be safe to repeat, and `monitor.port.json#remove` says so with RFC 0011's word,
`"idempotent": true` -- which holds, because under `live` the binding runs `delete-row.graph.json`, whose one
effect is a DELETE, one of the methods `@http/http.port.json#request` declares idempotent. Drop the word and
`wilanis check` answers:

```
T0n1  @features/monitor/edge/remove-queued.trigger.json#fire/run
    '@connections/jobs.connection.json' delivers a message at least once, so '@monitor/domain/monitor.port.json#remove'
    may run twice for one message, and the operation does not promise idempotent
    → declare "idempotent": true on the operation (the checker then holds every profile to it, B0n1), or receive
      from a connection whose kind delivers at most once
```

Point the trigger at `monitor.port.json#submit` instead -- a POST -- and the promise cannot be made: writing
`idempotent: true` on `submit` is refused by RFC 0011's B0n1 naming the profile and the node. The tree cannot
be made to consume a message it cannot safely consume twice, and that is the point.

## Reference

### Documents and schemas

No new document kind. Two existing kind schemas gain one optional field each, both compatible under RFC 0008
and both following the precedent RFC 0002 set with `storage` on a connection kind:

**`connection-kind.schema.json`** gains `delivery` (string, enum `at-least-once` | `at-most-once`, optional):
"How many times a connection of this kind may hand one message to a trigger that receives from it.
`at-least-once`: a message the process did not acknowledge is delivered again, so what it fires may run twice.
`at-most-once`: a message is handed once and never again, so what it fires may not run at all. Absent: a
connection of this kind delivers nothing (an HTTP upstream, a directory)." `ConnectionKindDoc` in
`packages/core/src/model.ts` gains `delivery?: 'at-least-once' | 'at-most-once'`. A broker plugin declares it
on the kind it grants; `@queue` grants no kind, as `@storage` grants none.

**`trigger-kind.schema.json`** gains `connection` (string, optional): "The dotted path, within a trigger's
settings, of the connection a trigger of this kind receives from. Declared: the checker reads the connection's
kind and judges what it delivers against what the trigger fires (T0n1, T0n2). Absent: triggers of this kind
receive from no connection (a route, a command line)." It sits beside `refusals` and RFC 0006's `correlation`,
and is read the same way (`tableAt` in `check/triggers.ts` reads `refusals`; a sibling reads this).
`TriggerKindDoc` gains `connection?: string`.

The `trigger` kind itself does not change: `settings`, `in`, `out`, `policies`, `fire` mean what they mean.
Placement is unchanged: a queue trigger is a trigger, `HOME` in `packages/core/src/placement.ts` puts it in
`edge/`, and D008 refuses it elsewhere. `packages/runtime/templates/CLAUDE.md`: the `trigger` row gains "a
queue trigger names its connection, queue and message type and maps each reason to `ack`, `retry` or
`dead`"; the `connection` row gains "a connection whose kind declares `delivery` is a broker: a queue trigger
receives from it and `publish` sends to it"; the *What the tree starts* paragraph gains the `consume` step
beside `listen`. `wilanis new trigger` (`SCAFFOLDS` in `packages/runtime/src/scaffolds.ts`) gains
`--kind @queue/queue.trigger-kind.json`, writing the settings above with `outcomes: {}`.

### Ports, operations and kinds granted

Two packages, and the division between them is RFC 0002's: `@queue` says what a queue *is* and what may be
asked of one; a broker says how one is kept.

**`@wilanis/plugin-queue`** (`packages/plugin-queue/`, root `@queue`), depending on `@wilanis/core` and
`@wilanis/engine` only. `docs/plugin.json` grants two ports and one trigger kind, no connection kind, no
codec, no shape. Its settings: none -- a setting here would be a setting for every broker at once.

`docs/queue.port.json`, what a data graph runs:

| Operation | Accepts | Returns | `pure` / `refuses` / `holds` / `transactional` |
|---|---|---|---|
| `publish` | `connection` (string, `static`: a connection document whose kind declares `delivery`), `queue` (string, `static`), `type` (type, `binds: $Message`: the message's edge type), `message` (`$Message`), `headers` (open object of strings, optional), `delayMs` (number, optional: not deliverable before) | `{ id: string }` | effect; `transactional: true` (RFC 0004; see *Runtime behaviour*) |
| `ensure` | `connection` (string, `static`) | `{ ready: boolean }` | effect: creates what the broker needs on that connection (a table) and never alters what exists; nothing to do for a broker that needs nothing |

`publish` binds `$Message` from a `type` field at the call site the way `@std/object.port.json#make` binds
`$T`, so the checker holds the published `message` to the shape it names; whether that shape is the one the
consuming trigger declares is X0n3.

`docs/worker.port.json`, what a startup step names:

| Operation | `holds` | Accepts | Returns |
|---|---|---|---|
| `consume` | true | `concurrency` (number, optional: messages in flight per queue at once; default 1), `queues` (string[], optional: the queues this process works; absent: every queue trigger's) | `{ queues: number, connections: number }` |

`consume` reads `env.serving` and `env.hold` exactly as `listen` in `packages/plugin-http/src/serve.ts` and
`watchTree` in `packages/plugin-reload/src/index.ts` do, and throws the same way when run from a graph, which
L008 has already refused. The split into two ports follows `@http`, whose `http.port.json` a data graph runs
and whose `server.port.json` a startup step names: `wilanis describe @queue/queue.port.json` then lists
nothing a graph can never run. The stub's sketch put both on one port; the precedent it cited does not.

`docs/queue.trigger-kind.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/wilanis/wilanis-js/main/packages/core/schemas/trigger-kind.schema.json",
  "label": "Queue message",
  "description": "A message on a queue. The body is decoded as JSON into request.message (typed by settings.message); the message's headers, its id, the queue and how many times it has been delivered are in the context too, and the guarding plugin adds the caller it identified from a credential the trigger reads out of the headers. The trigger's input mapping picks what the graph gets; its policies decide before the graph runs. The answer is judged against out and recorded; nobody receives it. A refusal is acknowledged, retried or dead-lettered as settings.outcomes maps its reason; every reason the trigger can reach must be mapped (T005). A fault becomes settings.onFault, retry by default. A retry past maxAttempts is dead.",
  "connection": "connection",
  "refusals": "outcomes",
  "correlation": "headers.traceparent",
  "settings": {
    "fields": {
      "connection": { "type": "string", "description": "a connection document whose kind declares delivery: the broker" },
      "queue": { "type": "string", "description": "the queue's name on that broker" },
      "message": { "type": "type", "binds": "$Message", "description": "the edge type of the message body, request.message" },
      "maxAttempts": { "type": "number", "required": false, "description": "deliveries before retry becomes dead; default 5" },
      "backoffMs": { "type": "number", "required": false, "description": "the wait before the second delivery, doubled before each further one; default 1000" },
      "onFault": { "type": "string", "enum": ["retry", "dead"], "required": false, "description": "what a fault -- a node that broke with no reason -- becomes; default retry" },
      "outcomes": { "type": { "fields": {}, "open": "string" }, "required": false, "description": "reason -> ack | retry | dead: what each refusal the run can reach means to the message" }
    }
  },
  "context": {
    "fields": {
      "id": { "type": "string", "description": "the broker's id for this message" },
      "attempt": { "type": "number", "description": "1 on the first delivery" },
      "queue": { "type": "string" },
      "headers": { "type": { "fields": {}, "open": "string" }, "description": "what the publisher put beside the body; where a credential rides" },
      "message": { "type": "$Message" }
    }
  }
}
```

`correlation` is RFC 0006's field and is written once that RFC's step 2 has landed; until then the line is
absent and the kind validates without it. The values of `outcomes` are strings to the schema because
`$defs/inlineObject.open` in `common.schema.json` takes a boolean or a type reference and cannot carry an
enum; the three words are the plugin's to judge (X0n1), as `@auth` judges a challenge method (X102).

**`@wilanis/plugin-queue-memory`** (`packages/plugin-queue-memory/`, root `@queue-memory`), depending on
core, engine and `@wilanis/plugin-queue` -- an implementation depends on the contract, the arrow RFC 0002
drew between an engine and `@storage`. `docs/plugin.json` grants `@queue-memory/memory.connection-kind.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/wilanis/wilanis-js/main/packages/core/schemas/connection-kind.schema.json",
  "label": "In-process queue",
  "description": "A broker that lives as long as the process: queues are arrays, a retry is re-enqueued after its backoff, and nothing survives a restart. For development, tests and libraries/. It delivers at least once on purpose, so a tree that checks against it checks against what production will do.",
  "delivery": "at-least-once",
  "settings": { "fields": {} }
}
```

It is its own package and not a second entry point of `@queue`, for the reason RFC 0002 gave: "every broker
is a plugin" is the design, and the first broker obeying it is what keeps the claim honest. It has no rules
(an empty `check` says something true).

**The table broker** is the storage engine's. `@wilanis/plugin-storage-postgres` (RFC 0002) declares
`"delivery": "at-least-once"` on `@storage-postgres/postgres.connection-kind.json` beside `"storage": true`,
and registers a broker from its `postLoad` as it registers an engine. A queue trigger then names the same
connection the tree's stores name, and `publish` from an atomic graph joins the transaction (below). This step
is blocked on RFC 0002's implementation and is marked so in the plan. `@wilanis/plugin-storage-memory` needs
no broker: a tree in development names `@queue-memory` for that.

### Checker rules

Codes are placeholders (`T0n1`, `X0n1`); the implementing pull request takes the next free code of each
family as the tree stands when it lands, and no number here should be read as reserved. `@queue` takes a
band of X codes of its own when it lands, as RFC 0002 gave `@storage` one; its brokers take theirs. Existing
codes named below (T001 to T006, B006 to B008, L002, L003, L006, L008, A004, A005, C002, R001, P001, D008)
were checked against the source; B0n1, G0n2 and C0n1 are RFC 0011's, L0n1 is RFC 0004's, I001 is RFC 0007's,
X203 and X221 are RFC 0002's.

**Generic to every kind**, in `check/triggers.ts`, a new method of `TriggerCheck` called from `run()` after
`checkContract` and only when the kind declares `connection`:

| Code | Where it lives | Refuses when | Hint |
|---|---|---|---|
| T0n2 | `check/triggers.ts`, `checkDelivery` | the setting the kind's `connection` names is not a literal path (P001 already refuses a read of a static field; this is the message for a trigger), names no connection document (R001 through `judge.scope.get('connection', …)`), or names one whose kind declares no `delivery` | `receive from a connection whose kind declares delivery; wilanis ls connection-kind` |
| T0n1 | `check/triggers.ts`, `checkDelivery` | the connection's kind declares `at-least-once` and the operation `fire.run` names does not declare `idempotent: true` (RFC 0011's `Operation.idempotent`) | `declare "idempotent": true on the operation (the checker then holds every profile to it, B0n1), or receive from a connection whose kind delivers at most once` |

T0n1 reads the *promise* and nothing else: whether the promise holds under each profile is B0n1's judgement,
made once in `check/project.ts` over the effects the binding reaches, and this RFC does not repeat that walk.
The two rules are T rules and not X rules because they relate three compiler words -- a kind, a connection's
kind and an operation's `idempotent` -- and know nothing about queues: a future kind that receives from any
connection declaring `delivery` is judged by them unchanged. The rule for `at-most-once` is that there is
none: a message that may be lost breaks nothing the checker can see; the trigger's `outcomes` cannot say
`retry` over it, which is X0n2.

**The plugin's own** (`packages/plugin-queue/src/rules.ts`, run through `PluginModule.check` with
`PluginCheckContext.scope`), each judging a word only this plugin knows:

| Code | Where it lives | Refuses when | Hint |
|---|---|---|---|
| X0n1 | `plugin-queue/src/rules.ts` | a value of a queue trigger's `settings.outcomes` is not `ack`, `retry` or `dead`; or `settings.onFault` is `retry` (or absent) while `maxAttempts` is not a whole number of 1 or more | `an outcome is ack, retry or dead` / `maxAttempts is a whole number, 1 or more` |
| X0n2 | same | an outcome is `retry`, or `onFault` is `retry` (or absent), on a trigger whose connection's kind declares `at-most-once`: nothing will redeliver | `a broker that delivers at most once cannot retry; map the reason to ack or dead, and set onFault` |
| X0n3 | same | a data graph node runs `@queue/queue.port.json#publish` with literal `connection` and `queue` that some queue trigger of the tree also names, and the type its `type` names is not assignable (`assignable` in `packages/core/src/assign.ts`) to that trigger's `settings.message` | `publish the shape the trigger consumes: <path>, or name another queue` |
| X0n4 | same | a queue trigger's `settings.message`, or the `type` of a `publish`, names a shape with a `blob` field, at any depth | `bytes live in the blob registry and a handle is process-local; publish the handle's id as a string and read the bytes where the message is consumed` |
| X0n5 | same | a `publish` node sits in a graph marked `atomic` (RFC 0004) whose `connection`'s kind is not marked `storage` (RFC 0002): a broker outside the store cannot join its transaction | `publish after the atomic graph, in its caller, reached by a data dependency on its answer` |

X0n3 says nothing where a published queue has no consumer in this tree: another tree may consume it, and a
rule there would forbid publishing to anything but oneself. `describe` shows the pairing (below). X0n5 sees
the graph that carries the node; an atomic domain graph that *reaches* a data graph publishing to a
non-storage broker is caught at run time by the handler (below), and the per-profile walk that would refuse
it statically is RFC 0004's L0n1 extended by one clause, which that RFC's implementation may take.

**What is not added, because it already holds.** T001 judges the settings against the kind's contract;
`checkTypeSetting` already requires `message` to be an edge shape (`checkLayer` with `layer: 'edge'`). T002
holds `in` to `remove`'s `accepts` and `out` to its `returns`, so a queue trigger firing an operation that
answers must declare `out`, and the answer is judged and dropped -- the schema cannot say "goes nowhere", and
the kind's description does. T003 types `fire.in` over the context: `request.message.id` is a string because
`$Message` is `IdRequest`. T005 and T006 apply through `refusals: "outcomes"` with no change to
`checkRefusalTable`: every reason `refusalsOfTrigger` finds -- the graph's `missing` and `upstream`, the
policies' `anonymous` and `forbidden`, the guard's `invalid_credential` since the attachment gives a
credential -- must be a key, and no other may be. A004 judges `{{request.headers.authorization}}` as a read
of what the kind hands and of the type the guard takes; A005 refuses `can-record` on a queue trigger that
gives no token, as it does on a route. L003 requires `publish` under `effects`; L002 keeps it out of domain
graphs; L008 keeps `consume` out of every graph; B006 admits `consume` in a startup step because it is a
native `holds` operation, and refuses `publish` there since it is not. I001 (RFC 0007) holds a queue trigger
that reaches an operation an access invariant covers to the policy the invariant names -- which is what the
example's `remove-queued.trigger.json` satisfies, and what a policy-less queue trigger reaching `#remove`
would be refused for once that RFC lands.

### Runtime behaviour

**Where the broker is found.** `@queue` speaks no broker's language. `packages/plugin-queue/src/brokers.ts`
(new) exports the contract and the table, as `@wilanis/plugin-storage` exports `Engine` and `engines(env)`
(RFC 0002):

```ts
/** One message as a broker hands it to the worker. */
export interface Delivery { id: string; attempt: number; headers: Record<string, string>; body: unknown }
export type Outcome = 'ack' | 'retry' | 'dead';
/** What a broker does for one connection of the kind it registered; the connection is the canonical path, and the broker reads env.connections[it] itself. */
export interface Broker {
  ensure(connection: string): Promise<void>;
  publish(connection: string, queue: string, message: { body: unknown; headers: Record<string, string>; delayMs?: number }, atomic?: Atomic): Promise<{ id: string }>;
  /** Hand every message of the queue to `handle`, at most `concurrency` at once, until the returned function is called; it resolves once nothing is in flight. */
  consume(connection: string, queue: string, handle: (delivery: Delivery) => Promise<{ outcome: Outcome; backoffMs?: number }>, opts: { concurrency: number }): Promise<() => Promise<void>>;
}
/** The brokers registered for this tree, by the connection kind each grants; created on first use by whichever side reaches it. */
export function brokers(env: Record<string, unknown>): { register(kind: string, broker: Broker): void; for(kind: string): Broker | undefined };
```

A broker plugin registers from its `postLoad` -- `brokers(ctx.env).register('@queue-memory/memory.connection-kind.json', memoryBroker())`
-- and the table is a `WeakMap` keyed by `env` with a default, so plugin order in `project.json` cannot bite
and a reload starts clean, for the reasons RFC 0002 gives at length. `Atomic` is RFC 0004's type in
`packages/core/src/plugin.ts`; until it lands the parameter is absent.

**`publish`** (`packages/plugin-queue/src/publish.ts`, new). The handler resolves the connection as
`connectionOf` in `packages/plugin-http/src/request.ts` does -- `env.canon`, `env.connections[canonical]` --
reads the kind's `delivery` off the connection's kind through the registry, finds the broker in
`brokers(env)` by that kind, and fails the node naming the missing package when none registered (X0n3 and
T0n2 have judged the tree; this message is for a plugin that did not load). The body is the `message` value
as it is; the broker encodes it (JSON, for both brokers here). When `ctx.env.atomic` is present (RFC 0004) the
handler passes it to the broker: a storage broker enqueues on the transaction's session through
`atomic.join(connection, …)`, so the message exists exactly when the writes commit -- the transactional
outbox, with no document naming it; a broker that cannot join throws `'<connection>' cannot take part in a
transaction: publish after the atomic graph`, so the runtime refuses to be wrong quietly. `publish` declares
`transactional: true` in its port document because it *can* take part; which brokers do is the kind's fact,
read by X0n5 and by the handler.

**`consume`** (`packages/plugin-queue/src/worker.ts`, new). It follows `listen` line for line where it can:

1. `serving.triggers('@queue/queue.trigger-kind.json')`, read afresh on every delivery rather than captured,
   so a reload is seen (`Served.serving()` in `packages/runtime/src/serve.ts` routes every member through
   `current`). The triggers are grouped by canonical connection and queue; `queues` narrows the set.
2. For each (connection, queue): the broker for the connection's kind, and `broker.consume(...)` with the
   step's `concurrency`.
3. Per delivery: one blob scope (`serving.blobs.scope()`), released when the outcome is decided, as `listen`
   opens one per request. The context is `{ id, attempt, queue, headers, message: body }`;
   `serving.inputFor(trigger, request)` builds and judges the input -- an input that does not conform is
   `dead` at once, since redelivering a message that does not fit cannot help, and the line says why. Then
   `serving.fire({ trigger, input, request, blobs })`: the embedder's gate runs unchanged (`Embedder.gate`
   in `packages/runtime/src/embed.ts` gathers the token from `{{request.headers.authorization}}` through
   `gathered`, the guard's `identify` verifies it, the policies decide) and the operation runs.
4. The report becomes an outcome through one function, `outcomeOf(trigger, report)` in
   `packages/plugin-queue/src/outcome.ts` (new), shared with the kind's `TriggerRuntime.encode`: `done` is
   `ack`; a refusal (`refusalOf(report)` from `@wilanis/engine`) is `settings.outcomes[reason]`; a fault is
   `settings.onFault ?? 'retry'`; and `retry` with `attempt >= maxAttempts` is `dead`. The broker is answered
   `{ outcome, backoffMs: backoffMs * 2 ** (attempt - 1) }`.
5. `env.hold({ label: 'queue <connection>', stop })`, one hold per connection; `stop` calls what each
   `broker.consume` returned, which stops taking messages and resolves once every run in flight has been
   answered and acknowledged or not. The runtime stops holds in reverse (`bye` in `start`), so `consume`
   listed before `listen` drains after the socket closed.

Where a trigger's connection has no broker registered, `consume` throws before holding anything, naming the
connection and the kind; a startup step that throws stops the start (`runStartup`).

**Where the ack sits, and where the transaction sits.** They are not the same place, and this RFC says so
rather than pretending. An atomic graph's transaction (RFC 0004) is opened by the first transactional node
inside `Compiler.nestedRunner`'s run and settled at that run's quiescence -- inside `serving.fire`, before it
answers. The acknowledgement is the worker's, after `fire` has answered, outside every graph. So the
sequence for a message whose graph commits is: receive and lock; run (open, write, commit); acknowledge. A
process that dies between commit and acknowledge leaves a committed write and an unacknowledged message; the
broker delivers it again, and the graph runs again over a row that is already gone or already there. That is
at-least-once, and it is why T0n1 exists: the design does not put the acknowledgement inside the graph's
transaction, it requires the graph to be safe to run twice, and the checker can see the second thing where it
could never see the first. What the table broker *does* keep to one transaction is its own bookkeeping --
the receive is `SELECT … FOR UPDATE SKIP LOCKED` plus a lock stamp, committed at once, so two workers never
take one message; the ack is a `DELETE`; a retry is an `UPDATE` of `attempts` and `available_at`. The
alternative, the worker opening a transaction that the graph's writes join and the ack shares, is discussed
under *Drawbacks*.

**The memory broker** (`packages/plugin-queue-memory/src/index.ts`, new): a `Map` of queue name to an array
of `{ id, attempt, headers, body, availableAt }` per connection, living as long as the process; `consume`
polls its own array; `retry` re-enqueues with `attempt + 1` at `now + backoffMs`; `dead` moves the message to
a `dead` array a test can read. `ensure` does nothing.

**The table broker** (`packages/plugin-storage-postgres/src/broker.ts`, blocked on RFC 0002): one table
`wilanis_queue` in the connection's schema -- `id` (uuid), `queue` (text), `body` (jsonb), `headers` (jsonb),
`attempts` (int), `available_at`, `locked_until`, `dead_at` (timestamptz) -- created by `ensure`, which a
startup step reaches through a domain operation the way RFC 0002's `prepare` reaches `storage.port.json#ensure`.
Receive: `SELECT … WHERE queue = $1 AND dead_at IS NULL AND available_at <= now() AND (locked_until IS NULL OR locked_until < now()) ORDER BY available_at LIMIT $2 FOR UPDATE SKIP LOCKED`,
then `UPDATE … SET locked_until = now() + visibility`, in one short transaction. A worker that dies holding a
lock loses it at `locked_until`, which is the redelivery. Polling interval and visibility are the broker's
settings on the plugin (`plugin.json → settings`, RFC 0002's `statementTimeout` is the precedent), not a
document's.

**The trigger kind's runtime** (`packages/plugin-queue/src/index.ts`): `start` starts nothing and logs how
many queue triggers the tree has, as `@cli`'s does (`packages/runtime/src/plugins/cli-trigger.ts`); the
`consume` step does the work. `encode(trigger, report)` answers `{ outcome, reason?, message? }` through
`outcomeOf`, so `wilanis run` and the rehearsal say what the message would have become.

**`rehearse`, `fuzz`, `regress`, `run --seed`.** A queue trigger is a trigger: `rehearse` walks it from
`load.registry.all('trigger')` (`packages/runtime/src/rehearse.ts`), `generatedFire` in `stubbing.ts`
generates its context from `scope.contextType(kind, settings)` -- a message of `$Message`, an `attempt`, open
`headers` -- and `inputFor` honours `fire.in`. `stubEffects` stubs `publish` with a generated `{ id }` and
never reaches a broker, so the publishing route rehearses with nothing leaving the process. Its policies are
rehearsed as roots of their own (`policyRoots`), under the queue kind's context. Nothing in these three
commands changes. `wilanis run <queue trigger>` builds a command line's context (`requestOf` in
`packages/runtime/src/serve.ts`: `flags`, `args`, `cwd`, `body`), which hands no `message`; exercising a
queue trigger by hand is publishing to it, and how `run` might fill `request.message` from `--in` is left to
implementation (below).

**Traces (RFC 0006).** Every delivery is one fire and one trace, rooted `fire <trigger path>`, its
`correlation` read from `headers.traceparent` where the publisher put one. The outcome the worker decides is
the kind's answer, not the run's: it appears in the worker's log line as a route's status appears in the
listener's, and the trace's root carries the run's status (`refused: upstream`). `publish` is a node and gets
its span for free; whether the runtime stamps the run's own id into a published message's `traceparent` is
left to implementation, since RFC 0006's `Fired.id` lives in the embedder and no run-scope value carries it
to a handler today.

**Retry here, and retry in RFC 0011, are two different things.** RFC 0011's `retry` is written on a data
graph's node or a binding operation, repeats *one effect* inside *one run* when it *faults* (never when it
refuses), and shows as one node with `attempts[]`. This RFC's `retry` is an *outcome of a whole run*, decided
after the run ended, applied to a *declared refusal* (the graph saying `upstream`: not now) as much as to a
fault, and executed by the *broker*, which hands the message again as a *new run* -- a new `Fired`, a new
trace, `request.attempt` one higher. The two compose without touching: a node with RFC 0011's `retry` may try
three times inside one delivery, and the delivery may then be retried five times. Neither knows of the
other, and `maxAttempts` counts deliveries, never tries.

### Discoverability

- `wilanis describe @queue/worker.port.json#consume` prints `granted by @queue (@wilanis/plugin-queue)` and
  `(holds until stopped)`, as `operationLine` in `packages/runtime/src/discovery.ts` prints for `listen` today.
- `wilanis describe <connection kind>` prints `delivery: at-least-once` when declared; `describe <connection>`
  prints it under the kind, and lists the queue triggers receiving from it and the graphs publishing to it, by
  queue name -- the pairing X0n3 judges.
- `wilanis describe <queue trigger>` prints the connection, the queue, the message type, and the outcomes
  table the way it prints a route's settings.
- `wilanis map` prints a queue the way it prints a route: `queue removals (@connections/jobs.connection.json) → @monitor/edge/remove-queued.trigger.json → monitor.port.json#remove → …`,
  and under the publishing graph `→ publish removals`.
- The viewer's trigger page (`renderDocPage`, `case 'trigger'` in `packages/view/client/index.html`) shows a
  queue trigger's connection, queue and outcomes as it shows a route's; the connection page lists its queues.
  The view model (`packages/view/src/model.ts`) carries `delivery` on a connection entry. No new page: a
  queue trigger is an existing kind.

### Plugin contract

`PluginModule` in `packages/core/src/plugin.ts` does not change; neither does `Serving`, `FireArgs`,
`TriggerRuntime`, `Hold` or `Guard`. The worker reaches the runtime through `env.serving` and `env.hold`
inside a `holds` operation the project's startup list names, as the listener, the watcher and RFC 0006's
exporter do. A broker reaches `@queue` through a table `@queue` exports and the broker fills from `postLoad`,
as an engine reaches `@storage`. The guard is not consulted, changed or told: a credential in a message's
headers is a credential read from the kind's context, which is what the guard verifies today. The one
addition to core is two optional fields on two kind documents, read by the checker.

## Compatibility

IR v1, compatible. `connection-kind.schema.json` gains optional `delivery`; `trigger-kind.schema.json` gains
optional `connection`. Every kind document written before this RFC validates and means what it meant: a kind
without `delivery` delivers nothing and no trigger may receive from it (T0n2), a kind without `connection`
receives from nothing and T0n1 and T0n2 never run for its triggers. `ConnectionKindDoc` and `TriggerKindDoc`
gain one optional member each. No document under `example/` changes meaning; the example gains documents.
`@wilanis/plugin-queue` and `@wilanis/plugin-queue-memory` are new and optional. Until 1.0 is published, v1
may change in place (RFC 0008); this is one of the accepted RFCs that still changes a schema, and the freeze
comes after it.

## Tests

Sabotage tests in `packages/runtime/test/sabotage.test.ts` and `sabotage-access.test.ts`, through
`sabotage` and `codes` in `example-harness.ts` once the example carries the queue trigger and `PLUGINS` there
names `@queue` and `@queue-memory` beside `@http`, `@blob`, `@reload` and `@auth`:

| Code | The edit |
|---|---|
| T0n1 | drop `"idempotent": true` from `monitor.port.json#remove`; point `remove-queued.trigger.json` at `#submit` (also B0n1 if `idempotent` is then written on `submit`) |
| T0n2 | `settings.connection: "@connections/monitor-api.connection.json"` (an http kind, no `delivery`); `"@connections/nope.connection.json"` (R001); `"{{secrets.jwt}}"` (a read) |
| X0n1 | `outcomes.upstream: "later"`; `maxAttempts: 0` |
| X0n2 | a fake broker kind under `docsDir` declaring `at-most-once`, with `outcomes.upstream: "retry"` |
| X0n3 | `publish-removal.graph.json` with `type: "@monitor/edge/DeleteRequest.shape.json"` and `message: { ids: [] }` |
| X0n4 | `settings.message: "@monitor/edge/CsvUpload.shape.json"` (carries a blob) |
| X0n5 | blocked on RFC 0004: `"atomic": true` on a data graph publishing to `@connections/jobs.connection.json` (memory: not `storage`) |
| T005 | drop `missing` from `outcomes` → `['T005']`; drop the attachment's `in` → A005 and no `invalid_credential` reachable → `['A005', 'T006']` |
| L003 | drop `publish` from `feature.json → effects` |
| L008 | a data graph node running `@queue/worker.port.json#consume` |
| B006 | a startup step naming `@queue/queue.port.json#publish` |
| D008 | `relocate` the queue trigger to `domain/` |
| none | the example as written: `codes(EXAMPLE)` is empty; `rehearse` walks the queue trigger's branches (`missing`, `row`, `failed`) and its policies as roots, and the count of branches grows by exactly those |

End to end, in `packages/plugin-queue/test/` over `@wilanis/plugin-queue-memory` as a devDependency (the
way `packages/runtime` depends on `@wilanis/plugin-http` for tests), with a small tree loaded by `loadTree`
and served through `start` from `@wilanis/runtime` (a devDependency for tests only, as the http tests do in
`packages/plugin-http/test/harness.ts`):

| What | Asserts |
|---|---|
| publish then consume | a route publishes, the worker fires the trigger, the effect ran once, the message is acknowledged: the queue is empty |
| `missing` is acknowledged | the stubbed operation refuses `missing`; outcome `ack`; the queue is empty; the effect ran once |
| `upstream` is retried, with backoff | refuses `upstream` twice then answers; three deliveries with `attempt` 1, 2, 3; the gaps honour `backoffMs` 10 and 20 |
| retry past `maxAttempts` is dead | refuses `upstream` always with `maxAttempts: 2`; two deliveries; the message is in `dead` |
| a fault is `onFault` | the handler throws; `retry` by default; `dead` when `onFault: "dead"` |
| a message that does not fit is dead | body `{ "id": 7 }` against `IdRequest`; no fire; `dead`; the line names the field |
| the gate runs on a message | a token from the access tree's fake directory in `headers.authorization`: the run is allowed; a customer's token: `forbidden` → `dead`; no token: `anonymous` → `dead`; a bad token: `invalid_credential` → `dead` |
| a policy-less queue trigger is public | the same message with no `policies`: the operation runs |
| stop drains | `stop()` while a delivery is in flight resolves after that delivery's outcome; no message is taken after `stop()` began |
| a reload is seen | `serving.reload()` swaps the tree; the next delivery fires the new trigger's operation |
| no broker registered | a tree naming a kind no plugin registered: `consume` throws naming the connection and the kind; `start` stops |
| at-least-once is real | the memory broker told to drop one acknowledgement redelivers; the idempotent stub sees the message twice and the store shows one effect |
| `encode` | `wilanis run` on a cli trigger of the same operation answers as today; `encode` of a report refusing `upstream` on the queue trigger answers `{ outcome: 'retry', reason: 'upstream', message }` |
| rules | one sabotage per X rule against the small tree, as `packages/plugin-auth/test` does for X101 to X103 |
| shared suite | `suite.ts`: publish, consume, retry, dead, drain, as a suite a broker's tests import (RFC 0002's `suite.ts` is the precedent); `packages/plugin-queue-memory/test/broker.test.ts` runs it; `packages/plugin-storage-postgres/test/broker.test.ts` runs it behind `WILANIS_TEST_POSTGRES_URL` and adds: two workers over one table each take distinct messages (`SKIP LOCKED`), a lock expires and the message is redelivered, `publish` inside an atomic graph is absent after a rollback (blocked on RFC 0002, RFC 0004) |

Core, in `packages/core/test/validate.test.ts`: a connection kind with `delivery: "at-least-once"` and a
trigger kind with `connection: "connection"` validate; `delivery: "exactly-once"` is refused by the schema.
Discoverability, in `packages/runtime/test/tools.test.ts`: `describe` of the connection prints the queue and
its trigger; `map` prints the queue line. View, in `packages/view/test`: the example's queue trigger page.

## Implementation plan

1. **Schemas and model** (`area:core`): `delivery` on `connection-kind.schema.json`, `connection` on
   `trigger-kind.schema.json`, the two members in `model.ts`, the baseline in `validate.test.ts`, the template's
   rows. `good first issue`.
2. **Checker** (`area:compiler`): `checkDelivery` in `check/triggers.ts` with T0n2 and T0n1; the sabotage
   tests. T0n1 reads `Operation.idempotent`, so this lands after RFC 0011's step 1; T0n2 can land first.
3. **`@wilanis/plugin-queue`** (`area:plugin-queue`, new label): the package, `docs/` (plugin.json,
   queue.port.json, worker.port.json, queue.trigger-kind.json), `brokers.ts` with `Broker` and `brokers(env)`,
   `publish.ts`, `worker.ts`, `outcome.ts`, the trigger runtime, `rules.ts` with X0n1 to X0n4, `suite.ts`, a
   README saying what a broker implements. Workspace member; added to `npm run release` after `plugin-auth`.
4. **`@wilanis/plugin-queue-memory`** (`area:plugin-queue`): the kind, the broker, `postLoad` registering it,
   `broker.test.ts` over the suite. `good first issue` once 3 lands.
5. **The example** (`area:runtime`): `jobs.connection.json`, `remove-queued.trigger.json`,
   `enqueue-removal.trigger.json`, `publish-removal.graph.json`, the `token` resolver, `#enqueueRemoval` and its
   binding entry, `publish` under effects, the two plugins and the `consume` step in `project.json`,
   `example/README.md`'s paragraph. `"idempotent": true` on `#remove` waits for RFC 0011's step 1; until then the
   example carries the trigger without it and step 2's T0n1 is not yet judging.
6. **Discoverability** (`area:runtime`, `area:view`): `describe`, `map`, the connection and trigger pages, the
   view model. `good first issue`.
7. **The gate over a message** (`area:plugin-queue`): the end-to-end tests with the access tree's fake
   directory, mirroring `packages/plugin-http/test/http.test.ts`; no code beyond tests, since the embedder's
   gate is unchanged.
8. **`correlation`** on the kind: blocked on RFC 0006's step 2. One line.
9. **X0n5 and `publish` joining a transaction** (`area:plugin-queue`): blocked on RFC 0004's implementation.
10. **The table broker** (`area:plugin-storage`): `delivery` on the postgres kind, `broker.ts`, `ensure`, the
    suite behind the environment variable, the example's `ensure` step under its storage profile. Blocked on
    RFC 0002's implementation (and 9 for the join).
11. **A worker process** (`area:runtime`): blocked on RFC 0013. See *Drawbacks*, first item.
12. **README**: a "Work off the request" paragraph beside "Every branch runs before you deploy", and the roadmap's
    M10 row updated with the example's route and worker.

## Drawbacks and alternatives

**One process listens and consumes; two processes need RFC 0013.** The stub said a worker is "the same tree
started with a profile whose startup lists `subscribe` and not `listen`". The code says a profile is a set of
bindings and nothing else -- `project.schema.json → profiles` has `bindings`, `runStartup` reads the one
`project.doc.startup` for every profile -- so today every process that runs the tree runs every step. That is
the right default for a small deployment: one process answers routes and works queues, and `consume` before
`listen` drains in the right order. A separate worker process needs a startup list per profile, which RFC 0013's
sketch already proposes (`startup` may name a profile); this RFC does not add a second way to say it, and marks
the step blocked.

**The connection kind declares delivery, not the trigger kind.** The trigger kind is one document for every
broker and cannot know whether a table or SQS is behind a given trigger; the connection kind is the broker's
own document, written by the plugin that knows. RFC 0002 put `storage: true` on the kind for the same reason,
and X203 reads it there. The alternative -- a `delivery` setting on each trigger, written by the author --
would let an author claim `at-most-once` over a broker that redelivers, which is a lie the checker would then
trust.

**Exactly-once by transaction was considered and not taken.** The worker could open the transaction: receive
the row, hand `env.atomic` (RFC 0004) pre-opened to `serving.fire` so the graph's writes on the same connection
join it, delete the row, commit -- the transactional inbox. Then a write and its acknowledgement would stand or
fall together and T0n1 would be unnecessary for graphs whose effects all fall on that connection. It is not
taken, for four reasons the code makes concrete. `Serving.fire` carries no scope and `Embedder.fire` builds
`env` from its own, so the change is to the contract every kind uses. The lock would be held for the whole
run, including its pure nodes and its HTTP calls, which RFC 0004 already warns starves the pool; a message's
run is longer than a route's on average, not shorter. The checker could not see it: RFC 0004's L0n1 refuses an
atomic *graph* reaching a non-transactional effect, but here nothing in a document says the run is atomic, so
a graph that DELETEs against an upstream and then writes a row would commit the row with the ack and repeat
the DELETE on a crash anyway -- exactly-once for one connection and at-least-once for everything else, with
nothing to tell an author which. And a broker that is not the store (SQS) cannot do it at all, so the promise
would hold under one connection kind and vanish under another. At-least-once plus `idempotent`, judged per
profile by B0n1, is one promise that holds everywhere and that the checker can prove. A later RFC may add the
inbox for the storage broker alone, on top of this, as an optimisation that makes a redelivery rarer without
making one unsafe.

**`retry` and `dead` as outcomes, not as RFC 0011's `retry`.** An author could write RFC 0011's `retry` on
the binding operation the queue trigger fires, and get three tries inside one delivery. That is a different
thing (*Runtime behaviour*), and both exist: one is the transport's flakiness, the other is the business
saying "not now". The stub asked whether the mapping is a trigger setting like `response.refusals`; it is,
and for the same reason the http kind's is: the graph says why in one word, the kind says what that word
means to its caller, and `refusals` on the kind lets T005 and T006 judge both tables with one rule.

**Policies on a queue trigger mean what they mean everywhere.** The stub asked whether a queue trigger is
always internal and policy-less. Three facts decide it. The mechanism costs nothing: a credential is a read of
the kind's context (`gathered` in `embed.ts`, A004), the queue kind hands `headers`, and the guard verifies what
it is handed with no knowledge of where it came from. The invariants need it: RFC 0007's I001 holds every
trigger that *reaches* a gated operation to the policy, and a queue trigger firing `#remove` reaches it; a
policy-less-by-fiat kind would need an exemption, which is the hole "a domain graph cannot route around an
invariant" was written to close. And "internal" is not a property the checker can see: whoever can publish to
the broker can fire the trigger, and a queue trigger without `policies` is public to them, which the
invariant judges exactly as it judges a public route. What the stub called "a service identity" is a token
the tree issued -- `@auth/token.port.json#issue` exists -- to whichever principal caused the work; the example
forwards the caller's own, which expires with `accessTtl`, and a message consumed after that is
`invalid_credential` and `dead`. That is honest and visible; a longer-lived token for queued work is the
access library's to add, and whether a token belongs in a message body at all is RFC 0020's question.

**A `job` kind** was rejected by the stub and stays rejected: it would be a second way to fire a port.

**One worker per connection, not per trigger.** `consume` groups the tree's queue triggers by connection and
queue, as `listen` answers every route on one socket. A `consume` per trigger would put a startup step per
queue in `project.json`, which is the routes-in-the-startup-list the http design refused.

**Polling.** The table broker polls; the memory broker polls its array. A LISTEN/NOTIFY wake-up is an
optimisation inside `@wilanis/plugin-storage-postgres` and changes no document.

**Cost.** Two packages, two READMEs, two entries in `npm run release`; a third when the table broker lands.
Two optional fields in core. The worker holds one blob scope per delivery and one `Fired` per delivery, as the
listener does per request. A message body is buffered whole: it is JSON of an edge shape without a blob (X0n4),
never a file.

## Open questions

Settled here, with the reasoning in the text: **delivery is the connection kind's fact**, `delivery` beside
RFC 0002's `storage`, and the checker relates it to RFC 0011's `idempotent` by one generic rule, T0n1, that
reads the promise and leaves the proof to B0n1 (*Checker rules*; *Drawbacks*, second item). **A policy on a
queue trigger is a policy**: the credential rides in the message's headers, the kind hands them, the guard
verifies them before any graph runs, and a queue trigger without policies is public to whoever can publish,
which the access invariants judge (*Drawbacks*, fifth item). **Retry and dead-letter are outcomes in a table
on the trigger** that the kind's `refusals` names, judged by T005 and T006, and a redelivery is a new run,
distinct from RFC 0011's retry of one effect inside a run (*Runtime behaviour*, last paragraph; *Drawbacks*,
fourth item). The ack is outside the graph's transaction and the design says so (*Runtime behaviour*).

Nothing else must be decided before `accepted`. Decided during implementation:

1. The table broker's polling interval and visibility timeout, as settings on the postgres plugin, and whether
   the backoff gains jitter -- with RFC 0011's answer for its own backoff.
2. Whether `wilanis run <queue trigger> --in '{"id":"golf"}'` fills `request.message`, so a queue trigger can be
   fired by hand against a real broker, or whether publishing is the one way.
3. Whether `publish` stamps a `traceparent` from the run into a message that carries none, once RFC 0006 says
   how a handler learns the run's id.
4. The exact log line of a delivery, and whether `dead` messages get a `wilanis` command to list and requeue
   them or stay a table an operator reads.
