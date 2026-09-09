# RFC 0003: Storage declarations the compiler judges

- **Status:** draft
- **Milestone:** A credible backend
- **Areas:** `area:compiler`, `area:core`, `area:plugin-storage`
- **Tracking issue:** #5
- **Depends on:** RFC 0002 (the `@wilanis/plugin-storage` plugin, the `store` document, `@storage/store.port.json`, `@storage/storage.port.json#ensure`)

## Summary

A `store` document says more than which shape a collection holds and which field is its key: what is
unique, which field refers to which other collection, what an existing row receives when a column is added,
which fields are indexed. The compiler judges the declaration against the shapes it names, and the storage
plugin judges every filter and every `patch` against the declaration, so a misspelled field, a filter
comparing a number with a string, or a `patch` that rewrites the key is a refusal of `wilanis check`, not
an error from PostgreSQL at run time. The declaration reaches the database through RFC 0002's `ensure`,
widened here to add what is missing to a table that exists and to refuse what would destroy it.

## Motivation

RFC 0002 gives a tree records of a shape behind a connection, keyed by one required string field. What it
leaves to run time is what a database knows of its own tables beyond the key: which combination may not
repeat, which field points at another collection, which field is worth an index. And it leaves to the
handler what the checker could say first: RFC 0002 declares `where` and `changes` as `unknown` so that the
grammar can nest, and fails the node on an unknown field or operator when the graph runs. An author -- an
agent above all -- writes `"where": { "methd": "GET" }` and finds out when the query answers nothing, or
patches `{ "id": "..." }` and finds out from a log. Both are exactly the class of error the checker exists
to catch: a reference to something that does not exist, a value that does not fit a type.

This RFC does not design migrations. A store that already exists and disagrees with its declaration in a
way that would lose data is refused, and the plan that reconciles the two is RFC 0017. It does not add
joins, aggregates or a query language: a relation is a field holding another collection's key, read by a
second `get`, and anything richer is out of scope here. It does not change what `put` accepts: a record is
the whole shape, as RFC 0002 and the "no absence" rule say.

## Guide-level explanation

A store lives in a feature's `data/`, beside the binding that uses it, and names the connection it sits on
and the collections it holds, each records of one core shape from the feature's `domain/` (RFC 0002). This
is the monitor's store, once the REST API is replaced by a table:

```json
{
  "$schema": "@wilanis/store.schema.json",
  "label": "Entries",
  "description": "Observed calls, one row each; a url is observed once per method. Notes hang off an entry.",
  "connection": "@connections/entries.connection.json",
  "collections": {
    "entries": {
      "of": "@monitor/domain/Entry.shape.json",
      "key": "id",
      "unique": [["url", "method"]],
      "defaults": { "ua": "unknown" },
      "indexes": [["method"]]
    },
    "notes": {
      "of": "@monitor/domain/Note.shape.json",
      "key": "id",
      "refs": { "entryId": { "collection": "entries" } }
    }
  }
}
```

Read it top to bottom. `entries` holds `Entry` records, identified by `id`, which the graph asks
`@storage/store.port.json#newKey` for before it `put`s (RFC 0002: no field is filled in silently). No two
records share a `url` and a `method`. There is an index on `method`, because the listing filters by it.
`notes` holds `Note` records whose `entryId` is the `id` of an entry; a note whose entry does not exist
is refused by the database, and so is removing an entry that still has notes.

`defaults` is about existing rows, not about what a graph writes. When `ensure` adds the column `ua` to a
table that already has rows, those rows receive `"unknown"`; a `put` still gives the whole record, and a
record without `ua` is simply one where the optional field is absent. Whether a field may be absent is not
said here twice: it is the shape's `required: false`, as everywhere else, and it is what makes the column
nullable.

A data graph reads the store the way RFC 0002 shows, with the filter it declares:

```json
{
  "type": "@wilanis/node/run.schema.json",
  "id": "asked",
  "run": "@storage/store.port.json#find",
  "in": {
    "store": "@monitor/data/entries.store.json",
    "collection": "entries",
    "where": { "method": "{{in.method}}", "ua": { "has": true } },
    "order": [{ "by": "url" }],
    "type": "@monitor/domain/Entry.shape.json"
  }
}
```

Misspell the field and `wilanis check` answers, instead of the handler at run time:

```
X206  @features/monitor/data/list-rows.graph.json#nodes/asked/in/where/methd
    'methd' is not a field of @monitor/domain/Entry.shape.json (fields: id, url, method, ua)
    → wilanis describe @monitor/domain/Entry.shape.json
```

