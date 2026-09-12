# @wilanis/plugin-storage

The `@storage` plugin for wilanis: records of a shape, kept behind a connection, read and written through one
generic port. A feature declares a **store** -- which shapes it persists, under which collection names, keyed
by which field, over which connection -- and its data graphs name the store and the collection and nothing
else. The collection is where the record type is written down, so no call site repeats it.

```
npm install @wilanis/plugin-storage
```

```json
{ "use": "@storage", "from": "@wilanis/plugin-storage" }
```

This package says what a store is and what may be asked of one. **How records are kept is an engine plugin's
business**: `@storage` speaks no engine's language, carries no driver, and depends on `@wilanis/core` and
`@wilanis/engine` alone. Name an engine's package beside this one in `project.json` -- in either order -- and a
store whose connection is of the kind it grants is kept by it.

## What may be asked

`@storage/store.port.json`, every operation taking `store` and `collection` and nothing else that names a type:

- `#get` one record by its key; `#find` the records a filter matches, ordered and paged; `#count` how many.
- `#put` one whole record: the upsert the name suggests, or, with `"replace": false`, a write that answers
  `conflict` instead of overwriting. `#patch` some fields of one; `#remove` one, answering what it removed.
- `#newKey` a key no record has, so what identifies a record is written by a node a reader can see.

An absent record is answered as `record` absent rather than as a failure, so a graph routes on `has(record)`.
`@storage/storage.port.json#ensure` prepares what a store declares, from a startup step.

`$T`, the record's type, and `$K`, its key's, are read from the store document by the port's `resolves` --
`collections[collection].of` and `collections[collection].of{key}.type` -- so the checker types every call site
from the collection the call names.

## The `where` grammar

A filter is an object whose keys are fields of the collection's shape. A value is a literal (equality) or a
predicate of `eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `in`, `notIn`, `has`, `contains`, `startsWith`; `all`, `any`
and `not` sit beside the field names. A field that is a shape or a list may only be tested with `has`. The
grammar is parsed here, once, so every engine judges one filter the same way -- and a misspelled field or
operator is named rather than quietly compared.

## Writing an engine

An engine is a plugin of its own. It grants a connection kind marked `"storage": true`, implements `Engine`
from this package, and registers itself from `postLoad`:

```
engines(ctx.env).register('@your-engine/your.connection-kind.json', makeEngine(ctx));
```

The table is created by whichever side reaches it first, so nothing has to be said about plugin order. What
"being an engine" means is executable: `@wilanis/plugin-storage/suite` exports the cases every engine must
answer alike, as plain `{ name, run }` pairs your own `it` can run.

Every operation is an effect, so each lives in a data graph and is listed in the feature's `effects`. A
rehearsal stubs them and reaches no engine at all.

Part of [wilanis](https://github.com/wilanis/wilanis-js). Apache-2.0.
