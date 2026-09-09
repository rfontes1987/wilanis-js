# Contributing to wilanis

Work here flows from a spec to a pull request, never the other way round. The whole process is
RFC 0001, `docs/rfcs/0001-the-rfc-process.md`; this page is the short form.

## How work flows

1. **The roadmap is `docs/roadmap.md`**: demos, each naming the RFCs it draws on; the GitHub milestones
   mirror it. **An RFC** is one file under `docs/rfcs/`, proposed in a pull request and tracked by one
   issue labelled `rfc` under the milestone that first shows it. Nothing is implemented while it is
   `status:draft`.
2. **An accepted RFC becomes tasks**: its Implementation plan, one sub-issue each, labelled `task`.
   A task that is unblocked and unclaimed is `status:ready`; `help wanted` means we would like someone
   outside to take it; `good first issue` means it needs no prior knowledge of the code.
3. **A task becomes a pull request** that closes it. `npm test` must pass: lint, build and every test.
4. **A fix that changes no rule and makes no promise** needs no RFC: open a `bug` issue or just a pull
   request.

## Finding something to work on

```
gh issue list -R wilanis/wilanis-js --label status:ready --no-assignee
gh issue list -R wilanis/wilanis-js --label "help wanted"
```

Prefer the lowest milestone. Pick one, assign yourself, read its RFC, then work. If you use Claude Code, `/roadmap` does exactly
this, `/rfc` walks through proposing a new RFC, and `/review` briefs the maintainer on a pull request or
an RFC and acts on their word. The skills live in `.claude/skills/`.

## Branches

A branch is named after the issue it serves: `<issue>-<short-title>`, as in `4-storage-plugin`. A pull
request from a branch named otherwise fails its `branch name` check. `main` takes pull requests only, with
the checks green, and never a force push. A branch lives while it is worked on: with no open pull request
it is deleted 14 days after its last commit; with one, the pull request is marked stale after 30 quiet days
and closed 14 days later. Merging deletes the head branch.

## The rules the code follows

`CLAUDE.md` is the whole story: where things live, which way dependencies point, the house rules
Biome enforces, and how to add a rule, a kind, a plugin. Read it before changing anything. A rule that
bites is a design signal, not an obstacle.

## Commits and pull requests

A commit message says what changed and why, in the imperative, in plain words. No generated trailers,
no tool or session references. A pull request names the issue it serves and ticks the template's
boxes. Discussion of *whether* to do something belongs on the RFC, not on the pull request that does it.
