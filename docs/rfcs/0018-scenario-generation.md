# RFC 0018: Scenario generation from the branch solver

- **Status:** draft (stub)
- **Areas:** `area:runtime`
- **Tracking issue:** #20
- **Depends on:** none

## Summary

The inputs `rehearse` solves for every branch become committed scenarios with expected outcomes, so that
the regression suite of a tree is written by the solver, and the edge cases the solver cannot reach are
generated from the shapes.

## Motivation

`rehearse` (`packages/runtime/src/rehearse.ts`, the solver in `solve.ts` and `branches.ts`) already works
out, for every `switch`, which inputs reach each rule, and runs that branch with the world stubbed. `fuzz`
(`packages/runtime/src/fuzz.ts`) records runs as scenarios in the shape of
`packages/core/schemas/scenario.schema.json` (trigger, seed, input, stubs, expected report), and `regress`
replays them and diffs node by node. The gap: rehearsal's solved cases are not kept, and fuzz's cases are
random, so the suite a tree carries is neither complete nor stable. The report's "automatic scenario
generation" is the join of the two.

## Sketch

- `wilanis rehearse --record <dir>` writes one scenario per solved branch, named after the graph, the switch
  and the rule, with the run's report as `expect`. Since the solver is deterministic, the same tree yields
  the same files, so a diff in the directory is a change in behaviour, reviewable in a pull request.
- The solver's unreachable rules (`NEVER RUN`) become a scenario that expects the refusal, so a fix that makes
  a rule reachable shows up as a diff too.
- What the solver cannot reach, it approximates from the shape: a boundary per numeric field, an empty and a
  long string, an empty and a single-element list, a missing optional. These are `fuzz`'s job today with a
  random seed; this RFC gives it a `--edges` mode with fixed cases instead.
- A scenario file is a document in the tree (`scenarios/`), so the checker validates it against the schema
  and refuses one that names a trigger that no longer exists.

## Checker rules, tests, implementation plan

Written when this RFC is expanded to a full spec.

## Compatibility

Additive: a flag on `rehearse`, a mode on `fuzz`, and possibly a `scenarios/` directory in `HOME`.

## Drawbacks and alternatives

Hundreds of generated files invite an agent to edit an expectation to make a diff go away; the RFC should
recommend that generated scenarios are regenerated, never edited, and that a human writes the few that
matter by hand. The alternative, keeping rehearsal ephemeral and trusting `fuzz`, is what exists.

## Open questions

- Naming and stability: when a rule is reordered, does its scenario move or is it re-solved, and is the
  file name the rule text or an index?
- Does a recorded rehearsal replace `fuzz --seed` as the regression baseline, or sit beside it?
- Where do the generated files live in a tree that is an include (`libraries/access`): with the include, and
  do they run in the host?
