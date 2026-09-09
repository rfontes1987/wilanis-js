# RFC 0026: The application manifest

- **Status:** draft (stub)
- **Milestone:** The AI advantage
- **Areas:** `area:runtime`
- **Tracking issue:** #NNN
- **Depends on:** RFC 0016 (capability-aware compilation)

## Summary

`wilanis manifest --json` prints what a tree is, as a machine-readable document: its endpoints, ports,
effects by connection, stores, scheduled jobs, policies, privileged operations, secrets and what the
environment must permit. The tree already knows all of it; the manifest is the one place it is said.

## Motivation

`wilanis map` (`packages/runtime/src/discovery.ts`) prints how a request flows from trigger to port to
binding to graph, and `describe` prints one thing in full. Both speak to a person. A provisioner (RFC 0024),
a security review (RFC 0020), a cost estimate and an agent deciding what exists before adding to it all want
the same facts as data. The report's item 20 calls this the major advantage of a formal intermediate
representation, and it is cheap because the discovery code already walks every relation.

## Sketch

One command, work in `tools.ts` (callable without the CLI), output stable and sorted so that two runs diff:

```json
{ "name": "example", "profile": "production",
  "triggers": [{ "kind": "@http/http.trigger-kind.json", "route": "GET /monitor/{id}", "fires": "...", "policies": [] }],
  "ports": { "domain": ["@monitor/domain/monitor.port.json"], "native": ["@http/http.port.json"] },
  "effects": { "@connections/monitor-api.connection.json": ["@http/http.port.json#request"] },
  "stores": [], "scheduled": [], "holds": ["@http/server.port.json#listen"],
  "privileged": ["@monitor/domain/monitor.port.json#remove"],
  "secrets": ["MONITOR_JWT_SECRET"], "requires": ["@http/http.port.json#request", "@blob/csv.port.json#parse"] }
```

Per profile, since bindings and permits differ. "Privileged" is every operation reachable only behind a
policy; "public" is every trigger with none, listed so a reviewer sees them first. The viewer gets a
manifest page from the same function, and `wilanis check --json` (RFC 0019) may embed it. Counts (the
report's "HTTP endpoints: 12") are derived by the reader, not printed.

## Checker rules, tests, implementation plan

Written when this RFC is expanded to a full spec.

## Compatibility

Adds a command; no schema changes. The manifest's own shape is versioned with the IR (RFC 0008).

## Drawbacks and alternatives

The manifest's shape becomes a contract other tools depend on, so it needs the same stability promise as
refusal codes; the RFC should publish its JSON Schema under `packages/core/schemas/`. The alternative,
letting each consumer walk the tree with `loadTree`, is what the viewer does today and is fine for tools in
this repository, not for a provisioner.

## Open questions

- Does the manifest include the included trees' documents inline, marked `included`, or reference the
  package and version?
- Is the manifest computed by the runtime (this sketch) or by the compiler, since everything in it is static?
- Which fields does RFC 0024's image recipe consume, and are they enough to fix the first version's shape?
