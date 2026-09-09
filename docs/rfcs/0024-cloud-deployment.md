# RFC 0024: Kubernetes deployment: a Helm chart and a local cluster

- **Status:** draft (stub)
- **Milestone:** Ecosystem
- **Areas:** `area:runtime`
- **Tracking issue:** #26
- **Depends on:** RFC 0013 (deployment and profiles), RFC 0026 (manifest)

## Summary

A tree deploys to Kubernetes, and to nothing else that costs money: a generated container image, a Helm chart
for the tree and for what its connections need (PostgreSQL, MinIO, a queue, Jaeger), and a script that stands
the whole thing up on a local cluster so anyone can run the example the way it runs in production.

## Motivation

A tree is deployed as documents plus `node_modules`, started by `wilanis start --profile <name>`
(RFC 0013). That is enough for a virtual machine and a person. It is not enough for an agent asked to "put
this in production": it needs a recipe that turns the tree into an artifact a cluster accepts, and a way to
know what the environment must provide (the variables of `project.json → secrets`, the port `listen` opens,
the store the connection names). The manifest (RFC 0026) is that knowledge; this RFC is what reads it.

The project's rule: no vendor. Every piece of infrastructure the roadmap depends on runs on Kubernetes from
an open-source chart, and the repository ships the charts and the instructions, so a reader can reproduce
every milestone demo on a laptop with `kind` or `k3d`. Managed services that speak the same protocols
(PostgreSQL, the S3 API, AMQP) work by construction, but none is required and none is documented here.

## Sketch

- **`wilanis image <root>`** writes a `Dockerfile` (or prints it) from the manifest: the Node version from
  `engines`, the tree and its `node_modules`, the profile as the start command, the port as `EXPOSE`, every
  secret as a documented variable, a health route if the http plugin grants one. The recipe is generated,
  never hand-edited; the tree is the source.
- **A Helm chart for a tree**, `charts/wilanis-tree/`, templated from the manifest: a Deployment (replicas
  are safe once RFC 0005 holds no state on disk), a Service on the listened port, a Secret per
  `project.json → secrets` entry, a ConfigMap naming the profile, and a readiness probe on the health route.
- **Charts for what the tree needs**, as dependencies the chart's `values.yaml` switches on: PostgreSQL
  (CloudNativePG or Bitnami), MinIO for the S3 API (RFC 0005), a queue (RFC 0009), Jaeger or the
  OpenTelemetry collector (RFC 0006). Each is an upstream chart pinned by version, not one we maintain.
- **A local cluster script**, `scripts/cluster.sh`: creates a `kind` cluster, installs the chart with the
  example's values, waits for readiness, and prints the URL. Every milestone demo that needs infrastructure
  runs on this; CI runs the same script on a `kind` cluster in GitHub Actions.
- **Development without a cluster** stays what it is: the `memory` engine, the file blob store, no queue.
  The cluster is for the production profile and for the demos.

## Checker rules, tests, implementation plan

Written when this RFC is expanded to a full spec.

## Compatibility

Adds a command, a chart directory and scripts; no schema changes.

## Drawbacks and alternatives

Upstream charts change under us, and a generated Dockerfile that is wrong is a support burden the project
must carry. Serverless was considered and set aside: a function-per-trigger deployment has no process to
`hold` a listener or a scheduler in, so it would change what a startup list means; it returns only if a
future RFC shows the tree can be split that way without changing its meaning. Provider-specific recipes
(Fly, Render, Cloud Run, ECS) are out: they cost money to test and add nothing the chart does not.

## Open questions

- Does `wilanis image` belong in the runtime, or in a separate `@wilanis/deploy` package so the runtime
  carries no opinion about containers?
- One chart with switches, or one chart per dependency composed by an umbrella chart?
- Which PostgreSQL operator, and whether the chart provisions the database or expects one.
