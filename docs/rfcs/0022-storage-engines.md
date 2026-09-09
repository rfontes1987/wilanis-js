# RFC 0022: More storage engines: SQLite, MySQL, and declared capabilities

- **Status:** draft (stub)
- **Milestone:** Ecosystem
- **Areas:** `area:plugin-storage`
- **Tracking issue:** #24
- **Depends on:** RFC 0002 (storage)

## Summary

PostgreSQL first, alone, until its semantics are excellent. Then SQLite, because a single file is the
development database every tree wants, then MySQL. Each engine is a connection kind that declares its
capabilities, and the plugin's own rules refuse a declaration or an operation the engine cannot honour.

## Motivation

Kysely speaks several dialects, and it is tempting to promise all of them on the first day. The report
argues, and this stub agrees, that nominal support for five engines with subtle differences is worth less
than one engine done properly; the differences (returning clauses, `SKIP LOCKED`, JSON columns, partial
indexes, transactional DDL) are exactly what RFC 0002's semantics lean on. What the platform can promise is
that the differences are declared, so a tree learns at `wilanis check` time, not in production, that its
engine lacks something.

## Sketch

`@storage/storage.connection-kind.json` is RFC 0002's. This RFC adds `sqlite.connection-kind.json` and
`mysql.connection-kind.json`, and gives every storage connection kind a `capabilities` block:

```json
"capabilities": { "transactions": true, "returning": true, "skipLocked": false, "json": true,
  "partialIndexes": false, "transactionalDdl": true }
```

The plugin's `check` (its X rules) reads the capabilities of every storage connection a profile binds and
refuses: an `atomic` graph (RFC 0004) over an engine without transactions; a queue over storage (RFC 0009)
without `skipLocked`; a `unique` with a `where` without partial indexes; and so on, each with the hint to
change the engine or the declaration. SQLite ships with `better-sqlite3` behind Kysely's dialect, in the same
package, since the point is zero setup for development and `rehearse` gets a real store to run against.
MySQL follows when someone needs it.

## Checker rules, tests, implementation plan

Written when this RFC is expanded to a full spec.

## Compatibility

Additive: connection kinds under the plugin's `docs/`, and a `capabilities` block on the connection kind
schema the plugin already grants.

## Drawbacks and alternatives

Every capability is a branch in the plugin's handlers and a row in its test matrix, and the matrix grows
with the product of engines and features; the RFC should cap the capability list and say what is not
negotiable (transactions). The alternative, a lowest common denominator with no capabilities, forbids
PostgreSQL features the first engine needs.

## Open questions

- Does SQLite become the store `rehearse` uses by default, replacing the stubbed store of RFC 0002, or only
  an option?
- Are capabilities declared by the connection kind (per engine) or discovered from the connection at
  `postLoad` (per server version)?
- Is a MySQL dialect worth its test matrix before anyone asks, or does it wait for a contributor?
