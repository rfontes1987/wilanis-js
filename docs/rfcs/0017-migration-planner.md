# RFC 0017: Migrations derived from store declarations

- **Status:** draft (stub)
- **Areas:** `area:plugin-storage`
- **Tracking issue:** #19
- **Depends on:** RFC 0003 (store declarations)

## Summary

A migration is derived, not written: the difference between the store declarations the database last saw
and the ones in the tree now becomes a plan, printed before it runs, refused when destructive unless
confirmed, and recorded in the store itself.

## Motivation

RFC 0003 makes the store's schema a document the compiler knows, and ships an additive `ensure` that creates
what is missing. That covers a new collection and a new optional field; it does not cover a renamed field, a
narrowed type, a dropped collection or a new `unique` over existing rows. Today those would be a pile of
Kysely migration files outside the tree, which is the code the platform exists to remove and which an agent
cannot be trusted to write against production data. The report's "migration planner" is the right shape.

## Sketch

`wilanis migrate <root> --profile <name>` (the work in `tools.ts`, callable without the CLI) does four things:

1. Reads the version of the declarations the store recorded (a table the plugin owns, holding the JSON of
   the collections as last applied).
2. Diffs it against the tree's declarations and produces a plan: a list of steps, each additive (create,
   add nullable, add index), transformative (rename, widen, backfill a default), or destructive (drop, narrow,
   add `unique` or `required` over existing rows).
3. Prints the plan as `wilanis check` prints refusals: one step per line, the collection and field, and what
   would be lost. Destructive steps are refused unless `--allow-destructive` names each collection.
4. Applies the plan inside one transaction where the engine allows, and records the new version.

A rename is the one step a diff cannot see; the declaration says it (`"renamed": { "from": "title" }`)
and the planner consumes the annotation and asks for its removal on the next run. `rehearse` never
migrates: the stubbed store is created fresh from the declarations every time.

## Checker rules, tests, implementation plan

Written when this RFC is expanded to a full spec.

## Compatibility

Adds a command and a plugin-owned table; the store declaration (RFC 0003) gains an optional `renamed`.

## Drawbacks and alternatives

A derived plan is only as good as the diff, and a backfill that needs business logic (splitting a name into
two fields) is out of its reach; the RFC should say that such a step is a one-off graph run by a CLI trigger,
not a migration. The alternative, hand-written migration documents as a kind, keeps a history an agent must
maintain and was rejected for the first version.

## Open questions

- Where is the applied version recorded when a tree has several connections of the storage kind: per
  connection, and does the plan run per connection?
- Does `wilanis start` refuse to listen when the store is behind the declarations, or migrate on start under
  a setting?
- Down migrations: derive the reverse plan, or declare that the platform only moves forward?
