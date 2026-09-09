# RFC 0004: Atomic graphs: transactions as a property of a data graph

- **Status:** draft
- **Milestone:** A credible backend
- **Areas:** `area:core`, `area:compiler`, `area:runtime`, `area:plugin-storage`
- **Tracking issue:** #6
- **Depends on:** RFC 0002 (the storage plugin: the first effects that can take part in a transaction)

## Summary

A graph may declare `"atomic": true`. Every effect it reaches then runs inside one transaction on one
connection: the graph's answer commits it, and a declared refusal or a fault rolls it back. Nothing new is
added to the language -- no transaction node, no begin or commit operation -- and the engine learns nothing.
The checker refuses an atomic graph whose effects could not be one transaction: two connections, an effect
that cannot take part (an HTTP request, a file), a map that collects failures. Kysely executes the
transaction underneath the storage plugin; wilanis knows *what* must be transactional.

## Motivation

The example's `import` takes a CSV of drafts and records each row through `monitor.submit`, all at once
(`example/features/monitor/domain/import-entries.graph.json` fans out through a `map`). When the fifth
draft refuses, the first four are already stored. Today nothing in the tree can say "all of these or none":
an author would have to write a graph that removes what it recorded, and remember every path that can fail.
An agent writing the tree will not remember. Once RFC 0002 gives a tree a real store, this becomes the
first bug every generated application has.

The engine is stateless and concurrent by design (`packages/engine/src/run.ts` fires every ready node at
once), so a transaction cannot be a pair of nodes an author sequences by hand: two effect nodes with no
data dependency run together, and a `commit` node would race them. Atomicity has to be a property of the
scope a graph runs in, opened before its first node and settled after its last.

This RFC does not try to make effects on two systems atomic (charge a card, then store the order). That
is compensation, a saga, and belongs to RFC 0011 (retry and idempotency semantics). It also does not add
savepoints: see Drawbacks.

## Guide-level explanation

**Atomic.** A graph that says `"atomic": true` succeeds or fails as one. While it runs, every effect it
reaches on its connection is inside one transaction. When the graph answers, the transaction commits. When
a node refuses on purpose, or breaks, the transaction rolls back and nothing the graph did is kept.

The import, made atomic, is two graphs where today there is one. The blob is read outside the
transaction, since a file is not something a database can roll back; the recording is inside it:

```json
{
  "$schema": "@wilanis/graph.schema.json",
  "label": "Record all drafts",
  "description": "Every draft recorded, or none: a draft that refuses rolls back the rows recorded before it.",
  "atomic": true,
  "in": "@monitor/domain/EntryDraft.shape.json[]",
  "out": { "type": "@monitor/domain/Entry.shape.json[]", "from": "recorded" },
  "nodes": [
    {
      "type": "@wilanis/node/map.schema.json",
      "id": "recorded",
      "label": "Record each draft",
      "run": "@monitor/domain/monitor.port.json#submit",
      "over": "{{in}}",
      "bind": { "url": "url", "method": "method", "ua": "ua" }
    }
  ]
}
```

`record-all` is a domain graph: it names domain operations and knows nothing about the store. The
transaction it declares spans whatever the profile's binding runs for `submit` -- with RFC 0002's storage
binding, one `@storage/store.port.json#put` per draft, all on the connection that
`@monitor/data/entries.store.json` names. The map
still fans out in the graph; on the connection the writes are paced to one transaction, the way a
`throttle` paces a map's requests against an HTTP connection today.

A data graph may be atomic too. This one behind `monitor.record` stores the entry and records it as the
latest call of its method, in a second collection of the same store, and answers the entry only when both
are in:

```json
{
  "$schema": "@wilanis/graph.schema.json",
  "label": "Store an entry and its method's latest",
  "description": "The entry and the latest-call record of its method move together.",
  "atomic": true,
  "in": "@monitor/domain/Entry.shape.json",
  "out": { "type": "@monitor/domain/Entry.shape.json", "from": "stored" },
  "nodes": [
    {
      "type": "@wilanis/node/run.schema.json",
      "id": "stored",
      "run": "@storage/store.port.json#put",
      "in": {
        "store": "@monitor/data/entries.store.json",
        "collection": "entries",
        "type": "@monitor/domain/Entry.shape.json",
        "record": "{{in}}"
      }
    },
    {
      "type": "@wilanis/node/run.schema.json",
      "id": "latest",
      "run": "@storage/store.port.json#patch",
      "in": {
        "store": "@monitor/data/entries.store.json",
        "collection": "latest",
        "type": "@monitor/domain/Latest.shape.json",
        "key": "{{in.method}}",
        "changes": { "url": "{{in.url}}", "entry": "{{in.id}}" }
      }
    }
  ]
}
```

