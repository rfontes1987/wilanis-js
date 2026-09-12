# wilanis

wilanis is a language for describing a backend service, a compiler that checks the description, and a
runtime that runs it.

The description is JSON documents: the routes, the types, the contracts between the parts, and how data
flows through them. There is no application code. The documents are the service, and `wilanis check` reads
every one of them and proves they fit together before anything runs. An AI agent can write them, because
every mistake it makes comes back as a refusal naming the file and the fix.

*Status: pre-1.0 and moving. Nothing is on npm yet, so clone and build to try it. See
[Status and roadmap](#status-and-roadmap). The schemas are served from `main` until the `schemas-v1` tag.*

## The problem it solves

Backend services repeat the same steps: take a request, check it, call a database or another API, decide
what the answer means, send a response. In Express, Fastify or NestJS you write each step as a function, and
then a test that fakes the network and slowly stops matching it. Your business rules are a small part of
that code. Most of it connects one step to the next, and that is where the bugs are, because it is written
again in every project and rarely tested well. When the API you call adds a field you edit a handler, a
type, a validator and a test, and hope you found them all.

## What a service looks like

You do not write the code that connects the steps. You write files that say what should happen, and the
runtime does it.

A route is one file. This one is from [`example/`](example/), a small REST service in front of a public
API, shown without its `$schema` line and description:

```json
{
  "label": "GET /monitor/{id}",
  "kind": "@http/http.trigger-kind.json",
  "settings": {
    "route": "/monitor/{id}",
    "method": "GET",
    "produces": "application/json",
    "response": { "refusals": { "missing": 404, "upstream": 502 } }
  },
  "in": "@monitor/edge/IdRequest.shape.json",
  "out": "@monitor/edge/EntryView.shape.json",
  "fire": {
    "run": "@monitor/domain/monitor.port.json#get",
    "in": { "id": "{{request.params.id}}" }
  }
}
```

Read it top to bottom: a GET on `/monitor/{id}`, open to anyone since it names no policy, answering JSON.
It takes an `IdRequest` and answers an `EntryView`, both shapes declared in their own files. It runs the
`get` operation of the `monitor` port with the id from the URL. If the operation refuses with reason
`missing`, the client gets a 404; with `upstream`, a 502.

The route does not say *how* `get` is done. That is a separate file, a graph, which fetches the row and
decides what the upstream's answer means. Three of its five nodes:

```json
{
  "label": "Get a row",
  "in": "@monitor/domain/EntryRef.shape.json",
  "out": { "type": "@monitor/domain/Entry.shape.json", "from": ["row", "missing", "failed"] },
  "nodes": [
    {
      "id": "asked",
      "type": "@wilanis/node/run.schema.json",
      "run": "@http/http.port.json#request",
      "in": {
        "connection": "@connections/monitor-api.connection.json",
        "method": "GET",
        "path": "/monitor/{{in.id}}",
        "produces": "application/json",
        "returns": "@monitor/edge/EntryRow.shape.json"
      }
    },
    {
      "id": "route",
      "type": "@wilanis/node/switch.schema.json",
      "in": { "status": "{{asked.status}}", "body": "{{asked.body}}" },
      "rules": [
        { "when": "status == 404", "to": "missing" },
        { "when": "status == 200 && has(body)", "to": "row" }
      ],
      "else": "failed"
    },
    {
      "id": "missing",
      "type": "@wilanis/node/run.schema.json",
      "run": "@std/outcome.port.json#refuse",
      "in": { "reason": "missing", "message": "no entry {{in.id}}", "type": "@monitor/domain/Entry.shape.json" }
    }
  ]
}
```

One request, one decision, one declared outcome per branch. A 404 from the API is not an exception here; it
is a case you named. Anything you did not name goes to `failed`, and the checker will not accept a switch
without an `else`.

## The checker reads it before you run it

`wilanis check` loads every file and verifies that they fit together: every reference points at a file that
exists, every operation you call exists on its port, every value you pass fits the type the operation
accepts, every graph's output fits what its caller expects, every effect a feature reaches is one it is
allowed to reach. Rename an operation in the port and forget the route, and you get this:

```
R001  @features/monitor/edge/get-entry.trigger.json#fire/run
    port '@monitor/domain/monitor.port.json' has no operation 'fetch' (operations: listAll, listByMethod, get, ...)
    → wilanis ls port

1 refusal(s)
```

The file, the path inside it, what is wrong, and the command that shows the fix. A compiler does this for
typed code. wilanis does it for the whole service, the connections between its parts included. Every refusal
carries a code from one of eleven families, listed in [`docs/model.md`](docs/model.md#refusal-codes).

## Every branch runs before you deploy

`wilanis rehearse` runs every trigger with the outside world stubbed. For each `switch` it works out which
inputs reach each rule and runs that branch too, so a code path you never tested by hand is exercised anyway:

```
features/monitor/data/get-row  switch 'route'  3/3 branches
  ok  when status == 404               refused on purpose at 'missing' as missing: "no entry golf"
  ok  when status == 200 && has(body)  answered from 'row'
  ok  anything else                    refused on purpose at 'failed' as upstream: "the monitor API answered 500"

every branch settled -- 37 branch(es), 15 decision(s), 15 graph(s).
```

A rule that no input can satisfy is reported as `NEVER RUN`: either dead logic or a hole in your routing,
found without writing a test. `wilanis fuzz` records runs as scenarios and `wilanis regress` replays them and
compares the results, so an edit that changes what the service does shows up as a difference you can read.

## See the whole thing

`wilanis map` prints how a request flows -- through its policies, into the port, the binding and the graphs,
down to the effects:

```
@features/monitor/edge/delete-entry.trigger.json  (@http/http.trigger-kind.json)
  gated by @features/access/edge/employees-only.policy.json → @access/domain/access.port.json#requireEmployee  given token
  gated by @features/access/edge/can-record.policy.json → @access/domain/access.port.json#requireRecorder
  @monitor/domain/monitor.port.json#remove
    @features/monitor/data/delete-row.graph.json
      asked @http/http.port.json#request  (effect)
      route [switch → missing | row | failed]
```

`wilanis-view` serves every file as a page and draws every graph. This is the `Get a row` graph from above:
the input on the left, the request, the decision on its status, the three outcomes, and the output they
converge on. Every box is a node in the file and every wire is a `{{reference}}`. The panel on the right says
who reaches this graph and what it uses; double-clicking a node opens what it runs.

![The get-row graph in wilanis-view](docs/viewer-get-row.png)

## What you get

**Almost no code, so almost nothing to test.** The example serves fourteen routes and three commands: a REST
resource with batch deletion and a rate-limited upstream, CSV import and export, sign-in against two
directories, a session, role-based policies over every write, and a command gated by a one-time code. It is
fifty-seven JSON files of its own plus the fifty-odd it includes, and **zero lines of JavaScript or
TypeScript**. The code that does exist is general: the engine is about 650 lines, and the standard library is
four ports of pure operations. None of it knows anything about your business. It is tested once, here.

**Less code changes less often.** Code changes when the world changes: a new field, a new route, an API that
answers 410 where it used to answer 404. Here each of those is an edit to a JSON file, judged before it runs.
The runtime only changes when a new kind of thing becomes possible, which is rare.

**The tests are already written.** You do not fake a 404 by hand. `rehearse` takes that case from your own
switch rule and runs it. Add a rule and its branch is covered the moment you save.

**Anyone can read the service.** `map` prints the flow, `describe` lays out a contract, the viewer draws every
graph. A new colleague, or an auditor, reads the service without reading code.

**An agent can write it.** Every file has a schema, so every key is either allowed or refused, and there is no
syntax to be creative with. A JSON file cannot open a socket or read the disk. It can only point at other
files, and it can only call effects its feature allows. So an agent's mistakes are refusals with hints: it
reads one, edits, and checks again. `wilanis init` writes a `CLAUDE.md` into your project that tells the agent
the rules.

## Try it

The example talks to a public test API and needs no key. The one secret is the key its own tokens are signed
with:

```
git clone https://github.com/wilanis/wilanis-js && cd wilanis-js
npm install && npm run build
npx wilanis check example          # is the tree consistent?
npx wilanis rehearse example       # run every branch of every route and policy, world stubbed
npx wilanis map example            # how does a request flow, and what gates it?
npx wilanis-view example           # draw it, on http://127.0.0.1:4400/
export MONITOR_JWT_SECRET=$(openssl rand -base64 32)
npx wilanis start example          # run what its startup declares: on :8080
npx wilanis run @hello/edge/hello-gated.trigger.json example   # challenged until you answer with a one-time code
```

[`example/README.md`](example/README.md) walks through what it serves and who may do what.

Until the packages are published, starting your own project means running `npx wilanis` from this
repository's root against your tree. From 1.0:

```
mkdir board && cd board
npm init -y && npm install @wilanis/runtime @wilanis/plugin-http
npx wilanis new project board .    # project.json and package.json
npx wilanis init .                 # CLAUDE.md and hooks for an agent working in this tree
npx wilanis check .
```

## The words

| Word | What it is |
|---|---|
| **Shape** | A type: named fields, required unless said otherwise. An `edge` shape is what the outside world sends and expects; a `core` shape is yours. |
| **Port** | A contract: operations with what they accept and return. A plugin grants ports (`@http/http.port.json` has `request`); your feature declares its own. |
| **Binding** | How a port is met: for each operation, the graph that does it. Swap the binding and the same domain runs against a different store, a fake, or a queue. |
| **Graph** | A data flow: nodes that run an operation, route on a condition (`switch`) or fan out over a list (`map`). A node runs when its inputs are ready; `{{asked.body}}` is the body of the node called `asked`. |
| **Trigger** | An entry point: an HTTP route, a CLI command, whatever a plugin offers. It names the port operation to fire, where its inputs come from, and the policies that gate it -- never a graph. |
| **Policy** | A gate on a trigger. It fires a port operation over what the guard established about the caller; its graph allows by answering, or refuses with a reason the policy calls a denial or a challenge. A trigger with no policies is public. |
| **Feature** | A directory with three subdirectories, and the directory is the layer: `edge/`, `domain/`, `data/`. `feature.json` lists the effects it may use. |
| **Plugin** | An npm package exposing a `PluginModule`: the ports, trigger kinds and codecs it grants, each as a JSON file you can open, and a handler function per operation. |

[`docs/model.md`](docs/model.md) is the full reference: every rule, `project.json`, what a tree starts, and
the schemas.

## Packages

| Package | What it is | Depends on |
|---|---|---|
| [`@wilanis/engine`](packages/engine) | The kernel: stateless, clockless, runs a spec and answers a report | nothing |
| [`@wilanis/core`](packages/core) | The document language: JSON Schemas, TypeScript model, type system, loader, Scope, plugin contract | engine, ajv |
| [`@wilanis/compiler`](packages/compiler) | `checkTree` judges a loaded tree; `Compiler` lowers graphs to engine specs | core, engine |
| [`@wilanis/runtime`](packages/runtime) | Embedder, gates (`rehearse`, `fuzz`, `regress`), discovery, startup, blob registry, the `wilanis` CLI. Ships `@std` and `@cli` | core, engine, compiler |
| [`@wilanis/plugin-http`](packages/plugin-http) | The `@http` plugin: routes, outbound requests, connections, body codecs, cookies | core, engine |
| [`@wilanis/plugin-blob`](packages/plugin-blob) | The `@blob` plugin: stored files read as CSV rows or text, and written back | core, engine |
| [`@wilanis/plugin-reload`](packages/plugin-reload) | The `@reload` plugin: watch the tree and serve it again on a change, without closing the port | core, engine |
| [`@wilanis/plugin-auth`](packages/plugin-auth) | The `@auth` plugin: the guard that identifies callers -- our own tokens, sessions with typed attributes, one-time challenges | core, engine, jose |
| [`@wilanis/view`](packages/view) | The `wilanis-view` viewer: every graph drawn, callers one click away. Read-only; it grants nothing and runs nothing | core, compiler, runtime |
| [`@wilanis/access`](libraries/access) | Not a toolchain package but a tree to include: sign-in, sessions, the policies that gate other features, and the command that issues a one-time code. Pure JSON | plugin-auth, plugin-http at run time |

Dependencies point one way -- engine ← core ← compiler ← runtime ← view -- and a plugin depends on core and
engine only. A project installs `@wilanis/runtime`, the plugin packages it uses, and the trees it includes.

## Status and roadmap

Pre-1.0. Everything above runs today; nothing is published to npm yet, on purpose. 1.0 is cut only once every
accepted RFC that changes a schema has landed or been withdrawn, so the schemas are final before they are
frozen.

[`docs/roadmap.md`](docs/roadmap.md) is the plan, and a milestone is a demo -- something a person runs and
sees that the example could not do before: entries in a real store, sessions shared across instances, files in
an object store, a request drawn as a trace, work off the request, one command that deploys it, tenants by
construction, an agent repairing a broken tree from the diagnostics. Each draws on RFCs under
[`docs/rfcs/`](docs/rfcs/README.md), which are specified and accepted before anything is built.

The decisions about this repository's own code are tests. [`fitness/`](fitness/README.md) holds one file per
claim: the engine imports nothing, dependencies point one way, a plugin grants files not objects, every
refusal says how to fix it. Each file also carries the broken input that proves its test catches a
violation. Changing a decision takes a `Decision:` line in the commit, in the maintainer's own words.

## Developing this repository

An npm workspace: eight packages, one includable tree, one example project.

```
npm install                 # links the workspace
npm run build               # tsc -b, project references, dependency order
npm test                    # lint, build, then every test
npm run lint:fix            # biome, applying every safe fix
```

[`CLAUDE.md`](CLAUDE.md) describes the layout and the rules for changing it -- which way dependencies point,
the house rules Biome enforces, and how to add a rule, a document kind or a plugin.
[`CONTRIBUTING.md`](CONTRIBUTING.md) says how work flows from an RFC to an issue to a pull request.

## License

Apache-2.0. See [`LICENSE`](LICENSE).
