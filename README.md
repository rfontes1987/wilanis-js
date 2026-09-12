# wilanis

**Backend services written as JSON documents instead of code.** You describe the routes, the types, the
contracts between the parts and how data flows through them. A compiler reads every file and proves they fit
together before anything runs. A small engine runs them.

The example in this repository serves **fourteen HTTP routes and three commands**: a REST resource over a
rate-limited upstream, CSV import and export, sign-in against two directories, sessions, and role-based
policies over every write. It is **57 JSON files and zero lines of JavaScript**.

*Pre-1.0 and moving. Nothing is on npm yet, so clone and build to try it. See [Status](#status).*

## A route is one file

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

A GET on `/monitor/{id}`, open to anyone because it names no policy. It takes an `IdRequest` and answers an
`EntryView`, both declared in files of their own. It runs the `get` operation of the `monitor` port with the
id from the URL. If that operation refuses with `missing`, the client gets a 404; with `upstream`, a 502.

The file never says *how* `get` works. In the same example a command-line trigger fires that same operation,
under the same policies, and neither the engine nor the compiler knows what HTTP is.

## What it does is a graph

Behind the port, one file per operation. Two of the five nodes in the one behind `get`, the decision and
one of the outcomes it routes to:

```json
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
```

One request, one decision, a declared outcome per branch. A 404 from the API is not an exception here, it is
a case you named. Anything you did not name goes to `failed`, and the checker will not accept a switch
without an `else`.

![The same graph, drawn by wilanis-view](docs/viewer-get-row.png)

## The compiler reads it before it runs

Rename an operation in the port and forget the route that calls it:

```
R001  @features/monitor/edge/get-entry.trigger.json#fire/run
    port '@monitor/domain/monitor.port.json' has no operation 'fetch' (operations: listAll, listByMethod, get, ...)
    → wilanis ls port
```

The file, the path inside it, what is wrong, and the command that shows the fix. Every reference, every
input, every output, every effect a feature reaches: judged across the whole tree at once, not one file at a
time.

## Every branch runs before you ship

`wilanis rehearse` runs every route and command with the network stubbed. For each switch it works out which
inputs reach each rule, and runs that branch too:

```
features/monitor/data/get-row  switch 'route'  3/3 branches
  ok  when status == 404               refused on purpose at 'missing' as missing: "no entry golf"
  ok  when status == 200 && has(body)  answered from 'row'
  ok  anything else                    refused on purpose at 'failed' as upstream: "the monitor API answered 500"

every branch settled -- 37 branch(es), 15 decision(s), 15 graph(s).
```

A rule that no input can satisfy is reported as `NEVER RUN`: dead logic, or a hole in your routing, found
without writing a test. `wilanis fuzz` writes runs out as scenarios, files of their own, and `wilanis regress`
replays them and compares node by node, so an edit that changes what the service does says so before it
ships.

## Why this suits code a model writes

Every file has a schema, so a key is either allowed or refused and there is no free-form syntax to invent
into. `check` judges the whole tree and answers with a code, a file, a path inside it and a hint. A wrong
document is inert: it cannot open a socket or read the disk, and it can only reach the effects its feature
declares. Checking takes a second and needs no network.

The bet is that a model does not have to be large to work in a language like that. Proving it is a milestone
on the roadmap, not a claim we have measured: break the example, and repair it from `wilanis check --json`.

## Try it

The example talks to a public test API and needs no key.

```
git clone https://github.com/wilanis/wilanis-js && cd wilanis-js
npm install && npm run build
npx wilanis check example          # is the tree consistent?
npx wilanis rehearse example       # run every branch of every route and policy, network stubbed
npx wilanis map example            # how does a request flow, and what gates it?
npx wilanis-view example           # draw it, on http://127.0.0.1:4400/
export MONITOR_JWT_SECRET=$(openssl rand -base64 32)
npx wilanis start example          # serve it on :8080
```

[`example/README.md`](example/README.md) walks through what it serves and who may do what.

## The words

| Word | What it is |
|---|---|
| **Shape** | A type: named fields, required unless said otherwise. An `edge` shape is what the outside world sends; a `core` shape is yours. |
| **Port** | A contract: operations with what they accept and return. |
| **Binding** | How a port is met, one graph per operation. Swap it and the same code runs against a different store, or a fake. |
| **Graph** | A data flow: nodes that run an operation, route on a condition, or fan out over a list. A node runs when its inputs are ready. |
| **Trigger** | An entry point: an HTTP route, a command, whatever a plugin offers. It names the operation to fire and the policies that gate it. |
| **Policy** | A gate on a trigger. It allows by answering, or refuses with a reason. A trigger with no policies is public. |
| **Connection** | Where an effect goes and how it is paced: an address, credentials read from secrets, a throttle. A graph names the connection, never the address. |
| **Profile** | Which binding meets which port, chosen per environment, so the same documents run against a fake or the real thing. |
| **Feature** | A directory of three: `edge/`, `domain/`, `data/`. The directory is the layer, and the checker reads it off the path. |
| **Plugin** | An npm package that ships JSON documents and one handler per operation. It is the only place code lives. |

[`docs/model.md`](docs/model.md) is the full reference: every rule, every refusal code, `project.json`, and
what a tree starts.

## What is here

| Package | |
|---|---|
| [`@wilanis/engine`](packages/engine) | The kernel: stateless, clockless, 650 lines, and it imports nothing |
| [`@wilanis/core`](packages/core) | The document language: schemas, model, type system, loader |
| [`@wilanis/compiler`](packages/compiler) | Judges a loaded tree, and lowers its graphs to engine specs |
| [`@wilanis/runtime`](packages/runtime) | Embedder, `rehearse`, `fuzz`, `regress`, startup, and the `wilanis` CLI |
| [`@wilanis/plugin-http`](packages/plugin-http) | Routes, outbound requests, connections, body codecs |
| [`@wilanis/plugin-blob`](packages/plugin-blob) | Stored files read as CSV rows or text, and written back |
| [`@wilanis/plugin-reload`](packages/plugin-reload) | Serve the tree again when it changes, without closing the port |
| [`@wilanis/plugin-auth`](packages/plugin-auth) | The guard: tokens, sessions with typed attributes, one-time challenges |
| [`@wilanis/view`](packages/view) | The viewer. Read-only: it grants nothing and runs nothing |
| [`@wilanis/access`](libraries/access) | Not code but a tree to include: sign-in, sessions and policies, in pure JSON |

Dependencies point one way, engine ← core ← compiler ← runtime, and a plugin depends on core and engine
only. A project installs the runtime, the plugins it uses, and the trees it includes.

## Status

Pre-1.0. Everything above runs today. Nothing is published to npm yet, on purpose: 1.0 is cut once every
accepted RFC that changes a schema has landed or been withdrawn, so the schemas are final before they are
frozen.

[`docs/roadmap.md`](docs/roadmap.md) is the plan, and each milestone is a demo: entries in a real database,
sessions shared across instances, a request drawn as a trace, work moved off the request, one command that
deploys it, tenants that cannot leak into each other, an agent repairing a broken tree. Each draws on RFCs under [`docs/rfcs/`](docs/rfcs/README.md),
written and accepted before anything is built.

## Contributing

[`CONTRIBUTING.md`](CONTRIBUTING.md) says how work flows, from an RFC to an issue to a pull request, and
[`CLAUDE.md`](CLAUDE.md) is the map of the code. Issues labelled `good first issue` need no prior knowledge
of it.

A plugin is the place to start if you want to add something the language cannot say: an npm package that
ships its ports and kinds as JSON documents and implements one handler each. The checker holds it to what it
declares.

## License

Apache-2.0. See [`LICENSE`](LICENSE).
