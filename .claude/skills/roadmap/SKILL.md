---
name: roadmap
description: Find the next thing to work on in wilanis-js and take it from issue to pull request. Use when asked "what should I work on", "pick a task", "take issue N", or to start work on a roadmap item.
---

# Working the roadmap

The roadmap is `docs/roadmap.md`: demos, each drawing on RFCs under `docs/rfcs/`, tracked as issues on
`wilanis/wilanis-js` under the milestone of the demo that first shows them. Read `CONTRIBUTING.md` once;
this skill is the procedure.

## 1. Find

```
gh issue list -R wilanis/wilanis-js --label status:ready --no-assignee --json number,title,labels,milestone
```

Prefer the lowest milestone (M01 before M02; 1.0 is last on purpose), then the task whose RFC's earlier steps are closed. If the user
named an issue, use it. Never take an issue whose RFC is `status:draft`: say so and stop.

## 2. Read

- The issue: which RFC and which step of its Implementation plan.
- The RFC file, whole: the Reference section states every rule, code, hint and test the step needs.
- `CLAUDE.md`, the "How to change things" entry that matches the step (a new rule, a new kind, ...).

## 3. Claim and branch

```
gh issue edit N -R wilanis/wilanis-js --add-assignee @me
git switch -c N-short-title main   # the issue number first: the branch-name check requires it
```

## 4. Implement

Do only the step. If the step needs something the RFC does not say, stop and ask; do not widen it.
Every new checker rule takes the next free code in its family, the hint the RFC wrote, and a sabotage
test in `packages/runtime/test/example.test.ts` (or the plugin's test directory). Run:

```
npm test
```

## 5. Deliver

Commit in plain imperative sentences (no trailers). Push and open the pull request from
`.github/PULL_REQUEST_TEMPLATE.md`, with `Closes #N` in the body:

```
gh pr create -R wilanis/wilanis-js --fill --body "Closes #N"
```

Tick the step in the tracking issue's checklist once merged. If it was the last of its RFC, edit the
RFC's status to `implemented` and the row in `docs/rfcs/README.md` in the same pull request, and close
the tracking issue when that merges. The state of an RFC is its `status:*` label and its header, kept
equal; the board shows them and adds nothing.
