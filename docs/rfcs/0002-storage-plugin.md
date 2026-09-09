# RFC 0002: The `@storage` plugin: records of a shape behind a generic port

- **Status:** draft
- **Milestone:** A credible backend
- **Areas:** `area:plugin-storage`, `area:core`, `area:runtime`
- **Tracking issue:** #NNN (opened when the RFC is proposed)
- **Depends on:** none

## Summary

A tree can keep records. A feature declares a **store**: which shapes it persists, under which
collection names, keyed by which field, over which connection. Its data graphs read and write those
records through one native port, `@storage/store.port.json`, whose operations speak the shape the
collection declares: `get`, `find`, `put`, `patch`, `remove`, `count`, `newKey`. The plugin ships two
engines behind the same connection kind: `memory`, for development, tests and `libraries/`, and
`postgres`, the first real one, built on Kysely. Kysely is an implementation detail and appears in no
document. Storage means records; `@blob` keeps bytes, as it does today.

## Motivation

Today a tree has no way to keep a value between two requests except by calling something outside
itself. The example's monitor feature stores its entries by `POST`ing them to a public REST API
(`example/features/monitor/data/create-row.graph.json`), and the `@auth` plugin keeps its sessions in
files under `.wilanis/auth` that no document names. An agent asked to "record an order" has nothing to
reach for: it would have to invent an HTTP upstream, or the runtime would have to grow code nobody can
read from the tree.

What the tree needs is the one thing every backend does and no wilanis document can yet say: *this
shape is kept, under this name, by this key*. Once that is a document, the checker can judge every
read and write against it, `rehearse` can stub it like any effect, `describe` and the viewer can show
who writes what, and the same data graphs can run against memory in a test and PostgreSQL in
production.

This RFC does not try to solve: schema constraints beyond the key (unique, relations, defaults) and
the compile-time judgment of filters and partial writes, which are RFC 0003; atomicity across several
operations, which is RFC 0004; where state lives per environment, which is RFC 0005; or deriving
migrations from a changed shape, which is a later RFC. It also does not expose SQL. A raw operation is
sketched under *Drawbacks and alternatives* and is not part of the first implementation.

## Guide-level explanation

