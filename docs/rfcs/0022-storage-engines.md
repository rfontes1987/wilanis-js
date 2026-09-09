# RFC 0022: More storage engines: SQLite, MySQL, and declared capabilities

- **Status:** draft (stub)
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

RFC 0002 makes each engine its own plugin granting its own connection kind, so this RFC adds two
packages, `@wilanis/plugin-storage-sqlite` and `@wilanis/plugin-storage-mysql`, rather than two values
of an enum: each implements the `Engine` interface `@wilanis/plugin-storage` exports, registers itself
in `postLoad`, and passes the shared suite. What is genuinely new here is the `capabilities` block
every storage connection kind gains:

```json
"capabilities": { "transactions": true, "returning": true, "skipLocked": false, "json": true,
  "partialIndexes": false, "transactionalDdl": true }
```

The plugin's `check` (its X rules) reads the capabilities of every storage connection a profile binds and
refuses: an `atomic` graph (RFC 0004) over an engine without transactions; a queue over storage (RFC 0009)
without `skipLocked`; a `unique` with a `where` without partial indexes; and so on, each with the hint to
change the engine or the declaration. SQLite ships with `better-sqlite3` behind Kysely's dialect, in the same
package, since the point is zero setup for development and `rehearse` gets a real store to run against.
MySQL follows when someone needs it. Because an engine is already a package, the work of this RFC is
the capability vocabulary and the rules over it, not the packaging.

## Checker rules, tests, implementation plan

Written when this RFC is expanded to a full spec.

## Compatibility

Additive: two packages, each with its connection kind under its own `docs/`, and a `capabilities` block
on the storage connection kinds RFC 0002's engines already grant.

## Drawbacks and alternatives

Every capability is a branch in the plugin's handlers and a row in its test matrix, and the matrix grows
with the product of engines and features; the RFC should cap the capability list and say what is not
negotiable (transactions). The alternative, a lowest common denominator with no capabilities, forbids
PostgreSQL features the first engine needs.

## Open questions

- RFC 0002 settles that `rehearse` reaches no non-pure node, so a real store never backs a rehearsal.
  Does anything here reopen that -- a `wilanis run` against a throwaway SQLite file is not rehearsal and
  needs no rule, but is there a case for a command between the two?
- Are capabilities declared by the connection kind (per engine) or discovered from the connection at
  `postLoad` (per server version)?
- Is a MySQL dialect worth its test matrix before anyone asks, or does it wait for a contributor?
