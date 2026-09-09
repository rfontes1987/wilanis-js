# RFC 0025: AI model calls as an effect

- **Status:** draft (stub)
- **Milestone:** Ecosystem
- **Areas:** a new plugin (`@wilanis/plugin-model`)
- **Tracking issue:** #27
- **Depends on:** RFC 0011 (retry, idempotency, timeout)

## Summary

A call to a language model is an effect like `http.request`: a port operation with a connection kind, an
answer validated against a declared edge shape, listed in `feature.json → effects` so the checker knows
which features reach a model. It is never a way to run generated code, and the RFC says so first.

## Motivation

Trees will want to classify a ticket, summarise a document, extract fields from a message. Today that is an
`http.request` to a provider with an edge shape for the response, which works and stays available. A plugin
adds what the generic request lacks: a connection kind with the provider's secret and model name, an
operation whose `returns` is the shape the model must fill (so the answer is validated like any edge value
and a malformed one is a failure the switch routes), token and cost accounting in the report, and a stub for
`rehearse` that answers a value the solver chose. The report lists this under the ecosystem, and this stub
keeps it there.

## Sketch

```json
{ "id": "classified", "type": "@wilanis/node/run.schema.json",
  "run": "@model/model.port.json#complete",
  "in": { "connection": "@connections/classifier.connection.json",
          "instructions": "Classify the entry as one of the categories.",
          "input": "{{in.entry}}", "returns": "@monitor/edge/Category.shape.json" } }
```

`complete` is an effect (not `pure`), `idempotent: false`, with a `timeout`; the feature must list it, and a
domain graph may not run it (L002), so a model is reached from `data/` and its answer crosses into the domain
through a shape, like any upstream's. The plugin's `check` refuses a `returns` that is not an edge shape and
an `input` that is a secret. The report of a run records the model, the tokens and the latency, so the
observability of RFC 0006 can price a request.

What this is not: a node that asks a model to write a graph, a tool-use loop inside the engine, or an
operation whose output is executed. A model's answer is data, and only data.

## Checker rules, tests, implementation plan

Written when this RFC is expanded to a full spec.

## Compatibility

Adds a package; nothing in `packages/core/schemas/` changes.

## Drawbacks and alternatives

A non-deterministic effect breaks `regress`'s node-by-node diff unless it is always stubbed, and the RFC must
say that a model call is stubbed in every gate and only real under `start` and `run`. The alternative is to
keep using `http.request`; the plugin is justified only by the validated `returns` and the accounting.

## Open questions

- Is the provider a connection kind per vendor, or one kind with a `provider` setting?
- Does a structured answer use the provider's schema-constrained output from the shape's JSON Schema, and is
  the shape-to-JSON-Schema lowering something core already has?
- Streaming answers: out of scope, or a `blob` answer like a download?