Write `{ "method": 7 }` and the answer is that `method` is a string, not a number. Write `{ "ua":
{ "lt": "x" } }` and the answer is that an ordering does not apply where the field is optional and only `has`
may test it, as RFC 0002's `where` grammar says. Patch `{ "id": "other" }` and the answer is that a key is
never patched.

The declaration reaches PostgreSQL at start, the way RFC 0002 arranges it: a startup step names a domain
operation, and the profile's binding delegates it to `@storage/storage.port.json#ensure`:

```json
{ "label": "Prepare the entry store", "run": "@monitor/domain/monitor.port.json#prepare" }
```

```json
"prepare": { "run": "@storage/storage.port.json#ensure", "in": { "store": "@monitor/data/entries.store.json" } }
```

RFC 0002's `ensure` creates a collection that does not exist and leaves one that does alone. This RFC widens
it: a column, unique, reference or index the declaration has and the table lacks is added, and `ensure`
refuses, with reason `drift`, when the database holds something the declaration would destroy: a column of
another type or nullability, a unique or a reference existing rows violate, a required column with no
default that existing rows would have to receive. The start stops there, as it does for any required step.
The memory engine's `ensure` still answers at once: there is nothing to reconcile.

## Reference

### Documents and schemas

RFC 0002 adds the `store` kind: `packages/core/schemas/store.schema.json`, `StoreDoc` and the `Kind` entry in
`packages/core/src/model.ts`, `HOME.store = { layers: ['data'] }` in `packages/core/src/placement.ts`, the row
in `packages/runtime/templates/CLAUDE.md`, `wilanis new store`. This RFC extends the collection entry:

```ts
export interface StoreCollection {
  of: TypeRef;                        // a core shape of the feature's domain/ (RFC 0002)
  key: string;                        // a required string field of the shape (RFC 0002)
  unique?: string[][];                // each inner list is one constraint over those fields together
  refs?: Record<string, StoreRef>;    // field → the collection whose key it holds
  defaults?: Record<string, unknown>; // field → the literal ensure writes into existing rows when it adds the column
  indexes?: string[][];               // each inner list is one index over those fields, in that order
  description?: string;
}
export interface StoreRef {
  collection: string;                 // a collection of this store
  onRemove?: 'refuse';                // what removing the referenced record does; only refuse in this RFC
  description?: string;
}
```

The schema mirrors it: `unique` and `indexes` are arrays of arrays of `common.schema.json#/$defs/ident`, each
inner array `minItems: 1`, `uniqueItems` throughout; `refs` and `defaults` have `propertyNames` of `ident`;
`onRemove` is `enum: ["refuse"]`; `additionalProperties: false` everywhere. The baseline document in
`packages/core/test/validate.test.ts` gains a collection with every field. The template row becomes:

| kind | what it is | where |
|---|---|---|
| `store` | what the feature keeps: a connection and collections of a core shape, each by key, with `unique`, `refs`, `defaults`, `indexes` | `data/` |

`wilanis new store <name> --of <shape>` (RFC 0002) is unchanged: the new fields are added by hand, and a
scaffold that writes none of them is complete.

### Ports, operations and kinds granted

None new. RFC 0002 grants `@storage/store.port.json` (`get`, `find`, `count`, `put { record }`, `patch { key,
changes }`, `remove`, `newKey`), `@storage/storage.port.json#ensure`, `@storage/storage.connection-kind.json`
with `engine: memory | postgres`, and `@storage/Order.shape.json`. This RFC widens `ensure` in place:

- its description says it adds what is missing to a collection that exists, and refuses `drift` for what it
  would have to destroy or change;
- its `returns` keeps `collections: number` and adds `columns: number`, `constraints: number`, `indexes:
  number`, each the count created; all zero on a second run and on the memory engine;
- `refuses` stays false: `drift` is not a graph's declared outcome but a startup failure, reported by `start`
  with the differences, one per line, so the step stops the tree the way an unreachable database does.

A violated `unique` or `refs` at run time fails the `put` or `remove` node with a message naming the
constraint, as RFC 0002 fails a node on a row that does not fit the shape. Whether `put` should instead
answer the conflict so a `switch` can route on it, the way `http#request` answers a status, is an open
question below.

### Checker rules

