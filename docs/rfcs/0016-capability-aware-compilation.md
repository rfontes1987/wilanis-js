# RFC 0016: Capability-aware compilation: what a tree requires against what an environment permits

- **Status:** draft (stub)
- **Areas:** `area:compiler`, `area:runtime`
- **Tracking issue:** #18
- **Depends on:** RFC 0013 (deployment and profiles)

## Summary

A profile declares the effects its environment permits, and the checker refuses a tree that requires an
effect the active profile does not permit. The tree already declares what it requires; this RFC adds the
other half.

## Motivation

The declaration side is built: `feature.json → effects` lists the effectful operations a feature may reach,
and L003 in `packages/compiler/src/check/graph.ts` refuses a data graph that runs one not listed
(`judge.effectsOf` in `check/judge.ts` reads the list). What is missing is the environment's side: nothing
says "production may write the store and call the monitor API, and nothing else", so a generated feature
that quietly adds `@http/http.port.json#request` to its own `feature.json` passes. The report's
"capability-aware compilation" is exactly this second list and the comparison.

## Sketch

A profile in `project.json` gains `permits`, a list of operation references or of whole ports:

```json
"profiles": { "production": { "bindings": { "...": "..." },
  "permits": ["@storage/store.port.json", "@http/http.port.json#request", "@blob/csv.port.json"] } }
```

A new C rule (project family, `check/project.ts`) refuses, per profile, every effect any feature requires
that the profile does not permit, naming the feature, the operation and the profile, with the hint to add
it to `permits` or remove it from the feature. A profile without `permits` permits everything, so existing
trees are unaffected; the security model (RFC 0020) recommends every production profile declare one.

Capabilities finer than an operation, such as which hosts `http.request` may reach, are the connection's:
a profile permits `@http/http.port.json#request` and the connections the profile binds say where. The
manifest (RFC 0026) prints the required list per profile so a reviewer compares it with the permitted one.

## Checker rules, tests, implementation plan

Written when this RFC is expanded to a full spec.

## Compatibility

Additive field on `project.schema.json`. IR v1 unaffected until 1.0.

## Drawbacks and alternatives

Two lists that must agree is one more thing to keep in step, and an agent's fix for the refusal will often
be to widen `permits`; the hint should say to remove the effect first. The alternative, deriving `permits`
from the bindings a profile chooses, was rejected: the point is a list a human wrote.

## Open questions

- Is `permits` per profile (this sketch) or a separate `environments` block that a profile names?
- Does an include (`project.json → includes`) bring its required effects into the comparison, and can the
  host refuse to permit one of them, effectively disabling part of the include?
- Should `wilanis start` re-check `permits` at run time against the actual plugin set, or is the checker's
  judgement enough?
