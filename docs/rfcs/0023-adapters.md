# RFC 0023: Adapters: search, cache, email, payment

- **Status:** draft (stub)
- **Milestone:** Ecosystem
- **Areas:** a new plugin each (`@wilanis/plugin-search`, `-cache`, `-email`, `-payment`)
- **Tracking issue:** #25
- **Depends on:** RFC 0011 (retry, idempotency, timeout)

## Summary

Each external service a tree commonly reaches is a plugin of its own: a port, a connection kind, its
external dependency in its own package, nothing in core. The order they are built in follows what the
example project needs, not a list of what exists in the market.

## Motivation

A tree talks to the world through connections, and today the world is HTTP (`@http`), files (`@blob`) and,
with RFC 0002, a database. Every service beyond that (a search index, a cache, a mail provider, a payment
processor) can be reached through `@http/http.port.json#request` with an edge shape per response, and that
is a fine start. A dedicated plugin earns its place when it adds something the generic request cannot: a
typed contract the checker judges, idempotency the operation declares (a payment must carry a `key`, RFC
0011), a connection kind with the right secrets, and a stub `rehearse` can run against.

## Sketch

The rule the report states and this tree already follows: "plugins that carry an external dependency are
always their own package" (`CLAUDE.md`). Each adapter is therefore:

- a package under `packages/plugin-<name>/`, depending on core and engine only;
- `docs/plugin.json` and one or more `*.port.json` with the operations, each marked `pure`, `refuses`,
  `idempotent` or with a `key` as RFC 0011 defines;
- a `*.connection-kind.json` naming the provider's settings and secrets;
- handlers in `src/`, a `check` for what only the plugin can judge (its X rules), and a `test/` against a fake
  provider, as `packages/plugin-http/test` runs against a fake upstream.

Priority is set by the example: a cache for the monitor's upstream (cheap, and it exercises RFC 0011's
idempotency), then email for the access tree's one-time code (today it is printed), then payment as the
worked example of `key`, then search when a tree needs it. No adapter is built before a tree asks for it.

## Checker rules, tests, implementation plan

Written when this RFC is expanded to a full spec.

## Compatibility

Adds packages; nothing in `packages/core/schemas/` changes.

## Drawbacks and alternatives

Each adapter is a package to release, version and keep to the house rules, and an abandoned adapter is worse
than none; the RFC should state the maintenance bar (a fake provider in its tests, a named owner). The
alternative for most services stays available: `http.request` with an edge shape.

## Open questions

- Is a cache a plugin (an effect with a connection) or an operation property (RFC 0011's `idempotent` plus a
  `cache` duration the runtime honours)? The second changes no tree.
- Does one `@email` port cover several providers as connection kinds, the way `@auth` has `directory` and
  `oidc` connection kinds, or is each provider a plugin?
- Which payment provider is the reference, and is a sandbox account something the test suite can assume?
