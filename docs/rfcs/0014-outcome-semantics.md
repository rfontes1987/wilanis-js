# RFC 0014: Outcome semantics: refusals, failures and faults, end to end

- **Status:** draft (stub)
- **Milestone:** Production grade
- **Areas:** `area:engine`, `area:compiler`, `area:runtime`, `area:plugin-http`
- **Tracking issue:** #NNN
- **Depends on:** none

## Summary

One document that states the three ways a run ends other than answering, what each means, how each trigger
kind answers it, how each is logged and how `rehearse` shows it. Most of this is built; the RFC writes it
down as one model and fixes the gaps the writing finds.

## Motivation

The model exists in pieces: `@std/outcome.port.json#refuse` ends a graph on purpose with a `reason`;
`refuses` on a port operation marks the operations that do; `packages/compiler/src/refusals.ts` finds every
reason a trigger can reach and T005 holds the trigger to mapping each; the http kind's description says a
fault is a 500. What no single document says is how a node's unexpected result (a 500 from an upstream the
switch did not route, a body that does not fit `returns`) differs from a fault of the runtime itself, and
what a caller sees in each case. The report calls this "strong error/outcome semantics" and puts it in P0;
in this tree the semantics are mostly there, so this RFC is a specification pass, and moves to P1.

## Sketch

Three outcomes, each with a name that is used everywhere from the engine's report to the viewer:

- **A refusal** is on purpose: a `refuse` node, a policy denying or challenging, the guard rejecting a
  credential. It has a `reason` the trigger maps (a status for http, an exit code and JSON for the command
  line), and `rehearse` prints it as `refused on purpose`.
- **A failure** is a node ending in a way its graph did not name: a handler threw, a body failed `returns`,
  RFC 0011's timeout struck. It is routable: a `switch` downstream may test for it, and the checker's rule
  that a switch needs an `else` is what keeps a failure from being silently dropped. A failure that reaches
  `out` unrouted is answered as the kind's fault.
- **A fault** is the runtime's own: a plugin threw outside a handler, a blob the registry no longer holds,
  a startup step that refused. A fault is never mapped and never a scenario's expected outcome; it is a 500,
  logged with the run's id, and counted.

The RFC then walks every trigger kind, `rehearse`, `fuzz`, `regress`, the viewer and the report shape in
`packages/engine/src/spec.ts` and states where each outcome appears and how, and lists the gaps found as
its implementation tasks.

## Checker rules, tests, implementation plan

Written when this RFC is expanded to a full spec.

## Compatibility

Documentation first; any schema change found necessary is additive.

## Drawbacks and alternatives

The distinction between failure and fault is the one most likely to be argued: a plugin bug looks like a
failure to the graph. The RFC's position is that anything a handler returns or throws is a failure, and
only what happens around handlers is a fault.

## Open questions

- Can a `switch` test a failure today, and if not, what does the rule look like: `failed(asked)` beside
  `has(x)`?
- Is a failure's detail (the thrown message) redacted like a secret before it reaches a caller?
- Does a fault carry a correlation id the caller can quote, and is that RFC 0006's business?
