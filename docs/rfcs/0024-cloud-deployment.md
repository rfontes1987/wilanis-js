# RFC 0024: Deployment: one plan, a Compose file and a Helm chart

- **Status:** accepted
- **Areas:** `area:core` (one additive key on `port.schema.json`, one on `connection-kind.schema.json`;
  `Operation` and `ConnectionKindDoc`), `area:compiler` (two rules in `check/contracts.ts`, and the first
  judgement of a connection kind document), `area:runtime` (three fields on RFC 0026's manifest and the one
  function that resolves them), `area:plugin-http` and `area:plugin-auth` (plugin documents say what they
  already do in code, and `@http` gains the `host` it never had), `area:deploy` (a new package, `@wilanis/deploy`, with a new label beside
  `area:view`), and `area:process` (the chart, the cluster script, one CI job). Nothing in the engine,
  nothing in `PluginModule`.
- **Schemas:** `port.schema.json` gains `operations.<name>.listens`; `connection-kind.schema.json` gains
  `endpoint` (both additive). RFC 0026's `manifest.schema.json` gains three fields.
  `packages/deploy/schemas/plan.schema.json` is new: the shape of a command's output, beside RFC 0019's
  `diagnostics.schema.json` and RFC 0026's manifest.
- **Packages:** `@wilanis/deploy` (`packages/deploy/`), depending on `@wilanis/core` and `@wilanis/runtime`
- **Tracking issue:** #26
- **Depends on:** RFC 0013 (a profile is one place a tree runs; `reachOf`; `holds`, `starts` and `needs` per
  profile) and RFC 0026 (the manifest, which this RFC reads and adds three fields to). RFC 0005 is what makes
  a second replica safe and what puts a bucket and a database behind ports the chart can stand up; RFC 0006's
  collector, RFC 0009's broker and RFC 0022's engines each become a switch on the chart when they land.
  RFC 0016 and RFC 0020 are read, not changed.

## Summary

After this RFC a tree deploys, and the recipe is derived rather than written: `wilanis-deploy <root>
--profile <name>` reads RFC 0026's manifest and writes a `Dockerfile`, a Compose file and a values file for
one Helm chart this repository ships, from the facts the tree already states -- the Node it needs, the
profile's start command, the port its `listen` opens, the variables its secrets name, the hosts its
connections dial. Between the manifest and any of those files sits one pure function, `planOf`, whose answer
is a **plan**: one *workload* per profile, its command, its ports, its variables by name, its probe, and what
the environment must provide. A target is a renderer from the plan; three ship (`image`, `compose`, `helm`),
a fourth is a function and no new walk. Two facts a deployment needs and no document said become declarations
a reader can open: an operation that `holds` may say it `listens`, and where the address it binds -- the
interface and the port -- comes from; and a connection kind may say which of its settings is the `endpoint`.
`@http` gains the `host` it never had, so a tree can say 127.0.0.1 on a laptop and every interface in a
container, and a deployment that would bind an address no container has is refused before it is written. Nothing is guessed, nothing is a plugin the
tool knows by name, and no secret's value is ever written to a file.

## Motivation

A tree is documents plus `node_modules`, started by `wilanis start --profile <name>` (RFC 0013). A person
with a virtual machine needs nothing more. Everyone else needs a recipe, and today the recipe is a person
reading four documents and writing YAML by hand. Five things are wrong with that, each visible in the code:

- **The address a tree listens on is half written in a handler and half not written at all.**
  `packages/plugin-http/src/serve.ts:201` is `Number(input.port ?? settings.port ?? 8080)`: the startup
  step's `in.port`, then the `@http` plugin's `settings.port`, then 8080. Three places, in an order only the
  handler knows. `@http/server.port.json` says `holds: true` and describes an accepted `port`, and a reader
  of the port document cannot tell that the number resolves that way -- nor that `listen` opens a TCP socket
  at all, as against `@reload/watch.port.json#watch`, which holds a watcher and opens nothing. RFC 0026
  wrote "a health route if the http plugin grants one" (`0026:42-43`) and then printed neither the port nor
  the route, because the manifest's `startup` rows carry `label`, `run`, `required` and `profiles` and its
  `plugins` rows carry no settings. The one fact every deployment begins with is the one fact the manifest
  does not have.
- **The interface is not written anywhere, and cannot be.** `serve.ts:227` is `server.listen(port, () =>
  ...)`: no host argument, so every tree binds every interface, on a laptop as in a cluster. A tree that
  wants 127.0.0.1 while it is being written, or a specific address on a multi-homed host, has no way to say
  so -- neither `listen.accepts` nor the `@http` settings has a `host`. It is the same omission as the port,
  one step worse: the port is at least decided somewhere.
- **What a tree dials is in a connection's settings under a key only its kind knows.** `baseUrl` for
  `@http/http.connection-kind.json`, `issuer` for `@auth/oidc.connection-kind.json`, and nothing at all for
  `@auth/directory.connection-kind.json`, whose `users` are written in the document. An operator asking
  "what must resolve from inside this cluster" reads every connection and knows each kind. RFC 0002's
  `storage` and RFC 0009's `delivery` and `connection` are the precedent: a fact about a kind belongs on the
  kind, declared once, and every tool reads it the same way.
- **No command turns a tree into an artifact.** `packages/runtime/src/cli.ts:14-31` lists eleven commands;
  none writes a file a container runtime or a cluster accepts. `wilanis init` writes `CLAUDE.md` for an
  agent; nothing writes a `Dockerfile` for a build.
- **The roadmap depends on infrastructure it does not ship.** `docs/roadmap.md` promises "every piece of
  infrastructure a demo needs runs on a local Kubernetes cluster from an open-source chart the repository
  ships (see RFC 0024)", and M02, M03, M07, M08 and M11 each need one: PostgreSQL, an object store speaking
  the S3 API (RFC 0005 `:176` names MinIO and this chart by name), a collector (RFC 0006), Meilisearch for
  RFC 0023 (`0023:172`). There is no `charts/` and no `scripts/`.
- **A deployment recipe drifts from the tree that produced it.** A hand-written Compose file keeps the port
  the tree had last month. Nothing notices.

This RFC does not build or push an image: it writes the `Dockerfile` and prints the command, and `docker`
does the rest, so the package depends on no container runtime. It does not add a document kind, a port, a
trigger kind or a plugin hook. It does not decide TLS, ingress hostnames, autoscaling or resource requests:
those are the cluster's, and they are values on a chart. It does not detect that a profile writes to disk --
RFC 0005 is what removes the disk, and until then every workload defaults to one replica and says why. And
it does not add a provider recipe for Fly, Render, Cloud Run or ECS: each costs money to test and adds
nothing the plan does not already say.

