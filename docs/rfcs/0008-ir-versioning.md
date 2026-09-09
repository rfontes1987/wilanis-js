# RFC 0008: Versioning the intermediate representation

- **Status:** draft
- **Milestone:** 1.0: published
- **Areas:** area:core area:runtime area:process
- **Tracking issue:** #10
- **Depends on:** none

## Summary

The documents a tree is made of are the intermediate representation (IR). Its version is the major
number in the schema URL every document names: `schemas-v1`. Until 1.0 is published, v1 changes in
place. From 1.0 on, v1 is frozen: a compatible change is made in place and a breaking change opens
`schemas-v2`, and a runtime says which IR versions it reads and promises the same semantics for a
document it accepts.

## Motivation

An application written by an agent may run for years and be regenerated rarely. If the meaning of a
document changes under it, the tree that passed `wilanis check` yesterday fails, or worse, passes and
behaves differently. The report's item 22 asks for explicit compatibility semantics; the user's decision
is: one version, v1, until we publish, then the compatibility rules apply. This RFC writes those rules
down so the freeze is a fact and not a habit.

## Guide-level explanation

Every document names its kind and its version in one line:

```json
"$schema": "https://raw.githubusercontent.com/wilanis/wilanis-js/schemas-v1/packages/core/schemas/graph.schema.json"
```

or the alias `@wilanis/graph.schema.json`, which the loader reads as the version the runtime prefers.
The branch `schemas-v1` of this repository is the published v1: `packages/core/schemas/` on that branch
is what the URL serves.

**Before 1.0.** v1 is the working draft. A schema may change in place, a kind may be renamed, a rule
may tighten. Documents in this repository (`example/`, `libraries/`, every plugin's `docs/`) are updated
in the same commit, so `npm test` is the compatibility check.

**From 1.0 on.** A change to v1 is *compatible* when every document that validated before still
validates and means the same thing: a new optional field, a new document kind, a new node type, a new
port a plugin grants, a new refusal for something that was already wrong. Compatible changes are made
in place on `schemas-v1`. A change is *breaking* when a valid document stops validating or changes
meaning: a required field added, a field removed or renamed, a default changed, a rule that now refuses
a document it accepted. A breaking change is made on a new branch, `schemas-v2`, with new `$id`s; the
`schemas-v1` branch stays as it was.

**What the runtime promises.** A runtime release states the IR versions it reads. A document of a
version it reads runs with the semantics that version's RFCs describe; a document of a version it does
not read is refused at load with the version it wanted and the runtime that reads it. `wilanis check`
prints the IR version of the tree beside the runtime's.

## Reference

### Documents and schemas

- `packages/core/src/model.ts` holds the base URL; the version is its last path segment. A
  `schemas-v2` adds a second base and keeps the first.
- Every schema's `$id` and `$schema` enum carry the URL; `validate.ts` joins the kinds in `model.ts`
  with the schemas, so a version is one list in one place.
- `project.json` gains nothing: the version is per document, as today. Mixing versions in one tree is
  refused (see Checker rules).

### Ports, operations and kinds granted

None.

### Checker rules

| Code | Where it lives | Refuses when | Hint |
|---|---|---|---|
| D0nn | `load.ts` / `check/project.ts` | a document names an IR version this runtime does not read | "this runtime reads v1; the document names v2: upgrade @wilanis/runtime, or rewrite the document against v1" |
| D0nn | `check/project.ts` | two documents of one tree name different IR versions | "a tree is one version: migrate the rest, see docs/rfcs/0008" |

Numbers are assigned when the implementing pull request lands (current highest: D010).

### Runtime behaviour

- `wilanis check` and `wilanis describe project` print `IR v1, runtime reads v1`.
- The loader refuses a version it does not read before any other rule runs.
- Refusal codes and `at` paths are part of the promise: a code keeps its meaning within a version
  (RFC 0019 makes the full statement).

### Discoverability

`docs/rfcs/README.md` lists which RFCs are v1 and, later, which are v2. The README's "Schemas" section
already states the branch rule; it gains the compatible/breaking definitions above.

### Plugin contract

A plugin's `plugin.json` names the IR version of the documents under its `docs/`; a plugin whose
documents are of a version the runtime does not read is refused at load with the same rule.

## Compatibility

This RFC is the compatibility rule. It changes no schema. It changes the README and adds two loader
rules that cannot fire on any v1 tree today.

## Tests

- A copy of the example with one document rewritten to a `schemas-v2` URL expects the version refusal.
- A copy with two versions mixed expects the mixing refusal.
- Both in `packages/runtime/test/example.test.ts` beside the other sabotages.

## Implementation plan

1. Write the compatible/breaking definitions into `README.md → Schemas` (good first issue).
2. Print the IR version in `wilanis check` and `describe project`.
3. The two loader rules and their sabotage tests.
4. At 1.0: tag `schemas-v1` as frozen in the README and in this RFC's status.

## Drawbacks and alternatives

Freezing means a bad early decision lives in v1 for as long as v1 is read. The alternative, versioning
per kind, would let a graph be v2 while a shape is v1; it was rejected because the checker's rules
span kinds, so a version is a property of the tree.

## Open questions

- Whether the runtime reads two IR versions at once (v1 and v2 trees side by side) or one, and a
  `wilanis migrate` command rewrites a tree. The first is safer for a fleet; the second is simpler.
- Whether an npm major of `@wilanis/runtime` may drop an IR version, and with how much notice.
