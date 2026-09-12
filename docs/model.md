# The model

Every rule `wilanis check` enforces, stated once. The [README](../README.md) shows what a service looks
like; this page is the reference. [`CLAUDE.md`](../CLAUDE.md) is for changing the toolchain itself, and the
schemas under [`packages/core/schemas/`](../packages/core/schemas/) are what every rule here mirrors.

## Documents

- **One JSON file each.** The `$schema` names the kind:
  `https://raw.githubusercontent.com/wilanis/wilanis-js/main/packages/core/schemas/graph.schema.json`, or the
  alias `@wilanis/graph.schema.json`. Every kind carries an optional `label` and `description`.
- **References are paths.** `@features/tasks/tasks.port.json`; `project.json` declares aliases
  (`@tasks` → `@features/tasks`); plugins are alias roots (`@std`, `@http`); an operation is `path#operation`.
- **A document's place is a rule.** `HOME` in `packages/core/src/placement.ts` says which layer each kind
  lives in, and D008 refuses the rest.

## Features and layers

A feature is three directories, and the directory *is* the layer:

| Directory | What lives there |
|---|---|
| `edge/` | triggers, policies, the shapes the world speaks, resolvers |
| `domain/` | the port, the core shapes, the graphs that hold business rules |
| `data/` | the binding, and the graphs that translate and reach effects |

The checker reads the layer off the path and never infers it from who references a document.
`feature.json` lists the effects the feature may use.

## Shapes

A type: named fields with types, required unless said otherwise. A shape has a layer -- `edge` (what the
world imposes) or `core` (ours). An edge shape lives in `edge/`, a core shape in `domain/`. `unknown` exists
only in edge shapes and native contracts. The misspelled field a partner API returns lives in an edge shape
and never reaches the domain.

## Ports and bindings

A **port** is a contract: operations with `accepts` and `returns`. Granted by a plugin it is *native* -- the
plugin implements it. Declared in a feature it is a *domain* port, and a **binding** meets it, per operation:
a data graph, or a delegation (`run` + `in`). Swap the binding and the same domain runs against a different
store, a fake, or a queue. A profile in `project.json` chooses the bindings.

## Graphs

Dataflow. Nodes have explicit types: `@wilanis/node/run.schema.json`, `switch`, `map`. A node runs when its
sources have settled, and independent nodes run concurrently. `switch` routes to exactly one node and cancels
the rest; `has(x)` in a rule proves `x` present for the routed node. Reconvergence happens only at `out.from`.

## One way in

A node's `in` gives every value an operation takes, in one grammar: a literal as written, or `{{asked.status}}`
to read another node, the graph's `in`, a constant (`{{const.initial}}`) or a resolver. Embedded in text it
interpolates (`"/tasks/{{in.id}}"`). A key that is not an identifier is quoted in brackets:
`{{request.headers['user-agent']}}`. A contract marks the fields that must be literals `static` (a connection,
a content type); a `type` field always is.

## Types are declared, never inferred

`object#make`, `object#merge`, `list#first`, `list#concat`, `http#request` take a `type` or `returns` field
naming the result type, and the checker verifies the values given fit it.

## The standard library is four ports

`@std/object` (`make`, `merge`), `@std/text` (`fill`, `join`, `split`, `replace`), `@std/list` (`count`,
`first`, `concat`, `slice`), `@std/outcome` (`refuse`). All pure, legal in any layer.

## No absence

Required unless `required: false`; an optional value cannot feed a required one; a missing key stays missing.

## Files are blobs

A `blob` is a type: the value is a handle (id, contentType, size, filename) and the bytes live once, on disk,
in the runtime's blob registry (`project.json → blobs.dir`). An upload streams into the registry through a
content type mapped to `@http/codecs/blob.codec.json` and the graph gets the handle; a download is a trigger
whose `out` is `blob`, streamed back out. `@blob/csv.port.json` reads a blob as rows of a declared shape and
writes rows as one; every such operation is an effect, so it lives in a data graph. Nothing of a file passes
through the engine, and a run's blobs are released once the trigger has answered.

## Triggers are generic

