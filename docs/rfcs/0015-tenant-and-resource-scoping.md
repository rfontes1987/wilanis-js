# RFC 0015: Tenant and resource scoping as a provenance rule

- **Status:** draft (stub)
- **Areas:** `area:compiler`, `area:plugin-storage`
- **Tracking issue:** #17
- **Depends on:** RFC 0002 (storage), RFC 0003 (store declarations), RFC 0007 (invariants)

## Summary

A store collection declares a field as `scoped` by a resolver that a policy `proves`, and the checker refuses
any write or filter that feeds that field from anywhere else. "The AI forgot the tenant filter" becomes a
refusal with a hint, not a vulnerability found in production.

## Motivation

Multi-tenant applications are what an agent will be asked to write first, and the classic hole is a query
that reads another tenant's rows because one `where tenant_id = ...` was left out. The report proposes
tenant scoping as a first-class concept. This tree does not need a new concept: it already tracks where every
input value comes from, and A006 already forces every trigger reaching a `required` resolver to guarantee it
through its kind or a policy's `proves` (`packages/compiler/src/check/access.ts`,
`packages/compiler/src/check/resolvers.ts`). Scoping is that rule, applied to a store field.

## Sketch

In a store declaration (RFC 0003) a collection marks a field:

```json
{ "collection": "entries", "of": "@monitor/domain/Entry.shape.json",
  "key": "id", "scoped": { "field": "tenant", "by": "@monitor/edge/tenant.resolvers.json#tenant" } }
```

The resolver named is declared `required`, so A006 already guarantees every trigger reaching a graph that
reads it has a policy proving `request.principal` (or whatever the resolver reads). This RFC adds the
provenance rule, a new A code: every storage operation over `entries` must supply `tenant`, in its filter
for reads and removes and in its record for writes, and the value must be the reference `{{tenant}}` to that
resolver and nothing else: not a literal, not `{{in.tenant}}`, not a field of the request body. The
checker walks the sources the way `sources.ts` in the engine does at run time, so the proof is static.

`describe` on the collection says `scoped by tenant (proved by employees-only.policy.json)`, and the viewer
draws the resolver's wire into every scoped node. Resource ownership ("a user reads only their own records")
is the same rule with the resolver reading `request.principal.id`.

## Checker rules, tests, implementation plan

Written when this RFC is expanded to a full spec.

## Compatibility

Additive field on the store declaration (RFC 0003). Nothing changes for a collection that declares no scope.

## Drawbacks and alternatives

An administrative operation that legitimately crosses tenants needs an exemption, and an exemption is where
holes come back; the RFC's position is that such an operation is a separate collection view, declared
unscoped, reachable only behind a policy the checker sees. The alternative, scoping enforced by the storage
plugin at run time from the principal, was rejected: it hides the rule from the checker and the viewer.

## Open questions

- Does a scoped field need to exist on the shape, or does the store add it, so that the domain shape never
  mentions the tenant at all?
- Is one scope per collection enough, or do resource ownership and tenant both apply to the same rows?
- What does `rehearse` solve for the scoped value: the resolver's stub, and does it check that two tenants
  never see each other's stubbed rows?
