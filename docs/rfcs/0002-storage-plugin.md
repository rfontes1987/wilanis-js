# RFC 0002: The `@storage` plugin: records of a shape behind a generic port

- **Status:** accepted
- **Areas:** `area:plugin-storage`, `area:core`, `area:runtime`
- **Schemas:** adds `store.schema.json`; adds the optional `resolves` to `$defs/field` in `common.schema.json` and the optional `storage` to `connection-kind.schema.json` (both compatible, RFC 0008)
- **Packages:** `@wilanis/plugin-storage`, `@wilanis/plugin-storage-memory`, `@wilanis/plugin-storage-postgres`
- **Tracking issue:** #4
- **Depends on:** none

## Summary

A tree can keep records. A feature declares a **store**: which shapes it persists, under which
collection names, keyed by which field, over which connection. Its data graphs read and write those
records through one native port, `@storage/store.port.json`, whose operations speak the shape the
collection declares: `get`, `find`, `put`, `patch`, `remove`, `count`, `newKey`. An **engine is its own
plugin**: `@wilanis/plugin-storage-memory` for development, tests and `libraries/`, and
`@wilanis/plugin-storage-postgres`, the first real one, built on Kysely. Each grants one connection
kind, carries its own driver and its own settings, and a store names it the way every document names
anything -- by path. `@storage` itself speaks no engine's language and depends on no driver. Kysely is
an implementation detail of one package and appears in no document. Storage means records; `@blob`
keeps bytes, as it does today.

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

**Connection, a kind an engine plugin grants.** A channel to one storage engine, of that engine's
kind: `@storage-memory/memory.connection-kind.json` has no settings, and
`@storage-postgres/postgres.connection-kind.json` has the URL read from a secret, the schema and the
pool. There is no `engine` field to spell: which engine a connection reaches is which kind it names,
so a misspelling is C001 against a kind that does not exist rather than a value the plugin has to
police. Swapping engines is swapping the connection's `kind`.

**Port, `@storage/store.port.json`.** The operations a data graph runs against a collection. Every one
is an effect: it lives in a data graph and is listed in `feature.json → effects` (L003).

The monitor feature, kept in a store instead of the REST API. The connection, at the tree's root:

```json
{
  "$schema": "@wilanis/connection.schema.json",
  "label": "Entries",
  "description": "Where the monitor's entries are kept. Memory in development; production names the postgres kind instead.",
  "kind": "@storage-memory/memory.connection-kind.json"
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
  "out": { "type": "@monitor/domain/Entry.shape.json", "from": "answer" },
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
        "record": "{{entry}}"
      }
    },
    {
      "type": "@wilanis/node/run.schema.json",
      "id": "answer",
      "label": "The stored entry",
      "run": "@std/object.port.json#make",
      "in": { "value": "{{stored.record}}", "type": "@monitor/domain/Entry.shape.json" }
    }
  ]
}
```

`put` answers `{ record, conflict }`, so this graph reads `stored.record`. It leaves `replace` at its
default and never sets `conflict`, which is why it can hand the record on without a `switch`; a graph
that passes `"replace": false` routes on `conflict` exactly as `get` routes on `has(record)`, and the
narrowing rules already know `record` is present on the branch where `conflict` is false.

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

The refusal an author meets first, when a call names a collection the store does not hold:

```
X204  @features/monitor/data/get-record.graph.json#nodes/asked/in/collection
    @monitor/data/entries.store.json has no collection 'entry' (collections: entries)
    → wilanis describe @monitor/data/entries.store.json
```

There is no refusal about the record's type at a call site, because no call site states one: the
collection's `of` is the type, and a graph that treats the answer as another shape is refused by the
G rules that already type every read.

## Reference

### Documents and schemas

**A new kind, `store`.** `packages/core/schemas/store.schema.json`, `$id` under `SCHEMA_BASE`,
`$schema` accepting the URL and `@wilanis/store.schema.json`, with `label` and `description` like every
kind. `StoreDoc` in `model.ts`, `'store'` added to `Kind` and `KINDS`; `validate.ts` picks the schema
up through `KINDS`.