The operations are RFC 0002's: `put { store, collection, type, record }` and
`patch { store, collection, type, key, changes }`. Neither names a connection; the `store` document does.
This RFC needs only that they declare `transactional` and that their static `store` leads the checker to
one connection.

Mark the wrong graph atomic and the checker says why it cannot be:

```
L0n1  @features/monitor/domain/import-entries.graph.json#nodes/drafts
    atomic graph reaches '@blob/csv.port.json#parse', which cannot take part in a transaction
    → read the file in the caller and make the graph that writes the store atomic instead
```

## Reference

### Documents and schemas

- `graph.schema.json` gains `atomic` (boolean, optional, default false): "Every effect this graph reaches
  runs in one transaction on one connection: its answer commits, a refusal or a fault rolls back." `GraphDoc`
  in `packages/core/src/model.ts` gains `atomic?: boolean`. Allowed on domain and data graphs alike (see
  Drawbacks for why not on the binding).
- `port.schema.json` gains `transactional` (boolean, optional) on an operation, beside `pure`, `refuses`
  and `holds`: "True when running it can take part in the transaction of an atomic graph. Such an operation
  accepts a static field the checker resolves a connection from: `connection`, the path of a connection
  document, or `store`, the path of a store document that names one. A plugin grants it." `Operation` in
  `model.ts` gains `transactional?: boolean`.
- `packages/runtime/templates/CLAUDE.md`: the `graph` row gains "`atomic` when its effects commit or roll
  back together"; the `port` row gains `transactional` in the list of operation flags.
- Placement: unchanged; `HOME` in `placement.ts` already puts graphs in `domain/` and `data/`.
- `wilanis new graph`: unchanged; `atomic` is one key an author adds.

### Ports, operations and kinds granted

None by this RFC. The storage plugin (RFC 0002) marks its writes and reads `transactional: true` in
`packages/plugin-storage/docs/store.port.json`. `@http/http.port.json#request`, `@blob/csv.port.json#parse`,
`@blob/csv.port.json#write`, `@blob/text.port.json#*` and every `@auth` operation stay as they are: not
transactional.

### Checker rules

Numbers are placeholders; the implementing pull request takes the next free code of each family (today
A006 B008 C002 D010 G013 L008 P003 R001 S001 T006). "Reaches" means: an effect node of the graph itself,
or, for a domain graph, an effect node of the graph its operations are bound to under the profile being
judged, followed through nested domain operations. The walk is the one `judgeTree` already does per profile
for B002.

**Resolving the connection.** A transactional call names its connection in one of two static fields, and
the compiler resolves both without plugin knowledge: `connection` is a connection document's path;
`store` is the path of a `store` document, a core kind since RFC 0002, whose `connection` field names one.
One method of `Judge` answers it, `Judge.connectionOf(hit, given)`: the canonical connection path, or
nothing when the field is absent or names no document. It reads the store through
`scope.get('store', path)`, the same read RFC 0003's `check/stores.ts` makes, and relies on that module's
R001 (a store whose `connection` names nothing) so it never refuses the same thing twice. The storage
plugin's X rules judge what a call means to the store; the compiler judges only where it goes.

