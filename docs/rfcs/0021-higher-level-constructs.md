# RFC 0021: Higher-level constructs: state machines and resources

- **Status:** draft
- **Areas:** `area:core` (one kind: schema, `MachineDoc`, placement; one reserved reason word), `area:compiler` (the M
  family, the machine's sites and the guards it lowers), `area:runtime` (`describe`, `map`, `rehearse`'s lines, two
  scaffolds, the template), `area:view` (the machine page and the canvas badge), `area:plugin-storage` (one X rule over
  `patch`)
- **Tracking issue:** #23
- **Depends on:** RFC 0002 (a record lives in a store's collection and is written by `@storage/store.port.json#put`;
  `resolves` is how the compiler knows which collection a call writes; accepted). RFC 0007 (sites, the three proof rules
  and the lowered guard; the reserved reason word as a precedent; `operationsReachable`; accepted). RFC 0003's `defaults`
  is what an existing row receives when a shape gains its state field. RFC 0004's `atomic` is how two moves from one
  state are kept from racing, and this RFC adds nothing for it. RFC 0011 and RFC 0012 sent compensation across systems
  here (*Motivation*, what this does not do). RFC 0014 noted that a machine's transitions might want a caught refusal;
  they do not (*Drawbacks*). RFC 0018's `fuzz --edges` already tries every member of an enum, which is what a dynamic
  move needs tried. RFC 0019's envelope is what `--json` prints.

## Summary

No second layer. The fear behind this RFC is that an agent's application becomes a heap of primitive nodes, and the
remedy proposed was a domain language -- resources, pagination, state machines, retry policies, event handlers --
compiled down to graphs. This RFC answers each candidate on its own terms and adds one construct. A CRUD resource is
scaffolding: `wilanis new resource <Name>` writes the shapes, the store, the port, the five data graphs, the binding
and the five routes, and the tree then holds nothing the checker did not already know. Pagination is a shape with a
cursor and a `find` with `limit` and `offset`; a retry policy is RFC 0011; an event handler is RFC 0009. None is a
language change. The one construct that earns its place is a **state machine over a stored shape**: a `machine`
document in `domain/` that names a core shape, the `enum` field that is its state, the state a record is born in and
the transitions between states, each with the rule it requires. The compiler finds every place a record of that shape
is written to a store, tells a birth from a move, proves what it can from literals and from the switches an author
already wrote, refuses at check time what contradicts the table, and lowers a guard -- RFC 0007's switch and refuse --
where only the running value can tell, so that a record never changes state outside a declared transition and every
trigger that could be told so maps the reason `transition`. This is RFC 0007's third class of invariant, stated once
against the lifecycle rather than at every write. The construct lowers to nodes an author could have written, the graph
page shows the lowering, the machine page draws the table, and every refusal points at the document an author edits.

## Motivation

The example, once RFC 0002 keeps its entries in a store, has a record and a handful of graphs that write it: one that
makes an entry and puts it, one that patches its URL and method, one that removes it. Give `Entry` a `status` --
observed, flagged, resolved, dismissed -- and the business acquires a rule it cannot state: an entry is born observed,
only a flagged entry is resolved, a resolved one carries the note that says what was found, and nothing goes back to
observed. Today that rule is a `switch` in each graph that moves an entry, written by hand, one per graph, and a graph
that forgets it produces a tree `wilanis check` accepts. An agent adding `PUT /monitor/{id}/status` that merges
`{{in.status}}` into the record and puts it has written a route that moves an entry anywhere, and nothing in the tree
says otherwise. RFC 0007 saw this and stopped: "an order cannot become paid without a payment result" needs a record's
old and new values at a storage write, and is better stated once against a lifecycle than at every write. It named
RFC 0021 as the lifecycle and deferred the class.

What an author, human or agent, cannot express now: that `status` is not a string field but a position in a table;
which positions follow which; what must be true of the record for a step to be taken; and where the record starts.
Each is a fact the checker could hold every graph to, the rehearsal could walk branch by branch, the viewer could draw
as the diagram every whiteboard already has, and `describe` could print beside the shape. The cost of not having it is
the cost RFC 0007 named for every invariant: a rule held in someone's head, and a tree that is correct by coincidence.

What this RFC does not do. It does not add a resource kind, a pagination construct, a retry construct or an event
construct, and *Reference* says of each where it already lives. It does not add a workflow or saga construct: a
process that spans systems (charge, then ship, then mail) is a record whose state is the step it has reached, each
step a transition an operation performs, compensation a transition an author writes (`charged → refunded`), and what
drives a stuck record forward is a worker (RFC 0009) or a schedule (RFC 0010) that finds records in a state and moves
them. The machine gives that process its table and its rehearsal; it runs nothing. It does not add `transition` as a
third form of the `invariant` document: the rule on a transition *is* the class 3 invariant, and one place is enough.
It does not touch removal: a record is removed in any state (*Open questions*). It does not add a construct for a
state field that is not an `enum`, or for a lifecycle spread over two records: one shape, one field, one table. And it
does not make the compiler learn `@storage`: it finds a write by the type the contract binds through `resolves`, which
is core's vocabulary, and the one rule that reads `patch`'s `changes` is the storage plugin's own.

## Guide-level explanation