```
store
  connection   path            a connection whose kind an engine plugin grants (X203)
  collections  object, ≥ 1     ident → collection
    of           typeRef         the path of a core shape, or of a shape a plugin grants; the record type
    key          ident           a required field of `of`; its type is the key's type ($K), whatever it is
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

Three packages, and the division between them is the whole of the design: `@storage` says what a
store *is* and what may be asked of one; an engine plugin says how one is kept.

`packages/plugin-storage/docs/plugin.json` grants two ports, one shape and no connection kind. Its
settings: none, in this RFC or later -- a setting here would be a setting for every engine at once.

**`@wilanis/plugin-storage-memory`**, `docs/plugin.json` grants
`@storage-memory/memory.connection-kind.json`:

```
settings   none
```

A connection of it reaches a `Map` that lives as long as the process. No URL, no pool, nothing to
configure, and nothing to refuse: the kind having no settings is what makes a memory store impossible
to misconfigure.

**`@wilanis/plugin-storage-postgres`**, `docs/plugin.json` grants
`@storage-postgres/postgres.connection-kind.json`:

```
settings
  url      string, secret              the connection URL, read as {{secrets.*}}
  schema   string, optional            the schema; default public
  pool     { max: number }, optional   the pool's size; default 10
```

`url` is required, because a kind whose every setting is optional cannot say what it needs. The
plugin's own settings (`plugin.json → settings`), separate from any one connection: `statementTimeout`
(number, optional, seconds) and `keyType` (string, optional, enum [`uuidv7`, `identity`]; default
`uuidv7`), what `newKey` answers where the collection's key is a string and where it is a number
respectively. Engine-wide knobs live here; per-database facts live on the connection.

**What makes a connection kind a storage kind.** Its document says so: `"storage": true` on the
connection kind. That is how X203 knows a store's connection reaches an engine and not, say, an HTTP
upstream, and how `describe` groups them. A kind that claims it and whose plugin registers no engine
is a broken plugin, not a broken tree.

This is the RFC's second schema change, and a smaller one:
`packages/core/schemas/connection-kind.schema.json` gains an optional boolean `storage`, described as
"a connection of this kind reaches a storage engine; `@storage` stores may name it". Like `resolves`
it is a new optional property, so every existing kind document still validates (*Compatibility*). The
alternative -- `@storage` keeping a list of the kinds it knows -- is the enum this RFC just removed,
wearing a different hat: an engine we never wrote could not join it.

**Which engines exist is not this RFC's list.** A store names a connection kind, and any plugin that
grants a kind marked `storage` and registers an engine for it is an engine. RFC 0022's SQLite and
MySQL become two more packages rather than two more values of an enum, and a tree can carry an engine
we never wrote.

**`@storage/store.port.json`.** Every operation takes exactly two static fields: `store` (string,
`static`: the path of a store document) and `collection` (string, `static`: a key of its
`collections`). Nothing else names the record type. The pair *is* the type: the collection declares
`of`, so a call site that repeated it could only agree or disagree, and agreeing is not information.
None is `pure`; none `refuses`; none `holds`.

**How `$T` is resolved, since no call site carries it.** Every native operation today binds a type
variable from a `type` field at the call site (`binds: $T` on `@std/object.port.json#make`), which is
why an earlier draft of this RFC repeated the shape. A store makes that indirect, and the indirection
is the point: the type is a fact of a document the checker already reads. An operation declares

```
"in": { "store": { "type": "string", "static": true, "resolves": { "$T": "collections[collection].of" } } }
```

`resolves` is a new key on a native operation's input, read by the compiler alone: given the static
value of that input, it names the document to load and the path within it whose value is a type
reference, and binds the variable to that type. A segment may take a key rather than a fixed name,
written two ways: `[input]` takes it from another static input of the same call, so one expression
covers every collection of a store; `{sibling}` takes it from a field beside the one just read. A path
that reaches a type reference and goes on follows it into the shape it names, which is the one place a
path leaves the document it started in. Where a type variable comes from is thereby always written in
the port document -- `describe` prints it, and no caller repeats it.

This is a core change, and the smallest one that removes the repetition. `resolves` is a new optional
key on a contract's field: `$defs/field` in `packages/core/schemas/common.schema.json`, where it sits
beside `binds` and `static` and where its grammar is described, and `Field` in
`packages/core/src/model.ts`, which mirrors it. The schema is the half that matters for an author,
since `$defs/field` is `additionalProperties: false` and an editor completes against it. Two sites bind variables
today and both assume a variable comes from a literal at the call site -- `checkTypeField` in
`packages/compiler/src/check/inputs.ts`, which ends `if (field.binds) this.subst[field.binds] = type`,
and `bindings()` in `packages/compiler/src/documents.ts`, which skips any field that is not
`field.binds && field.type === 'type'`. Each gains the second channel: where a static field carries
`resolves`, read its literal, open that document through the registry, read the path, and put the
type in the same `subst`. `documents.ts` is shared by the checker and the compiler precisely so the
two cannot disagree about what a call site binds, and that is why the channel is added there rather
than in the storage plugin.

