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

Everyone taking part is held to the [Code of Conduct](CODE_OF_CONDUCT.md), and a vulnerability is reported
privately, the way [SECURITY.md](SECURITY.md) says, never as an issue.

## Finding something to work on

One milestone is worked at a time: the open one with the earliest due date, since `docs/roadmap.md`
numbers them in the order their RFCs allow.

```
gh api repos/wilanis/wilanis-js/milestones --jq '[.[] | select(.state == "open")] | sort_by(.due_on)[0].title'
gh issue list -R wilanis/wilanis-js --label status:ready --search "no:assignee" --milestone "<that title>"
gh issue list -R wilanis/wilanis-js --label "help wanted"
```

Pick one, **claim it by pushing its branch**, then read its RFC and work. The claim is the branch, not
the assignee: GitHub accepts a second assignee as readily as the first, so two people who both read
`no:assignee` both start. Creating a ref is the one thing the server refuses twice.

```
git switch -c <issue>-<short-title>
git push --force-with-lease=refs/heads/<issue>-<short-title>: -u origin <issue>-<short-title>
gh issue edit <issue> -R wilanis/wilanis-js --add-assignee @me
```

The empty lease says *this ref must not exist*; a rejection means someone holds the task already, so take
another rather than forcing or renaming. Assigning yourself records the claim afterwards and does not make
it. Before taking anything, check the ref as well as the label: `git ls-remote --heads origin
'refs/heads/<issue>-*'`. If nothing under the milestone is `status:ready`, its
remaining steps wait on one in flight: say which, rather than reaching into the next milestone. If you use
Claude Code, `/roadmap` does exactly this, `/rfc` walks through proposing a new RFC, and `/review` briefs
the maintainer on a pull request or an RFC and acts on their word. The skills live in `.claude/skills/`.

## Branches

A branch is named after the issue it serves: `<issue>-<short-title>`, as in `4-storage-plugin`. A pull
request from a branch named otherwise fails its `branch name` check. `main` takes pull requests only, with
the checks green, and never a force push. A branch lives while it is worked on: with no open pull request
it is deleted 14 days after its last commit; with one, the pull request is marked stale after 30 quiet days
and closed 14 days later. Merging deletes the head branch on the remote, and not your copy of it:
delete that too, or the clone collects branches whose remote is gone.

```
git switch main && git pull --ff-only && git branch -D <issue>-<short-title>
git fetch --prune
```

## The rules the code follows

`CLAUDE.md` is the whole story: where things live, which way dependencies point, the house rules
Biome enforces, and how to add a rule, a kind, a plugin. Read it before changing anything. A rule that
bites is a design signal, not an obstacle.

## Commits and pull requests

A commit message says what changed and why, in the imperative, in plain words. No generated trailers,
no tool or session references. A pull request names the issue it serves and ticks the template's
boxes. Discussion of *whether* to do something belongs on the RFC, not on the pull request that does it.

**A change to a `fitness/*.fitness.ts` file is a change of decision.** Each one is a decision about this
repository's code -- a claim with why it holds and when to retire it (RFC 0027). A commit touching one
carries one more line, in the maintainer's own words. The rest of the directory is not a decision and needs
no line: `lib/` reads the repository and judges nothing, `README.md` describes, `run.test.ts` registers.

```
Decision: retires fitness/the-engine-imports-nothing.fitness.ts because RFC 00NN moves sources into the engine.
```

`npm install` switches on `.githooks/commit-msg`, which refuses the commit without it; `--no-verify` skips
the hook, and the `decision` job in CI does not. That job checks every such commit and then waits in the
`decisions` environment for the maintainer to approve the run, so a decision is never changed silently. A
fitness function that bites is a design signal: the edit usually goes to the code, not to `fitness/`.
