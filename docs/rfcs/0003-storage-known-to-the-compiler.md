# RFC 0003: Storage declarations the compiler judges

- **Status:** accepted
- **Areas:** `area:compiler`, `area:core`, `area:plugin-storage`
- **Tracking issue:** #5
- **Depends on:** RFC 0002 (the `@wilanis/plugin-storage` plugin, the `store` document, `@storage/store.port.json`, `@storage/storage.port.json#ensure`)

## Summary

A `store` document says more than which shape a collection holds and which field is its key: what is
unique, which field refers to which other collection, and what an existing row receives when a column is
added. The compiler judges the declaration against the shapes it names, and the storage
plugin judges every filter and every `patch` against the declaration, so a misspelled field, a filter
comparing a number with a string, or a `patch` that rewrites the key is a refusal of `wilanis check`, not
an error from PostgreSQL at run time. The declaration reaches the database through RFC 0002's `ensure`,
widened here to add what is missing to a table that exists and to refuse what would destroy it.

## Motivation

RFC 0002 gives a tree records of a shape behind a connection, keyed by one required string field. What it
leaves to run time is what a database knows of its own tables beyond the key: which combination may not
repeat, which field points at another collection, what an existing row receives. And it leaves to the
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
      "defaults": { "ua": "unknown" }
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
records share a `url` and a `method`. `notes` holds `Note` records whose `entryId` is the `id` of an entry; a note whose entry does not exist
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
    "order": [{ "by": "url" }]
  }
}
```

Misspell the field and `wilanis check` answers, instead of the handler at run time:

```
X208  @features/monitor/data/list-rows.graph.json#nodes/asked/in/where/methd
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
it: a column, unique or reference the declaration has and the table lacks is added, and `ensure`
refuses, with reason `drift`, when the database holds something the declaration would destroy: a column of
another type or nullability, a unique or a reference existing rows violate, a required column with no
default that existing rows would have to receive. The start stops there, as it does for any required step.
The memory engine's `ensure` still answers at once: there is nothing to reconcile. Which of these
rules an engine can honour is its own to declare and refuse, as RFC 0002 splits them.

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
  description?: string;
}
export interface StoreRef {
  collection: string;                 // a collection of this store
  onRemove?: 'refuse';                // what removing the referenced record does; refuse is the only value there will be
  description?: string;
}
```

The schema mirrors it: `unique` is an array of arrays of `common.schema.json#/$defs/ident`, each
inner array `minItems: 1`, `uniqueItems` throughout; `refs` and `defaults` have `propertyNames` of `ident`;
`onRemove` is `enum: ["refuse"]`; `additionalProperties: false` everywhere. The baseline document in
`packages/core/test/validate.test.ts` gains a collection with every field. The template row becomes:

| kind | what it is | where |
|---|---|---|
| `store` | what the feature keeps: a connection and collections of a core shape, each by key, with `unique`, `refs`, `defaults` | `data/` |

`wilanis new store <name> --of <shape>` (RFC 0002) is unchanged: the new fields are added by hand, and a
scaffold that writes none of them is complete.

### Ports, operations and kinds granted

None new. RFC 0002 grants `@storage/store.port.json` (`get`, `find`, `count`, `put { record, replace }`,
`patch { key, changes }`, `remove`, `newKey`), `@storage/storage.port.json#ensure` and
`@storage/Order.shape.json`; the connection kinds belong to the engine plugins
(`@wilanis/plugin-storage-memory`, `@wilanis/plugin-storage-postgres`), and no call site names a record
type -- `$T` and `$K` are resolved from the store document. This RFC widens `ensure` in place:

- its description says it adds what is missing to a collection that exists, and refuses `drift` for what it
  would have to destroy or change;
- its `returns` keeps `collections: number` and adds `columns: number` and `constraints: number`, each the
  count created; all zero on a second run and on the memory engine;
- `refuses` stays false: `drift` is not a graph's declared outcome but a startup failure, reported by `start`
  with the differences, one per line, so the step stops the tree the way an unreachable database does.

