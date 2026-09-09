---
name: review
description: Review a pull request or an RFC of wilanis-js for the maintainer. Picks one, briefs them (what it changes, decision points with a recommendation, pros and cons, risks, checks), then on their explicit yes merges the pull request by rebase, posts the review comment, or accepts the RFC. Use when asked to "review PR N", "review RFC NNNN", "what is waiting for review", or "merge N".
---

# Reviewing for the maintainer

The maintainer validates every detail; this skill makes that fast and keeps the record straight. The
procedure is one. The target is a pull request, or one RFC file inside the pull request that proposes it.

## 1. Pick

```
gh pr list -R wilanis/wilanis-js --json number,title,labels,headRefName,statusCheckRollup,reviewDecision
```

If the user named one, use it. Otherwise show what is open with the state of its checks and let them
choose. For an RFC: the file under `docs/rfcs/` and the pull request that proposes it; the file's header
names the tracking issue, and the issue names the pull request.

## 2. Read, in a fresh subagent

Spawn an `Explore` or `general-purpose` agent, never a fork: the brief comes from what is there, not from
the memory of the session that wrote it. Give it the pull request number or the RFC path and ask for the
brief below and nothing else. It reads the whole diff (`gh pr diff N`) or the whole file plus the code the
file names, and `CLAUDE.md`.

## 3. The brief

Under 300 words, in this order:

- **What it changes**, in CLAUDE.md's terms: document kinds, checker rule families, plugin hooks, promises
  the runtime makes, schemas. "None" when none.
- **Decision points**: each a question the maintainer must answer, with a recommendation and the reason. For
  an RFC these are its Open questions plus anything the reader found unsettled.
- **Pros and cons**, only where a real alternative exists.
- **Risks**: what breaks or drifts if this is wrong; any rail below that is not met.
- **Checks**: CI state, unresolved threads, up to date with `main`, the branch named after an issue.

Present it, then ask one question about this one target: merge, comment, accept, or leave.

## 4. Act, on an explicit yes for this target

A yes covers this pull request or this RFC and nothing else. Never carry it to the next one.

### Merge a pull request

Rails, all of them: every check green; no unresolved thread; up to date with `main` (rebase, push, wait
for the checks again if not); the head branch named `<issue>-<short-title>`. Then:

```
gh pr merge N -R wilanis/wilanis-js --rebase --delete-branch
```

Report the commits now on `main`. If the pull request closed a task, look at its RFC's other tasks; when it
was the last, the RFC's status becomes `implemented` (the `roadmap` skill says how).

### Comment on an RFC

Draft the comment from the decision points the maintainer settled, in their voice, plain. Offer it as text
to paste, or post it on their word. It posts under their account with no marker; they approved the text.
A remark about a line goes on that line of the file in the pull request; a remark about the whole goes on
the tracking issue:

```
gh api repos/wilanis/wilanis-js/pulls/N/comments -f body="..." -f path="docs/rfcs/NNNN-title.md" -f commit_id="$(gh pr view N -R wilanis/wilanis-js --json headRefOid -q .headRefOid)" -F line=LINE -f side=RIGHT
gh issue comment M -R wilanis/wilanis-js --body "..."
```

### Accept an RFC

Rails: it is a full spec, never a stub (a stub is expanded first, with the `rfc` skill); no open question
is left in the file, each answered in the text or moved under "decided during implementation"; the tracking
issue exists. Then, in the pull request that holds the file:

1. The header: `**Status:** accepted`. The row in `docs/rfcs/README.md`. Commit and push to the pull
   request's branch.
2. The labels: `gh issue edit M -R wilanis/wilanis-js --remove-label status:draft --add-label status:accepted`.
3. One task issue per step of the Implementation plan, with the RFC form's `task` template: labels `task`
   and the RFC's `area:*`, the tracking issue's milestone, `good first issue` where the plan says so. Link
   each as a sub-issue of the tracking issue (`gh api -X POST repos/wilanis/wilanis-js/issues/M/sub_issues
   -F sub_issue_id=<the task's id, not its number>`). Label the unblocked ones `status:ready`.
4. The board: `gh project item-edit` sets Stage to "Spec accepted" for the tracking issue.

The pull request merges when every full spec in it is accepted or moved out; the stubs in it merge as
stubs.
