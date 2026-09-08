# Working on wilanis

This is the `@wilanis/*` workspace: eight npm packages, one example project, and a test directory beside each package that has one. Read this
before changing anything; it says where things live and which direction dependencies may point.

## Layout

```
packages/engine/       @wilanis/engine     spec.ts kernel.ts                       depends on nothing
packages/core/         @wilanis/core       model types expr scope load validate plugin, schemas/   → engine
packages/compiler/     @wilanis/compiler   checker.ts compiler.ts                  → core, engine
packages/runtime/      @wilanis/runtime    embed tools branches serve(start) project cli, plugins/{std,cli-trigger}, docs/{std,cli}, bin/, templates/   → core, engine, compiler
packages/plugin-http/  @wilanis/plugin-http  index.ts codecs.ts throttle.ts, docs/  → core, engine
packages/plugin-blob/  @wilanis/plugin-blob  index.ts, docs/                        → core, engine
packages/plugin-reload/ @wilanis/plugin-reload  index.ts, docs/                     → core, engine
packages/plugin-auth/  @wilanis/plugin-auth  index.ts store.ts, docs/               → core, engine   (the guard: tokens, sessions, challenges, directories)
packages/view/         @wilanis/view       model.ts serve.ts cli.ts, client/index.html, bin/   → core, compiler, runtime
libraries/access/      @wilanis/access     a tree to include: features/access (sign-in, sessions, policies, otp), features/access-dev (its own binding), connections/, project.json, test/
example/               a consumer project: JSON documents + package.json; includes @wilanis/access and binds its identity port in features/directories
```

Dependencies point one way: engine ← core ← compiler ← runtime ← view, and plugins depend on core and
engine only. The viewer is a tool over a loaded tree, not a plugin: it grants nothing to a tree and
executes nothing; `viewOf` is pure and the page under `client/` is one static file with no build step. A plugin never imports the compiler or the runtime. The runtime never reaches into a plugin's
internals; it sees the `PluginModule` contract in `packages/core/src/plugin.ts`. If a change needs an
import against this direction, the design is wrong, not the import rule.

Tests live next to what they test: `packages/engine/test` (kernel), `packages/core/test` (schema validation,
scope), `packages/runtime/test` (the example tree, sabotaged variants, plugin loading, postLoad, the project's
startup steps; and the
branch solver behind `rehearse`), `packages/plugin-http/test` (end to end against a fake upstream),
`packages/plugin-blob/test` (the file store, the CSV parser, the operations), `packages/plugin-reload/test`
(the watcher, and what it does with a tree that refuses), `packages/plugin-auth/test` (sign-in against a directory
and a fake OIDC issuer, the policies over the example's writes, the session across calls and a refresh, the
one-time code on the command line, the plugin's X rules), `libraries/access/test` (the access tree alone, and
every A rule sabotaged),
`packages/view/test` (the view model of the example, and the server). The compiler has no test directory of
its own: every checker rule is exercised through the example and its sabotaged variants in
`packages/runtime/test/example.test.ts`. The runtime and the view depend on the http plugin, and the http
plugin on the runtime, only as devDependencies, for tests.

## Commands

```
npm install                 # links the workspace
npm run build               # tsc -b, project references, dependency order
npm test                    # build, then vitest
npx wilanis check example   # the CLI from the built runtime
npx wilanis check libraries/access   # the access tree on its own, with its development binding
npx wilanis start example   # run what its startup declares (the http listener among them)
npx wilanis-view example    # the viewer, on http://127.0.0.1:4400/
npm run release             # publishes engine, core, compiler, runtime, plugin-http, plugin-blob, plugin-reload, plugin-auth, access, view in that order
```

`npm test` must pass before a commit. Tests import the built `dist` of sibling packages, so a change in
core needs a build before its effect shows in a runtime test; `npm test` does that.

## Principles, and what they mean here

- **DRY.** A rule lives in one place. Document kinds are declared once in `model.ts` and once as a schema;
  the two mirror each other and `validate.ts` joins them. Refusal codes are produced by the checker (D R L
  G P B T A C S) or a plugin's `check` (X); never duplicate a check in the runtime.
- **Orthogonality.** The engine knows nodes, sources and handlers; it never learns about files, shapes or
  triggers. A file's bytes live in the blob registry (`packages/runtime/src/blobs.ts`) and nowhere else: a
  `blob` value is a handle, codecs stream bodies in and out of the registry, and `@blob` operations stream
  what they read. Never buffer a blob whole beside the store. The compiler knows documents and the engine; it never learns about HTTP. Keep it that way.
  A feature is three directories -- `edge/`, `domain/`, `data/` -- and the directory *is* the layer: the
  checker reads it off the path rather than inferring a role from who references a document. A trigger fires
  a domain port operation through its `fire` run node and never names a graph, so the port is the one seam
  between the edge and the business. A binding says how a port is met and never cares which layer it is in.
  The request is read in three places only: a trigger's `fire.in`, a policy's `decide.in`, and a `resolvers`
  document (edge/) whose named reads a data graph or a binding uses as `{{name}}`. A resolver is a read, never
  an operation; the compiler lowers it to a source reference and nothing runs.
  Who is calling is the guard's business and what they may do is a policy's: the one plugin with a `guard`
  (`@auth`) verifies a credential before any graph runs and adds `request.principal`, `request.session`,
  `request.challenge` to every kind's context; a `policy` (edge/) fires a domain operation over those, and its
  graph refuses with a reason the policy maps to `deny` or `challenge`. A trigger attaches its policies
  in order, and where it attaches one it gives the guard the credentials it verifies (`in: { token: ... }`), read from
  the kind's context like any input; the runtime's embedder runs the gate (`Embedder.gate`), never a kind. No graph
  ever validates a token or a code, and no kind ever checks access.
  A tree may include trees (`project.json → includes`, npm packages only): the loader walks their `features/` as
  if local, marks each document `included`, brings their aliases along, and leaves their connections, plugins and
  settings behind. `libraries/` holds such trees; they are pure JSON with their own tests, and depend on no path
  into this repository, since the packages will move to repositories of their own.
