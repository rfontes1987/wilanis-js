# RFC 0011: Retry, idempotency and timeout as declared properties of an operation

- **Status:** draft (stub)
- **Areas:** `area:core`, `area:compiler`, `area:runtime`
- **Tracking issue:** #13
- **Depends on:** none

## Summary

A port operation says, beside `pure`, `refuses` and `holds`, whether it is `idempotent`, whether a call
site may declare it `retryable`, and what its `timeout` is. The checker refuses a retry over an operation
that is not idempotent; the runtime retries and times out where the documents say so, and nowhere else.

## Motivation

An agent writes `charge payment`, `save order`, `send email` as three nodes and the graph looks correct. It
is not: the second can fail after the first succeeded, and a retry of the whole graph charges twice. Nothing
in the tree today lets the checker see that, because the port document does not say what a repeated call
does. The report names this "distributed-effect semantics" and is right that it matters more than it looks.

Out of scope: compensation across systems (sagas). RFC 0004 keeps atomicity to one connection, and a
compensating construct is a candidate for RFC 0021.

## Sketch

Three fields join the operation object in `packages/core/schemas/port.schema.json`, whose `pure`, `refuses`
and `holds` set the pattern of one boolean per fact about the operation:

- `idempotent: true` states that calling it again with the same inputs changes nothing further. A native
  operation declares it in the plugin's `docs/`; a domain operation may declare it only when every graph
  its bindings run reaches idempotent effects alone, which the checker verifies.
- `key`: the name of an accepted field that is the idempotency key, so a caller can make a non-idempotent
  operation safe to repeat by supplying one; the storage plugin (RFC 0002) and a payment adapter (RFC 0023)
  would honour it.
- `timeout`: the most a call may take, a duration string; the embedder enforces it, the engine stays
  clockless (RFC 0012 says how a timed-out node reports).

At a call site, a `run` node gains `retry: { times, backoff }`; the checker refuses a retry over an
operation that is neither `idempotent` nor given a `key` (a new L rule). `rehearse` reports the retryable
nodes, and `fuzz` gets a mode that fails an effect once to see the retry happen.

## Checker rules, tests, implementation plan

Written when this RFC is expanded to a full spec.

## Compatibility

Additive fields on `port.schema.json` and on the run node schema; documents without them keep their
meaning (no retry, no timeout beyond the connection's). IR v1 unaffected until 1.0 freezes it.

## Drawbacks and alternatives

`idempotent` on a domain operation is a claim the checker can only verify through the bindings of the active
profile, so it is true under one profile and unverified under another; the RFC must say whether that is a
refusal or a note. The alternative was an "effect class" enum on the port; three booleans and a key are
closer to the house style and to what the checker can prove.

## Open questions

- Is `retry` a property of the call site (this sketch) or of the binding, where the operation is met?
- Does `timeout` belong on the operation, on the connection (`timeoutMs` exists on the http connection in
  `packages/plugin-http/src/request.ts`), or both, with the operation's the tighter bound?
- What does a retry do to the report: one node with attempts, or one node per attempt?
