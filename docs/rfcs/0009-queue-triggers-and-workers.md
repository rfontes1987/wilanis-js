# RFC 0009: Queue messages as triggers, and workers

- **Status:** draft (stub)
- **Areas:** `area:runtime`, a new plugin (`@wilanis/plugin-queue`)
- **Tracking issue:** #11
- **Depends on:** RFC 0002 (storage), RFC 0011 (retry, idempotency, timeout)

## Summary

A message arriving on a queue fires a trigger the way an HTTP request or a command line does today, and a
graph publishes a message through a port operation. A worker is nothing new: it is `wilanis start` on a tree
whose startup names a `holds` operation that subscribes to the queue.

## Motivation

A tree today answers only what arrives on a socket or a command line. Work that must outlive a request
(sending a receipt, recomputing a digest, retrying a failed upstream call) has nowhere to go: an author would
have to leave the tree and write a consumer in TypeScript, which is exactly the code the platform exists to
remove. The report calls this "asynchronous execution"; the trigger model already fits it, so this RFC adds
a plugin, not a programming model.

This RFC does not decide delivery guarantees on its own: at-least-once delivery means a message may fire
twice, and whether that is safe is what RFC 0011 declares on the operation the trigger fires.

## Sketch

The plugin grants three documents under its `docs/`:

- `@queue/queue.trigger-kind.json`: a trigger kind, the precedent being
  `packages/plugin-http/docs/http.trigger-kind.json`. Its `settings` name the queue and the edge type of the
  message; its `context` hands `request.message` (typed by that setting, like `$Body`), `request.attempt` and
  `request.id`. A trigger of this kind `fire`s a domain port operation with inputs read from that context, and
  attaches policies like any trigger; the guard sees a service identity, not a person.
- `@queue/queue.port.json` with `publish` (an effect: a data graph names it, `feature.json → effects` allows
  it) and `subscribe`, marked `holds`, so only a startup step may name it (L008 refuses a graph that does).
- `@queue/queue.connection-kind.json`: the broker and its settings, a secret for its credential.

A worker process is the same tree started with a profile whose startup lists `subscribe` and not `listen`.
The first broker is the storage plugin itself (a table as a queue, `SELECT ... FOR UPDATE SKIP LOCKED`), so
a tree needs no second service to have a queue; RabbitMQ or SQS follow as connection kinds.

```json
{ "label": "Send the receipt", "kind": "@queue/queue.trigger-kind.json",
  "settings": { "queue": "receipts", "message": "@orders/edge/ReceiptDue.shape.json" },
  "in": "@orders/edge/ReceiptDue.shape.json", "out": "@orders/edge/Sent.shape.json",
  "fire": { "run": "@orders/domain/orders.port.json#sendReceipt", "in": { "order": "{{request.message.order}}" } } }
```

`rehearse` runs a queue trigger like any other, with the message solved from the switch rules it reaches;
a refusal the trigger can reach must be mapped to an outcome (acknowledge, retry, dead-letter) the way an
HTTP trigger maps reasons to statuses (T005).

## Checker rules, tests, implementation plan

Written when this RFC is expanded to a full spec.

## Compatibility

Adds a plugin; no schema in `packages/core/schemas/` changes. IR v1 unaffected.

## Drawbacks and alternatives

A queue trigger cannot answer anyone, so `out` is a record for the log and the scenario, not a response;
this is the first trigger kind where an answer goes nowhere, and the kind's schema must say so. The
alternative, a dedicated "job" document kind, was rejected: it would be a second way to fire a port.

## Open questions

- Delivery semantics per broker: does the trigger kind declare at-least-once or at-most-once, or does the
  connection kind, and how does the checker relate it to `idempotent` on the fired operation (RFC 0011)?
- What does a policy mean on a queue trigger: is the publisher's identity carried in the message and verified
  by the guard, or is a queue trigger always internal and policy-less?
- Retry and dead-letter as refusal outcomes: is the mapping a trigger setting (like `response.refusals`)?
