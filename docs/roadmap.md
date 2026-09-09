# Roadmap

A milestone is a demo: something a person runs and sees that the example could not do before. The
GitHub milestones of `wilanis/wilanis-js` mirror this page, one per heading, and the issues under each are
the RFCs it draws on and the tasks that build it. A milestone closes when its demo runs, by hand and in
the test suite. The RFCs themselves live in [`rfcs/`](rfcs/README.md); this page is the only place that
says which milestone shows which RFC.

Nothing on this roadmap needs a paid service. Every piece of infrastructure a demo needs runs on a local
Kubernetes cluster from an open-source chart the repository ships (see RFC 0024).

## M01 Entries kept in a store

Start the example and the monitor keeps its entries in the storage plugin's memory engine instead of the
upstream API. Draws on RFC 0002 and the call-site rules of RFC 0003.

```
npx wilanis start example
curl -X POST :8080/monitor -d '{...}'   # then GET /monitor/{id} answers what you posted
npx wilanis describe @monitor/data/entries.store.json
```

## M02 Same tree, real database

Start the example under a production profile against PostgreSQL; the startup log shows the store ensured
and its collections created. Not one document changes between profiles. Draws on the PostgreSQL engine of
RFC 0002 and `ensure` of RFC 0003.

```
npx wilanis start example --profile production
startup 1/3 Ensure the entries store: ok, 2 collections
```

## M03 All or nothing

The CSV import records every row and updates the digest in one atomic graph. A bad row in the middle
leaves nothing written; rehearsal prints the rolled-back branch. Draws on RFC 0004.

## M04 Sign in on one instance, stay signed in on another

Two instances of the example share sessions and challenges through storage. Sign in on the first port,
call a gated route on the second. Draws on the auth half of RFC 0005.

## M05 Files in an object store

CSV upload and download run against MinIO, an object store speaking the S3 API, on the local cluster,
with nothing written to the instance's disk. Draws on the blob half of RFC 0005.

## M06 See a request run

Start with `--trace` and every request prints its tree: gate, policies, graphs, effects, timings. The same
trace reaches a local Jaeger through the OpenTelemetry plugin. Draws on RFC 0006.

## M07 The checker knows the rule

An access invariant over every monitor write and a field invariant on the entry shape. Removing a policy
from a route is a refusal; rehearsal reports each invariant as proved or guarded. Draws on RFC 0007.

## M08 Work off the request

The digest is computed by a scheduled job and imports are processed by a worker fed from a queue, beside
the routes. Draws on RFC 0009 and RFC 0010.

## M09 Fails well

Against a flaky fake upstream the trace shows retries honouring declared idempotency and timeouts; a long
run is cancelled and still answers a report. Draws on RFC 0011, RFC 0012 and RFC 0014.

## M10 Ship it

One command produces the image and the manifest; the Helm chart stands the example up on a local `kind`
cluster; a tree that requires an effect the environment does not permit is refused before it listens.
Draws on RFC 0013, RFC 0016, RFC 0024 and RFC 0026.

## M11 Tenants by construction

A second tenant in the example. Feeding the tenant field from the request body is a refusal with a hint.
Draws on RFC 0015.

## M12 Change the schema, get the plan

Add a field to the entry shape and `wilanis migrate plan` prints the migration, refusing the destructive
step until told. Draws on RFC 0017.

## M13 The agent fixes it

Break the example, run `wilanis check --json`, and a small model repairs it in a loop from the
diagnostics. Solved branches become committed scenarios. Draws on RFC 0018 and RFC 0019.

## M14 1.0

Last on purpose: 1.0 is cut only when every accepted RFC that changes a schema has landed or been withdrawn,
so the schemas are final before they are frozen, and nothing is published to npm before that. Then: every
package on npm; in an empty directory, install, init, and an agent session produce a tree that passes check
and rehearse; the security model is published and the `schemas-v1` tag is cut. Draws on RFC 0008 and
RFC 0020.

## Unscheduled

RFC 0021 (higher-level constructs), RFC 0022 (more storage engines), RFC 0023 (adapters) and RFC 0025 (AI
model calls) each get a milestone with its own demo when someone picks them up.
