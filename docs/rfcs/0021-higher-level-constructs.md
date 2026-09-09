# RFC 0021: Higher-level constructs: state machines and resources

- **Status:** draft (stub)
- **Milestone:** Ecosystem
- **Areas:** `area:core`, `area:compiler`, `area:runtime`, `area:view`
- **Tracking issue:** #23
- **Depends on:** RFC 0002 (storage), RFC 0007 (invariants)

## Summary

Whether the language needs constructs above graphs, and if so which. The position this stub carries: no
second layer; CRUD is scaffolding, not language; the one construct that might earn its place is a state
machine over a stored shape, and it must compile to graphs the viewer can still draw.

## Motivation

The report (item 16) fears that AI-generated applications become huge collections of primitive nodes and
proposes a domain DSL (resources, pagination, state machines, retry policies, event handlers) that compiles
down to the graph. The fear is real; the remedy is not obviously a language. Every layer above the IR is one
more thing the checker must judge, the viewer must draw, `describe` must explain and the schema must
publish, and the guarantees of RFC 0020 must be re-proved through the lowering. This stub exists so the
question is answered on purpose, after RFC 0002 shows what real generated trees look like.

## Sketch

Three candidate constructs, and where each belongs:

- **A CRUD resource.** Five triggers, a port with five operations, a binding over the store. This is
  scaffolding: `wilanis new resource <name>` in `packages/runtime/src/tools.ts` writes the documents, the
  agent edits them, and the tree contains nothing the checker does not already know. No language change.
- **Pagination, retry policy, event handler.** Each is an existing thing or an RFC already: a shape with
  `cursor` fields and a `list#slice`, RFC 0011, RFC 0009. No language change.
- **A state machine over a stored shape.** `Order: pending → paid → shipped | cancelled`, with the operation
  that performs each transition. This is the one construct with a claim: it gives RFC 0007 its third class of
  invariant (a transition that must not happen) statically, it is what the viewer would draw best, and it is
  the hardest thing to get right as raw switches. If it exists it is a document in `domain/` that names the
  shape, its `state` field and the transitions, and the compiler lowers each transition to a guard node in the
  binding graph, refusing an operation that writes the field outside a declared transition.

The bar the RFC must clear: every construct lowers to documents an author could have written, the lowered
graph is what the viewer shows, and the refusals point at the construct, not the lowering.

## Checker rules, tests, implementation plan

Written when this RFC is expanded to a full spec.

## Compatibility

A new document kind at most (`HOME` in `placement.ts`, a schema, a viewer page); nothing else changes.

## Drawbacks and alternatives

A state machine kind is the first document that is not itself a graph, a shape, a contract or a wiring,
and every such first is a precedent. The alternative that keeps the language as it is: a `wilanis new
machine` scaffold that writes the switches and a transition invariant (RFC 0007) that checks them.

## Open questions

- After RFC 0002, how big are the generated trees really, and where do their nodes pile up? Measure first.
- If the state machine is a kind, does its transition table live on the shape (a field's allowed changes) or
  in its own document?
- Does the viewer draw the construct or the lowering, and can it switch between them?
