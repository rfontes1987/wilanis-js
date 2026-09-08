# wilanis

Applications as trees of JSON documents. A compiler judges the tree, a stateless engine runs it, and an
AI agent can write every document under rules strict enough that what comes out is secure, easy to change,
and reliable.

You do not write handler code. You write shapes, ports, bindings, graphs and triggers; `wilanis check`
tells you what is wrong with the file, the rule and the fix; `wilanis serve` runs it.

```
mkdir board && cd board
npm init -y && npm install @wilanis/runtime @wilanis/plugin-http
npx wilanis new project board .      # project.json and package.json
npx wilanis init .                   # CLAUDE.md and hooks for an agent working in this tree
npx wilanis check .
```

## Three principles

**DRY.** Every fact is written once and referenced by path. A shape is declared in one file and named as
`@shapes/Task.shape.json` everywhere else. A port is the single statement of what its operations accept
and return; bindings and graphs are judged against it, never re-declare it. Which codec handles which
content type is one table in `project.json`. Nothing is inferred and restated: result types are declared,
and the checker verifies the wiring fits.

**Orthogonality.** The toolchain is five packages with one-way dependencies (below). Inside a tree, the
layers do not leak: triggers speak edge shapes, domain graphs speak core shapes and domain ports, bindings
and data graphs translate between them and are the only place effects happen. Every effectful operation a
feature reaches is allow-listed in its `feature.json`. Plugins sit behind one contract; the compiler never
knows what HTTP is.

**Discoverability.** Every document opens with a `$schema` URL an editor or an agent can fetch. Every
reference is a path from the root or through a declared alias, so `wilanis ls`, `describe` and `map`
answer what exists, what a contract says, and how a request flows. Every refusal carries a code, the file,
the location and the direction of the fix.

## Packages

| Package | What it is | Depends on |
|---|---|---|
| `@wilanis/engine` | The kernel: stateless, clockless, runs a spec and answers a report | nothing |
| `@wilanis/core` | The document language: JSON Schemas, TypeScript model, type system, loader, Scope, plugin contract | engine, ajv |
| `@wilanis/compiler` | `checkTree` judges a loaded tree; `Compiler` lowers graphs to engine specs | core, engine |
| `@wilanis/runtime` | Embedder, gates (`rehearse`, `fuzz`, `regress`), discovery, serve, plugin packages, the `wilanis` CLI. Ships `@std` and `@cli` | core, engine, compiler |
| `@wilanis/plugin-http` | The `@http` plugin: routes with JWT access, outbound requests, connections, body codecs | core, engine, jose |

A project installs `@wilanis/runtime` and the plugin packages it uses. Nothing else.

## The model in one page

- **Documents.** One JSON file each. The `$schema` names the kind: `https://raw.githubusercontent.com/rfontes1987/wilanis/schemas-v1/packages/core/schemas/graph.schema.json`, or the alias `@wilanis/graph.schema.json`.
- **References are paths.** `@features/tasks/tasks.port.json`; `project.json` declares aliases (`@tasks` → `@features/tasks`); plugins are alias roots (`@std`, `@http`); an operation is `path#operation`.
- **Shapes** have a layer: `edge` (what the world imposes) or `core` (ours). `unknown` exists only in edge shapes and native contracts.
- **Ports** are contracts. Granted by a plugin → native (the plugin implements it). In a feature → domain (a **binding** implements it, per operation: a data graph, or a delegation `run` + `params`).
- **Graphs** are dataflow. Nodes are explicit types: `@wilanis/node/run.schema.json`, `switch`, `map`. A node runs when its sources settled. `switch` routes to exactly one node and cancels the rest; `has(x)` in a rule proves `x` present for the routed node. Reconvergence only at `out.from`.
- **Types are declared, never inferred.** `data#object`, `data#merge`, `list#first`, `list#concat`, `http#request` take a `type` or `returns` param; the checker verifies the wiring fits it.
- **No absence.** Required unless `required: false`; optional cannot feed required; a missing key stays missing.
- **Triggers are generic.** A trigger names its kind (http route, cli command, ...), the settings that kind judges, an `input` mapping from the kind's context (`{{request.body.title}}`), edge `in`/`out` types, and a graph. `request.*` is legal in a trigger's `input` and a resolver's `in`; nowhere else.
- **Effects are explicit.** `http.request` answers status, headers, body. Whether 404 is a failure is a `switch`'s decision. A node fails only on the unexpected.
- **Engine.** Stateless, clockless; runs all ready nodes concurrently; `blocked` + `needs` when input is missing; any node's value can be pre-supplied (replay); nested reports for binding graphs; secret redaction.

## project.json: plugins and hooks

```json
"plugins": [
  { "use": "@std" },
  { "use": "@cli" },
  { "use": "@http", "from": "@wilanis/plugin-http", "settings": { "port": 8080, "codecs": { "application/json": "@http/codecs/json.codec.json" } } }
]
```

`use` is the alias root. `from` is the npm package that ships it, imported by the runtime from the
project's own `node_modules`. It is a package name and nothing else: a JSON document can never point at a
file on disk. `@std` and `@cli` are built into the runtime and take no `from`.

A plugin package exports its `PluginModule` as the default export. Two hooks on it:

- `check(ctx)` adds the plugin's own rules (the `X` codes) to `wilanis check`.
- `postLoad(ctx)` runs once after the tree is loaded and judged, before any trigger starts, with the
  plugin's settings (secrets substituted), the registry, the scope and the environment. Open connections,
  warm caches, register parsers here. It may hand back a teardown, run when the runtime stops. `serve`
  and a real `run` call it; the stubbed gates (`rehearse`, `fuzz`, `regress`, `run --seed`) do not.

## Schemas

The schemas live in `packages/core/schemas/` and are published from the `schemas-v1` branch of this
repository, so every document can name its schema by URL and an editor can fetch it:

```
https://raw.githubusercontent.com/rfontes1987/wilanis/schemas-v1/packages/core/schemas/<kind>.schema.json
```

The branch name carries the schema major version. A breaking change to a schema goes to `schemas-v2`;
documents written against v1 keep validating. Node types are documents of their own under `node/`, listed
in `graph.schema.json`.

## The example

`example/` is a task board and a complete consumer project: it installs `@wilanis/runtime` and
`@wilanis/plugin-http` from `package.json` and contains nothing but JSON. `GET /tasks[?status=]` and
`POST /tasks` are http triggers into domain graphs that speak `@tasks/tasks.port.json`;
`tasks-rest.binding.json` meets that port with data graphs that issue declared PostgREST requests, forward
the caller's bearer token through a resolver, and decide with a `switch` on `status` whether the answer is
rows or a failure. A cli trigger prints a digest through the same port.

```
npm install && npm run build
npx wilanis check example
npx wilanis rehearse example --seed 4
npx wilanis map example
npx wilanis describe @http/http.port.json example
npm test
```

## Developing this repository

It is an npm workspace. `npm run build` builds every package through TypeScript project references,
`npm test` builds and runs the tests, `npm run release` publishes the five packages in dependency order.
`CLAUDE.md` describes the layout and the rules for changing it.

## License

Apache-2.0. See `LICENSE`.
