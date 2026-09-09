# RFC 0012: Resource limits, timeouts and cancellation of a run

- **Status:** draft (stub)
- **Areas:** `area:engine`, `area:runtime`
- **Tracking issue:** #14
- **Depends on:** RFC 0011 (retry, idempotency, timeout)

## Summary

A run has a deadline, a fan-out has a ceiling, a body has a size, and a run that is cancelled ends with a
report that says so. The engine stays clockless: every limit is the embedder's or the trigger kind's, and
the engine only learns of it through the abort signal it already accepts.

## Motivation

A production service is judged by what happens when something hangs. Today a node waits on its handler for
as long as the handler takes; a `map` over a list runs one handler per element with no ceiling; the HTTP
plugin decodes whatever arrives. None of that is wrong for a development server and all of it is wrong for
a public one. The report lists "resource limits/timeouts/cancellation" as production-grade, and it is.

## Sketch

Three places, one rule each:

- **The run.** `FireOptions` in `packages/runtime/src/embed.ts` already takes an `AbortSignal`. This RFC
  gives it a source: a `deadline` per trigger kind setting (the http kind's `response` block gains one), and
  the embedder aborts at the deadline. The engine, on abort, settles every pending node as cancelled and
  answers a report whose nodes say `cancelled`, so `rehearse` and the viewer can show what did not run.
  A cancelled run answers the trigger kind's fault (a 504 for http), never a partial answer.
- **The node.** RFC 0011's `timeout` on an operation is the per-node bound; a timed-out node is a failure
  (RFC 0014), routable by a `switch` like any other, and the engine records it as such.
- **The fan-out and the body.** A `map` node gains `limit` (most elements) and `concurrency`; a trigger
  kind's settings gain `maxBody`; a `list` in a shape may declare `maxItems`. The checker refuses a `map`
  over an unbounded edge list on a public trigger, since that is the request-shaped denial of service.

The engine's scheduler (`packages/engine/src/run.ts`) fires every ready node concurrently; `concurrency`
is the first time it learns to hold one back, and the RFC must keep that change small.

## Checker rules, tests, implementation plan

Written when this RFC is expanded to a full spec.

## Compatibility

Additive settings on trigger kinds and the map node; defaults preserve today's behaviour (no deadline,
unbounded). IR v1 unaffected until 1.0.

## Drawbacks and alternatives

Cancellation cannot undo an effect that already ran, so a cancelled run may leave a half-done write; that is
RFC 0004's problem inside one connection and RFC 0011's across connections, and this RFC must say so
plainly rather than imply a cancelled run is clean. The alternative, a global timeout in `project.json`,
was kept as the default the trigger kinds fall back to.

## Open questions

- Is the per-run deadline a trigger setting, a kind default, a project default, or all three layered?
- How does a cancelled run appear in a scenario (`packages/core/schemas/scenario.schema.json`), so that
  `regress` can replay a timeout deterministically?
- Memory: is a ceiling on the size of a value crossing a node worth enforcing, given blobs already keep
  bytes out of the engine?