Everything downstream is untouched: once `subst['$T']` holds a type, `substitute` and `unify` in
`packages/core/src/assign.ts` behave exactly as they do for `@std/object.port.json#make`, and
`checkValueField` already substitutes before holding a value to its contract, so `record: $T` on `put`
is held to the collection's shape by machinery that exists.

It is deliberately not a general expression language: a path of field names, each segment optionally
taking a key by a static input of the same call (`collections[collection].of`) or by a sibling field
(`of{key}`), resolving to a value that must be a type reference. A path outside that grammar is refused
by the schema, at the field that writes it; a contract that resolves from a field that is not static, or
takes a key by an input the operation has not got, is refused when the plugin loads (D011) -- not when a
graph runs.

| Operation | Accepts, beyond store/collection | Returns | Answers |
|---|---|---|---|
| `get` | `key: $K` | `{ record?: $T }` | the record, or `record` absent |
| `find` | `where?: unknown`, `order?: @storage/Order.shape.json[]`, `limit?: number`, `offset?: number` | `$T[]` | the matching records, in order; every record when `where` is absent |
| `count` | `where?: unknown` | `number` | how many match |
| `put` | `record: $T`, `replace?: boolean` | `{ record?: $T, conflict: boolean }` | the record as stored and `conflict: false`; where a record of that key exists, it is replaced when `replace` is true (the default), and otherwise nothing is written and the answer is `record` absent with `conflict: true` |
| `patch` | `key: $K`, `changes: unknown` | `{ record?: $T }` | the record after the change, or `record` absent when there was none |
| `remove` | `key: $K` | `{ record?: $T }` | the record that was removed, or `record` absent |
| `newKey` | none | `$K` | a fresh key that no record of the collection has |

**`put` and `replace`.** One verb writes. `replace` defaults to true, so the common `put` is the
upsert the name suggests; a graph that must not overwrite sets `"replace": false` and routes on
`conflict`, which is why the answer carries the flag rather than failing the node. There is no
`insert`: a second verb would differ from `put` in one boolean and force every reader to learn which
one they hold. RFC 0004 makes a `get`-then-`put` pair atomic for the cases a flag cannot express.

