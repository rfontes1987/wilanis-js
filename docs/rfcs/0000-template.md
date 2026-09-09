# RFC 0000: Title

- **Status:** draft | accepted | implemented | withdrawn
- **Milestone:** the milestone this belongs to
- **Areas:** the packages it touches (`area:core`, `area:compiler`, ...)
- **Tracking issue:** #NNN (opened when the RFC is proposed)
- **Depends on:** other RFCs that must land first, or none

## Summary

One paragraph: what a tree can say or do after this that it cannot today.

## Motivation

What an author, human or agent, cannot express now, and what goes wrong because of it. Name the
document they would have to write today, or the code that would have to exist outside the tree.
Say what this does *not* try to solve.

## Guide-level explanation

Explain it the way `README.md` explains the model: the words a reader needs, then the documents an
author writes, as JSON. Show a small, complete example from the perspective of the `example/` tree.
If a refusal is the main way an author meets the feature, show the refusal too.

## Reference

The precise statement of every rule. Each of these subsections says "none" when it has nothing.

### Documents and schemas

New document kinds or new fields on existing kinds: the schema (under `packages/core/schemas/`),
the `*Doc` interface, the layer it lives in (`HOME` in `placement.ts`), the row in
`packages/runtime/templates/CLAUDE.md`, and what `wilanis new` scaffolds.

### Ports, operations and kinds granted

What a plugin grants, as the JSON documents under its `docs/`: ports and their operations with
`accepts`, `returns`, `pure`, `refuses`, `holds`; trigger kinds; connection kinds; codecs; shapes.

### Checker rules

One row per rule. A rule has the next code in its family, a message, an `at` path, and a hint that
names the command or the edit that fixes it.

| Code | Where it lives | Refuses when | Hint |
|---|---|---|---|
| X000 | `check/<family>.ts` or a plugin's `check` | ... | ... |

### Runtime behaviour

What the embedder, the engine, the plugin handlers, `rehearse`, `fuzz`, `regress`, `start` do
differently. Name the function or module that changes.

### Discoverability

What `wilanis describe`, `wilanis map`, `wilanis ls` and the viewer show for the new thing.

### Plugin contract

Changes to `PluginModule` in `packages/core/src/plugin.ts`, or none.

## Compatibility

The effect on IR v1: which schemas change and whether a document written before this RFC still
validates and keeps its meaning. Until 1.0 is published, v1 may change in place; after it, a
breaking change goes to `schemas-v2` (see RFC 0008).

## Tests

The sabotage tests: for each checker rule, the edit to the example that produces it. The end-to-end
tests: what is run against what fake. Where each test lives.

## Implementation plan

Ordered tasks, each small enough to be one pull request and one sub-issue of the tracking issue.
Say which can be taken by a new contributor (`good first issue`).

1. ...

## Drawbacks and alternatives

What this costs, and what else was considered and why not.

## Open questions

What must be decided before `accepted`, and what may be decided during implementation.