Two judges, by what each can know. The compiler judges the store document against the shapes it names:
fields, types and references, which is what every C, L and R rule already does. The storage plugin judges
every `where`, `order` and `changes` against the store: the `where` grammar and what `patch` may touch are the
plugin's semantics, judged where `@auth` judges session writes against the session shape in
`packages/plugin-auth/src/rules.ts` (X103). Neither computes what the other already has: the plugin imports
`assignable` and `typeAt` from `@wilanis/core` for every type question, reads the store through
`scope.get('store', path)`, and types a read value with `scope.valueRead` and the graph's own resolver.

What RFC 0002 already judges is not repeated here: X201 (`of` is a core shape without `blob`), X202 (`key` is a
required string field), X203 (connection settings fit the engine), X204 (a call's `store`, `collection` and
`type`), X205 (the store's connection kind), R001 and L0nn on the store's references, D008 on its place. Nor is
`put`: its `record` is `$T`, bound by `type`, so `checkInputs` in `packages/compiler/src/check/inputs.ts` already
holds a record to the whole shape (G004, G005) and nothing here relaxes that.

Compiler rules extend `checkStore` in `packages/compiler/src/check/contracts.ts` (RFC 0002), family C
("connections, settings and stores"); when the module passes the 300-line house rule they move together to
`check/stores.ts`. Codes below are placeholders: numbers are assigned in the implementing pull request from
the next free in the family (the families stand at A006 B008 C002 D010 G013 L008 P003 R001 S001 T006 today).

| Code | Where it lives | Refuses when | Hint |
|---|---|---|---|
| C0nn | `checkStore` | a name in `unique`, `indexes`, `refs` or `defaults` is not a field of the shape | `wilanis describe <shape>` |
| C0nn | `checkStore` | a `defaults` value is not assignable to its field's type, or is given for the key | `write a literal of type <type>; a key is never defaulted` |
| C0nn | `checkStore` | a `refs` entry names a collection this store does not declare | `a reference stays within one store; declare the collection here, or read it by a second get` |
| C0nn | `checkStore` | a `refs` field is not a required string, the type every key has (X202) | `<field> is <type>; a key is a required string` |
| C0nn | `checkStore` | a `refs` field is the collection's own key, or a `unique` or `indexes` list repeats a field | `a key is unique already; a constraint names each field once` |
| C0nn | `checkStore` | two collections of one store are named alike ignoring case | `collection names become table names; keep them distinct in lower case` |

Plugin rules live in `packages/plugin-storage/src/rules.ts`, the plugin's `check`, given `PluginCheckContext`
(`packages/core/src/plugin.ts`), continuing RFC 0002's table. They walk every run and map node of every graph
and every delegation of every binding, as `checkGraphWrites` and `checkBindingWrites` do in the auth plugin,
and judge those whose `run` is an operation of `@storage/store.port.json` or `@storage/storage.port.json`.
The compiler has already judged the call site generically by then (G005, G006, P001), and X204 has already
settled which shape the collection holds, so every rule below reads that shape.

| Code | Where it lives | Refuses when | Hint |
|---|---|---|---|
| X206 | `rules.ts` | a key of `where` (at any nesting under `all`, `any`, `not`), or an `order` entry's `by`, is neither a field of the shape nor a combinator | `wilanis describe <shape>` |
| X207 | `rules.ts` | a `where` value -- a literal, or a read typed where it comes from -- is not assignable to the field's type (`eq`, `ne`, `lt`, `lte`, `gt`, `gte`), or is not a list of it (`in`, `notIn`), or is not a boolean (`has`), or is not a string (`contains`, `startsWith`) | `<field> is <type>` |
| X208 | `rules.ts` | a `where` operator is one the field's type does not admit under RFC 0002's **The `where` grammar**: `contains` or `startsWith` on a non-string, an ordering on a boolean, anything but `has` on a field that is a shape or a list, or an operator the grammar does not name | `see The where grammar in @storage/store.port.json` |
| X209 | `rules.ts` | a `patch` whose `changes` is a literal object names the key, a field the shape lacks, or gives a value not assignable to the field's type; a `changes` that is one read is judged as an object against the shape with every field optional | `a key identifies; it is never patched` / `wilanis describe <shape>` |
| X210 | `rules.ts` | `ensure` is run by a graph node, or delegated to by a binding operation that no startup step reaches under any profile | `name the domain operation in project.json → startup; ensure runs once, before the port opens` |
| X211 | `rules.ts` | a graph or binding of one feature names a store of another | `reach another feature's records through its domain port` |

X211 is the plugin's rather than L005's because a store is never in `exports`: `feature.schema.json` says
exports are ports and core shapes, and this RFC keeps it so. A collection is an implementation detail of
one feature; another feature asks the domain port.

### Runtime behaviour

`ensure`, in `packages/plugin-storage/src/engines/postgres.ts` (RFC 0002), grows from "create what is
missing, collection by collection" to a comparison of the declaration with `information_schema` for every
collection of the store: tables, columns, constraints and indexes. Mapping as RFC 0002 fixes it: a
collection is a table, a field a column of the same name (`string` → `text`, `number` → `double precision`,
`boolean` → `boolean`, a shape, a list or `unknown` → `jsonb`), a required field `NOT NULL`, the key the
primary key. This RFC adds: each `unique` list is one unique constraint, each `indexes` list one index in that
order, each `refs` a foreign key to the target's key with `ON DELETE RESTRICT`; a column added to a table that
has rows carries `DEFAULT <defaults[field]>` when one is declared, and the default is dropped once the column
exists, so it never applies to what `put` writes. Everything created goes in one transaction, and the answer
counts it. It refuses `drift` and creates nothing when a column exists with another type or nullability, a
column exists that the shape has no field for and is `NOT NULL`, a required column would be added to a table
with rows and no default, a `unique` or a `refs` would fail on existing rows, or the primary key differs.
The memory engine's `ensure` answers zeros; the memory engine enforces `unique` and `refs` in its `put` and
`remove` so that a test sees the same failures as PostgreSQL.

The handlers of `find`, `count` and `patch` keep RFC 0002's run-time judgement of `where` and `changes`: a
value may reach them typed `unknown` from an edge, and a check-time rule cannot see what arrives. Nothing is
judged twice by hand: the run-time judgement is the one that existed, and the check-time rules above refuse
before it what they can see.

`rehearse`, `fuzz` and `regress` stub both ports (RFC 0002): they never call `ensure`, and the plugin's
`check` is what covers the declaration there.

### Discoverability

`wilanis ls store` and `wilanis describe <store>` exist from RFC 0002 (`describe` in
`packages/runtime/src/discovery.ts`, a `store` case in `kindBody`); the store's page gains the marks:

```
store  @monitor/data/entries.store.json  (Entries)
  connection  @connections/entries.connection.json  (engine postgres)
  collection entries: @monitor/domain/Entry.shape.json
    key id   unique [url, method]   default ua = "unknown"   index [method]
    read by     @monitor/data/get-row.graph.json#asked (get), @monitor/data/list-rows.graph.json#asked (find)
    written by  @monitor/data/create-row.graph.json#saved (put), @monitor/data/delete-row.graph.json#gone (remove)
  collection notes: @monitor/domain/Note.shape.json
    key id   refs entryId → entries.id (refuse on remove)
  ensured by  @monitor/domain/monitor.port.json#prepare  (startup 1/3, profile live)
```

The readers and writers come from the same walk the plugin's rules make. `describe` of a shape held by a
collection gains a line `held by  @monitor/data/entries.store.json#entries`, beside the lines saying who
writes it. `wilanis map` already prints `store entries (get)` (RFC 0002); nothing to add.

The viewer's `store` case in `renderDocPage` (`packages/view/client/index.html`, RFC 0002) grows one column
per mark -- key, unique, default, ref, index -- on each collection's field table, a ref rendered as a link to
the target collection, and the `ensured by` step in the right-hand panel.

### Plugin contract

None. The rules use `PluginCheckContext` as it stands.

## Compatibility

`store` is RFC 0002's kind; this RFC adds optional fields to its schema and changes no other schema. A store
written under RFC 0002 alone keeps validating and means the same, and `ensure` on it does what it did. `ensure`'s
`returns` gains fields, which is compatible for every caller. Nothing about IR v1 that exists today changes;
until 1.0 this lands in place (RFC 0008).

## Tests

RFC 0002 gives the example a store, a `local` profile on the memory engine and a `prepare` step; the sabotage
tests edit that store. In `packages/runtime/test/sabotage-storage.test.ts`, with the `sabotage` helper of
`example-harness.ts`, one `it` per compiler row:

- C (names): `"unique": [["urrl"]]`; `"indexes": [["nope"]]`; `"defaults": { "nope": 1 }`; `"refs": { "nope": ... }`.
- C (defaults): `"defaults": { "ua": 7 }`; `"defaults": { "id": "x" }`.
- C (refs): `"refs": { "ua": { "collection": "nowhere" } }`; a ref on an optional field (`ua`); a ref on the
  collection's own key.
- C (repeats): `"unique": [["url", "url"]]`; `"indexes": [["method", "method"]]`.
- C (case): two collections `Entries` and `entries`.

In `packages/plugin-storage/test/rules.test.ts`, extending RFC 0002's small tree and its `check` through
`checkTree`:

- X206: `where: { methd: "GET" }`; `where: { any: [{ nope: 1 }] }`; `order: [{ by: "nope" }]`.
- X207: `where: { method: 7 }`; `where: { method: "{{in.count}}" }` with `count: number`;
  `where: { method: { in: "GET" } }`; `where: { ua: { has: "yes" } }`.
- X208: `where: { url: { lt: "a" } }` on an optional field; `where: { method: { contains: 1 } }` on a number
  field; `where: { method: { like: "G%" } }`.
- X209: `changes: { id: "other" }`; `changes: { nope: 1 }`; `changes: { url: 7 }`; `changes: "{{in.changes}}"`
  where `changes` is an edge shape with a field the record shape lacks.
- X210: `ensure` in a graph node; a binding delegating to `ensure` that no startup step reaches.
- X211: a graph of feature `b` naming feature `a`'s store.

In `packages/plugin-storage/test/ensure.test.ts`: against the memory engine, `ensure` answers zeros and `put`
fails on a violated `unique`, `remove` on a referenced record; against PostgreSQL (skipped without
`WILANIS_TEST_POSTGRES_URL`, as RFC 0002 arranges), `ensure` on an empty database creates every table, column,
constraint and index and counts them; a second run counts zeros; adding an optional field to the shape adds
the column; adding a field with a default to a table with rows fills them; changing a field's type refuses
`drift` and leaves the table as it was; adding a `unique` that existing rows violate refuses `drift`. In
`packages/runtime/test/startup.test.ts`: a required startup step whose binding delegates to `ensure` stops
`start` on `drift`, and the port never opens.

## Implementation plan

1. Extend `store.schema.json`, `StoreDoc` and the validate baseline; the template row. `good first issue`
   once RFC 0002 has landed.
2. Extend `checkStore` with the C rules; `sabotage-storage.test.ts`.
3. `rules.ts`: X206 to X208 over `where` and `order`, with `assignable`, `typeAt` and `valueRead`.
4. X209 over `changes`; X210 and X211.
5. `ensure`: the memory engine's `unique` and `refs`, then the PostgreSQL comparison, additions and `drift`;
   `ensure.test.ts` and the startup test.
6. `describe` marks, the `held by` line, the viewer's columns. `good first issue`.
7. The example: `unique`, `defaults` and an index on its store; README's paragraph on stores names them.

## Drawbacks and alternatives

**Two judges.** Splitting the rules between the compiler and the plugin costs a reader two places to look.
The alternative -- a contract keyword telling the compiler that a static field "refers to a store's
collection" -- would put storage knowledge into `@wilanis/core`, which knows nothing of any plugin today; the
auth plugin's X103 shows the split is the house pattern, and RFC 0002 already draws the line there.

**`generated` was considered and left out.** A store that assigns a key or a value on `put` would make `put`
accept less than the shape requires, against the "no absence" rule: a record type would mean one thing when
read and another when written. RFC 0002's `newKey` gives the graph a key to write, so the record is whole at
the call site, and `defaults` here touches only rows that exist when a column is added.

**A new family letter.** Store rules could take a letter of their own (`K`) instead of joining C. C is chosen
because a store is judged the way a connection is -- a declaration against the contracts it names -- and
because the families stay few; the tracking issue may decide otherwise before `accepted`.

**Declaring the schema in the shape.** `unique` and `refs` could be marks on the shape's fields instead of on
the collection. A shape is a type and is used in more places than a store; the same `Entry` may be held in two
stores with different uniqueness. The declaration stays with the store.

**No `cascade`.** `onRemove` admits only `refuse`, so removing a parent means removing the children first, in
a graph. A cascade is a hidden write the checker cannot see; if it comes, it comes as an explicit choice here.

## Open questions

Before `accepted`:

- Is C the right family, or does storage deserve its own letter?
- Should a violated `unique` or `refs` fail the node, as here, or should `put` and `remove` answer it (a
  `conflict` field beside `record`) so a `switch` routes on it the way it routes on an HTTP status? The second
  changes RFC 0002's `returns` and would be decided in both RFCs together.
- Should `ensure` add columns and constraints in the `live` profile at all, or only in development, with
  production waiting for RFC 0017's planner? The RFC says additive everywhere and destructive nowhere.

During implementation:

- Whether `indexes` earns its place, or whether `unique` and `refs` cover what an AI-written tree needs first.
- How `describe` prints a composite `unique` or `index` when a collection has several.