**`$K`, the key's type.** A key is whatever type the collection's key field has -- `$K` is resolved
from the store beside `$T`, by the same `resolves` key
(`collections[collection].of{key}.type`: `of` is followed into the shape it names, and `{key}` takes
the field whose name the collection's `key` holds), so
`get`, `patch` and `remove` accept that type and `newKey` answers it. The port says nothing about
which types a key may be: that is the shape's business, and the engine's. A collection keyed by a
`number` field types its `get` with a number and no rule in this RFC objects. What each engine can
key by, and what `newKey` answers for it, is the engine plugin's own judgment (its X rules), stated
below with the engines.

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

**Two stores, one connection.** Nothing stops two features declaring a store over the same connection,
and they should be able to: one database per tree is the normal case. A collection is therefore named
by the pair (connection, collection name), not by the store document -- two stores over one connection
that both declare `entries` name the *same* collection, and if their shapes differ the engine meets
two shapes for one table. X207 refuses that: two collections of one connection with the same name and
a different `of`. The same name with the same shape is allowed and is how two features share a table
deliberately. Prefixing collection names per feature was the alternative, and it is rejected because a
table's name would then be a fact no document states.

**`@storage/storage.port.json`**, the engine's own operations, for startup:

| Operation | Accepts | Returns | Answers |
|---|---|---|---|
| `ensure` | `store: string, static` | `{ collections: number }` | creates every collection of the store that does not exist yet, from its shape, and never alters one that does; what that means is the engine's (nothing to do, for memory) |

`ensure` is an effect, not `holds`: a startup step reaches it through a domain port bound to a data
graph, the way the example's `Reach the entry store` step does today (B006 stays as it is).

**How a shape becomes a table**, in `@wilanis/plugin-storage-postgres` and nowhere else -- `@storage`
never learns what a column is. Table: the collection name, in the connection's schema.
Column per field, named as the field. `string` → `text`; `number` → `double precision`; `boolean` →
`boolean`; a shape, a list, `unknown` → `jsonb`; `blob` → refused (X221). A required field is `NOT
NULL`; the key is `PRIMARY KEY`. An `enum` is `text`; the handler judges the value against the shape,
not the database. What is read is judged with `conforms` from `@wilanis/core` before it is answered,
as `@blob/csv.port.json#parse` judges a row, so a row written outside wilanis that no longer fits the
shape fails the node rather than reaching a graph.

### Checker rules

Each plugin judges only what it owns, which is what splitting the engines out buys: `@storage`'s rules
never mention an engine, and an engine's rules never mention a graph. `@storage` takes X2xx and each
engine a band of its own (`@auth` owns X1xx, `@http` X001-X003).

`@storage`'s `check`:

| Code | Where it lives | Refuses when | Hint |
|---|---|---|---|
| X201 | `plugin-storage/src/rules.ts` | a collection's `of` is neither a core shape nor a shape a plugin grants (an edge shape is refused: the world's shape is not what a tree keeps) | `wilanis ls shape` |
| X202 | same | a collection's `key` is not a field of `of`, or that field is optional | name a required field of the shape |
| X203 | same | a store's `connection` is of a kind not marked `storage`, or of a kind no loaded plugin grants at all | add the engine's plugin to `project.json → plugins`; `wilanis ls connection` |
| X204 | same | a call's `store` names no store document, or its `collection` is not one of its collections | `wilanis describe <the store>` |
| X205 | same | a `where`, `order`, `changes` or `key` is given to an operation that does not accept it, or a `find` is given an `order` naming no field of the shape | `wilanis describe @storage/store.port.json` |
| X206 | same | a collection's name is not an identifier, or one store declares the same collection name twice | rename the collection |
| X207 | same | two collections of one *connection* share a name and declare a different `of` | rename one, or give both the same shape if the table is meant to be shared |

X202 says nothing about the key's *type*: a key is whatever the shape says it is, and which types can
be kept and generated is the engine's judgment, below. `@storage` has no rule against a `blob` field
either -- the blob registry keeps bytes and a handle is a value like any other; an engine that cannot
write one refuses it.

An engine plugin's `check`, by the contract every engine meets -- `@wilanis/plugin-storage-postgres`
(X22x):

| Code | Where it lives | Refuses when | Hint |
|---|---|---|---|
| X221 | `plugin-storage-postgres/src/rules.ts` | a collection kept over a postgres connection has a field this engine has no column for: a `blob` (bytes live in the blob registry) | store the handle's id as a string |
| X222 | same | a collection's key field is of a type this engine cannot key by, or one `newKey` cannot answer under `keyType` (`identity` over a `string` key, `uuidv7` over a `number`) | set the plugin's `keyType`, or key by another field |
| X223 | same | a collection name is not a legal table name in the connection's schema, or two collections of one connection collide once folded to lower case | rename the collection |

`@wilanis/plugin-storage-memory` (X21x) has no rules: it keeps any value of any shape, and keys by
any type, so there is nothing for it to refuse. A plugin with an empty `check` is allowed and says
something true.

The compiler, generic to every kind (numbers assigned when the implementing PR lands; the current
highest are A006 B008 C002 D010 G013 L008 P003 R001 S001 T006):

| Code | Where it lives | Refuses when | Hint |
|---|---|---|---|
| R001 | `check/contracts.ts`, a new `checkStore` | `connection` or a collection's `of` names a document that does not exist | `wilanis ls connection` / `wilanis ls shape` |
| L0nn | `checkStore`, through `Judge`'s visibility | `of` names a core shape of another feature that feature does not export | add it to that feature's `exports`, or keep the store where the shape is |
| D008 | `placement.ts`, existing | a store outside `data/` | existing |

### Runtime behaviour

**Handlers, and how they reach an engine they cannot import.** `PluginModule.handlers` in
`@storage` maps the seven `store.port.json` operations and `ensure`. A handler reads the store
document through `ctx.env` the way `@http`'s `request` reads a connection (`connectionOf` in
`packages/plugin-http/src/request.ts`): `env.canon` canonicalises the `store` path, the registry hands
the document, `env.connections[canonical]` the connection, `env.resolveType` the shape.

