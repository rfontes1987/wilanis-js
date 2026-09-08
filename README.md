# wilanis

Declarative dataflow graphs, judged by a compiler, run by a stateless kernel. Clean-room TypeScript / Node 22.

A tree of JSON documents describes an application: shapes, ports, bindings, graphs, triggers, connections.
`wilanis check` judges the whole tree statically so that nothing refuses at load; `serve` runs it; `rehearse`, `fuzz` and `regress` are the gates an AI agent runs after every edit and before it stops.

```
npm install && npm run build
node bin/wilanis.js check example
node bin/wilanis.js rehearse example --seed 4
node bin/wilanis.js fuzz example --runs 6 && node bin/wilanis.js regress example
node bin/wilanis.js map example
node bin/wilanis.js describe @http/http.port.json example
npm test
```

## The model in one page

- **Documents.** One JSON file each; the `$schema` names the kind (`@wilanis/graph.schema.json`). Schemas live in `schemas/`.
- **References are paths.** `@features/tasks/tasks.port.json`; `project.json` declares aliases (`@tasks` → `@features/tasks`); plugins are alias roots (`@std`, `@http`); operations are `path#operation`.
- **Shapes** have a layer: `edge` (what the world imposes) or `core` (ours). `unknown` exists only in edge shapes and native contracts.
- **Ports** are contracts. Granted by a plugin → native (the plugin implements it). In a feature → domain (a **binding** implements it, per operation: a data graph, or a delegation `run` + `params` = the declared statement).
- **Graphs** are dataflow. Nodes are explicit types: `@wilanis/node/run`, `switch`, `map`. A node runs when its sources settled. `switch` routes to exactly one node and cancels the rest; `has(x)` in a rule proves `x` present for the routed node. Reconvergence only at `out.from`.
- **Types are declared, never inferred.** `data#object`, `data#merge`, `list#first`, `list#concat`, `http#request` take a `type`/`returns` param; the checker verifies the wiring fits it.
- **No absence.** Required unless `required: false`; optional cannot feed required; the kernel treats missing keys as missing keys.
- **Triggers are generic.** A trigger names its kind (http route, cron, cli, ...), the settings that kind judges, an `input` mapping from the kind's context (`{{request.body.title}}`, `{{request.query.page}}`), edge `in`/`out` types, and a graph. `request.*` is legal in a trigger's `input` and a resolver's `in`; nowhere else.
- **Content types are explicit.** The `@http` settings table maps content type → codec (json, text, form, multipart); triggers and `http.request` say `consumes` / `produces`.
- **`http.request`** knows method, path, headers, body; answers status, headers, body. Whether 404 is a failure is a `switch`'s decision. A node fails only on the unexpected.
- **Kernel.** Stateless, clockless; runs all ready nodes concurrently; `blocked` + `needs` when input is missing; any node's value can be pre-supplied (replay); nested reports for binding graphs; secret redaction.

## Layout

```
schemas/        JSON Schemas, one per kind (+ schemas/node/*)
src/model.ts    the document model            src/types/     the type system
src/schema/     Ajv validation                src/loader/    tree loading, aliases, plugin roots
src/expr/       switch expressions            src/check/     Scope + every rule (D R L G P B T C S X)
src/kernel/     spec + scheduler              src/compiler/  lowering to kernel specs, env
src/plugins/    @std @http @schedule @cli     src/triggers/  the embedder (fire, input mapping, prune)
src/tools/      rehearse fuzz regress describe ls map new     src/serve.ts  serve / run
templates/      CLAUDE.md + .claude/settings.json hooks (wilanis init)
example/        the board project: React front end ↔ routes ↔ PostgREST-shaped API
test/           kernel, checker (14 sabotaged variants), http end-to-end against a fake upstream
```

## The example

`example/` is a task board. `GET /tasks[?status=]` and `POST /tasks` are http triggers into domain graphs that speak `@tasks/tasks.port.json`; `tasks-rest.binding.json` meets that port with data graphs that issue declared PostgREST requests (`/tasks?select=...&status=eq.{{in.status}}`), forward the caller's bearer token through a resolver, and decide with a `switch` on `status` whether the answer is rows or a failure. A cron trigger builds a nightly digest through the same port. `test/http.test.ts` runs the whole thing against a fake upstream: 401 without a token, 400 on an enum miss or an undeclared body field, 200 with pruned rows, 201 with the status the domain chose.

Two refusals the checker produced while this example was being written, both real: `B005` (an operation's accepts did not match its data graph's `in`) and `T004` (the nightly digest reached a graph that read `request.headers` under a kind that hands none). The second is why `listAll` does not forward a caller and `listByStatus` does.
