# RFC 0001: The RFC process

- **Status:** draft
- **Milestone:** none (the process itself)
- **Areas:** area:process
- **Tracking issue:** #1
- **Depends on:** none

## Summary

Every change that adds a document kind, a checker rule family, a plugin hook, a port a plugin grants,
or a promise the runtime makes is specified in a file under `docs/rfcs/` and accepted before any code
is written. The roadmap is the set of RFCs, tracked as GitHub issues, grouped by milestone, and shown
on the Roadmap project board. Small fixes and refactors that change no rule need no RFC.

## Motivation

`CLAUDE.md` says: "Do not add features, document kinds, or plugin hooks beyond what a task asks for.
When a task seems to need one, stop and say so." That rule needs a place to say it *to*. Until now the
place was a conversation; a conversation is not reviewable line by line, is not versioned with the code,
and cannot be read by the next contributor, human or agent, who opens the repository.

The wiki was considered and rejected: a wiki page is not reviewed through a pull request, drifts from
the code it describes, and is a second source of truth beside the tree.

This RFC does not decide *what* to build. It decides how a decision to build something is written down,
discussed, accepted and turned into work.

## Guide-level explanation

**An RFC** is one markdown file, `docs/rfcs/NNNN-short-title.md`, written from `0000-template.md`. It
says what a tree can say or do afterwards that it cannot today, shows the documents an author writes,
states every checker rule with its code and hint, and lists the tasks that implement it. Its header
says its status, its milestone and its tracking issue.

**A tracking issue** is one GitHub issue per RFC, opened with the "RFC" issue form, labelled `rfc` and
`status:draft`, assigned to the RFC's milestone. It links the RFC file. When the RFC is accepted the
label becomes `status:accepted`; its implementation plan becomes sub-issues labelled `task`; a task
that is unblocked and unclaimed is labelled `status:ready`, and `help wanted` when we want someone
outside to take it.

**The lifecycle** of an RFC:

```
draft ──► accepted ──► implemented
  │
  └─────► withdrawn
```

- *draft*: proposed in a pull request that adds the file. Discussion happens on the pull request, line
  by line. The tracking issue exists from this point so the roadmap shows it.
- *accepted*: the maintainer merges the pull request after validating every detail. Nothing is
  implemented before this. The header's status changes in the merge.
- *implemented*: every task closed. The RFC stays as the record of why.
- *withdrawn*: merged with the reason, so the next person does not propose it again.

**A change to an accepted RFC** is a pull request editing the file, with the reason in the commit. An
implemented RFC is not edited; a new RFC supersedes it and says so in both headers.

**A stub** is an RFC that fills only the header, Summary, Motivation, a Sketch, Compatibility,
Drawbacks and Open questions, marked `draft (stub)`. It holds a roadmap slot and the direction taken;
it is expanded into a full spec, in a new pull request, before it can be accepted.

**Finding work.** `gh issue list --label status:ready` lists what may be taken. The `roadmap` skill in
`.claude/skills/roadmap/` walks an agent through it: pick, read the RFC, branch, implement under
`CLAUDE.md`, run `npm test`, open a pull request that closes the issue. The `rfc` skill walks through
proposing one.

## Reference

### Documents and schemas

None. RFCs are markdown, not documents of a tree.

### Ports, operations and kinds granted

None.

### Checker rules

None.

### Runtime behaviour

None.

### Discoverability

- `docs/rfcs/README.md` is the index: every RFC, its status and milestone, kept in the same pull
  request that changes a status.
- `CONTRIBUTING.md` says how work flows and points here.
- `.github/ISSUE_TEMPLATE/rfc.yml`, `task.yml`, `bug.yml` are the issue forms; blank issues are off.
- `.github/PULL_REQUEST_TEMPLATE.md` asks which RFC or issue a pull request serves.
- The Roadmap project board on the `wilanis` organisation shows every `rfc` and `task` issue by status
  and milestone.

### Plugin contract

None.

## Compatibility

None.

## Tests

None. The process is checked by reading.

## Implementation plan

1. This file, the template, the index, `CONTRIBUTING.md`, the issue and pull request templates, the
   two skills (this pull request).
2. The labels `rfc`, `task`, `status:draft`, `status:accepted`, `status:ready`, `area:*`, and the five
   milestones on `wilanis/wilanis-js` (done by hand; recorded here).
3. The Roadmap project board with a Status field mirroring the labels (needs the `project` token scope).
4. The first batch of RFCs, 0002 to 0026, as one pull request, with a tracking issue each.

## Drawbacks and alternatives

Writing a spec before code is slower for the first step and faster for every step after it, because the
checker rules, hints and tests are named before they are argued about in code review. The cost is real
for small things, which is why a change that adds no rule and no promise needs no RFC.

Alternatives: GitHub Discussions (not versioned, not reviewable); the wiki (rejected above); design
docs in a separate repository (splits the source of truth from the code).

## Open questions

- Whether an RFC needs a second reviewer once there is more than one maintainer.
- Whether `status:ready` should be set by the maintainer only or by whoever finishes the blocking task.