Then it needs the engine, which lives in another package that `@storage` must not depend on -- an
engine plugin depends on `@storage` for the contract, never the reverse, so the arrow points the way
every other arrow in the workspace does. The seam is the hook plugins already have: an engine plugin's
`postLoad` registers itself, under the connection kind it grants, in a table the environment carries.
`postLoad` is the right hook and not merely a convenient one: an engine must not exist before the tree
it serves has been loaded and judged, and `postLoad` is by definition the moment after both.

```ts
// @wilanis/plugin-storage-postgres, postLoad
engines(ctx.env).register('@storage-postgres/postgres.connection-kind.json', makePostgresEngine(ctx));
```

`engines(env)` is exported by `@wilanis/plugin-storage` and is the whole of the contract between the
two: a table kept in a `WeakMap` keyed by `env.connections`, so nothing is global and a reload starts
clean. It is keyed by that member and not by `env` itself because the embedder hands a handler a copy,
`{ ...env, blobs }`, whenever a run carries a blob scope -- the http listener does on every request --
so a table keyed by the object would be found by `postLoad` and missed by the first request.
`connections` is built once for the tree by `buildEnv` and carried by every copy, which makes it the
name of the environment where the object is not. (`throttleFor` in `@http` keys on `env` and has the
same flaw; it is not repeated here.) `@storage`'s handler looks the connection's `kind` up in it and
fails the node with a message naming the missing package where no engine registered -- which X203
has already refused at check time, so the run-time message is for a plugin that failed to load, not
for a tree that is wrong.

**The table exists before any engine registers, and that is not luck.** `postLoad` runs the hooks in
`project.json` order, serially, and tears them down in reverse (`postLoad` in
`packages/runtime/src/serve.ts`). Nothing sorts that list, so a tree that names its engine before
`@storage` would, on a naive reading, register into a table that does not exist yet. Two things make
the order irrelevant instead of merely usually-right:

- `engines(env)` **creates the table on first use**, by either side. It is a `WeakMap` lookup with a
  default, not a structure `@storage` builds in its own `postLoad`; an engine that registers first
  makes the table and `@storage` finds what is already there. `@storage`'s `postLoad` therefore does
  no setup an engine could race -- it opens nothing and registers nothing.
- What an engine needs at registration time is the *contract*, which is a module import resolved
  before any hook runs, never a live object of `@storage`'s.

So there is no ordering requirement to state in `project.json`, and none for an author to get wrong.
That is a deliberate design constraint on the seam, not an accident of it: were the table something
`@storage` had to build first, the RFC would owe the loader a dependency order between plugins, which
is a change to how every plugin loads and far beyond what storage should cost. Teardown inherits the
same property -- reverse order stops the engines before or after `@storage` indifferently, since
`@storage` holds no pool and closes nothing.

**The `Engine` interface**, exported by `@wilanis/plugin-storage` in `src/engine.ts`: `get`, `find`,
`count`, `put`, `patch`, `remove`, `newKey`, `ensure`, each taking the collection, its shape, its key
field and the operation's arguments, and answering values -- no SQL, no dialect, no Kysely in the
signature. It is a published interface of the package rather than an internal one, because a third
package implements it; that is what makes "an engine is a plugin" true rather than decorative. A
`where` reaches the engine as the grammar's tree, and each engine compiles it: the memory engine to a
predicate, the postgres engine to Kysely expressions. The evaluator for the grammar (parsing and
validating it) stays in `@storage`, so every engine judges the same filter the same way.

`@wilanis/plugin-storage-postgres` makes one Kysely instance per connection, kept in its own
`WeakMap`; its `postLoad` opens nothing eagerly and hands back a teardown that destroys every pool it
made. `@wilanis/plugin-storage-memory` is a `Map` per store and collection, living exactly as long as
the process; its `postLoad` registers the engine and holds nothing to tear down.

**Rehearsal, fuzz, regress.** Nothing changes, and no engine is involved. Every operation is an
effect, so `stubEffects` in `packages/runtime/src/stubbing.ts` answers a generated value of its return
type with `$T` bound from the store document (the `resolves` above), and the branch solver reaches
both sides of `has(record)`. `rehearse` never reaches a non-pure node, so it never reaches an engine
at all -- not even the memory one.

