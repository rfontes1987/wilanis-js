# Working in this tree

This project is a wilanis tree: behaviour is JSON documents, judged by `wilanis check`, run by a stateless
engine. You do not write handler code. You write documents and the compiler tells you what is wrong, with
the file, the rule and the fix.

## The loop

1. Edit or add documents. After every edit the hook runs `wilanis check`. Read the refusal, fix it, do not work around it.
2. Before you stop, `wilanis rehearse` runs every trigger with stubbed effects, and every branch of every `switch` it
   reaches -- each rule solved from its own expression, so no branch is left to chance. Read the last line: it either
   says every branch settled, or lists the problems. `ok` lines are fine, including `refused on purpose`, which is a fail
   node the graph declares. The three to fix: `NEVER RUN` is a rule no inputs can reach, `BROKE` is a branch that fails
   where the graph declares no failure, `BLOCKED` is a wiring hole.
3. `wilanis fuzz` writes scenarios; `wilanis regress` replays them. Run regress after any change to a graph or binding.
4. When a contract is unclear: `wilanis describe <path>`. When you need the lay of the land: `wilanis ls`, `wilanis map`.

## Vocabulary

Every file opens with its `$schema` and a `description`. A `label` (optional, on any document and on any
node) is the short human name a reader sees in the viewer instead of the path or the id; write one when the
file name would not say enough.

Every file opens with its `$schema`. The schema for a kind is

```
https://raw.githubusercontent.com/wilanis/wilanis-js/main/packages/core/schemas/<kind>.schema.json
```

(the alias `@wilanis/<kind>.schema.json` is also accepted). Fetch the schema when a field is unclear: every
property is described.