| Code | Where it lives | Refuses when | Hint |
|---|---|---|---|
| C0n1 | `check/contracts.ts` | an operation declares `transactional: true` and accepts neither a `static` field named `connection` nor one named `store` | `a transactional operation says where it goes, statically: accept "connection" (a connection document) or "store" (a store document that names one), marked "static": true` |
| L0n1 | `check/graph.ts`, `checkOperationFits` | an atomic graph reaches an effectful operation that is not `transactional` and not `pure` (`@http/http.port.json#request`, any `@blob` operation, `@auth`) | `read or send that outside the transaction: in the caller for a domain graph, in a graph of its own for a data graph` |
| L0n2 | `check/graph-whole.ts` | the transactional effects an atomic graph reaches, grouped by the connection `Judge.connectionOf` resolves for each, fall on more than one connection | `one transaction is one connection; split the graph, or move both stores to one connection` |
| L0n3 | `check/graph-whole.ts` | an atomic graph reaches no transactional effect at all | `nothing here can roll back; delete "atomic"` |
| G0n1 | `check/graph-nodes.ts` | a `map` inside an atomic graph, or inside a graph an atomic graph reaches, declares `onItemFailure: collect` | `a failed element aborts the transaction, so its failure cannot be collected; use "fail", or take the map out of the atomic graph` |

L0n1 and L0n2 are judged for every profile in `project.json → profiles`, since the effects a domain graph
reaches depend on which binding meets each operation; a refusal names the profile. A graph that is not
atomic but is reached from one is judged as part of the atomic graph: the rules apply to the whole scope,
not to the document that carries the flag.

### Runtime behaviour

The engine does not change. `RunContext.env` is opaque to the kernel (`packages/engine/src/spec.ts`) and
`Compiler.nestedRunner` in `packages/compiler/src/compiler.ts` forwards `ctx.env` unchanged into every
nested run, so a value put in `env` at a graph's boundary reaches every handler below it. Two such values
exist already: `env.blobs`, the per-run scope of the blob store the embedder substitutes in `Embedder.fire`,
and `env.hold`, the callback a `holds` operation calls (`Hold` in `packages/core/src/plugin.ts`, pushed onto
`Embedder.held`). The transaction is the third, and follows both precedents.

**The scope.** `packages/core/src/plugin.ts` gains one type beside `Hold`:

```ts
/** What one transaction's participant can do once it is open. */
export interface Participant {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}
/**
 * What an atomic graph's run hands every handler below it, as `env.atomic`. The first transactional operation
 * to run opens the transaction on its connection through `join`; every later one on the same connection gets
 * the same participant. The runtime settles it when the graph's run ends: commit when it answered, rollback
 * otherwise. A handler that is not transactional never reads it.
 */
export interface Atomic {
  join<T extends Participant>(connection: string, open: () => Promise<T>): Promise<T>;
}
```

`join` memoises the *promise* of `open()` synchronously, so two storage nodes the engine started in the same
tick share one transaction rather than opening two. A `join` on a second connection is a fault (the checker
has already refused it; the runtime refuses to be wrong quietly).

**Where it opens.** `Compiler.nestedRunner` is the one place a graph's run begins and ends -- a binding's
graph (`graphCall`) and a graph-bound operation reached from a node (`handlerFor`) both compile to it. For a
graph whose document says `atomic`, the compiler wraps it (a new module, `packages/compiler/src/atomic.ts`,
so `compiler.ts` stays under the file limit):

```ts
const outer = ctx.env.atomic as Atomic | undefined;
const scope = outer ?? new AtomicScope();
const report = await new Kernel(handlers).run(spec, { ...opts, env: { ...ctx.env, atomic: scope } });
if (!outer) await scope.settle(report.status === 'done');
```

`Kernel.run` resolves at quiescence -- `Run.execute` loops until nothing is running -- so no handler is in
flight when `settle` commits or rolls back. A commit that fails throws, so the calling node fails and the
report says so, the way `nestedFailure` reports a nested run today. An atomic graph reached from inside an
atomic scope joins the outer one rather than opening its own: its refusal ends the outer run anyway, since a
nested refusal is the calling node's failure, so a separate transaction would have nothing to preserve.

The compiler learns that a graph is atomic, the way it learns that an operation `holds`
(`Compiler.holdsSpec`). It learns nothing about connections, drivers or SQL: it opens a scope and settles it.