**Start.** `wilanis start` runs `postLoad`, then the startup steps; a `prepare` step bound to `ensure`
fails the start when the engine is unreachable, so the port never opens over a missing store.

**Discovery of effects.** `Judge.effectsOf` and L003 already refuse a storage operation the feature
does not list; nothing to add.

### Discoverability

- `wilanis ls store` lists the stores; `wilanis describe <store>` prints the connection, the engine
  that grants its kind (`granted by @storage-postgres (@wilanis/plugin-storage-postgres)`, the way
  every native port already names who grants it), each collection with its shape, its key and its
  key's type, and the graphs that run an operation against it (found the way `describe` on a session
  shape lists who writes what).
- `wilanis describe @storage/store.port.json` lays the port out like any native port; every field is
  described in the document, including the `where` grammar.
- `wilanis map` prints a store the way it prints an upstream connection today: `route → port → graph → store entries (get)`.
- The viewer draws a store's page, and a graph node that runs a storage operation links to the store
  and the collection.

### Plugin contract

`PluginModule` is unchanged: every plugin here uses `root`, `docs`, `handlers`, `check` and `postLoad`
as they are, and an engine registers itself from `postLoad` rather than through a new hook. What does
change is the *contract a port document may express*: `resolves` on a field, in
`packages/core/schemas/common.schema.json` and `Field` in `model.ts`. See *Compatibility*.

## Compatibility

Additive for every existing document. One schema file is added and `KINDS` gains an entry, so the D001
hint that lists the kinds gains a name; no existing document changes meaning. The example gains
documents and a profile and keeps the REST binding.

Two existing schemas change, both by gaining one optional property, and both compatible under RFC 0008.

The smaller: `connection-kind.schema.json` gains `storage`, a boolean, so an engine plugin's kind can
say it reaches a storage engine. Every kind document that omits it validates as before and means what
it did.

The larger is `resolves`, and it touches an **existing schema**, not only
the TypeScript. A contract's field is `$defs/field` in `packages/core/schemas/common.schema.json`,
which is `additionalProperties: false`, so a port document carrying `resolves` is refused by
validation until the property is declared there beside `binds` and `static`. `Field` in
`packages/core/src/model.ts` and that `$def` mirror each other, as every kind's interface and schema
do, and `validate.ts` joins them.

Under RFC 0008 this is a **compatible** change: a new optional property, so every document that
validates today still validates, and the schema is edited in place at the address `main` serves. It
does not open `schemas-v2`. It does mean this RFC is one of the accepted RFCs that still changes a
schema, which is what 1.0 waits on -- the freeze comes after the last such change, not before it, and
the release gate refuses a publish until `schemas-v1` is tagged.

Two smaller consequences of editing the shared `$def`. `$defs/field` is referenced by both
`shape.schema.json` and `port.schema.json`, so `resolves` becomes syntactically legal on a shape's
field, where it means nothing; that is the looseness `binds` already carries ("Native contracts only"
is enforced by its description and by the checker, not by the schema), and this RFC follows the
existing rule rather than tightening it -- splitting `$defs/field` into a shape field and a contract
field is its own change and its own RFC. And the property's description in the schema is where the
path grammar is written down, since the schema is what an editor completes against.

IR v1 stays v1: a resolved `$T` is the same lowered type it would have been had the call site spelled
it, so nothing about the intermediate representation changes shape.

## Tests

Each package tests what it owns, and one suite is shared so that every engine answers the same
questions.

`packages/plugin-storage/test/`:

- `port.test.ts`: a small tree loaded with `loadTree` and run through the `Embedder`, as
  `packages/plugin-http/test/harness.ts` does, over `@wilanis/plugin-storage-memory` (a
  devDependency, the way the runtime depends on the http plugin for tests): put, get, find with every
  operator and combinator, order, limit and offset, patch, remove, count, `newKey` uniqueness,
  absence answered as `record` absent, `put` with `replace: false` answering `conflict: true` and
  writing nothing, a record that does not fit the shape failing the node.
- `resolves.test.ts`: `$T` and `$K` bound from the store, not from the call site: a graph that reads
  a field the collection's shape lacks is refused by a G rule, a collection keyed by a `number`
  types `get` with a number, and `describe` prints where each variable comes from.
