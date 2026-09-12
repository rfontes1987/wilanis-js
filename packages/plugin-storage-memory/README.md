# @wilanis/plugin-storage-memory

The `@storage-memory` engine for wilanis: an [`@storage`](https://github.com/wilanis/wilanis-js/tree/main/packages/plugin-storage)
store kept in a Map, for exactly as long as the process runs. Nothing is written to disk and nothing outlives
the process -- **stop the tree and the records are gone** -- which is what makes it the store to reach for in
development, in tests, and for the trees under `libraries/` that must check, rehearse and run on their own.

```
npm install @wilanis/plugin-storage-memory
```

```json
{ "use": "@storage-memory", "from": "@wilanis/plugin-storage-memory" }
```

Name it beside `@storage` in `project.json`, in either order, and a store whose connection is of the kind it
grants is kept by it.

## The connection kind

`@storage-memory/memory.connection-kind.json`, marked `"storage": true`, which is how a store knows it may
name a connection of this kind. **It has no settings at all** -- there is no host, no path and no credential
to get wrong, so a memory store is the one store that cannot be misconfigured:

```json
{
  "$schema": "@wilanis/connection.schema.json",
  "description": "the records, kept for as long as this process runs",
  "kind": "@storage-memory/memory.connection-kind.json",
  "settings": {}
}
```

## What it keeps, and where

A collection is the pair of its **connection** and its **name**, as `@storage` says it is: two features
declaring the same collection name over one connection meet the same records, and the same name over another
connection meets none of them.

The maps hang off the engine instance and never off the module, and an instance is registered per environment,
so loading a tree a second time starts empty. A record is deep-copied on the way in and on the way out, so
what a graph does with a record it was given never reaches what is kept.

`#newKey` answers a uuid where the collection's key field is a string and one past the highest where it is a
number; a key of any other type is the tree's own to write, and the engine says so rather than answering
something that is not that type. Every collection exists as soon as it is asked for, so `#ensure` prepares
what a store declares and there is nothing to create.

It opens nothing, so it holds nothing to tear down.

Depends on `@wilanis/core`, `@wilanis/engine` and `@wilanis/plugin-storage` -- the one contract it answers.
What "being an engine" means is executable: this package runs `@wilanis/plugin-storage/suite`, the cases every
engine must answer alike.

Part of [wilanis](https://github.com/wilanis/wilanis-js). Apache-2.0.