| kind | what it is | where |
|---|---|---|
| `project` | aliases, plugins (`use`, `from`, `settings` incl. the codecs table), includes (trees whose features load here), secrets, startup, profiles | `project.json` |
| `feature` | dependsOn, exports, effects allowlist | `features/<name>/feature.json` |
| `shape` | a named object type; `layer: edge` (the world's) or `core` (ours) | `edge/` or `domain/` |
| `port` | a contract: operations with accepts / returns; a field may be `static` | `domain/` |
| `binding` | how a port is met: per operation a graph or a delegation (`run` + `in`) | `data/` |
| `graph` | dataflow: nodes of type run / switch / map, `in`, `out.from`, constants; a data graph may name `resolvers` | `domain/` or `data/` |
| `trigger` | a way in: `kind`, `settings`, `in`, `out`, `policies` (what gates it, in order, each given the credentials it needs), and `fire` -- the run node it invokes | `edge/` |
| `policy` | a gate: `decide` fires a domain operation over what the guard hands (`{{request.principal}}`), `outcomes` maps each reason its graph refuses with to `deny` or `challenge`, `proves` says what is present once it allows | `edge/` |
| `resolvers` | named reads of the request (`request.params.id`, `request.headers['user-agent']`, `request.session.id`), for data graphs and bindings to read as `{{name}}`; `required` when a policy guarantees the read | `edge/` |
| `connection` | a channel to an external system, settings read `{{secrets.*}}` | `connections/` |
| `scenario` | a recorded run (fuzz writes, regress replays) | `scenarios/` |

## Layers

A feature has three directories, and the directory **is** the rule -- a document's layer is where it lives,
never inferred from what references it:

```
features/<name>/
  feature.json
  edge/      triggers, policies, the shapes the world speaks, and the resolvers: what is read from the request
  domain/    the port, the core shapes, the graphs that hold business rules
  data/      the binding and the graphs that translate and reach effects
```

- **The edge** speaks the world's vocabulary. A trigger declares `in` / `out` as edge shapes and `fire`: the
  **domain port operation** it runs, with the values it passes. A trigger never names a graph -- it says what it wants done,
  and the port's binding decides how (D008, L006).
- **The domain** holds the rules. A domain graph speaks core shapes and domain ports; the only native
  operations it may run are pure. Every effect it needs, it reaches through a port (L002).
- **The data layer** translates. A data graph may name edge shapes and speaks native ports, and every
  effectful operation it reaches is listed in `feature.json → effects` (L003). It is the only layer that
  reads the request, and only through a `resolvers` document it names: `"resolvers": "@f/edge/request.resolvers.json"`,
  then `{{agent}}` wherever the value is used. A resolver is a read, not an operation: nothing runs.

A domain graph must earn its place: if it does nothing but forward its input to one port operation, it is
boilerplate between the trigger and the binding, and the trigger should fire that operation itself (L007).

Node types are `@wilanis/node/run.schema.json`, `@wilanis/node/switch.schema.json`, `@wilanis/node/map.schema.json`; `graph.schema.json` lists them.

Every reference is a path from the root: `@features/tasks/tasks.port.json`, or through an alias in
`project.json`: `@tasks/tasks.port.json`. Plugins are alias roots: `@std/list.port.json`,
`@http/http.port.json`. An operation is `path#operation`.

## Plugins

`project.json → plugins` lists every plugin the tree uses. `@std` (pure operations) and `@cli` (command-line
triggers) are built in. Any other plugin is an npm package named by `from`, installed in this project's
`package.json`:

```json
{ "use": "@http", "from": "@wilanis/plugin-http", "settings": { "port": 8080, "codecs": { "application/json": "@http/codecs/json.codec.json" } } }
```

`from` is a package name, never a path. `wilanis ls port`, `ls trigger-kind`, `ls connection-kind` and
`ls codec` show what the installed plugins provide; `wilanis describe <path>` lays out any of them and says
which file it is. Every document a plugin grants is a JSON file in its package (`@http/http.port.json` is
`node_modules/@wilanis/plugin-http/docs/http.port.json`; `@std` and `@cli` live under the runtime's `docs/`),
so anything the DSL names can be opened and read like a header file.

## Rules you will meet

- **One way in.** A node's `in` gives every value the operation takes. A literal is written as it is (`"method": "GET"`); a read is a template: `"{{asked.status}}"` (another node), `"{{in.id}}"` (the graph's input), `"{{const.initial}}"`, `"{{agent}}"` (a resolver). Alone, a template takes the value and its type; inside text it interpolates: `"/tasks/{{in.id}}"`. Objects and lists are written in place with values inside. A path segment is `.name`; a key that is not an identifier is quoted in brackets: `{{asked.headers['x-request-id']}}`.
- **Static fields** (`wilanis describe` marks them) take a literal, never a read: a connection, a content type, a `type`. P001 says you gave a read where the checker needs to see the value.
- **Layers.** Triggers speak edge shapes. Domain graphs (behind triggers) speak core shapes and domain ports; the only native operations they may run are pure (`@std`). Data graphs and bindings (behind domain ports) speak native ports and may name edge shapes: they translate.
- **Effects.** Every effectful native operation a feature's data layer reaches is listed in `feature.json → effects`. L003 means add it there, deliberately.
- **No absence.** A field is required unless it says `required: false`. An optional read cannot feed a required input (G004). Route around it: a `switch` rule `has(x)` proves `x` present for the node it routes to.
- **Types are declared.** `@std/object.port.json#make`, `#merge`, `@std/list.port.json#first`, `#concat`, `#slice` and `@http/http.port.json#request` take a `type` / `returns` field naming the result type. The checker verifies what you gave fits it; the operation judges the value at run time.
- **The standard library** is four ports of pure operations: `@std/object.port.json` (`make` an object of a declared type from values written in place, `merge` two), `@std/text.port.json` (`fill` a template's `{name}` placeholders from `values`, `join`, `split`, `replace`), `@std/list.port.json` (`count`, `first`, `concat`, `slice`), `@std/outcome.port.json` (`refuse`: end the graph on purpose with a static `reason` and a message; a rehearsal calls it refused on purpose). `wilanis describe @std/object.port.json` lays any of them out.
- **Refusals.** A graph says *why* it refused in one word (`"reason": "missing"`), never how the caller is answered. The trigger says that: an http route maps each reason to a status under `settings.response.refusals` (`{ "missing": 404, "upstream": 502 }`) and answers `{ reason, message }`. T005 names a reason the route can reach but does not map; T006 a mapping nothing reaches. A node that breaks where no refusal is declared is a fault, and a 500.
- **What the tree starts.** `project.json → startup` lists what runs once when `wilanis start` runs it, in order -- and nothing else runs. **The server listens because a step says so**: `{ "run": "@http/server.port.json#listen" }`. Delete that step and nothing listens; no runtime opens a port because http triggers exist. Put what the tree needs first: open a pool, declare a queue, subscribe to a topic, check that storage answers. Most steps name a **domain port operation** (`"run": "@tasks/domain/store.port.json#open"`), never a graph, so the profile's binding decides how it is met -- a fake in dev, the real connection in prod. A step's `in` is written as literals and `{{secrets.*}}` only: nothing has been received yet, so a step that reads `request.*`, or whose bound graph does, is refused (B007, B008). A step that refuses stops the start and exits nonzero, so a tree whose database is unreachable never opens its port; write `"required": false` for a step the tree can serve without, and its refusal is logged instead. An operation marked `holds` (`wilanis describe` says `holds until stopped`) starts something that outlives the run -- a listener, a watcher -- and only a startup step may name one: a graph that runs one is refused (L008). Add `@reload` to the plugins and `{ "run": "@reload/watch.port.json#watch" }` before the listener, and an edit is served without a restart.
- **`request.*`** (the trigger kind's context: headers, query, params, cookies, body, flags, args... and what the guard adds: principal, session, challenge) is read in exactly three places: a trigger's `fire.in`, a policy's `decide.in`, and a `resolvers` document's `read`. Nowhere else.
- **Who may call.** A trigger with no `policies` is public. `"policies": [...]` gate it, in order, and where a policy is attached the trigger gives the guard the credentials it verifies, read from the kind's context like any input: `{ "policy": "@access/edge/signed-in.policy.json", "in": { "token": ["{{request.headers.authorization}}", "{{request.cookies.session}}"] } }` -- a list is the places a credential may sit, the first present wins; a later policy written bare reuses what an earlier one gave. The guard (`@auth`) verifies the token -- our own, issued by `@auth/token.port.json#issue` at sign-in; a `Bearer ` prefix is stripped -- and hands `request.principal` (`subject`, `realm`, `roles`), `request.session` (`id`, `attributes`), and `request.challenge` from a challenge answer (`"challenge": { "id": "{{request.flags['challenge-id']}}", "code": "{{request.flags.code}}" }`). A credential that does not verify is refused as `invalid_credential`, which the trigger maps like any reason; none at all is anonymous. Each policy then fires a domain operation with `decide.in` read from the request, and its graph allows by answering or refuses with a reason (`anonymous`, `forbidden`, `otp`) that the policy's `outcomes` calls a `deny` or a `challenge` and the trigger maps to an answer (T005). A challenge opens through the guard and the caller is told its id and how to answer it, in the kind's own words; the graph never sees a code. Never validate a credential in a graph: `@auth/identity.port.json#verify` judges a password against a directory connection, the guard judges tokens and codes. `wilanis describe @auth/plugin.json` lists the credentials the guard takes and what each yields.
- **Including a tree.** `project.json → includes: [{ "from": "@wilanis/access", "features": ["access"] }]` loads that package's features as if they sat here: `dependsOn` it, name its exports, attach its policies, and bind the ports it leaves unbound (`wilanis check` says which, B002) in a feature of your own. Its aliases come along; its connections, plugins and settings do not: configure the plugins it uses (D010 names one you forgot) with the settings its README gives. `wilanis describe <path>` says `included from` when a document is another tree's; edit it there.
- **Sessions.** `@auth` settings name the session shape (`"session": "@access/domain/Session.shape.json"`); `@auth/session.port.json#get`, `#set`, `#remove`, `#end` read and write its attributes from a data graph, keyed by `{{sid}}` from a resolver reading `request.session.id`. Declare that resolver `required` and give the gating policy `"proves": ["request.principal", "request.session"]`, so the read is present by construction (A006). X104 refuses a write of an attribute the shape does not declare. `wilanis describe <the session shape>` lists who writes what.
- **Membership.** `'recorder' in principal.roles` is true when the list holds the value. A read through a value that may be missing is refused in a rule unless a `has()` on the left of the same `&&` proved it: `has(principal) && principal.realm == 'employee'`.
- **`http.request`** executes and reports `status`, `headers`, `body`. It does not decide what a 404 means; a `switch` on `status` does. `returns` types the body of a 2xx only, so an error body reaches the switch. How many requests may hit one API at once is the connection's business, not the graph's: `"throttle": { "concurrency": 4, "perSecond": 10 }` on the connection paces every request made against it, a `map` fanning out one per element included.
- **A graph's `in`** is usually a shape, read as `{{in.field}}`. It may be any type instead -- `"in": "string[]"` -- read whole as `{{in}}`; a binding meets such a graph with an operation that accepts exactly one field, and that field is what the graph receives (B005 otherwise).
- **Many at once.** A `map` node runs one operation per element of `over`, all at once, and settles only when every element has; its result is the list of theirs, in order. Bind the element to the operation's inputs (`"bind": { "id": "" }` hands the whole element as `id`) or let it arrive as `item`. One element that fails fails the node, once the others are done.
- **Files are blobs.** A `blob` field or `in`/`out` is a stored file, carried as a handle (`id`, `contentType`, `size`, `filename`); the bytes never enter a graph. A route uploads one through a content type the `@http` codecs table maps to `@http/codecs/blob.codec.json` (`"text/csv": ...`), with `settings.body: "blob"` and `fire.in` reading `{{request.body}}`; it downloads one by declaring `out: "blob"` and a `produces` mapped to that codec. A data graph reads the file with `@blob/csv.port.json#parse` (rows of a declared `type`) or `@blob/text.port.json#read`, and makes one with `#write`; these are effects, listed in `feature.json → effects`. On the command line, `wilanis run --file path` hands a file as `request.file` and `--out path` receives a blob answer.
- **Content types** are explicit: `consumes` / `produces` on triggers and on `http.request` must be in the `@http` codecs table in `project.json`.
- **Reconvergence** happens only at `out.from`: a list of candidates, each behind a switch, the first that settled answers.

## Refusal codes

D documents (incl. D008, a document outside the layer its kind lives in; D009, D010 about includes, below) · R references · L layers, effects, visibility (incl. L002, a domain graph reaching an effect or the request; L006, a trigger or policy firing a native operation; L007, a domain graph that only forwards; L008, a graph running what outlives the run) · G graphs (edges, types, routing, cycles, unused) · P static fields and resolvers (P002, a read no trigger kind hands; P003, a resolver named like a root) · B bindings and profiles (B006, a startup step naming no domain operation; B007, a startup step's input; B008, a startup step reaching the request) · T triggers (T004, a resolver read the firing kind does not hand; T005, a refusal reason the trigger does not map, its policies' and the guard's included; T006, a mapped reason nothing reaches) · A access (A001, a policy's input that reads outside the request or does not fit its decision under the trigger's kind; A002, a reason the decision reaches that outcomes does not map, or a challenge without a method; A003, an outcome nothing reaches; A004, a credential the guard does not verify, one read where the kind hands nothing, or one no policy of the trigger reads; A005, a policy reading the caller on a trigger that gives the guard nothing; A006, a resolver read as required that no policy of the trigger proves) · C connections and settings · S scenarios · X plugin-specific (@http: codecs, X003 a throttle that lets nothing through; @auth: X101 a session shape that is none, X102 a challenge method undeclared or one no attachment could answer, X103 a session write outside the shape). D009 is a feature both local and included, D010 an include that is not a tree, asks a feature it does not ship, or uses a plugin the project does not name.

If a refusal seems wrong, it is far more likely the contract is wrong than the checker; read `wilanis describe` on the port before arguing with it.