## Guide-level explanation

**The words.** A **plan** is what one deployment of one tree is, derived from the manifest: pure data, no
YAML, no cluster. A **workload** is one profile's process -- RFC 0013 already made a worker a profile
(`0013:370-373`), so one profile is one workload and nothing new says how a tree is split. A **target** is a
renderer from a plan to files: `image` writes a `Dockerfile`, `compose` writes a Compose file, `helm` writes
the values of the one chart this repository ships, `plan` writes the plan itself so that somebody else's
target needs nothing from us. **`requires`** is what the environment must provide: every connection the
profile reaches whose kind declares an `endpoint`, with the host it names.

**One command.**

```
$ npx wilanis-deploy example --profile production
plan: 1 workload (production), 1 port, 2 variables, 1 host required
wrote example/deploy/Dockerfile
wrote example/deploy/.dockerignore
wrote example/deploy/compose.yaml
wrote example/deploy/.env.example
→ docker compose -f example/deploy/compose.yaml up --build
```

`deploy/compose.yaml`, in full, for the example as RFC 0013 leaves it:

```yaml
# generated by wilanis-deploy from example (profile production) -- do not edit
# regenerate: npx wilanis-deploy example --profile production
services:
  monitor-production:
    build:
      context: ..
      dockerfile: deploy/Dockerfile
    image: monitor:0.1.0
    command: ["wilanis", "start", ".", "--profile", "production"]
    ports: ["8080:8080"]
    env_file: [.env]
    restart: unless-stopped
    read_only: true
    tmpfs: ["/tmp"]
    healthcheck:
      test: ["CMD", "node", "-e", "require('node:net').connect(8080).on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"]
      interval: 10s
      timeout: 2s
      retries: 6
```

and `deploy/.env.example`, which holds names and never values:

```
# every variable profile 'production' needs; fill these in and save as .env
MONITOR_API_KEY=        # secrets.monitorKey, read by @connections/monitor-api-production.connection.json
MONITOR_JWT_SECRET=     # secrets.jwt, read by @auth settings
```

**Why the healthcheck is a socket and not a route.** A tree opens its port because a startup step said so,
and `runStartup` runs the steps in order: the socket exists only after every step before `Listen` succeeded.
So the socket *is* the readiness contract the tree already wrote, and a health route would be a second,
weaker statement of it -- and a route `@http` granted would be a route no trigger declares, which is the one
thing the tree's routes are not. RFC 0026 asked whether the http plugin grants a health route; it grants
none, and none is needed.

**The chart.** The Helm chart is not generated. `charts/wilanis-tree/` is written once, reviewed like code,
`helm lint`-ed in CI, and installed by every tree; what differs per tree is its values, which the tool
derives:

```
$ npx wilanis-deploy example --profile production --target helm
wrote example/deploy/values.yaml
→ helm install monitor charts/wilanis-tree -f example/deploy/values.yaml
```

```yaml
# generated by wilanis-deploy from example (profile production) -- do not edit
# regenerate: npx wilanis-deploy example --profile production --target helm
name: monitor
image:
  repository: monitor
  tag: "0.1.0"
  pullPolicy: IfNotPresent
workloads:
  - profile: production
    command: ["wilanis", "start", ".", "--profile", "production"]
    replicas: 1                     # RFC 0005 is what makes a second safe: until then this tree may hold state on disk
    ports: [{ name: http, port: 8080 }]
    probe: { tcpSocket: { port: 8080 } }   # an httpGet here instead probes a route the tree declares
    env:
      - { name: MONITOR_API_KEY, secretKey: MONITOR_API_KEY }
      - { name: MONITOR_JWT_SECRET, secretKey: MONITOR_JWT_SECRET }
secret:
  existingSecret: ""                # created by the operator; the chart never holds a value
  keys: [MONITOR_API_KEY, MONITOR_JWT_SECRET]
requires:
  - connection: "@connections/monitor-api-production.connection.json"
    kind: "@http/http.connection-kind.json"
    endpoint: "https://monitor.internal/api/v1"
# What the chart may stand up beside the tree, all off by default; charts/wilanis-tree/values-local.yaml
# turns on what the example's local cluster needs.
postgresql: { enabled: false }
minio: { enabled: false }
jaeger: { enabled: false }
```

`requires` is not consumed by a template: it is the list an operator reads to know what must resolve, and
what the chart's own `NOTES.txt` prints after an install. The tree said it; nobody retyped it.

**The local cluster.**

```
$ scripts/cluster.sh up
kind: cluster 'wilanis' ready (1 node, 8080 → 30080)
pack: 10 tarballs from packages/ and libraries/, installed into a staging copy of example/
docker: built monitor:0.1.0
helm: installed monitor (charts/wilanis-tree -f example/deploy/values.yaml -f charts/wilanis-tree/values-local.yaml)
ready: deployment/monitor-production 1/1
→ http://localhost:8080/monitor
$ scripts/cluster.sh down
```

The image is built from a staging copy of `example/` into which the workspace's packages are installed as
`npm pack` tarballs -- the same artifacts `npm run release` would publish -- so the demo proves the packages
as they ship, not as they are symlinked.

**The plan, for anyone else's target.**

```
$ npx wilanis-deploy example --profile production --target plan
```
```json
{
  "format": 1,
  "name": "monitor",
  "node": ">=22",
  "image": { "context": ".", "dockerfile": "deploy/Dockerfile", "reference": "monitor:0.1.0" },
  "workloads": [
    {
      "profile": "production",
      "description": "Behind the load balancer: the same bindings, the real monitor API in place of the test one, nothing watched.",
      "command": ["wilanis", "start", ".", "--profile", "production"],
      "listens": [{ "operation": "@http/server.port.json#listen", "host": null, "port": 8080 }],
      "holds": ["@http/server.port.json#listen"],
      "needs": [
        { "variable": "MONITOR_API_KEY", "key": "monitorKey", "readBy": ["@connections/monitor-api-production.connection.json"] },
        { "variable": "MONITOR_JWT_SECRET", "key": "jwt", "readBy": ["@auth settings"] }
      ],
      "replicas": 1,
      "probe": { "tcp": 8080 }
    }
  ],
  "requires": [
    {
      "connection": "@connections/monitor-api-production.connection.json",
      "kind": "@http/http.connection-kind.json",
      "endpoint": "https://monitor.internal/api/v1",
      "reachedBy": ["production"]
    }
  ]
}
```

