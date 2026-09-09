# RFC 0024: Cloud deployment integrations

- **Status:** draft (stub)
- **Milestone:** Ecosystem
- **Areas:** `area:runtime`
- **Tracking issue:** #NNN
- **Depends on:** RFC 0013 (deployment and profiles), RFC 0026 (manifest)

## Summary

The manifest tells a provisioner what a tree needs; the first integration is a container image recipe that
any host runs; serverless follows only if the `holds` model survives it.

## Motivation

A tree is deployed as documents plus `node_modules`, started by `wilanis start --profile <name>`
(RFC 0013). That is enough for a virtual machine and a person. It is not enough for an agent asked to "put
this in production": it needs a recipe that turns the tree into an artifact a cloud accepts, and a way to
know what the environment must provide (the variables of `project.json → secrets`, the port `listen` opens,
the store the connection names). The manifest (RFC 0026) is that knowledge; this RFC is what reads it.

## Sketch

- **`wilanis image <root>`** writes a `Dockerfile` (or prints it) from the manifest: the Node version from
  `engines`, the tree and its `node_modules`, the profile as the start command, the port as `EXPOSE`, every
  secret as a documented variable, a health route if the http plugin grants one. The recipe is generated,
  never hand-edited; the tree is the source.
- **A compose file for development**: the tree plus the PostgreSQL the storage connection wants, so `docker
  compose up` runs the example with a real store.
- **Provider recipes** (Fly, Render, Cloud Run, ECS) are templates over the same manifest, added as someone
  needs them, each a directory under `packages/runtime/templates/deploy/`.
- **Serverless** is a question, not a plan: a function-per-trigger deployment has no process to `hold` a
  listener or a scheduler in, so `holds` operations would have to become the platform's (an HTTP gateway, a
  managed scheduler, a queue subscription). Whether the tree can be split that way without changing its
  meaning is what the full RFC must answer before promising it.

## Checker rules, tests, implementation plan

Written when this RFC is expanded to a full spec.

## Compatibility

Adds a command and templates; no schema changes.

## Drawbacks and alternatives

Provider templates rot as providers change, and a generated Dockerfile that is wrong is a support burden the
project must be willing to carry. The alternative, a documented recipe and nothing generated, is the fallback
if the manifest turns out to be enough on its own.

## Open questions

- Does `wilanis image` belong in the runtime, or in a separate `@wilanis/deploy` package so the runtime
  carries no opinion about containers?
- Which provider is first, and is it chosen by where the example is hosted?
- Can `holds` be honoured in a serverless model at all, or does that model get a different startup list?