- `rules.test.ts`: one sabotage per rule, X201 to X207, each breaking the small tree and expecting the
  code, as `packages/plugin-auth/test` does for X101-X103. X207 needs two stores over one connection.
- `src/suite.ts`, published as `@wilanis/plugin-storage/suite`: the port's behaviour as a suite a package
  exports and an engine's tests import, so "this is an engine" has one meaning that is executable. It lives
  under `src/` and not `test/` because an engine is a separate package and `files` ships `dist` and `docs`
  alone; it asserts with `node:assert/strict` and names no test framework, so vitest stays out of a runtime
  package. Not a test file itself.
- `engines.test.ts`: the registration table, both ways round. A tree whose `project.json` names the
  engine *before* `@storage` works exactly as one that names it after, and a tree that names no engine
  fails the node with the message that says which package is missing. This pins the ordering claim
  above, which is otherwise the kind of property that holds until someone changes `postLoad`.

`packages/plugin-storage-memory/test/engine.test.ts`: `suite.ts` against the memory engine, plus the
`Map`'s lifetime (a second `loadTree` starts empty).

`packages/plugin-storage-postgres/test/`: `engine.test.ts` runs `suite.ts` against a database named
by `WILANIS_TEST_POSTGRES_URL`, skipped when the variable is unset -- so a contributor without a
database still runs everything else; `ensure.test.ts` creates the tables and is idempotent;
`rules.test.ts` sabotages X221 to X223.

`packages/runtime/test/example.test.ts`: the example under the `local` profile rehearses with every
branch settled, and `startup.test.ts` runs `prepare` before `listen`. `packages/core/test/validate.test.ts`:
the `store` baseline. The compiler's new rows are exercised through sabotaged copies of the example in
`packages/runtime/test/sabotage.test.ts`.

## Implementation plan

1. **The `store` kind in core.** `store.schema.json`, `StoreDoc`, `KINDS`, `HOME`, the optional
   `storage` boolean on `connection-kind.schema.json`, the validate baseline, the row in
   `templates/CLAUDE.md`, the `wilanis new store` scaffold. `good first issue` for the scaffold and the row.
2. **`resolves` in core and the compiler.** The property on `$defs/field` in
   `packages/core/schemas/common.schema.json` with the path grammar in its description, the key on
   `Field` in `packages/core/src/model.ts`, a case in `packages/core/test/validate.test.ts` (a port
   document that carries it validates; one whose path is malformed does not), its resolution in
   `checkTypeField` (`check/inputs.ts`) and `bindings()` (`documents.ts`) so the checker
   and the compiler bind `$T` and `$K` alike,
   the stubs reading the bound type, `describe` printing where a variable comes from, and the refusal
   when a port document's `resolves` names a path that is not a type reference. Its own tests in
   `packages/core/test` and `packages/runtime/test`; nothing storage-specific is added to core.
3. **`checkStore` in the compiler.** References resolve, the shape is visible; sabotage tests.
4. **`@wilanis/plugin-storage`.** `packages/plugin-storage`: `docs/` (plugin.json, the two ports,
   `Order.shape.json`; no connection kind), the module, the exported `Engine` interface and
   `engines(env)` table, the handlers, the `where` evaluator, `suite.ts`. Workspace member; added to
   `npm run release` after `plugin-auth`.
5. **`@wilanis/plugin-storage-memory`.** Its own package, not an entry point of `@storage`: the
   connection kind, the engine, `postLoad` registering it, `engine.test.ts` over the shared suite. The
   first proof that an engine needs nothing but the contract. `good first issue` once step 4 lands.
6. **The rules.** `@storage`'s X201 to X207 and `rules.test.ts`.
7. **`@wilanis/plugin-storage-postgres`.** Kysely with `pg`: the connection kind, the plugin's
   settings, the shape-to-table mapping, `ensure`, the operations, the filter compiled to Kysely
   expressions, X221 to X223, `engine.test.ts` behind the environment variable.
8. **The example.** `entries.connection.json` (the memory kind), `entries.store.json`, the store
   binding and its data graphs, the `local` profile, the `prepare` operation and step; the example's
   README.
9. **Discoverability.** `ls store`, `describe` of a store and of the port, `map`, the viewer page.
   `good first issue` for the viewer page.
10. **Documents.** The README's *words* section gains *Store*; `templates/CLAUDE.md` gains the rule
    about absence answered as `record` absent; a README in each of the three packages, the engines'
    saying what an engine must implement.