The plan goes to stdout and never to a file inside the tree: `packages/core/src/load.ts:2` reads *every*
`*.json` under the root, so a `deploy/plan.json` would be a document the loader must refuse. The other
targets write `Dockerfile`, `compose.yaml`, `values.yaml` and `.env.example`, none of which is JSON, and
`deploy/` is therefore invisible to `wilanis check`.

**The documents that gain a line.** `@http/server.port.json` says what its handler already does:

```json
"listen": {
  "description": "Open the port and answer every http trigger in the tree until the process stops. ...",
  "holds": true,
  "listens": {
    "port": { "input": "port", "setting": "port", "default": 8080 },
    "host": { "input": "host", "setting": "host" }
  },
  "accepts": {
    "port": { "type": "number", "required": false, "description": "..." },
    "host": { "type": "string", "required": false, "description": "the interface to bind; absent: every interface" }
  }
}
```

`host` carries no `default`, and that is deliberate: absent everywhere, the handler calls
`server.listen(port)` exactly as it does today, which binds every interface on both families. Writing
`"default": "0.0.0.0"` would have looked tidier and quietly dropped IPv6. So a tree that says nothing keeps
binding everything, and a tree that wants to choose now can:

```json
{ "label": "Listen", "run": "@http/server.port.json#listen", "in": { "port": 8080, "host": "127.0.0.1" } }
```

or, for every profile at once, `"settings": { "port": 8080, "host": "127.0.0.1" }` on the `@http` plugin.
`192.168.1.12` is as ordinary as either: the value is handed to `server.listen(port, host)` and Node decides
whether such an address exists.

and `@http/http.connection-kind.json` says which setting is the address:

```json
{ "$schema": "@wilanis/connection-kind.schema.json", "endpoint": "baseUrl", "settings": { "fields": { "baseUrl": ... } } }
```

`@auth/oidc.connection-kind.json` says `"endpoint": "issuer"`. `@auth/directory.connection-kind.json` says
nothing: its `users` are written in the document, it reaches no host, and a kind that declares no `endpoint`
never appears in `requires`. A plugin that grants neither is unaffected, and `@reload/watch.port.json#watch`
stays a `holds` that opens no socket, which is exactly what `listens` distinguishes.

**The refusals an author meets.** Two are the checker's, on a plugin's own documents:

```
L0nn  @acme/server.port.json#operations/serve
    operation 'serve' declares 'listens' but not 'holds' -- only something that keeps running can listen
    → add "holds": true, or drop "listens"

C0nn  @acme/broker.connection-kind.json#endpoint
    'endpoint' names 'url', which this kind's settings do not declare
    → name a string setting of this kind: host
```

and three are the command's, at deploy time, in the shape `start` refuses a missing variable (RFC 0013):

```
$ npx wilanis-deploy example --profile digest     # a profile whose startup names only the digest run
profile 'digest' holds nothing: every startup step it runs answers and ends
→ a deployed profile keeps something running; deploy a profile whose startup opens a listener, a consumer
  or a scheduler, and run a one-shot profile with wilanis start

$ npx wilanis-deploy example --profile production      # with "port" removed from the @http settings
'@http/server.port.json#listen' listens on a port this tree does not fix: neither the 'Listen' step's
  in.port nor @http settings.port is a number
→ write "in": { "port": 8080 } on the step, or set "port" in the @http plugin's settings

$ npx wilanis-deploy example --profile production      # with "host": "127.0.0.1" on the Listen step
'@http/server.port.json#listen' binds 127.0.0.1, which nothing outside the container can reach: a
  published port and a Service both arrive on the container's own address
→ drop "host" to bind every interface, which is what a container wants; to keep a loopback bind on
  purpose -- a sidecar sharing the network namespace -- render --target plan and write the objects yourself
```

That last one is the whole reason the interface is worth declaring: `host` is the setting a person moves
between the laptop and production and forgets, and the failure it causes is a container that starts,
logs `http: listening on :8080`, passes nothing and answers nobody. A wildcard (`0.0.0.0`, `::`), a
`{{secrets.*}}` read the operator fills in, or no host at all all pass; a fixed address a container will not
have is refused before a file is written.

**Keeping the recipe honest.** Every generated file's first line says it is generated and how to regenerate
it. A file without that line is never overwritten. And `--check` writes nothing and exits 1 when anything
would change, which is what CI runs:

```
$ npx wilanis-deploy example --profile production --check
deploy/compose.yaml would change: ports 8080:8080 → 9090:9090
→ npx wilanis-deploy example --profile production
```

## Reference

### Documents and schemas

