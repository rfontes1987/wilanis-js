# RFC 0013: A deployment model: profiles, environments and what a tree needs to run

- **Status:** draft (stub)
- **Areas:** `area:runtime`, `area:core`
- **Tracking issue:** #15
- **Depends on:** RFC 0005 (externalized state), RFC 0016 (capabilities), RFC 0026 (manifest)

## Summary

What a deployable unit is, how a profile names an environment, how the secrets that environment supplies
are declared but never held, and what `wilanis start` verifies before it opens a port. The tree already has
the pieces; this RFC writes the contract between them.

## Motivation

`project.json` has `profiles` (each a set of bindings per domain port) and `secrets` (each a name bound to
an environment variable), per `packages/core/schemas/project.schema.json`. What it lacks is the statement of
how a tree goes from a repository to a running process in production: which profile is active and who
decides, which secrets must be present, what is checked at start and what is refused. Without that, every
deployment reinvents it, and an agent asked to "deploy" has no document to write.

## Sketch

- **The unit.** A tree is deployed as its documents plus its `node_modules` (the plugins and the includes it
  names), and nothing else: no build output, since documents are what runs. `wilanis start <root>
  --profile <name>` is the one entry point; the profile is chosen outside the tree, by whoever runs it.
- **Secrets.** `project.json → secrets` already maps a name to an `UPPER_CASE` variable. This RFC adds the
  rule that `wilanis start` refuses, before `postLoad`, when a secret the active profile's bindings read is
  not set, listing the variables by name; a secret never appears in a document or a scenario.
- **Profiles as environments.** A profile gains `permits` (RFC 0016), the effects the environment allows,
  and `startup` may name a profile, so production listens and development also watches. The `-dev` profile
  convention `libraries/access` already follows (its own binding, its own connections) becomes the documented
  pattern for every tree.
- **What start verifies.** Load, judge, resolve secrets, run `postLoad`, run the startup steps in order, and
  only then listen; a step that refuses stops the start (already the rule). The manifest (RFC 0026) is what a
  provisioner reads to know the variables, ports and permits the tree expects.

## Checker rules, tests, implementation plan

Written when this RFC is expanded to a full spec.

## Compatibility

Additive fields on `project.schema.json`; a tree with one profile and no `permits` behaves as today.

## Drawbacks and alternatives

A profile chosen by flag means the same tree behaves differently by how it is started, which is the point,
but the manifest must print per profile so a reviewer sees each. The alternative, one tree per environment,
duplicates every document and was rejected.

## Open questions

- Is the active profile a flag, an environment variable, or a `default` in `project.json` with a flag
  override? The RFC should pick one order of precedence.
- Do secrets have a scope per profile, so that a development secret cannot be read under production?
- Where do connection settings that differ by environment (a base URL, a pool size) live: on the connection
  document under a profile, or as secrets?