## Drawbacks and alternatives

- **`resolves` is a core change, and this RFC carries it.** Dropping `type` from the call sites is
  what makes a store worth having -- the collection knows the shape, and a call that repeats it can
  only be redundant or wrong -- but the type system had no way to bind a variable from another
  document, so this RFC adds the smallest one. The cost is a new key in the operation input contract
  that only a plugin with a declaring document will ever use, and a path expression in core, however
  narrow. The benefit is that every storage call site is two static strings and its arguments, and
  that where a type comes from is written down rather than repeated.
- **One connection per store, chosen by the document, not the profile.** A profile swaps bindings, not
  connections, so a store whose connection names the memory kind names it for every profile. The
  example works around it with `local` and `live` binding different *bindings*. Whether a profile may
  swap a connection is RFC 0005's question, since `@auth`'s store has the same problem. Engines being
  separate plugins makes that question sharper, not softer: swapping engines is now swapping a
  connection's `kind`, which is exactly what a profile cannot do yet.
- **Three packages instead of one.** `@storage`, `-memory` and `-postgres` mean three `package.json`
  files, three READMEs and three entries in `npm run release` for what one package could have shipped
  behind an enum. What it buys: a tree that uses memory installs no driver, a driver's dependency
  never reaches a tree that does not name it, each engine judges its own limits in its own X band, and
  an engine we did not write is a plugin like ours rather than a patch to our enum. RFC 0022's SQLite
  and MySQL are the test of this, and they get cheaper.
- **A raw operation.** `@storage/sql.port.json#query` with a static `sql`, `params`, and `returns:
  unknown` would let an author reach what the port cannot say. It is deliberately absent from this
  RFC: it cannot be checked against the store, `rehearse` can only stub it as `unknown`, and every
  such node weakens what the tree guarantees. If it is ever added, it is its own port, legal only in
  `data/`, marked in `describe` as opaque, and counted separately in the manifest (RFC 0026).
- **No `ensure` at all** and a printed DDL instead: a CLI command would need the runtime to reach into
  the plugin, which the contract forbids. An operation a startup step fires keeps the plugin in charge
  and the tree in control of when it runs.

## Open questions

None before `accepted`: the review settled every one, and this section records what it decided rather
than dropping the questions, so the reasoning survives with the spec.

**Settled in review.**

- **The key's type is the shape's business and the engine's, never the port's.** `$K` is resolved from
  the collection's key field; X202 requires a required field and says nothing about its type; an
  engine refuses in its own band what it cannot key by (X222 for postgres).
- **One verb writes.** `put` takes `replace`, defaulting to true, and answers `{ record?, conflict }`.
  There is no `insert`.
- **`find` does not require `limit`.** A rule about unbounded reads is RFC 0015's if it is anyone's.
- **`rehearse` reaches no non-pure node**, so no rehearsal reaches an engine, not even the memory one.
  This is a fact of the runtime, not a knob this RFC could turn.
- **No call site names a record type.** `resolves` is accepted: a native operation's static input may
  say where a type variable comes from, read as a path from the document that input names. It costs
  core one optional property on a field (*Compatibility*) and pays for the repetition every storage
  call site would otherwise carry. The grammar needed a second form after all -- `{sibling}`, so that a
  key's type can be read from the record's own shape -- and taking it kept `$K` in the port document,
  where a reader can see it, rather than in the `resolveType` plugin hook that was the fallback.
- **An engine registers from `postLoad`.** It is the hook whose meaning is "the tree is loaded and
  judged", which is exactly when an engine may exist, and the registration table is created by
  whichever side reaches it first, so no plugin order is required of an author (*Runtime behaviour*).
- **`@wilanis/plugin-storage-memory` is its own package.** Not a second entry point of `@storage`, and
  not conditional on how the implementation turns out: "every engine is a plugin" is the design, and
  the first two engines both obeying it is what keeps the claim honest.

**Left to implementation, deliberately.** Two things, because they are the implementing agent's and
cost nothing to defer: the exact Kysely expressions behind `contains` and `startsWith`, and whether `jsonb`
fields may be ordered by. Neither changes a document, a rule, a schema or the plan -- they are choices
inside `@wilanis/plugin-storage-postgres` that the shared suite judges by behaviour. If one of them
turns out to need a rule, it is a rule in that plugin's own band, added the way any rule is.
