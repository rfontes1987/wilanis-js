# RFC 0001: The RFC process

- **Status:** accepted
- **Areas:** area:process
- **Tracking issue:** #1
- **Depends on:** none

## Summary

Every change that adds a document kind, a checker rule family, a plugin hook, a port a plugin grants,
or a promise the runtime makes is specified in a file under `docs/rfcs/` and accepted before any code
is written. The roadmap, `docs/roadmap.md`, is a list of demos; each names the RFCs it draws on, and the
GitHub milestones mirror it. An RFC is tracked as an issue, under the milestone that first shows it, on
the Roadmap project board. Small fixes and refactors that change no rule need no RFC.

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
says its status and its tracking issue; which milestone shows it is the roadmap's to say, and the
tracking issue carries it as GitHub's own milestone field, so it is written once.

**A tracking issue** is one GitHub issue per RFC, opened with the "RFC" issue form, labelled `rfc` and
`status:draft`, assigned to the milestone `docs/roadmap.md` names for it -- a process RFC shows in no
demo and carries none. It links the RFC file. When the RFC is accepted the
label becomes `status:accepted`; its implementation plan becomes sub-issues labelled `task`; a task
that is unblocked and unclaimed is labelled `status:ready`, and `help wanted` when we want someone
outside to take it. When every task is closed the label becomes `status:implemented` and the issue
closes, so the file's status and the issue's label say the same word.

**The lifecycle** of an RFC:

```
draft ──► accepted ──► implemented
  │
  └─────► withdrawn
```

- *draft*: proposed in a pull request that adds the file. Discussion happens on the pull request, line
  by line. The tracking issue exists from this point so the roadmap shows it.
- *accepted*: the maintainer, having validated every detail, sets the file's status to `accepted` in the
  pull request that proposes it, and its implementation plan becomes task issues. Nothing is implemented
  before this. The pull request merges when every full spec in it is accepted or moved out; a stub in it
  merges as a stub.
- *implemented*: every task closed, `status:implemented` on the issue. The RFC stays as the record of why.
- *withdrawn*: merged with the reason, so the next person does not propose it again.

**A change to an accepted RFC** is a pull request editing the file, with the reason in the commit. An
implemented RFC is not edited; a new RFC supersedes it and says so in both headers.

**A stub** is an RFC that fills only the header, Summary, Motivation, a Sketch, Compatibility,
Drawbacks and Open questions, marked `draft (stub)`. It holds a roadmap slot and the direction taken;
it is expanded into a full spec, in a new pull request, before it can be accepted.

**Finding work.** `gh issue list --label status:ready` lists what may be taken. The `roadmap` skill in
`.claude/skills/roadmap/` walks an agent through it: pick, read the RFC, branch, implement under
`CLAUDE.md`, run `npm test`, open a pull request that closes the issue. The `rfc` skill walks through
proposing one. The `review` skill briefs the maintainer on a pull request or an RFC, what it changes,
the decisions it asks for, the checks, and on their word merges, comments, or accepts.

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

- `docs/roadmap.md` is the roadmap: the demos, and the RFCs each draws on. The GitHub milestones
  mirror it and say so.
- `docs/rfcs/README.md` is the index: every RFC and its status, kept in the same pull request that
  changes a status.
- `CONTRIBUTING.md` says how work flows and points here.
- `.github/ISSUE_TEMPLATE/rfc.yml`, `task.yml`, `bug.yml` are the issue forms; blank issues are off.
- `.github/PULL_REQUEST_TEMPLATE.md` asks which RFC or issue a pull request serves.
- The Roadmap project board on the `wilanis` organisation shows every `rfc` and `task` issue with its
  labels and milestone. The state of an RFC is its `status:*` label and nothing else; the board adds no
  field of its own, and its built-in Status only says open or done.

### Plugin contract

None.

## Compatibility

None.

## Tests

None. The process is checked by reading.

## Implementation plan

1. This file, the template, the index, `CONTRIBUTING.md`, the issue and pull request templates, the
   `roadmap` and `rfc` skills (the first pull request); the `review` skill (the second).
2. The labels `rfc`, `task`, `status:draft`, `status:accepted`, `status:ready`, `area:*`, and the
   milestones of `docs/roadmap.md` on `wilanis/wilanis-js` (done by hand; recorded here).
3. The Roadmap project board (needs the `project` token scope).
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