**`port.schema.json`**, `operations.<name>` gains `listens` (object, optional): "Where the address this
operation binds comes from. Declared: the operation opens a TCP socket, and each part of its address is the
named `in` value of the startup step that runs it, else the named setting of the plugin that grants the
port, else `default`. Absent: the operation opens no socket, or opens one no deployment needs to reach."
Two properties, `port` and `host`, at least `port` required, each an object with `input` (an identifier the
operation `accepts`), `setting` (an identifier of the granting plugin's settings) and `default`, all
optional and at least one of the three present. `additionalProperties: false` throughout. A `host` with no
`default` means what it says: nothing fixes the interface, so the operation binds every one -- the RFC
declines to write `0.0.0.0` as a default because that is IPv4 only, and today's `server.listen(port)` is
not. `Operation` in `packages/core/src/model.ts` gains
`listens?: { port: Bound<number>; host?: Bound<string> }` with
`Bound<T> = { input?: string; setting?: string; default?: T }`.

**`connection-kind.schema.json`** gains `endpoint` (string, optional): "Which of this kind's settings holds
the address a connection of this kind reaches: a dotted path into `settings`. Declared: a deployment lists
the connection among what the environment must provide. Absent: a connection of this kind reaches nothing
outside the tree, or reaches something no deployment provisions." `ConnectionKindDoc` in `model.ts` mirrors
it. The path is dotted so a nested setting (`broker.url`) can be named; today's three kinds need one
segment.

**RFC 0026's `manifest.schema.json`** gains three fields, by the procedure that RFC set out (`0026:312-315`)
-- named here, added to the schema, and filled by the step of this RFC's plan that lands them:

| Where | Field | Is |
|---|---|---|
| envelope | `node` | the tree's `package.json → engines.node`, verbatim, or `null` |
| `connections[]` | `endpoint` | the value the kind's `endpoint` path picks out of `settings`, as written (a `{{secrets.*}}` template stays text), or `null` when the kind declares none |
| `profiles.<name>` | `listens` | `[{ operation, host, port }]`: every `holds` operation the profile starts whose port document declares `listens`. `port` is the number when one is fixed, else `null`. `host` is the literal when one is written, the `{{secrets.*}}` text when it is a secret read, and `null` when nothing is written -- which is every interface, not an unknown |

**`packages/deploy/schemas/plan.schema.json`** is new, `$id` under the same published base as RFC 0019's
`diagnostics.schema.json` and RFC 0026's manifest, `title` `plan`, every property described,
`additionalProperties: false` on the envelope. It takes RFC 0019's promise as RFC 0026 took it: a field is
added and never removed or retyped, `format` is bumped for a breaking change, every array is sorted. Its
shape is the JSON of the *Guide*.

`HOME` in `packages/core/src/placement.ts`: no change -- this RFC adds no document kind, and `deploy/`,
`charts/` and `scripts/` hold no document. `packages/runtime/templates/CLAUDE.md` gains one sentence under
the commands: "`wilanis-deploy <root> --profile <name>` writes the Dockerfile, the Compose file and the
chart values for one place this tree runs; the tree is the source, so regenerate rather than edit them."
`wilanis new` scaffolds nothing new.

### Ports, operations and kinds granted

None: no port, kind, codec or shape is granted. Three plugin documents *declare* what their code already
does, and one of them gains an input `@http` never had:

| Document | Gains | Because |
|---|---|---|
| `@http/server.port.json` | `listen.listens: { port: { input: "port", setting: "port", default: 8080 }, host: { input: "host", setting: "host" } }` | the port half is `packages/plugin-http/src/serve.ts:201`, said where a reader can open it |
| `@http/server.port.json` | `listen.accepts.host` (string, optional): "the interface to bind: an address of this host, or absent for every interface" | `serve.ts:227` is `server.listen(port, cb)` and a tree has no way to say otherwise |
| `@http/plugin.json` | `settings.host` (string, optional), beside `settings.port` | so a tree fixes the interface once for every profile, as it fixes the port |
| `@http/http.connection-kind.json` | `endpoint: "baseUrl"` | the host an http connection dials |
| `@auth/oidc.connection-kind.json` | `endpoint: "issuer"` | the issuer an OIDC connection dials |

**When an operation declares `listens`.** The test is one question, and it is not `holds`: *does something
outside the process connect to it?* If yes, the operation binds an address and declares `listens`. If the
process is the one dialling, nothing is declared on the operation -- what it dials is a connection, and that
connection's kind declares `endpoint`. The two keys this RFC adds are the two directions of the same fact:

| The process | Says it | On | Written by |
|---|---|---|---|
| accepts what connects to it | `listens` | the operation, in its port document | the plugin granting the port |
| dials out | `endpoint` | the connection kind | the plugin granting the kind |

`holds` is necessary and not sufficient: every listener holds, and most things that hold never listen. Every
`holds` operation in the workspace and in the accepted RFCs, judged by that question:

| Operation | Binds | Declares |
|---|---|---|
| `@http/server.port.json#listen` | a TCP socket | `listens`, with `port` and `host` |
| `@reload/watch.port.json#watch` | nothing -- it watches the filesystem | nothing |
| `@otel/exporter.port.json#export` (RFC 0006) | nothing -- it dials the collector | nothing; see the gap below |
| `@queue/queue.port.json#consume` (RFC 0009) | nothing -- it dials the broker | nothing; the broker is a connection, and its kind declares `endpoint` |
| the scheduler (RFC 0010) | nothing -- a timer | nothing |

So exactly one operation in this workspace declares `listens` today, and a second would be a plugin that
grants a second server: a gRPC listener, an admin or metrics port, a webhook receiver on a port of its own,
an SMTP listener. Each declares both parts of its address the same way, and each is then a row in the
manifest, a port on the plan, a `ports:` entry in Compose and a `containerPort` in the chart with no
renderer learning its name.

Within `listens`, `port` is required and `host` is not, because a listener that cannot choose an interface
is a real thing -- a Unix socket has a path, not an address. An operation binding TCP declares both.

**The gap this leaves, named rather than hidden.** RFC 0006's collector endpoint is a *plugin setting*
(`@otel` `settings.endpoint`), not a connection, so `requires` will not list it and an operator reading the
plan will not see that the tree dials a collector. The fix is one of two, and neither is this RFC's: the
collector becomes a connection of a kind that declares `endpoint`, which is what every other outbound thing
in the tree already is; or `requires` grows a row for a plugin setting that names a host. The first is the
one that fits, and RFC 0006's step that lands `@otel` is where it should be decided.

**Where the address is deliberately *not* sayable.** `wilanis start` gains no `--host` and no `--port`. The
address is a fact of the tree, and a flag would be a fourth place it comes from -- one the manifest cannot
see, which would break the single property every target here rests on: that the tree says where its process
binds. RFC 0013's precedence exists for choosing a *profile*; the profile then says the address, and
`WILANIS_PROFILE` on the process is as far as the environment reaches.

The viewer is the other side of that line and stays where it is: `packages/view/src/serve.ts:121` is
already `opts.host ?? '127.0.0.1'`, with `wilanis-view [--host 127.0.0.1]` in its usage. It is a tool over a
tree, not an operation of one -- it grants nothing and is named by no document -- so it declares no
`listens` and keeps its flags. It is worth reading the asymmetry it exposes, though: the viewer, a
development tool, binds loopback unless told otherwise, and the tree's own server binds every interface
because it has never been able to do anything else.

`packages/plugin-http/src/serve.ts` resolves the host as it resolves the port -- `input.host ??
settings.host` -- and binds with it only when one is fixed: `host ? server.listen(port, host, ready) :
server.listen(port, ready)`. A tree that writes no host binds what it binds today, byte for byte. The
startup log gains the address it actually bound, `http: listening on 127.0.0.1:8080` where a host was
fixed and `:8080` where none was, so the one line a person reads at startup says which of the two happened.

`@auth/directory.connection-kind.json` declares none, and its description gains the clause that says why:
its users are written in the document. When RFC 0005's bucket kind, RFC 0002's storage kinds and RFC 0009's
broker kinds land, each declares its own `endpoint` in the RFC that lands it; none is this RFC's to write.

### Checker rules

`checker.ts:35-43` gains one loop, `for (const kind of registry.all('connection-kind')) checkConnectionKind(judge, kind)`,
so a connection kind document is judged for the first time on its own rather than only when a connection
names it. Numbers are assigned when the implementing pull request lands (current highest: A006 B008 C008
D010 G013 L008 P003 R001 S001 T006, X103; RFC 0003 took C003-C008 over a store's constraints, and
RFC 0013 and RFC 0016 hold their C rows as `C0nn` still, so each takes the next free one when it lands).

| Code | Where it lives | Refuses when | Hint |
|---|---|---|---|
| L0nn | `check/contracts.ts`, `checkPort` | an operation declares `listens` without `holds: true` | `add "holds": true, or drop "listens"` |
| L0nn | `check/contracts.ts`, `checkPort` | `listens.port.input` names no field of the operation's `accepts`, or one whose type is not `number`; `listens.host.input` likewise for `string` | `name a <number\|string> field this operation accepts: <list>` |
| C0nn | `check/contracts.ts`, `checkConnectionKind` (new) | `endpoint` names a path this kind's `settings` do not declare, or one whose type is not a string | `name a string setting of this kind: <list>` |

All three are refusals against a plugin's own documents, so a plugin author meets them and a tree author never
does -- the same footing as D0nn on `requires.ports` (RFC 0005) and X101-X103 (`@auth`). Nothing about a
tree changes: a tree with no `listens` anywhere checks exactly as it does today.

The two deploy-time refusals in the *Guide* are **not** checker rules, on RFC 0013's reasoning (`0013:241-242`):
a tree that never deploys is not wrong for holding nothing, and a port nothing fixes is only wrong when
somebody asks for a container. They are what `wilanis-deploy` verifies, as a missing variable is what `start`
verifies.

### Runtime behaviour

Nothing the engine, the embedder, `start`, `rehearse`, `fuzz`, `regress` or `run` does changes. Two functions
are new and one grows:

- **`listensOf(scope, profile): { operation: string; host: string | null; port: number | null }[]`**, new,
  `packages/runtime/src/manifest.ts`, beside `manifestOf`. For every startup step that runs under the
  profile (RFC 0013) whose operation's port document declares `listens`, each part of the address is read
  the same way: the step's `in.<input>`, else the granting plugin's `settings.<setting>`, else `default`,
  else `null`. A `port` takes only a literal number, so a `{{secrets.*}}` port lands in `null` and is
  refused later; a `host` takes a literal string *or* a `{{secrets.*}}` read, kept as its template text,
  because an operator may well fix the interface from the environment. The order is `serve.ts:201`'s and
  `serve.ts:227`'s, and the test that proves the three agree is named under *Tests*. It never runs a handler
  and never reads the environment.
- **`manifestOf`** fills the three new fields: `node` from the tree's `package.json` (which
  `packages/runtime/src/project.ts` already reads), `connections[].endpoint` through the kind's dotted path,
  and `profiles.<name>.listens` from `listensOf`. It stays pure, sorted and free of the clock and the
  environment, as RFC 0026 promised.