**Store.** A document in a feature's `data/` that says what the feature keeps: a connection, and the
collections it holds, each of one core shape (or a shape a plugin grants, so a plugin's records can be kept by the host, see RFC 0005), keyed by one of that shape's fields. A collection is a
table in PostgreSQL and a map in memory; the document never says which.

**Connection, `@storage/storage.connection-kind.json`.** A channel to a storage engine: `engine`
(`memory` or `postgres`) and, for postgres, the URL read from a secret.

**Port, `@storage/store.port.json`.** The operations a data graph runs against a collection. Every one
is an effect: it lives in a data graph and is listed in `feature.json → effects` (L003).

The monitor feature, kept in a store instead of the REST API. The connection, at the tree's root:

```json
{
  "$schema": "@wilanis/connection.schema.json",
  "label": "Entries",
  "description": "Where the monitor's entries are kept. Memory in development; a production profile points the same store at PostgreSQL.",
  "kind": "@storage/storage.connection-kind.json",
  "settings": { "engine": "memory" }
}
```

The store, `example/features/monitor/data/entries.store.json`:

```json
{
  "$schema": "@wilanis/store.schema.json",
  "label": "Entry store",
  "description": "The monitor's entries, one collection, keyed by id.",
  "connection": "@connections/entries.connection.json",
  "collections": {
    "entries": {
      "of": "@monitor/domain/Entry.shape.json",
      "key": "id",
      "description": "every observed call"
    }
  }
}
```

The data graph behind `monitor.port.json#get`, `example/features/monitor/data/get-record.graph.json`.
Compare it with `get-row.graph.json` today: the request and its status become one read and a `has()`:

```json
{
  "$schema": "@wilanis/graph.schema.json",
  "label": "Get a record",
  "description": "Data graph behind monitor.get: read the record by id; absent is the declared refusal.",
  "in": "@monitor/domain/EntryRef.shape.json",
  "out": { "type": "@monitor/domain/Entry.shape.json", "from": ["row", "missing"] },
  "nodes": [
    {
      "type": "@wilanis/node/run.schema.json",
      "id": "asked",
      "label": "Read the entry",
      "run": "@storage/store.port.json#get",
      "in": {
        "store": "@monitor/data/entries.store.json",
        "collection": "entries",
        "type": "@monitor/domain/Entry.shape.json",
        "key": "{{in.id}}"
      }
    },
    {
      "type": "@wilanis/node/switch.schema.json",
      "id": "route",
      "label": "Is it there?",
      "in": { "record": "{{asked.record}}" },
      "rules": [{ "when": "has(record)", "to": "row" }],
      "else": "missing"
    },
    {
      "type": "@wilanis/node/run.schema.json",
      "id": "row",
      "label": "The entry",
      "run": "@std/object.port.json#make",
      "in": { "value": "{{asked.record}}", "type": "@monitor/domain/Entry.shape.json" }
    },
    {
      "type": "@wilanis/node/run.schema.json",
      "id": "missing",
      "label": "No such entry",
      "run": "@std/outcome.port.json#refuse",
      "in": { "reason": "missing", "message": "no entry {{in.id}}", "type": "@monitor/domain/Entry.shape.json" }
    }
  ]
}
```

`get` does not fail when there is no record: it answers `record` absent, and the `switch` decides
what absence means, the way a `switch` on `status` decides what a 404 means today. `rehearse` solves
`has(record)` and runs both branches.

The graph behind `monitor.port.json#record`, `create-record.graph.json`: a fresh key, the record made
from it, the record put. No id is invented by the domain and none is generated silently:

```json
{
  "$schema": "@wilanis/graph.schema.json",
  "label": "Create a record",
  "description": "Data graph behind monitor.record: a new key, the entry made from it, stored.",
  "in": "@monitor/domain/EntryRecord.shape.json",
  "out": { "type": "@monitor/domain/Entry.shape.json", "from": "stored" },
  "nodes": [
    {
      "type": "@wilanis/node/run.schema.json",
      "id": "key",
      "run": "@storage/store.port.json#newKey",
      "in": { "store": "@monitor/data/entries.store.json", "collection": "entries" }
    },
    {
      "type": "@wilanis/node/run.schema.json",
      "id": "entry",
      "run": "@std/object.port.json#make",
      "in": {
        "value": { "id": "{{key}}", "url": "{{in.url}}", "method": "{{in.method}}", "ua": "{{in.ua}}" },
        "type": "@monitor/domain/Entry.shape.json"
      }
    },
    {
      "type": "@wilanis/node/run.schema.json",
      "id": "stored",
      "run": "@storage/store.port.json#put",
      "in": {
        "store": "@monitor/data/entries.store.json",
        "collection": "entries",
        "type": "@monitor/domain/Entry.shape.json",
        "record": "{{entry}}"
      }
    }
  ]
}
```

`listByMethod` becomes one `find` with a declared filter, `{ "where": { "method": "{{in.method}}" } }`;
`listAll` a `find` with none; `update` a `patch` of `url` and `method` by key; `remove` a `remove` by key,
each followed by the same `has(record)` decision as `get`. The binding
`example/features/monitor/data/monitor-store.binding.json` binds the six storage operations to these
graphs and the business operations (`submit`, `list`, `digest`, `removeMany`, `import`, `export`,
`parseDrafts`, `toCsv`) to the same domain graphs `monitor-rest.binding.json` binds today. A new profile
`local` in `project.json` chooses it; `live` keeps the REST binding. The feature lists what it now reaches:

```json
"effects": [
  "@storage/store.port.json#get", "@storage/store.port.json#find", "@storage/store.port.json#put",
  "@storage/store.port.json#patch", "@storage/store.port.json#remove", "@storage/store.port.json#newKey",
  "@storage/storage.port.json#ensure",
  "@blob/csv.port.json#parse", "@blob/csv.port.json#write"
]
```

The startup step the example already has, `Reach the entry store`, keeps firing
`monitor.port.json#listAll`; a new first step fires `monitor.port.json#prepare`, bound to a data graph
that runs `@storage/storage.port.json#ensure` so the tables exist before anything listens.

The refusal an author meets first, when the `type` at a call site is not the collection's shape:

```
X204  @features/monitor/data/get-record.graph.json#nodes/asked/in/type
    collection 'entries' of @monitor/data/entries.store.json holds @monitor/domain/Entry.shape.json, not @monitor/edge/EntryRow.shape.json
    → set "type": "@monitor/domain/Entry.shape.json"
```

## Reference

### Documents and schemas

**A new kind, `store`.** `packages/core/schemas/store.schema.json`, `$id` under `SCHEMA_BASE`,
`$schema` accepting the URL and `@wilanis/store.schema.json`, with `label` and `description` like every
kind. `StoreDoc` in `model.ts`, `'store'` added to `Kind` and `KINDS`; `validate.ts` picks the schema
up through `KINDS`.

```
store
  connection   path            a connection of kind @storage/storage.connection-kind.json
  collections  object, ≥ 1     ident → collection
    of           typeRef         the path of a core shape, or of a shape a plugin grants; the record type
    key          ident           a field of `of`: required, type string
    description  string          optional
```

Placement: `HOME.store = { layers: ['data'], why: 'a store says how records are kept, which is the data layer's job' }`
in `packages/core/src/placement.ts`; D008 refuses it anywhere else. A row in
`packages/runtime/templates/CLAUDE.md`: `store | what the feature keeps: a connection and collections of a core shape (or a plugin's shape), each by key | data/`.
`wilanis new store <name> --of <shape>` in `scaffolds.ts` writes one collection named after the file,
keyed by `id`, through `into(target, 'data', 'store')`. A `renderDocPage` case in
`packages/view/client/index.html` lists the collections, each with its shape (a link), its key and its
connection, and the graphs that read or write it.

**Existing kinds:** unchanged. `connection` documents of the new kind are judged by the existing C001
and C002 against the kind's settings contract.

### Ports, operations and kinds granted

`packages/plugin-storage/docs/plugin.json` grants two ports, one connection kind and one shape. Its
settings: none in this RFC.

**`@storage/storage.connection-kind.json`**

```
settings
  engine   string, enum [memory, postgres]
  url      string, secret, optional     postgres: the connection URL, read as {{secrets.*}}
  schema   string, optional             postgres: the schema; default public
  pool     { max: number }, optional    postgres: the pool's size; default 10
```

**`@storage/store.port.json`.** Every operation takes `store` (string, `static`: the path of a store
document), `collection` (string, `static`: a key of its `collections`) and, where it speaks the record
type, `type` (`type`, `binds: $T`: the collection's `of`, repeated at the call site so the checker and
the stubs know the type the way they do for `@std/object.port.json#make`; X204 refuses a `type` that
is not the collection's shape). None is `pure`; none `refuses`; none `holds`.

| Operation | Accepts, beyond store/collection | Returns | Answers |
|---|---|---|---|
| `get` | `type`, `key: string` | `{ record?: $T }` | the record, or `record` absent |
| `find` | `type`, `where?: unknown`, `order?: @storage/Order.shape.json[]`, `limit?: number`, `offset?: number` | `$T[]` | the matching records, in order; every record when `where` is absent |
| `count` | `where?: unknown` | `number` | how many match |
| `put` | `type`, `record: $T` | `$T` | the record as stored; inserts, or replaces the record with the same key |
| `patch` | `type`, `key: string`, `changes: unknown` | `{ record?: $T }` | the record after the change, or `record` absent when there was none |
| `remove` | `type`, `key: string` | `{ record?: $T }` | the record that was removed, or `record` absent |
| `newKey` | none | `string` | a fresh key that no record of the collection has: UUID version 7, in both engines |

A `key` is a string because a collection's key field is (X202); numeric keys are an open question.

**The `where` grammar.** A filter is an object whose keys are fields of the collection's shape. A value is
a literal or a read (`"{{in.method}}"`) meaning equality, or a predicate object with one or more of:
`eq`, `ne`, `lt`, `lte`, `gt`, `gte` (the field's type), `in`, `notIn` (a list of it), `has` (boolean:
present or absent, for optional fields), `contains`, `startsWith` (strings). Three combinators sit
beside field names: `all: [where, ...]`, `any: [where, ...]`, `not: where`. Nothing else is a filter; a
field that is a shape or a list may only be tested with `has`. `where` is declared `unknown` so that
the grammar can nest; the handler judges it at run time and fails the node on an unknown field or
operator. Judging it at compile time is RFC 0003.

```json
"where": { "method": { "in": ["GET", "POST"] }, "ua": { "has": true }, "any": [{ "url": { "startsWith": "https://" } }, { "url": { "contains": "localhost" } }] }
```

**`changes`** in `patch` is an object whose keys are fields of the shape other than the key, each a
value of the field's type; a key the shape lacks or a value that does not fit fails the node at run
time until RFC 0003 refuses it at check time. A `patch` never removes a field; absence is written by
`put`.

**`@storage/Order.shape.json`**, layer `edge`: `{ by: string, dir?: string enum [asc, desc] }`.

**`@storage/storage.port.json`**, the engine's own operations, for startup:

| Operation | Accepts | Returns | Answers |
|---|---|---|---|
| `ensure` | `store: string, static` | `{ collections: number }` | creates every collection of the store that does not exist yet, from its shape, and never alters one that does; a no-op on memory |

`ensure` is an effect, not `holds`: a startup step reaches it through a domain port bound to a data
graph, the way the example's `Reach the entry store` step does today (B006 stays as it is).

**How a shape becomes a table (postgres).** Table: the collection name, in the connection's schema.
Column per field, named as the field. `string` → `text`; `number` → `double precision`; `boolean` →
`boolean`; a shape, a list, `unknown` → `jsonb`; `blob` → refused (X201). A required field is `NOT
NULL`; the key is `PRIMARY KEY`. An `enum` is `text`; the handler judges the value against the shape,
not the database. What is read is judged with `conforms` from `@wilanis/core` before it is answered,
as `@blob/csv.port.json#parse` judges a row, so a row written outside wilanis that no longer fits the
shape fails the node rather than reaching a graph.

### Checker rules

The plugin's `check` (X2xx; `@auth` owns X1xx, `@http` X001-X003):

| Code | Where it lives | Refuses when | Hint |
|---|---|---|---|
| X201 | `plugin-storage/src/rules.ts` | a collection's `of` is neither a core shape nor a shape a plugin grants (an edge shape is refused: the world's shape is not what a tree keeps), or the shape has a field of type `blob` (a store keeps records; bytes live in the blob registry) | `wilanis ls shape`; or keep the file in the registry and store its handle's id as a string |
| X202 | same | a collection's `key` is not a field of `of`, or that field is optional or not a string | name a required string field of the shape |
| X203 | same | a `storage` connection's settings do not fit its engine: `postgres` without `url`, `memory` with `url`, `schema` or `pool` | `wilanis describe @storage/storage.connection-kind.json` |
| X204 | same | a call's `store` names no store document, its `collection` is not one of its collections, or its `type` is not the collection's `of` | `wilanis describe <the store>`; set "type" to the collection's shape |
| X205 | same | a store's `connection` is not of kind `@storage/storage.connection-kind.json` | `wilanis ls connection` |

The compiler, generic to every kind (numbers assigned when the implementing PR lands; the current
highest are A006 B008 C002 D010 G013 L008 P003 R001 S001 T006):

| Code | Where it lives | Refuses when | Hint |
|---|---|---|---|
| R001 | `check/contracts.ts`, a new `checkStore` | `connection` or a collection's `of` names a document that does not exist | `wilanis ls connection` / `wilanis ls shape` |
| L0nn | `checkStore`, through `Judge`'s visibility | `of` names a core shape of another feature that feature does not export | add it to that feature's `exports`, or keep the store where the shape is |
| D008 | `placement.ts`, existing | a store outside `data/` | existing |

### Runtime behaviour

**Handlers.** `PluginModule.handlers` maps the seven `store.port.json` operations and `ensure`. A
handler reads the store document through `ctx.env` the way `@http`'s `request` reads a connection
(`connectionOf` in `packages/plugin-http/src/request.ts`): `env.canon` canonicalises the `store` path,
the registry hands the document, `env.connections[canonical]` the connection, `env.resolveType` the
shape. Engines implement one interface, `Engine` (`get`, `find`, `count`, `put`, `patch`, `remove`,
`ensure`), in `src/engines/memory.ts` and `src/engines/postgres.ts`; the handlers know no SQL. A
Kysely instance is made once per connection and kept in a `WeakMap` keyed by `env`, exactly as
`throttleFor` keeps a throttle; `postLoad` opens nothing eagerly and hands back a teardown that
destroys every pool it made. The memory engine is a `Map` per store and collection; it lives as long
as the process and no longer.

**Rehearsal, fuzz, regress.** Nothing changes. Every operation is an effect, so `stubEffects` in
`packages/runtime/src/stubbing.ts` answers a generated value of its return type with `$T` bound from
the call's `type`, and the branch solver reaches both sides of `has(record)`.

**Start.** `wilanis start` runs `postLoad`, then the startup steps; a `prepare` step bound to `ensure`
fails the start when PostgreSQL is unreachable, so the port never opens over a missing store.

**Discovery of effects.** `Judge.effectsOf` and L003 already refuse a storage operation the feature
does not list; nothing to add.

### Discoverability

- `wilanis ls store` lists the stores; `wilanis describe <store>` prints the connection and its engine,
  each collection with its shape, its key and the graphs that run an operation against it (found the
  way `describe` on a session shape lists who writes what).
- `wilanis describe @storage/store.port.json` lays the port out like any native port; every field is
  described in the document, including the `where` grammar.
- `wilanis map` prints a store the way it prints an upstream connection today: `route → port → graph → store entries (get)`.
- The viewer draws a store's page, and a graph node that runs a storage operation links to the store
  and the collection.

### Plugin contract

None. The plugin uses `root`, `docs`, `handlers`, `check` and `postLoad` as they are.

## Compatibility

Additive. One schema file is added and `KINDS` gains an entry, so the D001 hint that lists the kinds
gains a name; no existing document changes meaning. The example gains documents and a profile and keeps
the REST binding. IR v1 stays v1.

## Tests

`packages/plugin-storage/test/`:

- `memory.test.ts`: a small tree loaded with `loadTree` and run through the `Embedder`, as
  `packages/plugin-http/test/harness.ts` does: put, get, find with every operator and combinator,
  order, limit and offset, patch, remove, count, newKey uniqueness, absence answered as `record`
  absent, a row that does not fit the shape failing the node.
- `postgres.test.ts`: the same suite against a database named by `WILANIS_TEST_POSTGRES_URL`, skipped
  when the variable is unset; `ensure` creates the tables and is idempotent.
- `rules.test.ts`: one sabotage per rule, X201 to X205, each breaking the small tree and expecting the
  code, as `packages/plugin-auth/test` does for X101-X103.

`packages/runtime/test/example.test.ts`: the example under the `local` profile rehearses with every
branch settled, and `startup.test.ts` runs `prepare` before `listen`. `packages/core/test/validate.test.ts`:
the `store` baseline. The compiler's new rows are exercised through sabotaged copies of the example in
`packages/runtime/test/sabotage.test.ts`.

## Implementation plan

1. **The `store` kind in core.** Schema, `StoreDoc`, `KINDS`, `HOME`, the validate baseline, the row in
   `templates/CLAUDE.md`, the `wilanis new store` scaffold. `good first issue` for the scaffold and the row.
2. **`checkStore` in the compiler.** References resolve, the shape is visible; sabotage tests.
3. **The package.** `packages/plugin-storage`: `docs/` (plugin.json, connection kind, the two ports,
   `Order.shape.json`), the module, the `Engine` interface, the memory engine, the handlers, the
   `where` evaluator, `memory.test.ts`. Workspace member; added to `npm run release` after `plugin-auth`.
4. **The plugin's rules.** X201 to X205 and `rules.test.ts`.
5. **The postgres engine.** Kysely with `pg`: the shape-to-table mapping, `ensure`, the operations, the
   filter compiled to Kysely expressions, `postgres.test.ts` behind the environment variable.
6. **The example.** `entries.connection.json`, `entries.store.json`, the store binding and its data
   graphs, the `local` profile, the `prepare` operation and step; the example's README.
7. **Discoverability.** `ls store`, `describe` of a store and of the port, `map`, the viewer page.
   `good first issue` for the viewer page.
8. **Documents.** The README's *words* section gains *Store*; `templates/CLAUDE.md` gains the rule
   about absence answered as `record` absent; the package's README.

## Drawbacks and alternatives

- **`type` repeated at every call site.** The store already knows the collection's shape, so `type`
  is redundant and X204 exists only to keep the two in step. It is the price of leaving the type system
  alone: `binds: $T` on a `type` field is how every native operation declares what it answers, and the
  stubs, the checker and `describe` all read it. The alternative, a `binds` that looks a variable up in
  another document, is a core change this RFC does not want to carry. Revisit if RFC 0003 makes the
  store the checker's source of truth anyway.
- **One connection per store, chosen by the document, not the profile.** A profile swaps bindings, not
  connections, so a store that says `engine: memory` says it for every profile. The example works
  around it with `local` and `live` binding different *bindings*. Whether a profile may swap a
  connection, or a connection may read its engine from the environment, is RFC 0005's question, since
  `@auth`'s store has the same problem.
- **Kysely and `pg` as plain dependencies.** A consumer that only ever uses `memory` still installs
  `pg`. Making the driver optional is easy later and premature now.
- **A raw operation.** `@storage/sql.port.json#query` with a static `sql`, `params`, and `returns:
  unknown` would let an author reach what the port cannot say. It is deliberately absent from this
  RFC: it cannot be checked against the store, `rehearse` can only stub it as `unknown`, and every
  such node weakens what the tree guarantees. If it is ever added, it is its own port, legal only in
  `data/`, marked in `describe` as opaque, and counted separately in the manifest (RFC 0026).
- **No `ensure` at all** and a printed DDL instead: a CLI command would need the runtime to reach into
  the plugin, which the contract forbids. An operation a startup step fires keeps the plugin in charge
  and the tree in control of when it runs.

## Open questions

Before `accepted`:

1. Numeric keys, and sequences: do we want `key` to allow a `number` field, with `newKey` answering the
   next value from the engine? UUID v7 strings sort by time and need no round trip, which is why they
   are the default here.
2. `put` as upsert: should there be a separate `insert` that refuses on an existing key, so a graph can
   route on `conflict`? It would answer `{ record?: $T, conflict: boolean }`; today a graph that must not
   overwrite does a `get` first, and RFC 0004 makes the pair atomic.
3. Should `find` require `limit`, so no graph can read a whole table by omission? The example's `listAll`
   argues no; a multi-tenant tree argues yes. RFC 0015 may answer this with a rule rather than a field.

During implementation:

4. The exact Kysely expression for `contains` and `startsWith` (`like` with escaping) and whether
   `jsonb` fields may be ordered by.
5. Whether the memory engine should be reachable by `rehearse` at all (today no effect is), for a
   future `wilanis rehearse --real-storage`.