**A machine** is a document in a feature's `domain/`, `*.machine.json`, because a lifecycle is a rule of the business.
It names a core shape (`over`), the field of that shape that holds the state (`state`: a required `string` with an
`enum`; the enum's members are the states), the state a record is born in (`initial`), and its **transitions**: each
named, from one or more states, to one state, with an optional `when` -- a rule in the switch grammar whose roots are
`old` and `new`, the record before and after the move.

**A birth** is a record of the shape made whole and put where none was. **A move** is a record read from its
collection, merged with a change to the state field, and put back. Everything else that writes a record of the shape --
a merge that leaves the state alone, a record read and put back -- is a **rewrite**, and the machine says nothing about
it. A `patch` never touches the state field: a move replaces the record it read, so the graph holds the old value the
rule is judged against.

The example, after RFC 0002 gave it a store. `Entry` gains two fields, `status` and an optional `note`, and the store's
collection says what every existing row receives (RFC 0003):

```json
"status": { "type": "string", "enum": ["observed", "flagged", "resolved", "dismissed"], "description": "where the entry is in its review" },
"note":   { "type": "string", "required": false, "description": "what the reviewer found" }
```

```json
"defaults": { "status": "observed" }
```

The machine, `example/features/monitor/domain/review.machine.json`:

```json
{
  "$schema": "@wilanis/machine.schema.json",
  "label": "An entry's review",
  "description": "An entry is observed. Someone may flag it for a look; a flagged entry is resolved with a note saying what was found, or dismissed. A closed entry may be reopened. Nothing returns to observed.",
  "over": "@monitor/domain/Entry.shape.json",
  "state": "status",
  "initial": "observed",
  "transitions": {
    "flag":    { "from": ["observed"], "to": "flagged", "description": "someone wants a look" },
    "resolve": { "from": ["flagged"], "to": "resolved", "when": "has(new.note)", "description": "looked at; the note says what was found" },
    "dismiss": { "from": ["observed", "flagged"], "to": "dismissed" },
    "reopen":  { "from": ["resolved", "dismissed"], "to": "flagged" }
  }
}
```

`resolve`'s `when` is the class 3 invariant RFC 0007 could not state: a record may become resolved only carrying a
note. It is written once, here, and holds at every graph that resolves an entry.

Two operations join `monitor.port.json`: `flag`, taking `EntryRef` and answering `Entry`, and `review`, taking a new
core shape `EntryReview` (`id`, `status` with the same enum, optional `note`) and answering `Entry`. Their data graphs
are ordinary. `flag-record.graph.json`:

```json
{
  "$schema": "@wilanis/graph.schema.json",
  "label": "Flag an entry",
  "description": "Data graph behind monitor.flag: read the entry, mark it flagged, put it back. Absent is the declared refusal.",
  "in": "@monitor/domain/EntryRef.shape.json",
  "out": { "type": "@monitor/domain/Entry.shape.json", "from": ["answer", "missing"] },
  "nodes": [
    { "type": "@wilanis/node/run.schema.json", "id": "asked", "run": "@storage/store.port.json#get",
      "in": { "store": "@monitor/data/entries.store.json", "collection": "entries", "key": "{{in.id}}" } },
    { "type": "@wilanis/node/switch.schema.json", "id": "route", "in": { "record": "{{asked.record}}" },
      "rules": [{ "when": "has(record)", "to": "entry" }], "else": "missing" },
    { "type": "@wilanis/node/run.schema.json", "id": "entry", "label": "Mark it flagged", "run": "@std/object.port.json#merge",
      "in": { "base": "{{asked.record}}", "over": { "status": "flagged" }, "type": "@monitor/domain/Entry.shape.json" } },
    { "type": "@wilanis/node/run.schema.json", "id": "stored", "run": "@storage/store.port.json#put",
      "in": { "store": "@monitor/data/entries.store.json", "collection": "entries", "record": "{{entry}}" } },
    { "type": "@wilanis/node/run.schema.json", "id": "answer", "run": "@std/object.port.json#make",
      "in": { "value": "{{stored.record}}", "type": "@monitor/domain/Entry.shape.json" } },
    { "type": "@wilanis/node/run.schema.json", "id": "missing", "run": "@std/outcome.port.json#refuse",
      "in": { "reason": "missing", "message": "no entry {{in.id}}", "type": "@monitor/domain/Entry.shape.json" } }
  ]
}
```

The author wrote no rule about `status`. The compiler sees a move at `entry`: its `base` is a record of `entries`, its
`over` writes `status` to the literal `flagged`, and the one transition that ends there is `flag`, from `observed`.
Nothing in the graph says what `asked.record.status` is, so the move is **guarded**: a switch the author never wrote
routes to `entry` when the old state is `observed` and to a refusal with reason `transition` otherwise. The trigger,
`POST /monitor/{id}/flag`, maps the reason as it maps every other:

```json
"refusals": { "missing": 404, "transition": 409, "anonymous": 401, "invalid_credential": 401, "forbidden": 403 }
```

Leave it out and T005 says so, naming `@monitor/data/flag-record.graph.json#entry` as where `transition` is refused.

`review-record.graph.json` is the same graph with `"over": { "status": "{{in.status}}", "note": "{{in.note}}" }`. The
new state is the caller's, so the guard is the whole table: one rule per transition, `old.status` in its `from`,
`new.status` its `to`, and its `when`; `resolve`'s rule reads `has(new.note)` from the merged record. A caller who
`PUT`s `{ "status": "resolved" }` on an observed entry, or on a flagged one without a note, is told 409.

**Proving the guard away.** An author who writes the decision themselves is rewarded with a graph that has no guard:

```json
{ "type": "@wilanis/node/switch.schema.json", "id": "route", "in": { "record": "{{asked.record}}" },
  "rules": [{ "when": "has(record) && record.status == 'observed'", "to": "entry" }, { "when": "has(record)", "to": "closed" }],
  "else": "missing" }
```

`entry` is now routed by a rule that establishes `record.status == 'observed'` about the very value the merge is over,
which is `flag`'s `from`; `flag` has no `when`; the move is **proved by narrowing** and the compiler lowers nothing.
The `closed` branch is the author's own refusal, with the author's own reason and message. This is RFC 0007's
incentive, unchanged: the guard is the honest price of a value the tree cannot judge, and the switch that removes it
is the graph a careful author would have written anyway.

**A birth** is judged the same way. `create-record.graph.json` (RFC 0002) makes the entry whole with `"status":
"observed"` beside `id`, `url`, `method` and `ua`, and puts it keyed by `newKey`'s answer: a birth in the initial
state, **proved by the literal**, no guard. Write `"status": "flagged"` there instead and `wilanis check` answers:

```
M005  @features/monitor/data/create-record.graph.json#nodes/entry
    a record of @monitor/domain/Entry.shape.json is born 'flagged', but 'An entry's review'
    (@monitor/domain/review.machine.json) says an entry is born 'observed'
    → write "status": "observed", or make this a move: read the record and merge the change
```

Make it `"status": "{{in.status}}"` and the birth is guarded: the record is put only when the caller's state is
`observed`, and the trigger maps `transition`.

**A write the machine cannot judge** is refused, since a rule that a graph can route around is not a rule. A data
graph that puts `{{in}}` -- an `Entry` the caller handed over whole -- over an existing record has moved it to
whatever state the caller chose, and nothing in the graph knows what the record was:

```
M006  @features/monitor/data/replace-record.graph.json#nodes/stored/in/record
    puts a record of @monitor/domain/Entry.shape.json that was neither read from 'entries' nor made whole,
    so 'An entry's review' cannot tell a birth from a move
    → read the record with #get and merge the change over it; or make the record whole, born 'observed', and put it with "replace": false
```

**The rehearsal** walks a guard as it walks every switch, and names each branch after its transition:

```
features/monitor/data/flag-record  move 'entry' An entry's review  2/2 branches
  ok  flag       answered from 'entry'
  ok  violated   refused on purpose at 'entry:violated' as transition: "'An entry's review' allows no move from 'resolved' to 'flagged'"

features/monitor/data/review-record  move 'entry' An entry's review  5/5 branches
  ok  flag       answered from 'entry'
  ok  resolve    answered from 'entry'
  ok  dismiss    answered from 'entry'
  ok  reopen     answered from 'entry'
  ok  violated   refused on purpose at 'entry:violated' as transition: "'An entry's review' allows no move from 'observed' to 'resolved'"

machines -- 1 declared: 'An entry's review' (4 transitions): born at 1 site (proved); moved at 2 sites (0 proved, 2 guarded); every transition performed.
```

**The diagram** is what the viewer draws on the machine's page: the four states as boxes, `observed` marked as the
start, an arrow per transition labelled with its name and its `when`, and under each arrow the graphs that perform it
and whether each is proved or guarded. The graph page draws the lowering -- the guard as RFC 0007 draws one, with a
badge naming the machine -- and the badge opens the diagram. `wilanis describe @monitor/domain/review.machine.json`
prints the same table.

**Resources are scaffolding.** `wilanis new resource features/tickets/Ticket` writes into the `tickets` feature the
three shapes, the store over the feature's connection, a port with `get`, `list`, `create`, `update` and `remove`, five
data graphs over `@storage/store.port.json`, the binding, and five `@http` routes, and adds the storage operations to
`feature.json → effects`. The result checks clean and rehearses every branch before the agent has typed a field. Add a
`status` to the shape and a machine over it, and nothing about the scaffold changes: the checker now holds its
`update` graph to the table, and refuses it (M006, above) until the agent writes the move as a move. No document kind
was added for this and none is needed: a resource is the five documents it always was, written faster.

## Reference

### Documents and schemas

**One new kind, `machine`.** `packages/core/schemas/machine.schema.json`, `$id` under the published base, `$schema`
accepting the URL and the alias `@wilanis/machine.schema.json`, with the optional `label` every kind carries:

```
machine
  description   string, required
  label         string
  over          path                   a core shape
  state         ident                  a field of `over`: a required string with an enum; its members are the states
  initial       string                 the state a record is born in; a member
  transitions   object, ≥ 1            name (ident) → transition
    from          string[], ≥ 1, unique  the states it leaves; members
    to            string                 the state it reaches; a member, not in `from`
    when          string                 a rule in the switch grammar; roots are `old` and `new`, each the shape's fields
    description   string
```

`additionalProperties: false` throughout. `MachineDoc` joins `DocByKind` in `packages/core/src/model.ts`, `'machine'`
joins `Kind` and `KINDS`, so `kindOfSchema` recognises it and `validate.ts` joins the schema:

```ts
/** A lifecycle over a stored shape: the states its `state` field may hold, the one a record is born in, and the moves between them. */
export interface MachineDoc extends Envelope {
  over: TypeRef;
  state: string;
  initial: string;
  transitions: Record<string, { from: string[]; to: string; when?: string; description?: string }>;
}
```

`HOME` in `packages/core/src/placement.ts` gains
`machine: { layers: ['domain'], why: 'a machine is a rule of the business over one of its shapes' }`, so a document
elsewhere is D008 with the hint that names `features/<name>/domain/`. The kinds table in
`packages/runtime/templates/CLAUDE.md` gains the row

| kind | what it is | where |
|---|---|---|
| `machine` | a lifecycle over a core shape: `state` (an enum field), `initial`, and `transitions` (`from` states, `to` a state, `when` a rule over `old` and `new`); a record is born in `initial` and moves only along a transition | `domain/` |

and the template's loop gains one paragraph: "When a shape has a field that is a position -- `status`, `stage`,
`phase` -- write a `machine` over it before the second graph that changes it. A move is a `get`, a `merge` that sets
the field and a `put`; a birth is a `make` in the initial state. M005 and M006 tell you which one you have written;
`transition` is the reason a trigger maps for a move the table refuses; a `switch` on the old state that the checker
can read removes the guard."

**Scaffolds** (`SCAFFOLDS` in `packages/runtime/src/scaffolds.ts`; `CLAUDE.md`'s "`into()` in `tools.ts`" is one
refactor stale, and RFC 0007 already writes `scaffolds.ts`):

- `wilanis new machine <name> --over <shape> --state <field>` writes, under `into(target, 'domain', 'machine')`, a
  machine over the shape whose `initial` is the enum's first member and whose transitions are one per consecutive pair
  of members, named `<a>-to-<b>`, each with a `TODO` description -- a table the agent edits down rather than a shape
  it fills in. Without `--over` it refuses, naming the flag; with a `--state` that is not an enum field it refuses
  with M001's words before writing anything.
- `wilanis new resource <feature>/<Name> [--plural <names>]` is a composite: it writes, in one call and refusing if
  any target exists, `domain/<Name>.shape.json` (core; `id` and a `TODO` field), `domain/<Name>Ref.shape.json` (`id`),
  `domain/<Name>Draft.shape.json` (the fields without `id`), `domain/<names>.port.json` (`get`, `list`, `create`,
  `update`, `remove`, typed over the three), `data/<names>.store.json` (one collection `<names>` of the shape, keyed by
  `id`, over the first connection of the tree whose kind is marked `storage`, or `@connections/<names>.connection.json`
  with a `TODO` kind when there is none), five data graphs (`get-<name>`, `list-<names>`, `create-<name>`,
  `update-<name>`, `remove-<name>`, each the RFC 0002 graph for its operation: `get`, `find`, `newKey`-`make`-`put`,
  `get`-`merge`-`put`, `remove`, with `has(record)` routing to `missing` where the operation can miss),
  `data/<names>-store.binding.json`, and five `edge/` triggers of `@http/http.trigger-kind.json` (`GET /<names>`,
  `GET /<names>/{id}`, `POST /<names>`, `PUT /<names>/{id}`, `DELETE /<names>/{id}`) with `missing` mapped to 404.
  It is the one scaffold that edits a file that exists: `feature.json → effects` gains the storage operations the
  graphs run, since a scaffold that leaves the tree refusing L003 has not scaffolded. It refuses, before writing,
  when the project names neither `@wilanis/plugin-http` nor `@wilanis/plugin-storage`, with the `project.json` edit as
  the hint. The plural defaults to `<name>s`. It writes no machine and no policy: what a resource's lifecycle is and
  who may touch it are the business's, and the scaffold does not guess.

**Pagination, retry, events: where each already lives**, so that the answer is on record and not re-asked. A page is a
`find` with `limit` and `offset` (RFC 0002) behind a domain operation whose `accepts` carries them and whose `returns`
is a core shape with `items` and a `next` cursor; `wilanis new resource`'s `list` graph accepts `limit` and `offset` and
passes them through. A retry policy is RFC 0011's `retry` on a `run` node and `idempotent` on an operation. An event
handler is RFC 0009's queue trigger, a schedule RFC 0010's. Nothing here is a document kind or a compiler rule.

No existing schema changes. `graph.schema.json`, `shape.schema.json`, `store.schema.json` and `port.schema.json` are as
RFC 0002, RFC 0003 and RFC 0004 leave them.

### Ports, operations and kinds granted

None. A guard is lowered to `@std/object.port.json#make` and `@std/outcome.port.json#refuse`, as RFC 0007's is. There
is one reason word, `transition`, for a move the table does not allow and for a birth outside the initial state
alike: which of the two a caller met is the tree's knowledge and is in the message and the trace, not a second word
every trigger must map (RFC 0007 made the same argument for `invariant`). The word is reserved: a `refuse` node an
author writes with `"reason": "transition"` is refused (M008), so that a mapped `transition` always means the table
spoke. `@storage/store.port.json` is unchanged: `put`, `get`, `find`, `patch`, `newKey` keep their contracts, and
`patch` stays the way to change every field but the state one.

### Checker rules

A new family `M`, `packages/compiler/src/check/machines.ts`, with `checkMachine(judge, machine)` over each document and
`checkMachineSites(judge)` over the graphs, both run in `judgeTree` (`packages/compiler/src/checker.ts`) after RFC
0007's invariant loop and before `checkScenario`: a machine is judged over shapes, stores and graphs already found
well-formed, so an M refusal never repeats an R001, a G or an X2 refusal, and RFC 0007's `sitesOf` and `Narrowing` are
there to be reused. M008 lives in `check/graph-nodes.ts` beside I006, since it judges a node and not a machine.

**Where a record is written.** A **write** is a `run` or `map` node calling a native operation that accepts a value
whose type variable is bound through `resolves` (RFC 0002) to a store collection whose `of` is the machine's shape;
today that is `@storage/store.port.json#put`'s `record`, and the collection is the pair the call's static `store` and
`collection` name. The compiler never names `@storage`: a plugin of RFC 0023 that accepts a stored record through the
same `resolves` is a write too, which is what a copy of a record kept elsewhere should be. A **record read** is a value
answered by a call of the same collection through `resolves` (`get`'s `record`, `find`'s element, `put`'s and `patch`'s
`record`), followed through `make` with `value: {{x}}` whole (RFC 0007's pass-through) and through a `map`'s `item`.
The **provenance** of the written value, followed the same way, decides what the write is:

| provenance of `record` | the write is | judged |
|---|---|---|
| a record read of the same collection, unmodified | a rewrite | not at all |
| a `merge` whose `base` is a record read of the same collection and whose `over` does not name the state field | a rewrite | not at all |
| a `merge` whose `base` is a record read of the same collection and whose `over` names the state field | a **move**; `old` is the base, `new` the result | M005, or guarded |
| a `make` whose `value` is an object written in place (each field a literal or a read) | a **birth**; `new` is the value | M005, M007, or guarded |
| anything else: the graph's `in`, a record read of another collection, a `merge` over a value that is not a record read, a `make` retyping a value made elsewhere | unjudgeable | M006 |

A move whose `over` sets the state to a literal is a move **to** that state; one that reads it (`{{in.status}}`) is a
**dynamic** move. `old`'s state is known when a `switch` routing to the merge, directly or through a node it reads,
established `record.status == '<s>'` or a disjunction of such about the value the merge is over (`Narrowing` from RFC
0007, collecting every conjunct; the rename from the switch's `in` alias to the base is the one `provedBy` makes for
`has()`), and unknown otherwise.

**Proof and violation.** A birth is *proved* when its state is the literal `initial`; a *violation* (M005) when it is
another literal; *guarded* when it is a read. A move to a literal state `t` is judged against the transitions ending in
`t`: none exist, M005; `old`'s state is known and no such transition leaves it, M005; `old`'s state is known, one
transition leaves it and its `when` is proved (its every conjunct is literal-true over the merge's literal fields, or
narrowed by the same switch), the move is *proved*; otherwise *guarded*. A dynamic move is always guarded, unless
`old`'s state is known to be one no transition leaves, which is M005 whatever `new` is. What is guarded is lowered
(*Runtime behaviour*).

| Code | Where it lives | Refuses when | Hint |
|---|---|---|---|
| M001 | `checkMachine`, at `over` or `state` | `over` names an edge shape or a non-shape (an unknown path is R001 through `judge.type`; an include's shape L005 through `judge.visible`); `state` is not a field of it, or is optional, or is not a `string` carrying `enum` | `a machine is over a core shape` / `the state is a required string field with an enum: its members are the states; wilanis describe <shape>` |
| M002 | `checkMachine`, at `initial`, `transitions/<name>/from/<i>` or `transitions/<name>/to` | the value is not a member of the field's `enum` | `the states are <members>` |
| M003 | `checkMachine`, at `transitions` or `transitions/<name>` | a member other than `initial` no transition reaches (a state a record can never be in); or a transition's `to` is in its `from` (a move to where it stands is a rewrite and needs no transition) | `add a transition into '<state>', or remove it from the enum` / `remove '<state>' from from, or remove the transition` |
| M004 | `checkMachine`, at `transitions/<name>/when` | the rule does not parse (`expr.parse`) or does not type-check (`expr.check`) with `Inputs` of two roots, `old` and `new`, each the shape's fields (optional fields optional); or it reads `old.<state>` or `new.<state>`, which `from` and `to` already say; the message is the `ExprError` | `the roots are old and new, each with the fields: <names>; the states are from and to` |
| M005 | `checkMachineSites`, against the graph, at `nodes/<id>` | a birth whose state is a literal other than `initial`; a move to a literal state no transition ends in; a move whose known old state no transition ending in `to` leaves; a `when` whose every root is literal and evaluates false | `write "<state>": "<initial>", or make this a move: read the record and merge the change` / `'<label>' has no transition to '<t>': add one, or route on the old state` / `'<label>' has no transition from '<s>' to '<t>'` |
| M006 | `checkMachineSites`, against the graph, at `nodes/<id>/in/<field>` | the written value's provenance is none of the table's first four rows | `read the record with #get and merge the change over it; or make the record whole, born '<initial>', and put it with "replace": false` |
| M007 | `checkMachineSites`, against the graph, at `nodes/<id>/in/replace` | a birth is put with `replace` absent or true and the record's key field is not read from a call of the same collection answering the key type through `resolves` (`newKey`): a birth over an existing record is a move the table never saw | `key it by #newKey, or set "replace": false and route on conflict` |
| M008 | `check/graph-nodes.ts`, at `nodes/<id>/in/reason` | a `refuse` node's static `reason` is `transition` | `choose another word; 'transition' is what a guard the machine lowers refuses with` |
| M009 | `checkMachine`, at `transitions/<name>` | no site could perform the transition: no move to its `to` and no dynamic move over the shape, in any graph, under any profile, like I003 for an invariant that constrains nothing. **A document the loader marked `included` is exempt**, as I003's is | `remove it, or write the graph that performs it` |
| M010 | `checkMachine`, against the later document, at `over` | two machines name the same shape and the same `state` field | `one lifecycle per field; merge the tables` |

What is not added. Two machines over one shape and different fields are allowed: an order's `status` and its
`payment` are two lifecycles. Two transitions with the same `to` and overlapping `from` are allowed; the guard is their
disjunction. A `when` on a birth does not exist: a birth is judged by RFC 0007's field invariants on the shape. `remove`
is not a site (*Open questions*). And no rule reads a `patch`: that is X2nn, below.

**One rule in `@storage`**, `packages/plugin-storage/src/rules.ts`, the next free code in the band RFC 0003 and RFC
0015 extend (X2nn here), beside RFC 0003's rules over `changes`: a `patch` whose `changes` names the `state` field of a
machine over the collection's shape is refused, at `nodes/<id>/in/changes/<field>`, with the hint `the state moves by
put of the record read and merged: wilanis describe <machine>`. The plugin reads the machine documents of the tree
through `PluginCheckContext` as it reads store documents for X204; core's `MachineDoc` is all it needs to know.

### Runtime behaviour

**Sites.** `sitesOf` in `packages/compiler/src/sites.ts` (RFC 0007) gains a third kind of site beside made and taken:
a **write site**, found by the `resolves` rule above, with the provenance of its value classified as in the table. The
classification is a function of the graph and the store documents alone, in `packages/compiler/src/provenance.ts`
(new, pure): `provenanceOf(scope, graph, value) → { kind: 'read' | 'merge' | 'make' | 'other', base?, over?, node }`.
`checkMachineSites` and the compiler call the same function, so the two cannot disagree about which node is a move.

**Lowering a guard.** In `Compiler.lowerGraph` (`packages/compiler/src/compiler.ts`), after every node is lowered, each
guarded move `id` (the `merge`) becomes RFC 0007's four kernel nodes with the table as the switch:

```
id:made      the merge, as lowered
id:check     switch  in: { old: <the merge's base, as lowered>, new: {{id:made}} }
                     rules: one per transition ending where the move may end, in declaration order,
                            label: <transition name>
                            when: (old.status == 'a' || old.status == 'b') && new.status == 't' [&& <when>]
                     else: 'id:violated'
id           call    @std/object.port.json#make  value: {{id:made}}  type: <shape>
id:violated  call    @std/outcome.port.json#refuse  reason: 'transition'  type: <shape>
                     message: "'<label>' allows no move from '{{id:made:old.status}}' to '{{id:made.status}}'"
```

For a move to a literal state the rules are those transitions alone and `new.status == 't'` is dropped as known; for a
dynamic move they are every transition. A rule's `label` is the transition's name, which is what `KSwitch.rules[].label`
is for and what the rehearsal prints. A guarded birth `id` (the `make`) is the same with one rule, labelled `born`,
`new.status == '<initial>'`, and the message `"'<label>' says a record is born '<initial>', not '{{id:made.status}}'"`.
Every read of `{{id...}}` elsewhere is unchanged, since `id` still answers the value; where `id` is an `out.from`
candidate, `id:violated` is appended after it (`outputCandidates` in `documents.ts`); `redact` carries over. A move
inside a `map` (a `find`, then one merge and put per element) is guarded in the nested spec, as RFC 0007 guards a list
element by element. The reason joins the walk: `graphRefusals` in `packages/compiler/src/refusals.ts` adds
`{ reason: 'transition', file: graph, node: id }` for each guarded write, so T005 holds every trigger reaching one to map
`transition`, through however many domain operations lie between (`refusalsReachable` follows a `call` into its bound
graph), and T006 refuses mapping it where nothing is guarded. A proved write adds nothing.

**The engine** learns nothing: a guard is a `switch` and two `call`s, and the `in` operator and `||` it needs are in
the grammar (`packages/core/src/expr`). `@std/object.port.json#merge` and `#make` are unchanged.

**Races.** Two moves from one state, at once, on one record: both read `observed`, both guards pass, the second `put`
wins. This RFC adds nothing for it, on purpose: RFC 0004 is where a `get`-then-`put` pair becomes one transaction, and
a graph that performs a move marks itself `"atomic": true` where its connection can carry that (the memory engine
cannot, and L0n3 says so). The template's paragraph says it in one sentence; whether the checker should say it is
*Open questions*.

**Rehearsal.** A guard is a switch, so the branch solver (`packages/runtime/src/solve.ts`) inverts each rule as it
inverts any rule and the walk (`rehearse.ts`) tries each transition and the else; the stubbed `get` is where the
solver puts the old state it needs. `rehearsal-report.ts` prints a move's guard with the header `move '<id>' <label>`
and a birth's with `birth '<id>' <label>`, its branches named by the rules' labels (the transition names, `born`) and
`violated`, and one summary line per machine after the branch summary:
`'<label>' (<n> transitions): born at N site(s) (P proved); moved at M site(s) (Q proved, R guarded); every transition
performed` -- or `'<name>' performed nowhere` for each M009 an include's exemption let through. `fuzz --edges` (RFC
0018) already writes one case per member of an enum for a trigger's input, so a dynamic move's every state arrives
from the edge; `regress` replays them. `run --seed`, `start` and the embedder change nothing: a guard is inside the
graph, where a value made by another graph meets it too.

**Reload.** A machine edited while `start` runs is a document change like any other: `@reload` checks and serves the
tree again, and a graph whose move the new table refuses is a refusal of that check, printed with its M code.

### Discoverability

- `wilanis describe <machine>` (`packages/runtime/src/discovery.ts`, a new `machineLines`, dispatched from `kindBody`)
  prints the shape, the field and its members with the initial marked, then one block per transition:
  `flag  observed → flagged`, indented under it `performed at <graph>#<node>  (proved by '<switch>' | guarded)  reached
  by <operation> (<trigger>)` per site, and after the transitions `born at <graph>#<node>  (proved | guarded)` per
  birth. `describe <shape>` (`shapeLines`, the "made or written by" list) gains `lifecycle  <machine>  state: <field>`.
  `describe <graph>`, once RFC 0007 gives it a case, marks a guarded node `(move: <machine>)` or `(birth: <machine>)`.
- `wilanis map` prints, under a trigger's `fires` tree, `moves  <machine>  <transition names>` beside the node that
  performs a move, so a reader of the CLI sees which routes change state.
- `wilanis ls machine` lists them.
- `wilanis describe --json` and `rehearse --json` (RFC 0019) carry a `machines` array: `{ path, label, over, state,
  initial, transitions: [{ name, from, to, when?, sites: [{ graph, node, how, reached: [...] }] }], births: [...] }`.
  The fields join the envelope's promise from 1.0.
- The viewer: `machineView` in `packages/view/src/model.ts` builds the same structure, and `renderDocPage` in
  `packages/view/client/index.html` gains `case 'machine'`, which draws the **diagram**: one box per state laid out by
  distance from `initial` (left to right, `initial` marked with a dot), one arrow per transition labelled with its
  name and `when`, a title on each arrow listing its sites; clicking an arrow lists them below with proved or guarded
  and the triggers that reach them. It uses `drawGraph`'s `svg`, `txt` and `withTitle` helpers and adds no library.
  On a graph's canvas, a guarded write carries a badge naming the machine and, for a move, the transitions it may take
  (`flag`, or `4 transitions`); a proved one a lighter badge saying how; double-clicking opens the machine's page. The
  shape page lists its machine beside the fields and the invariants RFC 0007 lists there.

### Plugin contract

None. `PluginModule`, `PluginCheckContext` and `PostLoadContext` are unchanged; the one X rule is written with what a
plugin's `check` already receives.

## Compatibility

Additive to IR v1: one new kind, no change to any existing schema. Every document written before this RFC validates
and means what it meant. Three behaviours change for a tree that adds a machine, and only for it: every graph that
writes a record of the shape is judged by the table, so a graph the checker accepted may now be M005, M006 or M007,
which is what declaring the table is for; T005 may newly require the reason `transition` on triggers reaching a
guarded write; and a `refuse` node with `"reason": "transition"` is M008. No tree in this repository has one. A shape
that gains its state field on a store with rows needs `defaults` on the collection (RFC 0003) or a `wilanis migrate`
plan (RFC 0017) whose step is additive; the machine itself touches no database. Until 1.0 is published, v1 may change
in place; after it, a breaking change goes to `schemas-v2` (RFC 0008).

## Tests

Sabotage tests in a new `packages/runtime/test/sabotage-machines.test.ts`, through `sabotage` and `codes` from
`example-harness.ts`, once the example carries the machine, the two operations and the two triggers:

- M001: `over: "@monitor/edge/EntryView.shape.json"`; `state: "url"` (a string without an enum); `state: "note"`
  (optional); `over: "@monitor/domain/nope.shape.json"` → `['R001']`.
- M002: `initial: "new"`; `flag.from: ["seen"]`; `resolve.to: "closed"`.
- M003: remove `flag` and `reopen` (nothing reaches `flagged`); `dismiss.from: ["observed", "dismissed"]`.
- M004: `when: "has(new.quantity)"`; `when: "new.url > 3"`; `when: "len(new.url) >"`; `when: "new.status == 'resolved'"`.
- M005: `create-record.graph.json`'s `entry` with `"status": "flagged"` (a birth outside the initial state);
  `flag-record.graph.json`'s merge with `"status": "observed"` (no transition ends there); the same merge left at
  `flagged` after a switch establishing `record.status == 'resolved'` with `reopen` removed (no transition from there);
  `review-record.graph.json` made a literal `resolve` with `"note"` absent from `over` and the base's `note` known
  absent by `!has(record.note)` on the routing switch (a `when` false over what is known).
- M006: a `put` of `{{in}}` in a data graph taking `Entry`; a `merge` whose `base` is `{{in}}`; a `put` of a record
  read from a second collection of another shape's store.
- M007: `create-record.graph.json` with `"id": "{{in.id}}"` in place of `{{key}}` and no `replace`; the same with
  `"replace": false` passes.
- M008: `reason: "transition"` on `get-record.graph.json`'s `missing` node.
- M009: add `"archive": { "from": ["resolved"], "to": "archived" }` with `archived` in the enum and no graph moving
  there, with `review-record.graph.json`'s merge made literal `"status": "flagged"` so no dynamic move remains.
- M010: a second machine over `Entry` and `status`.
- X2nn: `update-record.graph.json`'s `patch` with `"status": "flagged"` in `changes`.
- D008: `relocate` the machine to `edge/` or `data/`.
- T005/T006: drop `transition` from `flag-entry.trigger.json`'s refusal table → `['T005']`; map it on
  `get-entry.trigger.json` → `['T006']`; write the narrowing switch into `flag-record.graph.json` and the mapping on
  its trigger becomes `['T006']`, proving the guard is gone.

Behaviour tests in `packages/runtime/test/example.test.ts` and `branches.test.ts`:

- `rehearse` prints `move 'entry' An entry's review  2/2 branches` for `flag-record`, `5/5` for `review-record`, the
  `born` line for `create-record` as proved, and the summary line, for every seed 1 to 8; with the narrowing switch
  written into `flag-record`, its guard line is gone and the summary counts it proved.
- `wilanis run` with the memory engine: `POST /monitor/{id}/flag` on an observed entry answers 200 with `flagged`;
  again, 409 with the message naming `flagged` and `flagged`; `PUT /monitor/{id}/review` with `resolved` and no note,
  409; with a note, 200; with `observed`, 409.
- Compiler: `flag-record`'s spec has `entry:made`, `entry:check` with one rule labelled `flag`, `entry`,
  `entry:violated`, and `entry:violated` in `output`; `review-record`'s check has four rules in declaration order;
  `create-record`'s spec has none of them.
- `describe` of the machine, of `Entry.shape.json` and of `flag-record.graph.json` print the lines above; `map` prints
  `moves` under the two triggers.

Scaffolds, in `packages/runtime/test/scaffolds.test.ts`: `new machine` over `Entry` and `status` writes the four-member
chain and refuses without `--over`; `new resource features/tickets/Ticket` in a copy of the example writes the
nineteen files, appends the effects, and the tree then checks with no refusal and rehearses every branch; run twice it
refuses on the first existing file and writes nothing.

`packages/core/test/validate.test.ts` gains the baseline machine and the refusal of one with no transitions, a
non-ident transition name, and a `from` that repeats. `packages/plugin-storage/test/rules.test.ts` gains the X2nn
sabotage. `packages/view/test` gains the machine page of the example and the badge on `flag-record`'s canvas.
`libraries/access/test` is unchanged: the access tree ships no machine.

## Implementation plan

1. **The kind.** Schema, `MachineDoc`, `Kind`/`KINDS`, `HOME`, the template row and paragraph, the `wilanis new
   machine` scaffold, the validate baseline. `area:core`, `area:runtime`. `good first issue`: the `CLAUDE.md` recipe.
2. **The example.** `status` and `note` on `Entry`, `defaults` on the store, `EntryReview`, `flag` and `review` on the
   port, the two data graphs, the two triggers with `transition` mapped, the two operations added to RFC 0007's access
   invariant. `area:runtime`. Lands with 4; until then the example has no machine and nothing judges the new graphs.
3. **Provenance.** `provenance.ts`, the write site in `sitesOf`, with tests over the example's graphs: `create-record`
   is a birth keyed by `newKey`, `flag-record` a move to `flagged`, `update-record` a rewrite. `area:compiler`.
4. **The table.** `check/machines.ts` with M001 to M004, M009, M010; the `judgeTree` order; the sabotage tests.
   `area:compiler`.
5. **Sites judged.** M005, M006, M007 over provenance and `Narrowing`; M008 in `graph-nodes.ts`; their sabotage tests.
   `area:compiler`.
6. **Guards.** The lowering in `compiler.ts`, the rule labels, `transition` as a reachable reason, the compiler tests
   on the lowered specs; the T005 and T006 rows. `area:compiler`.
7. **`@storage`'s rule.** X2nn and its `rules.test.ts` row. `area:plugin-storage`. `good first issue` after 1.
8. **Rehearsal.** The `move` and `birth` headers, the branch names, the summary line; the `example.test.ts` rows.
   `area:runtime`.
9. **Discoverability.** `machineLines`, the `shapeLines` line, `map`'s `moves`, `ls`, the `--json` fields.
   `area:runtime`. `good first issue` after 4.
10. **The viewer.** `machineView`, the diagram, the canvas badges, the shape page's line. `area:view`.
11. **The resource scaffold.** `new resource`, its refusals, the `feature.json` edit, the test that its output checks
    clean and rehearses. `area:runtime`. Independent of 3 to 10; needs RFC 0002's plugin to exist.
12. **A milestone.** `docs/roadmap.md` gains one under the heading the maintainer chooses: `wilanis new resource`
    into a fresh feature, `check` clean; then a machine over the resource, one route refused as M006, the fix, and
    `rehearse` printing the table walked. This RFC leaves *Unscheduled* when it lands.

## Drawbacks and alternatives

- **A kind that is neither graph, shape, contract nor wiring.** The stub named this cost and it stands: a machine is
  a table, and it is the first document the compiler reads to change graphs it did not write beyond what an invariant
  does. It is taken because the alternative the stub offered -- a `wilanis new machine` scaffold that writes the
  switches, and a transition invariant of RFC 0007 that checks them -- gives up the two things the construct is for.
  A scaffolded switch is five copies of the table that drift; and RFC 0007's own text says a transition rule "is
  better stated once against a lifecycle than against every write" and stops there, because without the table the
  invariant cannot say which writes are births, which are moves and which are neither. The table is the smallest
  document that can.
- **Inferring the write, not naming it.** The compiler decides what a node is by following where its value came
  from, and an author who writes a move some other way -- a `make` copying the record field by field with a new
  status, a `patch` of the state -- meets M006 or X2nn rather than a guard. The alternative, a node or an input that
  *names* the transition it performs (`"transition": "flag"` on the merge, or a `@std` `move` operation), would let
  the author say what they mean and let the compiler stop guessing. It was rejected because it puts the construct
  into the graph's vocabulary: every graph that moves a record would carry a word the engine does not know, the
  viewer would show a node that is not a node, and the bar the stub set -- that the lowered graph is one an author
  could have written -- would be missed by the source itself. Provenance is a small language (read, merge, make) and
  the hints teach it in one line each.
- **One form of move.** `patch` is the natural way to write `status = flagged`, and this RFC refuses it for the state
  field. The reason is the old value: a `patch` carries none, and a transition judged only on its `to` is half a
  table. The cost is one `get` and one `merge` where a `patch` would do, and one race the author closes with `atomic`
  (RFC 0004). The alternative -- a compare-and-set on `patch`, `expect: { status: { in: [...] } }`, filled in by the
  compiler -- would make the compiler write a `@storage` input, which is the seam this repository does not cross.
  *Open questions* keeps the door open for a `patch` after a `get` of the same key.
- **A guard is not a catch.** RFC 0014 wondered whether a machine's transitions would want to catch a refusal by
  reason. They do not: the guard is a `switch` over `old.status`, and an author who wants to route an illegal move
  somewhere other than a 409 writes that switch, at which point there is no guard to catch. The dataflow walk RFC
  0014 deferred stays deferred.
- **No saga.** RFC 0011 and RFC 0012 sent compensation here, and this RFC declines to make it a construct. A
  cross-system process as a record with a state is the design every durable workflow engine converges on, and it
  falls out of this RFC with nothing added: the states are the steps, each transition is an effect an operation
  performs, `when` says what a step needs (`has(new.charge)` before `shipped`), compensation is a transition to a
  state named for it, and a worker moves what is stuck. What it does not give is a runtime that drives the process
  for you; that is RFC 0009's worker, declared, and the author's to write.
- **Cost of a guard.** Four kernel nodes per guarded write and one reason on every trigger that reaches it, as RFC
  0007 priced its guards; a table with many transitions is one switch with many rules, not many switches. Proving
  removes the price, and M005 is where a table and a graph disagree at check time, which is the cheapest place.
- **The measurement the stub asked for** -- how big generated trees really are, and where their nodes pile up -- is
  not made here. The resource scaffold answers the node-count fear directly whatever the count turns out to be, and
  the machine's claim rests on RFC 0007's deferred class and the rehearsal, not on size. *Open questions* says whether
  that should gate acceptance.

## Open questions

To decide before `accepted`:

1. **Measure first, or not.** The stub said to measure generated trees after RFC 0002 before deciding. Recommendation:
   accept without the measurement, since the two deliverables answer different questions -- the scaffold the size of a
   tree, the machine a rule no size of tree can state -- and record the measurement as the first task of the
   milestone (step 12), so the roadmap's demo shows the before and after of `wilanis new resource` on a real feature.
2. **`patch` after `get`.** As written, a `patch` of the state field is X2nn, full stop. The alternative allows it as
   a move when a `get` of the same collection with the same `key` read stands in the graph, with the old value that
   `get` answered; `provenance.ts` can find it syntactically. Recommendation: refuse in the first cut, and widen only
   with a failing example, as RFC 0007 widened narrowing.
3. **Atomic moves.** Whether a graph performing a move on a connection whose kind is `transactional` must declare
   `atomic` (a new L rule) or is merely told to in the template. Recommendation: the template; a rule would make every
   move on the memory engine a refusal, and RFC 0004 already tells an author when `atomic` can be had.
4. **Removal.** A record is removed in any state. A machine could say which states may be left by removal
   (`"final": ["resolved", "dismissed"]`), making `remove` a site guarded on the old state. Recommendation: defer to a
   later RFC if anyone asks; nothing here forecloses it, and the example does not need it.
5. **The answer to the stub's second question** -- the table on the shape, or its own document -- is its own document,
   for RFC 0007's reasons (a shape is a type; a rule has a label, a description, a page and a place in the checker's
   output; an include ships it). Recorded here so the question is not reopened.

To decide during implementation:

6. Whether a dynamic move's `else` message names the transitions that were possible from the old state, which the
   check switch knows; it costs nothing and helps a caller.
7. Whether the `resource` scaffold's `list` graph accepts `limit` and `offset` from the start, or a bare `find`; the
   test that its output rehearses every branch decides how much a bare scaffold should carry.
8. The exact `--json` field names, settled beside RFC 0019's when the two meet in code.