A trigger names its kind (an http route, a cli command, whatever a plugin grants), the settings that kind
judges, edge `in`/`out` types, and `fire`: the domain port operation it runs, with its inputs read from the
kind's context (`{{request.body.title}}`). **A trigger never names a graph**; the port's binding decides how
the operation is met.

## Access is a trigger's declaration and a policy's decision

A trigger attaches the policies that gate it, in order, and where it attaches one it gives the guard the
credentials it verifies, read from the kind's context like any input:

```json
{ "policy": "@access/edge/employees-only.policy.json",
  "in": { "token": ["{{request.headers.authorization}}", "{{request.cookies.session}}"] } }
```

A list is the places a credential may sit, the first present wins; a later policy written bare reuses what an
earlier one gave. A **policy** lives in `edge/` and fires a domain operation the way a trigger does, reading
what the guard hands: `request.principal`, `request.session`, `request.challenge`. Its graph allows by
answering and refuses with a reason; `outcomes` says whether a reason is a `deny` or a `challenge`, and the
trigger maps every reason it can reach, its policies' included (T005).

Validating a credential happens in the guarding plugin, before any policy, never in a graph, and the guard's
`plugin.json` says which credentials it verifies and what each yields. A trigger with no policies is public.
`has(principal) && 'recorder' in principal.roles` is a rule: `in` looks into a list, and what `has()` proves
on the left of `&&` may be read on the right.

A session is opened when a token is issued and carries attributes of a shape the project names; a graph reads
and writes them through `@auth/session.port.json`, keyed by `request.session.id`, and `wilanis describe` on the
shape lists who writes what.

## A tree includes trees

`project.json → includes` names npm packages whose `features/` load as if they sat here -- the same paths, the
same rules, visible through `exports` and `dependsOn`, bound by bindings and profiles -- and whose aliases come
along. Connections, plugins, settings, startup and profiles stay the host's; a port the include leaves unbound
is the host's to bind. An alias collision is D007, a feature present in both trees is D009, and a package that
is not a tree (or one using a plugin this project does not name) is D010. `@wilanis/access` is such a tree.

## Resolvers are reads

A `resolvers` document in a feature's `edge/` names what the data layer takes from the request
(`request.headers['user-agent']`); a data graph or a binding names the document and reads `{{agent}}`.
`request.*` is legal in a trigger's `fire.in`, a policy's `decide.in` and a resolver's `read`; nowhere else.
A resolver declared `required` is read as present, and every trigger reaching it must guarantee that: its kind
hands the path always, or a policy of the trigger lists it under `proves` (A006). A resolver is a read, never
an operation -- the compiler lowers it to a source reference and nothing runs.

## Effects are explicit

`http.request` answers status, headers and body. Whether a 404 is a failure is a `switch`'s decision: the body
is judged against `returns` only on a 2xx, so an error body reaches the switch. A node fails only on the
unexpected.

## The engine

Stateless and clockless. It runs all ready nodes concurrently, answers `blocked` with `needs` when input is
missing, accepts any node's value pre-supplied (that is replay), nests reports for binding graphs, and redacts
secrets.

## Refusal codes

Every refusal carries a code, the file, an `at` path inside it, and a hint naming the command or the edit that
fixes it. The families, each judged in its own module under `packages/compiler/src/check/`:

| Family | What it judges |
|---|---|
| `D` | documents: the loader, schema validation, placement, includes |
| `R` | references: a path or an operation that does not resolve |
| `L` | layers, effects and visibility |
| `G` | graphs: nodes, reads, narrowing, the graph as a whole |
| `P` | static fields and resolvers |
| `B` | bindings, profiles and the startup steps |
| `T` | triggers |
| `S` | scenarios |
| `A` | access: policies, credentials, what a policy proves |
| `C` | connections and settings |
| `X` | a plugin's own rules, from its `check` hook |

## project.json

```json
"plugins": [
  { "use": "@std" },
  { "use": "@cli" },
  { "use": "@http", "from": "@wilanis/plugin-http", "settings": { "port": 8080, "codecs": { "application/json": "@http/codecs/json.codec.json" } } }
]
```

