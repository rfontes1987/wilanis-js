---
name: rfc
description: Propose or expand an RFC in wilanis-js: pick the next number, write the spec from the template, open the pull request and the tracking issue. Use when asked to "write an RFC", "spec this out", "expand stub NNNN", or when a task needs a new kind, rule family, hook or promise.
---

# Proposing an RFC

The process is `docs/rfcs/0001-the-rfc-process.md`. This skill is the procedure.

## When one is needed

A new document kind, a new checker rule family, a new plugin hook, a port or kind a plugin grants, a
promise the runtime makes (a semantic, a compatibility rule), or a change to any of those. A fix, a
refactor or a new rule inside an existing family under an accepted RFC needs none.

## 1. Number and file

```
ls docs/rfcs | sort | tail -1
cp docs/rfcs/0000-template.md docs/rfcs/NNNN-short-title.md
```

To expand a stub, edit its file in place and change `draft (stub)` to `draft`.

## 2. Write

Fill every section of the template; write "none" rather than deleting a subsection. Ground every
claim in the code: name the file and function that changes, the existing rule the new one sits
beside, the command whose output changes. Codes for new rules are written as the family letter and a
placeholder (`G0nn`) with the note that numbers are assigned when the implementing pull request
lands. Show the documents an author writes as JSON against `example/`. Say what the RFC does not do.

## 3. Index and propose

Add the row to `docs/rfcs/README.md`. Branch, commit, push, and open the pull request:

```
git switch -c rfc-NNNN-short-title main
gh pr create -R wilanis/wilanis-js --label rfc --title "RFC NNNN: Title" --fill
```

## 4. Track

Open the tracking issue with the RFC form, `gh issue create -R wilanis/wilanis-js --template rfc.yml`
(or on GitHub), paste the Summary, choose the milestone, link the pull request, and write the issue
number into the RFC's header in the same pull request.

## 5. Acceptance

The maintainer validates every detail on the pull request. On merge the header's status is `accepted`,
the tracking issue's label moves from `status:draft` to `status:accepted`, and the Implementation plan
becomes sub-issues labelled `task`, the first unblocked ones `status:ready`.
