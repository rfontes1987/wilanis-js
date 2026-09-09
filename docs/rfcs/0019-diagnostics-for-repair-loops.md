# RFC 0019: Diagnostics designed for an agent's repair loop

- **Status:** draft (stub)
- **Areas:** `area:compiler`, `area:runtime`
- **Tracking issue:** #21
- **Depends on:** none

## Summary

`wilanis check --json`, a promise that codes and `at` paths stay stable across versions, a `fixes` field with
a concrete edit where one exists, and a page per code. The checker already speaks to an agent; this RFC makes
the contract explicit and machine-consumable.

## Motivation

Every refusal today is a `Refusal` (`packages/core/src/registry.ts`): `code`, `message`, `file`, `at`,
`hint`. `packages/compiler/src/refusals.ts` and the check families produce them, and the README's claim
that "a small, cheap model does this correctly and fast" rests on them. Three things are missing for the
loop to be a contract rather than a habit: a JSON form an agent parses without regexes, a promise that
`D008` means the same thing next year and that `at` points at the same place, and, where the fix is
mechanical, the fix itself. The report's "compiler as the AI's tutor" is this.

## Sketch

- **`--json`** on `check`, `rehearse`, `regress`: one object with `refusals[]`, each the `Refusal` fields plus
  `family` and, when known, `fixes`: a list of edits as `{ file, at, set | remove | add }` against the JSON
  document, applicable without understanding the message. R001 (unknown operation) can propose the nearest
  name; D008 (wrong layer) can propose the path; L003 can propose the `feature.json` edit its hint already
  names in words.
- **Stability.** A code, once shipped in a published version, is never reused for another meaning; a retired
  code stays documented as retired. An `at` path follows the JSON pointer into the document and does not
  change form. This is written into `CONTRIBUTING.md` and enforced by a test that diffs the code list
  against the previous release's.
- **A page per code.** `docs/refusals/<CODE>.md`, generated from the rule's message, hint and sabotage test,
  linked from the `--json` output as `url`, so an agent (or a person) can read the long form.
- **A repair transcript.** `wilanis check --json` is deterministic and sorted, so two runs diff cleanly; the
  runtime's template `CLAUDE.md` tells the agent to loop on it.

## Checker rules, tests, implementation plan

Written when this RFC is expanded to a full spec.

## Compatibility

Additive flags and fields; the text output stays. The stability promise begins at 1.0.

## Drawbacks and alternatives

`fixes` is a new surface to keep right, and a wrong fix applied blindly is worse than a hint read; the RFC
should limit `fixes` to edits the checker can prove pass afterwards. The alternative, leaving the hint as
prose, is what exists and works for capable models; the point of `fixes` is the cheap ones.

## Open questions

- Is `fixes` produced by each rule (spread through the families) or by a repair module that pattern-matches
  codes (one place, but a second source of truth)?
- Does the stability promise cover messages and hints, or only codes and `at`?
- Should `--json` include the tree's manifest (RFC 0026) so an agent sees what exists while fixing what does
  not?