`use` is the alias root. `from` is the npm package that ships the plugin, imported by the runtime from the
project's own `node_modules`. It is a package name and nothing else: a JSON document can never point at a file
on disk. `@std` and `@cli` are built into the runtime and take no `from`.

```json
"includes": [{ "from": "@wilanis/access", "features": ["access"] }]
```

`wilanis describe` and the viewer say `included from @wilanis/access` and name the file under `node_modules`.

A plugin package exports its `PluginModule` as the default export. Three hooks on it:

- `check(ctx)` adds the plugin's own rules (the `X` codes) to `wilanis check`.
- `guard` -- on the one plugin that identifies callers, declared in its `plugin.json` -- is called by the
  runtime around every fire of a trigger that attaches a policy, for every trigger kind alike: `identify`
  reads and verifies the credential and hands `request.principal`, `request.session`, `request.challenge`;
  `challenge` opens a challenge a policy asked for; `settle` spends what was single-use. The stubbed gates
  never call it.
- `postLoad(ctx)` runs once after the tree is loaded and judged, before any trigger starts, with the plugin's
  settings (secrets substituted), the registry, the scope and the environment. Open connections, warm caches,
  register parsers here. It may hand back a teardown, run when the runtime stops. `start` and a real `run`
  call it; the stubbed gates (`rehearse`, `fuzz`, `regress`, `run --seed`) do not.

## What a tree starts

`postLoad` is a plugin's own wiring, written in TypeScript, and a reader of the tree cannot see it. What *this*
project starts is declared instead, in `project.json → startup`:

```json
"startup": [
  { "label": "Open the pool", "run": "@board/domain/store.port.json#open" },
  { "label": "Watch for changes", "run": "@reload/watch.port.json#watch" },
  { "label": "Listen", "run": "@http/server.port.json#listen" }
]
```

`wilanis start` runs every plugin's `postLoad`, then these steps in order -- and nothing else. **The HTTP
server opens because the last step says so.** Delete it and nothing listens: no runtime decides on its own
that a tree with http triggers should open a port.

Each step names one port operation. Most name a **domain port**, so the active profile's binding decides how it
is met -- a fake in development, the real connection in production, without touching the step. Its `in` is
written as literals and `{{secrets.*}}`; nothing has been received yet, so a step that reads `request.*` -- or
whose bound graph does -- is refused before it ever runs (B007, B008).

A step may also name a `holds` operation: one that starts something outliving the run -- a listener, a watcher,
a subscription. A plugin grants it, `wilanis describe` marks it `(holds until stopped)`, and the runtime stops
what it started, in reverse, when the process ends. A graph may never run one (L008): what answers a request
cannot start a server.

A step that refuses stops the start and exits nonzero: a tree whose database is unreachable never opens its
port, rather than answering every route with a fault. Say `"required": false` for a step the tree can serve
without, and its refusal is logged while the rest go on.

```
$ npx wilanis start example
startup 1/3 Reach the entry store: ok
reload: watching /path/to/example -- an edit is served once it passes wilanis check
startup 2/3 Watch for changes: ok
http: listening on :8080 -- GET /monitor → @monitor/domain/monitor.port.json#list, ...
startup 3/3 Listen: ok
```

With `@reload` among the steps, editing a document serves the new tree without closing the port; a change that
does not pass `wilanis check` is reported and the last good tree keeps answering.

## Schemas and versioning

The schemas live in [`packages/core/schemas/`](../packages/core/schemas/) and are served from `main`, so every
document can name its schema by URL and an editor can fetch it:

```
https://raw.githubusercontent.com/wilanis/wilanis-js/main/packages/core/schemas/<kind>.schema.json
```

Until 1.0 is published they are a working draft and `main` is their address. At 1.0 the tag `schemas-v1` marks
the first supported version and becomes the address; a breaking change after that is tagged `schemas-v2`, and
documents written against v1 keep validating. [RFC 0008](rfcs/0008-ir-versioning.md) states the rules. Node
types are documents of their own under `node/`, listed in `graph.schema.json`.