- **`planOf(manifest, options): Plan`**, new, `packages/deploy/src/plan.ts`, the package's one export
  besides the renderers. Pure over a manifest object -- it never loads a tree, so it is tested from a
  committed manifest fixture and a third-party manifest works. `options.profiles` is the profiles asked for
  and `options.image` the reference, both supplied by the command the way RFC 0026 has `manifestOf` take
  `runtime` and `root` -- the command reads the tree's `package.json` for the version and the plan stays pure
  over the manifest. One workload per profile, sorted by profile name, each with the profile's `command`
  (`["wilanis", "start", ".", "--profile", "<name>"]`, and without the flag for the unnamed profile RFC 0026
  keys as `""`), `listens`, `holds`, `needs`, `replicas: 1` and `probe` (the first `listens` port, else
  `null`). `requires` is every connection reached by any asked profile whose row has a non-null `endpoint`,
  sorted by path, with `reachedBy`. It throws the three refusals of the *Guide*: a profile whose `holds` is
  empty; a `listens` whose port is `null`; and a `listens` whose host is a fixed literal that is not a
  wildcard (`0.0.0.0`, `::`) -- a `null` host (every interface) and a `{{secrets.*}}` host (the operator's)
  both pass. The last is thrown by the `compose` and `helm` renderers and not by `plan` itself, since a plan
  is what the tree says and only a published port makes a loopback bind wrong.

`@wilanis/deploy` (`packages/deploy/`, bin `wilanis-deploy`, modelled on `@wilanis/view`: a tool over a
loaded tree, not a plugin) holds `plan.ts` and one renderer per target, each a pure function from a plan to
a list of `{ path, contents }`:

- `image.ts` → `Dockerfile` and `.dockerignore`. `FROM node:<major of the plan's node, else 22>-alpine`,
  `WORKDIR /app`, `COPY package.json package-lock.json ./`, `RUN npm ci --omit=dev`, `COPY . .`,
  `USER node`, `EXPOSE` per distinct listened port, `CMD` the first workload's command. One image serves
  every workload; a workload that is not the first overrides the command, which is why the image is built
  once and the `Dockerfile` names no profile of its own.
- `compose.ts` → `compose.yaml` and `.env.example`, the YAML of the *Guide*, emitted with the `yaml`
  package rather than by string-building, so the output parses by construction.
- `helm.ts` → `values.yaml` for `charts/wilanis-tree`, likewise.
- `plan` is the plan itself, to stdout.

`write.ts` owns the files: each carries the two-line generated header; a file on disk whose first line is
not that header is never overwritten without `--force`; `--check` writes nothing and exits 1 naming what
would change. `cli.ts` parses `wilanis-deploy <root> --profile <name> [--profile <name>]... [--target
image,compose,helm,plan] [-o <dir>] [--check] [--force]`, loads and checks the tree as `wilanis manifest`
does (a tree with refusals prints them and exits 1 with nothing written), builds the manifest through
`manifestOf`, and renders. `--target` defaults to `image,compose`; `-o` defaults to `<root>/deploy`.
`--profile` is required and may be repeated: RFC 0026's reasoning for a default (`0026:395-398`) is that the
common question about a tree is what it *is*, which needs no argument; the common question about a
deployment is where it runs, which the asker always knows.

**The chart**, `charts/wilanis-tree/`, hand-written and versioned here: `Chart.yaml` (`apiVersion: v2`,
`dependencies` naming each upstream chart with a pinned `version` and a `condition`), `values.yaml` (the
shape the tool writes, with every switch off), `templates/` (one Deployment and one Service per entry of
`workloads`, a Secret only when the operator passes `secret.create`, and `NOTES.txt` printing `requires`),
and `values-local.yaml` (what the example's demo turns on, and the hosts it wires). The pod's security
context is what RFC 0020's deployment half asks for and this RFC can give without a rule: `runAsNonRoot`,
`readOnlyRootFilesystem`, an `emptyDir` at `/tmp` for the file blob registry, and no capabilities. The
dependencies:

| Switch | Chart | For |
|---|---|---|
| `postgresql` | CloudNativePG: the operator chart as the dependency, one `Cluster` resource in our templates behind the switch; a CNCF project whose images pull without an account | RFC 0002's engine (M02), and RFC 0009's broker, which is a table in the same connection (`0009:49-51`) -- so the chart ships no broker |
| `minio` | the MinIO project's own chart | the S3 API of RFC 0005 (M08) |
| `jaeger` | the Jaeger chart, OTLP in | RFC 0006's collector (M03) |

Each is off by default and pinned by version, and none is provisioned by the chart for production: a
production connection names a host the operator runs, and the switches exist so that the roadmap's demos
stand up on a laptop. An upstream chart is chosen for images that pull without a vendor account, which is
why the widely-used Bitnami charts are not among them.

**`scripts/cluster.sh`**: `up` creates a `kind` cluster with a host port mapped to a NodePort, packs the
workspace with `npm pack`, installs those tarballs into a staging copy of `example/`, builds the image,
loads it into the cluster, installs the chart with the generated values and `values-local.yaml`, waits for
readiness and prints the URL; `down` deletes the cluster. It is the only thing that needs `docker`, `kind`,
`kubectl` and `helm`, and it says which is missing rather than failing in the middle.

### Discoverability

- `wilanis describe @http/server.port.json` prints, for an operation that declares `listens`:
  `listen  (holds until stopped; port: in.port, else @http settings.port, else 8080; host: in.host, else
  @http settings.host, else every interface)`.
- `wilanis describe @connections/monitor-api.connection.json` prints `endpoint  https://.../api/v1
  (baseUrl, by @http/http.connection-kind.json)`; a connection of a kind that declares none prints nothing
  extra, as today.
- `wilanis manifest` carries `node`, `connections[].endpoint` and `profiles.<name>.listens` with its host
  and port; the `jq` lines
  of RFC 0026 answer the deployment questions without this package installed.
- `wilanis-deploy --help` lists the targets, the flags and what each target writes. `wilanis --help` is
  unchanged: the runtime carries no opinion about containers, so it advertises no deploy command, exactly as
  it advertises no viewer.
- The viewer: the port page shows the `listens` line under an operation marked `holds`, and the connection
  page shows the endpoint -- both through `viewOf`, from the documents, with no new endpoint and no
  dependency on this package.
- `README.md` gains a short *Ship it* section: the one command, the Compose line, and the cluster script.
- `charts/wilanis-tree/README.md` says what the chart expects (an image, a Secret, the values the tool
  writes) and what each switch stands up.

### Plugin contract

None. `PluginModule` in `packages/core/src/plugin.ts` is untouched: a plugin says that an operation listens,
and where its port comes from, in the port document it already ships, and says which setting is an address
in the connection kind it already ships. No hook, no member, no code. This is the rule of the house applied
to deployment: what the DSL names, a reader can open -- so the deploy tool knows `holds`, `listens` and
`endpoint`, and never knows `@http`.

## Compatibility

Two additive, optional keys on two core schemas: every document written before this RFC validates and means
what it meant: a port whose operations declare no `listens`, and a connection kind with no `endpoint`,
behave exactly as today. Three
additive fields on RFC 0026's manifest, by the procedure that RFC set out for exactly this: a field is
added, never removed or retyped, and `format` stays 1. One new package, one new chart directory, one new
script, one new CI job, one new schema for a command's output.

One behaviour changes for a plugin author, and only for one who opts in: a port document that declares
`listens` without `holds`, or a connection kind whose `endpoint` names nothing, is refused where it was
previously accepted -- but no document in this repository or any tree written before this RFC declares
either, so nothing existing is refused. `@http` and `@auth` gain their declarations in the step that lands
the rules, and the test that proves `listensOf` agrees with `serve.ts:201` and `:227` is what keeps them
from drifting.

`@http` gains an input and a setting, `host`, and binds no differently without them: absent everywhere, the
handler still calls `server.listen(port, ready)`, which is every interface on both families. That is why
`listens.host` carries no `default` and why the RFC does not write `0.0.0.0` anywhere it would take effect
-- a default that looked harmless would turn every existing tree IPv4-only on the day it landed. A tree
that writes `host` is choosing something it could not previously express, so nothing it does is a change of
meaning.

IR v1 is unaffected: no lowered form carries a port, an endpoint or a plan. `ir` in the manifest follows
RFC 0008 as before.

## Tests

**Sabotage**, in `packages/runtime/test/example.test.ts` beside the other plugin-document rules (copies of
the example hand `@wilanis/access` in as a `ResolvedInclude`):

- give `@http/server.port.json`'s `listen` a `listens` and remove `holds` → L0nn;
- point `listens.port.input` at `route` (a field `listen` does not accept) → L0nn; at `host` (a string) →
  L0nn; point `listens.host.input` at `port` (a number) → L0nn;
- give `@http/http.connection-kind.json` `"endpoint": "url"` → C0nn; `"endpoint": "headers"` (declared, not
  a string) → C0nn;
- the example unchanged, with the three declarations in place → no refusal.

**The manifest**, in `packages/runtime/test/manifest.test.ts` (RFC 0026's file):

- `node` is `>=22` for the example and `null` for a tree whose `package.json` declares no `engines`;
- `connections[]` for `monitor-api.connection.json` has `endpoint` equal to its `baseUrl`, for
  `employees.connection.json` `null`, and for the production stand-in the template text when a tree writes
  `{{secrets.*}}` there;
- `profiles.production.listens` is one row, `@http/server.port.json#listen` on port 8080 with `host: null`,
  and `profiles.live.listens` the same, with `watch` absent from both because `@reload/watch.port.json#watch`
  declares no `listens`;
- with `port` removed from the `@http` settings, the port is `8080` (the declared default); with a `"in": {
  "port": 9090 }` on the step, `9090`; with `"port": "{{secrets.port}}"` in the settings, `null`;
- `host` is `null` for the example as written; `"127.0.0.1"` with it on the step; `"0.0.0.0"` with it in the
  `@http` settings and nothing on the step; the template text with `"host": "{{secrets.bindHost}}"`;
- **the three agree**: a test in `packages/plugin-http/test` starts the example six ways -- the step's
  `in.port`, the plugin setting, neither; and the step's `in.host`, the plugin setting, neither -- and
  asserts the socket's own `address()` equals what `listensOf` answered for the same tree, with the
  no-host case asserted to be reachable on both `127.0.0.1` and the machine's own address. This is the
  test that keeps `serve.ts:201`, `serve.ts:227` and `server.port.json` from drifting.

**The plan**, in `packages/deploy/test/plan.test.ts`, over a committed manifest fixture
(`test/fixtures/monitor.manifest.json`, written by `wilanis manifest example` and checked in, so the package
tests without loading a tree):

- golden: the plan of the *Guide*, field for field;
- determinism: two calls answer equal strings, and a fixture whose arrays are reversed answers the same;
- two profiles asked for → two workloads, sorted, and `requires` entries carry both in `reachedBy`;
- a profile whose `holds` is empty → throws, naming the profile;
- a `listens` whose port is `null` → throws, naming the operation and both places a number may be written;
- a `listens` whose host is `"127.0.0.1"` → `compose` and `helm` throw, `plan` does not; `"0.0.0.0"`, `"::"`,
  `null` and `"{{secrets.bindHost}}"` → all four render;
- no value of any environment variable set for the test appears in the plan.

**The renderers**, in `packages/deploy/test/render.test.ts`, parsing the output with `yaml`:

- compose: one service per workload, the command, `ports`, `env_file`, `read_only`, the healthcheck's port;
  `.env.example` holds every variable name, an `=` and nothing after it, and no value;
- values: `workloads` matches the plan, `secret.keys` matches the variables, every dependency switch is
  `false`, `requires` carries the endpoint;
- Dockerfile: the `FROM` tag is the major of the plan's `node` (and 22 when it is `null`), `USER node` is
  present, one `EXPOSE` per distinct port, and no variable's value appears;
- every rendered file's first line is the generated header.

**The writer**, in `packages/deploy/test/write.test.ts`, against a temp directory:

- a clean directory → the files are written, and `--check` then reports nothing and exits 0;
- a changed port → `--check` exits 1 naming `compose.yaml`, and writes nothing;
- a file whose header was removed → not overwritten, and the refusal names `--force`; with `--force`, it is;
- `--target plan` writes no file and prints JSON that validates against `plan.schema.json` with Ajv;
- after every target has written into `example/deploy/`, `wilanis check example` still passes -- the
  regression that would catch a target writing a `.json` into a tree.

**The command**, in `packages/deploy/test/cli.test.ts`: `--profile` absent → exits 1 with the usage;
`--profile staging` → exits 1 with RFC 0013's message; a sabotaged copy that fails `check` → exits 1 with
the refusals and nothing written.

**The chart and the cluster**: `helm lint charts/wilanis-tree` and `helm template` against the example's
generated values, in the `cluster` workflow, which also runs `scripts/cluster.sh up`, curls `GET /monitor`
for a 200, and runs `down`. The fast `test` job runs `npx wilanis-deploy example --profile production
--target image,compose,helm --check`, which needs no cluster and fails when the checked-in files have gone
stale.

## Implementation plan

1. **`listens` and `endpoint`.** The two schema keys and their `model.ts` interfaces; `checkConnectionKind`
   and the loop in `checker.ts`; L0nn ×2 and C0nn; the plugin documents; `@http`'s `host` -- the accepted
   input, the setting, `serve.ts` binding with it, the startup log line -- and its own tests; `describe` for
   both lines; the sabotage tests. (`area:core`, `area:compiler`, `area:plugin-http`, `area:plugin-auth`)
2. **The manifest's three fields.** `listensOf`, `node`, `connections[].endpoint`; `manifest.schema.json`;
   the manifest tests and the agreement test in `packages/plugin-http/test`. Blocked on RFC 0026 steps 1
   and 2. (`area:runtime`, `area:plugin-http`)
3. **`packages/deploy`.** The package, `plan.schema.json`, `planOf`, the two deploy-time refusals, the
   `plan` target, the CLI, the manifest fixture, the plan and CLI tests. Blocked on step 2.
   (`area:deploy`)
4. **`image` and `compose`.** The two renderers, `write.ts` with the header, `--check` and `--force`; the
   render and writer tests; `--check` in the CI `test` job. (`area:deploy`)
5. **The chart.** `charts/wilanis-tree/` with its templates, `values.yaml`, pinned dependencies and
   `NOTES.txt`; the `helm` target; `helm lint` and `helm template` in CI; the chart's README.
   (`area:deploy`, `area:process`)
6. **The local cluster.** `scripts/cluster.sh`, the `cluster` workflow, the smoke curl; the README's *Ship
   it*; the `templates/CLAUDE.md` sentence. (`area:process`; the README and the template sentence are a
   `good first issue` once the script works)

Steps 1 and 2 are what M11 needs first and what RFC 0026's manifest is incomplete without; steps 3 and 4
give the demo its image; steps 5 and 6 give it the cluster. Nothing here blocks another RFC: RFC 0005,
RFC 0006, RFC 0009 and RFC 0022 each add a switch to the chart of step 5 when they land, in their own
plans.

## Drawbacks and alternatives

- **Two keys on core schemas for a tool that is not the runtime.** `listens` and `endpoint` describe the
  world a plugin reaches, which is the core's business; but they are read today only by a deploy tool, and
  that is a coupling worth naming. The alternative is a deploy tool that special-cases `@http` and
  `@auth` -- three lines of code that would need a fourth for every plugin that ever listens or dials, and
  that would make "who implements a thing is never a code detail" false of the one tool an operator uses.
  Declared on the document, the fact is also in `describe`, in the viewer and in the manifest, where a
  person who never deploys still benefits from it. If the maintainer prefers the coupling, *Open questions*
  says what changes.
- **`@http` gains a capability, in an RFC about deployment.** A bind address is not a deployment concept --
  it is what a server does -- and the honest reading is that `@http` was incomplete and this RFC is where
  the gap showed. The alternative, an RFC of its own for one input and one setting, would have left this one
  claiming the plan says everything a deployment needs while the plan could not say where the process binds.
  The change is bounded: one optional input, one optional setting, one branch in `serve.ts`, and no default,
  so a tree that ignores it binds what it binds today.
- **A fixed non-wildcard host is refused rather than warned.** There is a legitimate loopback bind in a
  cluster -- a sidecar sharing the pod's network namespace -- and this refusal catches it too. It is still
  the right default: the failure it prevents is silent (a container that starts, logs, and answers nobody),
  and the escape hatch is one flag away, `--target plan`, which is exactly the reader a sidecar deployment
  already is. A warning would be read by nobody and would be the one line CI does not fail on.
- **The Helm chart is hand-written, so it is not derived from the tree.** A generated chart is a template
  that generates a template: the tool would emit Go template expressions, which no YAML emitter can produce
  safely and no test can parse. Splitting it -- the chart written once, its values derived -- puts the
  generated half in pure data and the reviewed half under `helm lint`, and means a fix to the chart reaches
  every tree without regenerating anything. The cost is that a tree with an unusual need edits values rather
  than templates, and that the chart must stay general enough for every tree. It is one Deployment, one
  Service and one Secret; it can.
- **Upstream charts change under us.** Each is pinned by version and off by default, so a change upstream
  breaks the demo and never a deployment. The cost is a pin that ages; renewing it is a pull request the
  `cluster` workflow proves.
- **A generated Dockerfile that is wrong is a support burden.** It is fifteen lines, it is tested field by
  field, and `--check` fails CI when it drifts from the tree. A tree that needs more -- a native module, a
  second stage, a distroless base -- edits it and loses the header, and the tool then refuses to touch it,
  which is the right outcome: the generated recipe is a floor, not a cage.
- **Serverless.** A function per trigger has no process to `hold` a listener, a watcher or a consumer in, so
  a startup list would stop meaning what it means and RFC 0013's profile would stop being one place. This
  RFC's plan makes the question answerable rather than closed: a future target would have to say what
  becomes of `holds`, and if it can, it is a renderer and nothing else changes.
- **Provider recipes (Fly, Render, Cloud Run, ECS).** Out, as the stub said: each costs money to test and
  adds nothing the plan does not say. Anyone who wants one renders `--target plan` and writes fifty lines.
  That is the point of publishing the plan as a schema.
- **Plain Kubernetes manifests, with no Helm.** A reasonable fourth target and a small one, deliberately not
  shipped: two ways to install one thing is a support question, and `helm template | kubectl apply` installs
  the same objects for anyone who wants no release state in the cluster.
- **One image for every workload.** A tree's profiles share their documents and their `node_modules`; only
  the command differs. One image is one build, one scan and one tag to promote. The cost is that a worker
  image carries the http plugin it never starts, which is a few megabytes and no attack surface the process
  does not already have -- the code is loaded either way, and RFC 0016's `permits` is what narrows what it
  may reach.
- **Readiness is a socket, not a route.** A socket says exactly what the startup list already promised, and
  it needs no grant. It says nothing about a dependency that fell over after start, which a real health
  route would; a tree that wants that declares the trigger and writes an `httpGet` over the generated
  `probe` value, which is one line in a file the operator owns. The default costs nothing and claims nothing false.
- **`replicas: 1`.** Until RFC 0005 lands, a tree may keep sessions and blobs on the instance's disk, and a
  second replica would sign a user in on one and out on the other. Defaulting to one and saying why in the
  values file is honest; defaulting to two would be a bug the operator finds in production. The plan does
  not detect disk state, and *Open questions* says when it might.
- **`requires` is derived from what a kind declares, so a kind that declares nothing is invisible.** A
  connection whose kind says no `endpoint` is either self-contained (the example's directories) or a kind
  whose author has not yet added the line. The list is therefore a floor, and `NOTES.txt` says so rather
  than claiming completeness.
- **`deploy/` inside the tree.** It puts build output beside documents, which the project has avoided
  everywhere else. It is also where a reader looks, it is `-o`-able for anyone who disagrees, and it holds
  no `.json`, so the loader never sees it. The alternative, a sibling directory, makes the Docker build
  context the parent of the tree for no gain.

## Open questions

**None before `accepted`.**

**Settled here, so the reasoning survives:**

- **The chart ships from this repository**, `charts/wilanis-tree/`, so the cluster script, the chart and the
  tool that writes its values move together and one CI job proves all three. A repository of its own would
  let the chart version independently of the packages, and cost a second release process before there is a
  first; it stays available later, when the chart has a reason to move at its own pace. Publishing it to an
  OCI registry at 1.0 is a separate question, left below.

- **`listens` and `endpoint` stay on the core schemas.** The alternative was a deploy tool holding a table of
  `{ plugin → port setting, kind → endpoint setting }`, which would have made "who implements a thing is
  never a code detail" false of the one tool an operator uses, and would have needed a new row for every
  plugin that ever listens or dials. Declared on the document, the two facts are also in `describe`, in the
  viewer and in the manifest, where a person who never deploys still reads them.
- **A tree can choose its interface, and `@http` gains `host` to make that true.** `listens` names both parts
  of the address, `port` and `host`, each resolved from the step's `in`, then the plugin's settings, then a
  declared default. `host` has no default: absent, `server.listen(port)` is called exactly as today, which is
  every interface on both families, and writing `0.0.0.0` as a default would have made every existing tree
  IPv4-only. `127.0.0.1`, `192.168.1.12` and `{{secrets.bindHost}}` are each ordinary values; a fixed
  non-wildcard address is refused by the `compose` and `helm` renderers, because nothing outside a container
  can reach one, and `--target plan` is the way past that for a sidecar that shares the namespace.
- **`wilanis image` does not belong in the runtime** (the stub's first question). The runtime carries no
  opinion about containers, exactly as it carries none about the viewer: `@wilanis/deploy` is a tool over a
  manifest, with its own `bin`, its own schema and its own tests, and the runtime's usage text does not grow
  a line.
- **One chart, with its dependencies as switches** (the stub's second question). An umbrella whose subcharts
  are the upstream ones, each pinned and each `condition`-gated, is one thing to install and one thing to
  review; one chart per dependency composed by a fourth chart is the same graph with three more `Chart.yaml`
  files to keep in step.
- **CloudNativePG, and the chart provisions nothing for production** (the stub's third question). The
  switches exist so the roadmap's demos stand up on a laptop; a production database is the operator's, named
  by a connection, and the chart never claims to own one. RFC 0009's broker is a table in that same
  connection (`0009:49-51`), so the stub's queue chart is not needed and is gone.
- **`--profile` is required**, against RFC 0026's default-to-everything, because a deployment is of one
  place and the asker knows which.

**During implementation:**

- **Whether `wilanis new project` scaffolds `"host": "127.0.0.1"` on a new tree's default profile.** The
  default stays every interface -- changing it would break every deployment written before this RFC, and
  would force every container to write `0.0.0.0` to get past the renderers' refusal. But a *new* tree could
  be scaffolded loopback and lose the line when it is deployed, which the refusal already teaches. It would
  make a tree on a café network private by default without a compatibility break anywhere. Recommended;
  it is a product decision about defaults and so the maintainer's.
- Whether the plan grows `volumes` once RFC 0005 lands -- a profile that still reaches a file store or a
  local blob directory -- and whether `planOf` should then refuse `replicas > 1` for it, or only warn.
- The exact default image reference (`<name>:<package.json version>` here) and whether `-o` outside the tree
  should suppress the build context rewrite.
- Whether `charts/wilanis-tree` is published to an OCI registry at 1.0, and under which name.
