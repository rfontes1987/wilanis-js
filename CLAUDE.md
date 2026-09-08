# Working on wilanis

This is the `@wilanis/*` workspace: five npm packages, one example project, one set of tests. Read this
before changing anything; it says where things live and which direction dependencies may point.

## Layout

```
packages/engine/       @wilanis/engine     spec.ts kernel.ts                       depends on nothing
packages/core/         @wilanis/core       model types expr scope load validate plugin, schemas/   → engine
packages/compiler/     @wilanis/compiler   checker.ts compiler.ts                  → core, engine
packages/runtime/      @wilanis/runtime    embed tools serve project cli, plugins/{std,cli-trigger}, bin/, templates/   → core, engine, compiler
packages/plugin-http/  @wilanis/plugin-http  index.ts codecs.ts                    → core, engine
example/               a consumer project: JSON documents + package.json
```

Dependencies point one way: engine ← core ← compiler ← runtime, and plugins depend on core and engine
only. A plugin never imports the compiler or the runtime. The runtime never reaches into a plugin's
internals; it sees the `PluginModule` contract in `packages/core/src/plugin.ts`. If a change needs an
import against this direction, the design is wrong, not the import rule.

Tests live next to what they test: `packages/engine/test` (kernel), `packages/runtime/test` (the example
tree, sabotaged variants, plugin loading, postLoad), `packages/plugin-http/test` (end to end against a
fake upstream). The runtime and the http plugin depend on each other only as devDependencies, for tests.

## Commands

```
npm install                 # links the workspace
npm run build               # tsc -b, project references, dependency order
npm test                    # build, then vitest
npx wilanis check example   # the CLI from the built runtime
npm run release             # publishes engine, core, compiler, runtime, plugin-http in that order
```

`npm test` must pass before a commit. Tests import the built `dist` of sibling packages, so a change in
core needs a build before its effect shows in a runtime test; `npm test` does that.

## Principles, and what they mean here

- **DRY.** A rule lives in one place. Document kinds are declared once in `model.ts` and once as a schema;
  the two mirror each other and `validate.ts` joins them. Refusal codes are produced by the checker (D R L
  G P B T C S) or a plugin's `check` (X); never duplicate a check in the runtime.
- **Orthogonality.** The engine knows nodes, sources and handlers; it never learns about files, shapes or
  triggers. The compiler knows documents and the engine; it never learns about HTTP. Keep it that way.
- **Discoverability.** Every refusal has a code, a file, an `at` path and a hint that names the command
  or the edit that fixes it. Every document kind has a schema with descriptions. Every public function has a
  one-line doc comment that says what it answers.

## How to change things

- **A new rule.** Add it to `packages/compiler/src/checker.ts` under its family, give it the next code,
  write the hint, and add a sabotage test in `packages/runtime/test/example.test.ts` that breaks the example
  and expects the code.
- **A new document kind.** Schema in `packages/core/schemas/` (with `$id` under the published base and
  `$schema` accepting both forms), a `*Doc` interface and the `Kind` entry in `model.ts`, a row in
  `packages/runtime/templates/CLAUDE.md`.
- **A schema change.** Compatible: edit in place. Breaking: the base URL in `model.ts` and every `$id`
  move to `schemas-v2`, and the old branch stays.
- **A new plugin.** A new package under `packages/`, depending on core and engine only, exporting its
  `PluginModule` as default: `root`, `docs` (with `${root}/plugin.json`), `handlers`, and optionally
  `triggers`, `codecs`, `check`, `postLoad`. A project names it in `plugins[].from`. Plugins that carry an
  external dependency are always their own package.
- **A new CLI command.** `packages/runtime/src/cli.ts` dispatches; the work goes in `tools.ts` or
  `serve.ts` so it is callable without the CLI.
- **The project template.** `packages/runtime/templates/` is what `wilanis init` writes into a consumer
  tree. Its `CLAUDE.md` addresses an agent that writes documents, not one that changes this repository.

Do not add features, document kinds, or plugin hooks beyond what a task asks for. When a task seems to
need one, stop and say so.

## Commits

Author: `Rafael Fontes <rfontes1987@gmail.com>` (set as the repository's local git user). Messages are
plain: what changed and why, in the imperative. No generated trailers, no tool or session references.
Commit only when asked; never push or publish without an explicit request.
