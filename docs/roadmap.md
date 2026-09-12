# Roadmap

A milestone is a demo: something a person runs and sees that the example could not do before. The
GitHub milestones of `wilanis/wilanis-js` mirror this page, one per milestone heading -- *Unscheduled* and
*Process RFCs* are the two headings that are not milestones -- and the issues under each are
the RFCs it draws on and the tasks that build it. A milestone closes when its demo runs, by hand and in
the test suite. The RFCs themselves live in [`rfcs/`](rfcs/README.md); this page is the only place that
says which milestone shows which RFC.

The number is the order. A milestone appears after every milestone whose RFCs its own RFCs name under
*Depends on*, and among those free to start at the same time the smaller comes first, so that a milestone
is never begun on work that is not there yet. One milestone is worked at a time, and its GitHub milestone
carries the day it is due. Reordering the page means renumbering it and the GitHub milestones together.

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

First because RFC 0002 depends on nothing and RFC 0004, RFC 0005, RFC 0015, RFC 0017, RFC 0021 and
RFC 0022 all depend on it.

## M02 Same tree, real database

Start the example under a production profile against PostgreSQL; the startup log shows the store ensured
and its collections created. Not one document changes between profiles. Draws on the PostgreSQL engine of
RFC 0002 and `ensure` of RFC 0003.

```
npx wilanis start example --profile production
startup 1/3 Ensure the entries store: ok, 2 collections
```

## M03 See a request run

Start with `--trace` and every request prints its tree: gate, policies, graphs, effects, timings. The same
trace reaches a local Jaeger through the OpenTelemetry plugin. Draws on RFC 0006.

Here because RFC 0006 depends on nothing, and RFC 0024 under M11 depends on it.

## M04 All or nothing

The CSV import records every row and updates the digest in one atomic graph. A bad row in the middle
leaves nothing written; rehearsal prints the rolled-back branch. Draws on RFC 0004.

## M05 Change the schema, get the plan

Add a field to the entry shape and `wilanis migrate` prints the migration, refusing the destructive
step until told. Draws on RFC 0017, which depends on RFC 0003 and nothing after it.

## M06 The checker knows the rule

An access invariant over every monitor write and a field invariant on the entry shape. Removing a policy
from a route is a refusal; rehearsal reports each invariant as proved or guarded. Draws on RFC 0007.

## M07 Sign in on one instance, stay signed in on another

Two instances of the example share sessions and challenges through storage. Sign in on the first port,
call a gated route on the second. Draws on the auth half of RFC 0005.

## M08 Files in an object store

CSV upload and download run against MinIO, an object store speaking the S3 API, on the local cluster,
with nothing written to the instance's disk. Draws on the blob half of RFC 0005, after the port it
requires is in place under M07.

## M09 Fails well

Against a flaky fake upstream the trace shows retries honouring declared idempotency and timeouts; a long
run is cancelled and still answers a report. Draws on RFC 0011, RFC 0012 and RFC 0014.

## M10 Work off the request

The digest is computed by a scheduled job and imports are processed by a worker fed from a queue, beside
the routes. Draws on RFC 0009 and RFC 0010.

After M09, not before it: RFC 0009 accepts after RFC 0011 and its step 1 lands before RFC 0009's step 2,
and RFC 0010's `deadlineMs` setting waits on RFC 0012's `FireArgs.signal`. Both are M09's RFCs. A worker
that runs in a process of its own waits on RFC 0013 under M11; this demo puts the worker beside the routes,
so it does not.

## M11 Ship it

One command reads the manifest and writes the image recipe, the Compose file and the chart values: `docker
compose up` runs the example on a laptop, and the Helm chart stands the same tree up on a local `kind`
cluster. A tree that requires an effect the environment does not permit is refused before it listens.
Draws on RFC 0013, RFC 0016, RFC 0024 and RFC 0026.

```
npx wilanis-deploy example --profile production
scripts/cluster.sh up     # → http://localhost:8080/monitor
```

RFC 0013 depends on RFC 0005, so this follows M07 and M08; RFC 0024 depends on RFC 0006, so it follows M03.

## M12 Tenants by construction

A second tenant in the example. Feeding the tenant field from the request body is a refusal with a hint.
Draws on RFC 0029, the `reads` header the store binds its scope with, and RFC 0015.

## M13 The agent fixes it

Break the example, run `wilanis check --json`, and a small model repairs it in a loop from the
diagnostics. Solved branches become committed scenarios. Draws on RFC 0018 and RFC 0019.

Neither RFC depends on another, so this could be worked at any point; it is here because the repair loop
is worth more the more refusals there are to repair.

## M14 1.0

Last on purpose: 1.0 is cut only when every accepted RFC that changes a schema has landed or been withdrawn,
so the schemas are final before they are frozen, and nothing is published to npm before that. Then: every
package on npm; in an empty directory, install, init, and an agent session produce a tree that passes check
and rehearse; the security model is published and the `schemas-v1` tag is cut. Draws on RFC 0008 and
RFC 0020.

## Unscheduled

RFC 0021 (higher-level constructs), RFC 0022 (more storage engines), RFC 0023 (adapters), RFC 0025 (AI
model calls), RFC 0030 (the cache), RFC 0031 (intent triggers) and RFC 0032 (the site as a declared
input) each get a milestone with its own demo when someone picks them up. RFC 0032 waits on a consumer
rather than on work: the operation it was written for, RFC 0002's `raw`, is left out of that RFC on
purpose, and the next consumer is the fault message RFC 0019 asks for, under M13.

## Process RFCs

RFC 0001 (the RFC process), RFC 0027 (fitness functions) and RFC 0028 (the principles hold) change how
this repository works, not what a tree can say. They show in no demo, so they carry no milestone; their
tracking issues sit on the board with none, and RFC 0027 and RFC 0028 are implemented.