A violated `unique` or `refs` at run time is answered, not thrown. A node never fails on a condition the
author could have expected: failure is for the unforeseen -- an uncaught exception, or an assertion a plugin
placed on purpose -- and a constraint the store itself declares is the opposite of unforeseen. So `put`
answers `{ record?, conflict: boolean, violated?: string }` and `remove` answers `{ removed: boolean,
referencedBy?: string }`, and a graph routes on the flag with a `switch` exactly as it routes on `conflict`
from a `put` with `replace: false` (RFC 0002) or on a status from `http#request`. `violated` and
`referencedBy` name the constraint that answered, so the branch can say which. This extends RFC 0002's
own rule -- "the answer carries the flag rather than failing the node" -- from the key to every constraint
the declaration adds; it widens `put`'s `returns` and `remove`'s in RFC 0002's port table, which is
compatible for a graph that ignores the new fields, and the narrowing rules already know `record` is
present on the branch where `conflict` is false.

### Checker rules

Two judges, by what each can know. The compiler judges the store document against the shapes it names:
fields, types and references, which is what every C, L and R rule already does. The storage plugin judges
every `where`, `order` and `changes` against the store: the `where` grammar and what `patch` may touch are the
plugin's semantics, judged where `@auth` judges session writes against the session shape in
`packages/plugin-auth/src/rules.ts` (X103). Neither computes what the other already has: the plugin imports
`assignable` and `typeAt` from `@wilanis/core` for every type question, reads the store through
`scope.get('store', path)`, and types a read value with `scope.valueRead` and the graph's own resolver.