- **Discoverability.** Every refusal has a code, a file, an `at` path and a hint that names the command
  or the edit that fixes it. Every document kind has a schema with descriptions. Every public function has a
  one-line doc comment that says what it answers. Who implements a thing is never a code detail: a domain
  port names its bindings, and a native port says which plugin grants it -- `wilanis describe` prints
  `granted by @http (@wilanis/plugin-http)` and the viewer links its manifest.

## How to change things

- **A new rule.** Add it to `packages/compiler/src/checker.ts` under its family, give it the next code,
  write the hint, and add a sabotage test in `packages/runtime/test/example.test.ts` that breaks the example
  and expects the code.
- **A new placement rule.** Placement lives in one place: `HOME` in `packages/core/src/load.ts`, which says
  the layer (or top-level directory) each kind lives in and refuses the rest as D008. Add the kind there, add
  its row to `packages/runtime/templates/CLAUDE.md`, and teach `into()` in `tools.ts` where `wilanis new`
  should write it. A document's layer is read off its path by `layerOf` in `model.ts` -- never inferred from
  what references it.
- **A new document kind.** Schema in `packages/core/schemas/` (with `$id` under the published base and
  `$schema` accepting both forms, and the optional `label` every kind carries), a `*Doc` interface and the
  `Kind` entry in `model.ts`, a row in `packages/runtime/templates/CLAUDE.md`, the baseline in
  `packages/core/test/validate.test.ts`, a `wilanis new` scaffold in `tools.ts`, and a page in the viewer's
  `client/index.html` (`renderDocPage`), since the viewer never shows raw JSON by default.
- **A new include.** A directory under `libraries/`, a workspace member, published as `@wilanis/<name>`: `project.json`
  (its own plugins and aliases; the host reads only the aliases), `features/<name>/` (what a host includes),
  a `-dev` feature and `connections/` that let it check, rehearse and run alone, a `test/` that loads it through
  `loadTree` with the plugins it needs, and a README saying what the host binds and configures. The example
  includes it with `"features": [...]` and binds its ports in a feature of its own. The loader's include walk is
  in `load.ts`; `resolveIncludes` in the runtime's `project.ts` finds the package; tests that copy the example
  hand the include in as `ResolvedInclude` since a copy has no `node_modules`.
- **A new access rule.** Policies and credentials are the `A` family in `checker.ts` (`checkPolicy`, `checkAccess`);
  the guard's own reasons reach a trigger through `refusalsOfTrigger`. A rule about what the guard hands lives
  in the guard's `plugin.json` (`guard.credentials`, `guard.context`, `guard.refuses`), never in a trigger kind.
  What the `@auth` plugin alone can judge (a challenge method, a session write against the session shape) is its
  `check` (X101-X103).
- **A schema change.** Compatible: edit in place. Breaking: the base URL in `model.ts` and every `$id`
  move to `schemas-v2`, and the old branch stays.
- **A new plugin.** A new package under `packages/`, depending on core and engine only, exporting its
  `PluginModule` as default: `root`, `docs` (the directory of the JSON documents it ships, with
  `plugin.json`; listed in the package's `files`), `handlers`, and optionally `triggers`, `codecs`, `check`,
  `postLoad`, and -- for at most one plugin of a tree -- `guard`. Every port, kind, codec or shape a plugin grants is a file under `docs/`, never an object in
  code: what the DSL names, a reader can open. A project names the plugin in `plugins[].from`. Plugins that
  carry an external dependency are always their own package.
- **A new CLI command.** `packages/runtime/src/cli.ts` dispatches; the work goes in `tools.ts` or
  `serve.ts` so it is callable without the CLI.
- **What a tree starts.** Everything a tree starts is declared in `project.json → startup`, never decided by
  the runtime: `wilanis start` runs the plugins' `postLoad`, then those steps, and stops. The HTTP server
  opens because a step names `@http/server.port.json#listen`, so a tree that names none serves nothing.
  An operation that starts something outliving its run is marked `holds` in its port document (beside `pure`
  and `refuses`); it reads `env.hold` to hand back its teardown and `env.serving` to reach the tree, and the
  runtime stops what was held, in reverse, before the `postLoad` teardowns. Only a startup step may name one
  (L008 refuses a graph that runs one), and a native `holds` operation is the one native operation a startup
  step may name (B006 otherwise). `runStartup` and `Served` live in `serve.ts`; `checkStartup` in
  `checker.ts` judges the steps (B006, B007, B008) and runs last, after the resolvers documents are read.
  A plugin's `postLoad` stays what it is: that plugin's own wiring, not the project's.
- **The project template.** `packages/runtime/templates/` is what `wilanis init` writes into a consumer
  tree. Its `CLAUDE.md` addresses an agent that writes documents, not one that changes this repository.

Do not add features, document kinds, or plugin hooks beyond what a task asks for. When a task seems to
need one, stop and say so.

## Commits

Messages are plain: what changed and why, in the imperative. No generated trailers, no tool or session references.