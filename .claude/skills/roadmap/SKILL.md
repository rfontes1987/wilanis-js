---
name: roadmap
description: Find the next thing to work on in wilanis-js and take it from issue to pull request. Use when asked "what should I work on", "pick a task", "take issue N", or to start work on a roadmap item.
---

# Working the roadmap

The roadmap is `docs/roadmap.md`: demos, each drawing on RFCs under `docs/rfcs/`, tracked as issues on
`wilanis/wilanis-js` under the milestone of the demo that first shows them. Read `CONTRIBUTING.md` once;
this skill is the procedure.

## 1. Find

One milestone is worked at a time: the open one with the earliest due date. `docs/roadmap.md` numbers the
milestones in the order their RFCs allow, so the current one is the lowest open number and its date says so.

```
gh api repos/wilanis/wilanis-js/milestones --jq '[.[] | select(.state == "open")] | sort_by(.due_on)[0].title'
gh issue list -R wilanis/wilanis-js --label status:ready --search "no:assignee" \
  --milestone "<that title>" --json number,title,labels,milestone
```

Within the milestone, prefer the task whose RFC's earlier steps are closed. If nothing there is
`status:ready`, its remaining steps wait on one in flight: say which, and do not reach into the next
milestone. If the user named an issue, use it. Never take an issue whose RFC is `status:draft`: say so and
stop.

## 2. Read

- The issue: which RFC and which step of its Implementation plan.
- The RFC file, whole: the Reference section states every rule, code, hint and test the step needs.
- `CLAUDE.md`, the "How to change things" entry that matches the step (a new rule, a new kind, ...).

## 3. Claim and branch

```
gh issue edit N -R wilanis/wilanis-js --add-assignee @me
git switch main && git pull --ff-only
git switch -c N-short-title        # the issue number first: the branch-name check requires it
```

Move the issue's card to *In Progress*, so the board says what is being worked and not only what is left:

```
gh project item-edit 1 --owner wilanis --field Status --value "In Progress" \
  --url https://github.com/wilanis/wilanis-js/issues/N
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

Label the RFC's next step `status:ready`, or the board stops answering what can be taken and the milestone
looks blocked when it is not.

Merging deletes the branch on the remote and not the copy here. Delete that too, or the clone collects
branches whose remote is gone:

```
git switch main && git pull --ff-only && git branch -D N-short-title
git fetch --prune
```

## 6. When the milestone closes

Close the GitHub milestone, then point the board's *Now* view at the next one, or it keeps showing a
milestone that is done:

```
gh api graphql -f query='mutation($v:ID!,$f:String!){ updateProjectV2View(input:{viewId:$v,filter:$f}){ projectV2View { name filter } } }' \
  -f v=PVTV_lADOE33gE84Bi9UDzgLogF0 -f f='milestone:"<the next milestone title>"'
```

If the demo `docs/roadmap.md` promises for the milestone does not run by hand, the milestone is not closed,
whatever its issues say.