What RFC 0002 already judges is not repeated here: X201 (`of` is a core shape), X202 (`key` is a required
field of it), X203 (the connection is of a kind an engine grants), X204 (a call's `store` and `collection`),
X205 to X207 (a call's arguments, collection names, and two stores over one connection), what each engine
refuses in its own band (X22x for postgres), R001 and
L0nn on the store's references, D008 on its place. Nor is `put`: its `record` is `$T`, resolved from the
store, so `checkInputs` in `packages/compiler/src/check/inputs.ts` already holds a record to the whole shape
(G004, G005) and nothing here relaxes that.

Compiler rules extend `checkStore` in `packages/compiler/src/check/contracts.ts` (RFC 0002), family C
("connections, settings and stores"); when the module passes the 300-line house rule they move together to
`check/stores.ts`. The codes were assigned in the implementing pull request from the next free in the family, C002 having
been the highest (the other families stand at A006 B008 D010 G013 L008 P003 R001 S001 T006 today).

| Code | Where it lives | Refuses when | Hint |
|---|---|---|---|
| C003 | `checkStore` | a name in `unique`, `refs` or `defaults` is not a field of the shape | `wilanis describe <shape>` |
| C004 | `checkStore` | a `defaults` value is not assignable to its field's type, or is given for the key | `write a literal of type <type>; a key is never defaulted` |
| C005 | `checkStore` | a `refs` entry names a collection this store does not declare | `a reference stays within one store; declare the collection here, or read it by a second get` |
| C006 | `checkStore` | a `refs` field's type is not the type of the referenced collection's key | `<field> is <type>; <collection> is keyed by <type>` |
| C007 | `checkStore` | a `refs` field is the collection's own key, or a `unique` list names it | `a key is unique already; a constraint names each field once` |
| C008 | `checkStore` | a `unique` or `refs` entry names a field an engine holds no single value of: a `blob`, a shape or a list | `wilanis describe <the connection>` |

Two notes on what landed against what this table asked for. **A `unique` list that repeats a field** is not
C007's: the schema already refuses it as D001, through the `uniqueItems` this RFC puts on the inner list, and
a rule lives in one place. C007 is the key half alone, and a test asserts D001 answers the other.
**C008 is judged by type rather than by engine.** `checkStore` is a compiler rule and knows no engine, so it
reads the fact every engine shares -- a `blob` is a handle to bytes the registry holds, and neither a shape
nor a list is one value to index -- and a genuinely per-engine constraint belongs in the X band beside
X201-X207. A field C008 refuses is not then judged by C006: it holds no value to compare.

Neither of two rows in *Tests* below became a rule. A `refs` on an optional field is an ordinary nullable
reference and nothing in this table forbids it, so it is a passing case. Two collections named `Entries` and
`entries` are D001's, through `ident`, and X223's for postgres.

Plugin rules live in `packages/plugin-storage/src/rules.ts`, the plugin's `check`, given `PluginCheckContext`
(`packages/core/src/plugin.ts`), continuing RFC 0002's table. They walk every run and map node of every graph
and every delegation of every binding, as `checkGraphWrites` and `checkBindingWrites` do in the auth plugin,
and judge those whose `run` is an operation of `@storage/store.port.json` or `@storage/storage.port.json`.
The compiler has already judged the call site generically by then (G005, G006, P001), and X204 has already
settled which shape the collection holds, so every rule below reads that shape.

| Code | Where it lives | Refuses when | Hint |
|---|---|---|---|
| X208 | `rules.ts` | a key of `where` (at any nesting under `all`, `any`, `not`), or an `order` entry's `by`, is neither a field of the shape nor a combinator | `wilanis describe <shape>` |
| X209 | `rules.ts` | a `where` value -- a literal, or a read typed where it comes from -- is not assignable to the field's type (`eq`, `ne`, `lt`, `lte`, `gt`, `gte`), or is not a list of it (`in`, `notIn`), or is not a boolean (`has`), or is not a string (`contains`, `startsWith`) | `<field> is <type>` |
| X210 | `rules.ts` | a `where` operator is one the field's type does not admit under RFC 0002's **The `where` grammar**: `contains` or `startsWith` on a non-string, an ordering on a boolean, anything but `has` on a field that is a shape or a list, or an operator the grammar does not name | `see The where grammar in @storage/store.port.json` |
| X211 | `rules.ts` | a `patch` whose `changes` is a literal object names the key, a field the shape lacks, or gives a value not assignable to the field's type; a `changes` that is one read is judged as an object against the shape with every field optional | `a key identifies; it is never patched` / `wilanis describe <shape>` |
| X212 | `rules.ts` | `ensure` is run by a graph node, or delegated to by a binding operation that no startup step reaches under any profile | `name the domain operation in project.json → startup; ensure runs once, before the port opens` |
| X213 | `rules.ts` | a graph or binding of one feature names a store of another | `reach another feature's records through its domain port` |

**What X209 can see of a read.** A value a filter tests with is a literal or a read, and the two are judged
differently: a literal as written, a read by the type it reads. A plugin can type a read of `in` -- a graph's
in shape and a binding operation's `accepts` are documents, and `scope.valueRead` with `typeAt` over them
answers -- and it cannot type a read of an earlier node's output, because that table is the graph checker's,
and so is the narrowing a `switch` does. Such a read is left unjudged, and a filter comparing a node's answer
with the wrong field fails that node at run time rather than refusing at check. Closing the gap means widening
`PluginCheckContext`, which hands a plugin `scope`, `settings` and `refuse` and nothing that types a read at a
node; that is its own change, and this RFC does not make it.

The same distinction is why the grammar judges the *shape* of a value -- a list for `in`, a boolean for `has`
-- only where the value is one. At check time `{{in.urls}}` is a string, and refusing it for not being a list
would refuse a filter the run then accepts.

X213 is the plugin's rather than L005's because a store is never in `exports`: `feature.schema.json` says
exports are ports and core shapes, and this RFC keeps it so. A collection is an implementation detail of
one feature; another feature asks the domain port.

### Runtime behaviour

`ensure`, in `packages/plugin-storage/src/engines/postgres.ts` (RFC 0002), grows from "create what is
missing, collection by collection" to a comparison of the declaration with `information_schema` for every
collection of the store: tables, columns and constraints. Mapping as RFC 0002 fixes it: a
collection is a table, a field a column of the same name (`string` → `text`, `number` → `double precision`,
`boolean` → `boolean`, a shape, a list or `unknown` → `jsonb`), a required field `NOT NULL`, the key the
primary key. This RFC adds: each `unique` list is one unique constraint, each `refs` a foreign key to the
target's key with `ON DELETE RESTRICT`; a column added to a table that
has rows carries `DEFAULT <defaults[field]>` when one is declared, and the default is dropped once the column
exists, so it never applies to what `put` writes. Everything created goes in one transaction, and the answer
counts it. It refuses `drift` and creates nothing when a column exists with another type or nullability, a
column exists that the shape has no field for and is `NOT NULL`, a required column would be added to a table
with rows and no default, a `unique` or a `refs` would fail on existing rows, or the primary key differs.
The memory engine's `ensure` answers zeros; the memory engine enforces `unique` and `refs` in its `put` and
`remove`, answering the same flags PostgreSQL does, so that a test sees one behaviour on both.

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
    key         id
    unique      [url, method], [slug]
    default     ua = "unknown"
    read by     @monitor/data/get-row.graph.json#asked (get), @monitor/data/list-rows.graph.json#asked (find)
    written by  @monitor/data/create-row.graph.json#saved (put), @monitor/data/delete-row.graph.json#gone (remove)
  collection notes: @monitor/domain/Note.shape.json
    key         id
    refs        entryId → entries.id (refuse on remove)
  ensured by  @monitor/domain/monitor.port.json#prepare  (startup 1/3, profile live)
```

One line per mark family, its constraints comma-separated and each composite in declaration order, so a
collection with several uniques grows one line rather than one unreadable one; the label column is the
`padEnd` the rest of `discovery.ts` already uses, and a family with nothing to say prints no line. The
readers and writers come from the same walk the plugin's rules make. `describe` of a shape held by a
collection gains a line `held by  @monitor/data/entries.store.json#entries`, beside the lines saying who
writes it. `wilanis map` already prints `store entries (get)` (RFC 0002); nothing to add.

The viewer's `store` case in `renderDocPage` (`packages/view/client/index.html`, RFC 0002) grows one column
per mark -- key, unique, default, ref -- on each collection's field table, a ref rendered as a link to
the target collection, and the `ensured by` step in the right-hand panel.

### Plugin contract

None. The rules use `PluginCheckContext` as it stands.

## Compatibility

`store` is RFC 0002's kind; this RFC adds optional fields to its schema and changes no other schema. A store
written under RFC 0002 alone keeps validating and means the same, and `ensure` on it does what it did. The
`returns` of `ensure`, `put` and `remove` each gain fields, which is compatible for every caller: a graph that
ignores `violated` or `referencedBy` reads what it read before, and only a graph that declares a `unique` or a
`refs` can see them at all. Nothing about IR v1 that exists today changes; until 1.0 this lands in place
(RFC 0008).

## Tests

RFC 0002 gives the example a store, a `local` profile on the memory engine and a `prepare` step; the sabotage
tests edit that store. In `packages/runtime/test/sabotage-storage.test.ts`, with the `sabotage` helper of
`example-harness.ts`, one `it` per compiler row:

- C (names): `"unique": [["urrl"]]`; `"defaults": { "nope": 1 }`; `"refs": { "nope": ... }`.
- C (defaults): `"defaults": { "ua": 7 }`; `"defaults": { "id": "x" }`.
- C (refs): `"refs": { "ua": { "collection": "nowhere" } }`; a ref on an optional field (`ua`); a ref on the
  collection's own key.
- C (repeats): `"unique": [["url", "url"]]`.
- C (case): two collections `Entries` and `entries`.

In `packages/plugin-storage/test/rules.test.ts`, extending RFC 0002's small tree and its `check` through
`checkTree`:

- X208: `where: { methd: "GET" }`; `where: { any: [{ nope: 1 }] }`; `order: [{ by: "nope" }]`.
- X209: `where: { method: 7 }`; `where: { method: "{{in.count}}" }` with `count: number`;
  `where: { method: { in: "GET" } }`; `where: { ua: { has: "yes" } }`.
- X210: `where: { url: { lt: "a" } }` on an optional field; `where: { method: { contains: 1 } }` on a number
  field; `where: { method: { like: "G%" } }`.
- X211: `changes: { id: "other" }`; `changes: { nope: 1 }`; `changes: { url: 7 }`; `changes: "{{in.changes}}"`
  where `changes` is an edge shape with a field the record shape lacks.
- X212: `ensure` in a graph node; a binding delegating to `ensure` that no startup step reaches.
- X213: a graph of feature `b` naming feature `a`'s store.

In `packages/plugin-storage/test/ensure.test.ts`: against the memory engine, `ensure` answers zeros, `put`
answers `violated` on a broken `unique` and `remove` answers `referencedBy` on a referenced record, each
routed by a `switch` in the test's graph; against PostgreSQL (skipped without
`WILANIS_TEST_POSTGRES_URL`, as RFC 0002 arranges), `ensure` on an empty database creates every table, column,
constraint and counts them; a second run counts zeros; adding an optional field to the shape adds
the column; adding a field with a default to a table with rows fills them; changing a field's type refuses
`drift` and leaves the table as it was; adding a `unique` that existing rows violate refuses `drift`. In
`packages/runtime/test/startup.test.ts`: a required startup step whose binding delegates to `ensure` stops
`start` on `drift`, and the port never opens.

## Implementation plan

1. Extend `store.schema.json`, `StoreDoc` and the validate baseline; the template row. `good first issue`
   once RFC 0002 has landed.
2. Extend `checkStore` with the C rules; `sabotage-storage.test.ts`.
3. `rules.ts`: X208 to X210 over `where` and `order`, with `assignable`, `typeAt` and `valueRead`.
4. X211 over `changes`; X212 and X213.
5. Widen `put`'s and `remove`'s `returns` in `@storage/store.port.json` (RFC 0002's table) with `violated`
   and `referencedBy`, so a constraint is answered rather than thrown; the narrowing tests for the branches.
6. `ensure`: the memory engine's `unique` and `refs`, then the PostgreSQL comparison, additions and `drift`;
   `ensure.test.ts` and the startup test.
7. `describe` marks, the `held by` line, the viewer's columns. `good first issue`.
8. The example: `unique` and `defaults` on its store; README's paragraph on stores names them.

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
because the families stay few; the review settled that they do.

**Declaring the schema in the shape.** `unique` and `refs` could be marks on the shape's fields instead of on
the collection. A shape is a type and is used in more places than a store; the same `Entry` may be held in two
stores with different uniqueness. The declaration stays with the store.

**No `cascade`, ever.** `onRemove` admits only `refuse`, so removing a parent means removing the children
first, in a graph. This is not caution about a feature that may come later: what removing a record means for
the records that refer to it is business, and business lives in the domain, not in the data layer. A cascade
is a hidden write -- the checker cannot see it, a trace cannot show it, and an agent deleting one record would
have no way to know what else went with it. The graph that wants the children gone says so, node by node.

## Settled on review

- **C is the family.** Storage does not earn its own letter; the families stay few, and a store's names are
  contract names like any other.
- **A constraint answers; it does not fail the node.** A node never fails on a condition the author could
  have expected -- failure is for the unforeseen, an uncaught exception or a deliberate assertion -- so `put`
  and `remove` carry the violation as a flag a `switch` routes on, as the section above states. This is a
  global rule about nodes, not a storage exception, and it widens RFC 0002's `returns` for both operations.
- **`ensure` in `live` is the author's call.** The RFC neither blocks it nor forces it: the startup step
  names the operation, and whether a profile runs it is a property of the profile. Additive everywhere,
  destructive nowhere, and RFC 0017's planner remains the answer for what `ensure` refuses as `drift`.
- **No `indexes`.** An index is a downstream concern -- how the database answers, not what the business
  means. `unique` is the exception and stays, because uniqueness is a rule the domain holds and a violated
  one must be answered loudly. A tree that needs an index gets it from the database, not from a document
  the compiler judges.
- **`describe` prints one line per mark family**, its constraints comma-separated, as the Discoverability
  section shows.
- **No `cascade`, ever**, for the reason the section above gives: what a removal means for referring records
  is business, and it belongs to the domain.