**Who joins.** A handler of a `transactional` operation reads `ctx.env.atomic`; when present, it runs its
statement on `await scope.join(connection, () => this.begin(connection))`, where `connection` is the
canonical path the handler resolved the way it resolves everything else: through the `store` document
`env.canon` and the registry hand it, then `env.connections[canonical]` (RFC 0002, *Handlers*). When the
scope is absent, it runs as it does today, in its own implicit transaction. The storage plugin's `postgres` engine begins a Kysely transaction
and answers a participant whose `commit` and `rollback` are Kysely's; the statements of concurrent nodes are
queued on the one connection the transaction holds, which is what makes a map inside an atomic graph serial
at the store while it stays concurrent in the graph. The `memory` engine (RFC 0002) begins by taking a
copy-on-write view of its collections and commits by swapping it in, so the plugin's tests and the example's
tests exercise rollback without a database.

**The embedder** (`packages/runtime/src/embed.ts`) changes nothing: `Embedder.fire`, `startup` and `decide`
pass `env` as they do, and the scope rides inside. A startup step naming an operation bound to an atomic
graph is atomic too, for free.

**`rehearse`, `fuzz`, `regress`, `run --seed`.** `stubEffects` in `packages/runtime/src/stubbing.ts`
replaces every effectful native handler with a generator that never reads `env.atomic`, so the scope opens,
nobody joins, and `settle` has nothing to do. The rehearsal marks the graph `(atomic)` in the line that names
it and says `rolled back` after a refused branch's outcome (`packages/runtime/src/rehearsal-report.ts`), so a
reader sees which declared refusals undo the store. Nothing else changes: an atomic graph's branches are
solved and walked as any graph's are.

**Cancellation.** An `AbortSignal` that fires mid-run fails the run, so `settle(false)` rolls back.

### Discoverability

- `wilanis describe <graph>` prints `atomic: commits when it answers; rolls back on <the reasons its refuse
  nodes and reached graphs declare>, or a fault` and the one connection the scope holds under the profile.
- `wilanis describe <port>#<op>` lists `transactional` beside `pure`, `refuses`, `holds`.
- `wilanis map` marks a graph `[atomic]` where it names it.
- The viewer's graph page (`packages/view/client/index.html`, `renderDocPage`) shows an `atomic` badge on the
  graph and a marker on each node that takes part; the side panel says the connection. The view model
  (`packages/view/src/model.ts`) carries `atomic` and the connection on the graph entry.

### Plugin contract

`PluginModule` gains no member. The change is the `Atomic` and `Participant` types in `plugin.ts`, read
from `env` by a handler, the way `Hold` and `Serving` are today. This is the smallest change that works
because the scope is owned by the run, not by a plugin: the compiler opens it, the first participant fills
it, the compiler settles it. A `transactions` registry on `PluginModule` keyed by connection kind was
considered (see Drawbacks) and would make the runtime learn which plugin owns which connection, which
nothing else in the runtime does.

## Compatibility

Two optional booleans on IR v1: `atomic` on a graph, `transactional` on a port operation. Every document
written before this RFC validates and means the same. A graph that is not atomic runs exactly as today, and
a transactional operation outside an atomic graph runs in its own implicit transaction as it did. No
`schemas-v2`.

## Tests

Sabotage tests in `packages/runtime/test/example.test.ts`, against the example once RFC 0002 has given it
a storage-backed profile (names as RFC 0002 settles them):

- C0n1: mark `@monitor/domain/monitor.port.json#record` `transactional` (a domain operation with neither a
  static `connection` nor a static `store`).
- L0n1: add `"atomic": true` to `import-entries.graph.json`, which reaches `@blob/csv.port.json#parse`.
- L0n1, domain: add `"atomic": true` to `record-entry.graph.json` under the `live` profile, whose binding
  reaches `@http/http.port.json#request`; the refusal names the profile.
- L0n2: an atomic data graph with two `@storage` nodes on two store documents whose `connection` fields
  name different connections.
- L0n3: `"atomic": true` on `list-entries.graph.json`, which reaches no write.
- G0n1: `"onItemFailure": "collect"` on the map in `record-all.graph.json`.

End to end, in `packages/plugin-storage/test` against the `memory` engine, and in `packages/runtime/test`
through the example's storage profile:

- an atomic graph whose second node refuses leaves the store as it was; the report carries the refusal.
- an atomic graph whose second node faults leaves the store as it was.
- an atomic graph that answers leaves both writes in.
- a map of five drafts where the fourth refuses records none.
- two atomic graphs fired concurrently do not see each other's uncommitted rows (memory engine: isolation
  of the copy-on-write view; postgres, in `packages/plugin-storage/test` behind an environment variable
  naming a database, skipped when absent).
- a commit that fails (memory engine told to fail on commit) fails the calling node and the report says so.
- `rehearse example` prints `(atomic)` and `rolled back` for the new graphs; the branch count is unchanged.
- `describe` and the view model say `atomic` and the connection.

## Implementation plan

1. Schemas and model: `atomic` on `graph.schema.json`, `transactional` on `port.schema.json`, the two
   fields in `model.ts`, the template's rows, the baseline in `packages/core/test/validate.test.ts`.
   `good first issue`.
2. `Atomic` and `Participant` in `packages/core/src/plugin.ts`, with `AtomicScope` (join, settle) in
   `packages/compiler/src/atomic.ts` and its unit test.
3. Checker: C0n1 in `contracts.ts`; L0n1 and L0n3 in `graph.ts` and `graph-whole.ts`; L0n2 with the
   per-profile walk; G0n1 in `graph-nodes.ts`. Sabotage tests for each.
4. Compiler: `nestedRunner` wraps atomic graphs with the scope; a test with a fake transactional handler
   in `packages/runtime/test` proving open, join once, commit on done, rollback on refusal and on fault.
5. Storage plugin: `transactional: true` on its operations, `join` in its handlers, transactions in the
   `memory` and `postgres` engines. Lands with or after RFC 0002's implementation.
6. Rehearsal report: `(atomic)` and `rolled back`. `good first issue`.
7. `describe`, `map`, the view model and the viewer page. `good first issue` for the viewer badge.
8. The example: `record-all.graph.json` behind `import`, `store-and-latest.graph.json` behind `record`
   with a `latest` collection added to `entries.store.json`, under the storage profile, and the README's
   paragraph on atomicity.

## Drawbacks and alternatives

**The flag on the binding instead of the graph.** A binding says how a port is met, and a transaction is
a data-layer mechanism, so the entry `"record": { "graph": "...", "atomic": true }` reads naturally. But
the thing that must be atomic is the composition -- CreateOrder is reserve, create, pay -- and the
composition lives in a domain graph; a binding never sees it. The flag on the graph covers both the domain
graph that composes operations and the data graph that composes statements, with one rule set. The domain
layer does not thereby learn about databases: it says "these succeed or fail together", which is a business
statement, and the checker proves the data layer can honour it.

**A transaction node type, or `begin`/`commit` operations.** Rejected: the engine runs ready nodes
concurrently, so an author would have to thread a dependency through every effect node to keep them inside
the span, and an agent would get it wrong. A scope around the run is the only thing that cannot be
mis-sequenced.

**A `transactions` registry on `PluginModule`, keyed by connection kind.** The runtime would have to
resolve which plugin owns a connection's kind before the run, which today no part of the runtime does --
handlers read `env.connections` themselves. Letting the first participant open the transaction keeps that
knowledge where it is.

**Savepoints (nested atomicity).** A nested graph's refusal is its caller's failure; the language has no
way to route on a nested failure, so a partial rollback could never be observed. Savepoints wait for a
construct that can catch, which does not exist and is not proposed here.

**Cost.** A map inside an atomic graph serialises at the connection: what was N concurrent writes becomes
one transaction of N statements. That is the price of atomicity everywhere, not a wilanis cost. A long
atomic graph holds a connection for its whole run, and a connection pool sized for concurrency is RFC
0002's concern.

## Open questions

Before `accepted`:

- The word: `atomic` (proposed) or `transactional` on the graph as well. `atomic` says what the author
  wants; `transactional` says how. One word for the graph and another for the operation keeps them apart.
- Whether a domain graph may be atomic (proposed: yes, judged per profile). The alternative restricts the
  flag to data graphs and forces CreateOrder-style compositions into the data layer.
- Isolation level: a setting of the storage connection (RFC 0002), or a field beside `atomic`. Proposed: the
  connection's, since it is the store's vocabulary.

During implementation:

- Whether the rehearsal line should also list the reasons that roll back, or leave that to `describe`.
- Whether the viewer marks participating nodes individually or only the graph.
