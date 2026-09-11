# RFC 0030: `cache`: one word on a node, a graph or an operation, lowered to the nodes it stands for

- **Status:** accepted
- **Areas:** `area:core` (one `$defs` entry and five optional fields), `area:compiler` (the lowering and two rule
  families), `area:runtime` (`describe`, the example), `area:view` (a badge and the project page), and one new package
  (`area:plugin-cache`, `@wilanis/plugin-cache`)
- **Schemas:** `common.schema.json`, `node/run.schema.json`, `node/map.schema.json`, `graph.schema.json`,
  `port.schema.json`, `project.schema.json`; compatible
- **Tracking issue:** #265
- **Depends on:** RFC 0011 for `idempotent` and `key` on a port operation and for `Judge.idempotentAt`, which is how the
  checker knows a call may be skipped: G0n2 lands after RFC 0011's step 4, and the plugin after its step 1. RFC 0023 is
  where this cache was first drafted, as three hand-written nodes; that RFC gives the cache up to this one and keeps the
  adapter contract, which the plugin here meets. RFC 0004 is the precedent for the move this RFC makes -- a property of
  a document honoured by a nested plan the compiler builds -- and RFC 0005 is the sentence this RFC agrees with: a cache
  is a store of its own, not a place a value lives.

## Summary

A `run` or `map` node of a data graph, a data graph, or an operation a plugin grants may say `"cache": { "ttlMs": 60000 }`,
and the value it answers is remembered under a key made of its inputs and answered again, for that long, instead of
calling. A project names the one connection every cache in the tree uses, `project.json → cache.connection`, the way
it names its blob registry; there is one caching mechanism per tree. The compiler lowers the word to the nodes it
stands for -- ask the cache, decide, call the origin, remember -- as a nested plan the kernel runs like any bound graph,
so every cache read is a node in the report, in the trace and in the rehearsal, and the engine learns nothing. The
checker refuses a cache over a pure operation, over one whose repeat would change something, and anywhere in a domain
graph. The `@cache` plugin RFC 0023 drafted -- one port, a memory kind, a Redis kind when a tree asks -- moves here, and
its `remove` stays the one node an author writes, where a write must forget what a read remembered.

## Motivation

`GET /monitor/{id}` reaches the upstream on every call, and the upstream is a public mock with a rate limit. An author
who wants to remember an answer for a minute has, today, no port to remember it with; and with the plugin RFC 0023
drafted they would have had three nodes to write around every read that wants it -- `get`, a `switch` on `hit`, `put`
-- and a fourth, `@std/object.port.json#make`, to give the cached value a type. RFC 0023's own guide called that "three
nodes more than today" and paid it for a reason worth keeping: every one of them is in the report and in the rehearsal.

The price is wrong, not the reason. The three nodes are the same three nodes at every site, differing only in the
operation they wrap, the key and the lifetime, which is the definition of a thing the language should say in one
word and the compiler should expand. RFC 0011 already makes exactly this move for `retry` and `timeoutMs`: a word on the
node, honoured by the compiler, invisible to the engine. RFC 0004 makes it for `atomic`. What RFC 0011 declined to do,
and sent to RFC 0023, was to make a cache a *wrapper* -- a handler around the handler -- because a wrapper is an effect
in no node. This RFC does not make it a wrapper. It makes it nodes the author does not write.

What an author cannot express today:

- that a node's answer may stand for a while, without writing the cache-aside by hand at every site;
- that a whole data graph's answer may, keyed by what it was asked;
- that a plugin's operation is one whose answer usually stands for a while -- an OIDC discovery document, a geocode --
  so that every site gets the cache unless it says otherwise;
- where the tree's one cache lives, said once, rather than a `connection` input on every cache node.

What this RFC does not do. It does not add a cache to a domain graph or a domain node: a domain graph says what
happens, and for how long an answer stands is the data layer's fact, as RFC 0011 said of how often a call is made. It
does not cache a `pure` operation (nothing to save), an operation that `refuses` or `holds` (nothing to answer twice), or
one whose repeat would change something (skipping the call would skip the change). It does not add a second cache to a
tree: one connection, named at the root; a tree that wants two has two trees. It does not invalidate on its own beyond
the lifetime: a write that must forget a read's entry writes one `remove` node and names the key, which is why a site
may name its key. It does not add a lock, a lease or a queue (RFC 0009, RFC 0010). It does not make the memory kind
shared across processes; a shared kind is the last step and comes when a tree on two instances asks.

## Guide-level explanation

**Cache.** A word on a `run` or `map` node of a data graph, on a data graph, or on an operation in a port a plugin
grants: `"cache": { "ttlMs": <number>, "key"?: <text> }`, or `false`. It means: before calling, ask the tree's cache
for what this call answered last time, under this key; if it knows, answer that; otherwise call, and remember the
answer for `ttlMs`. The key is the operation, its inputs and its lifetime unless `key` says otherwise; who called is not in it, so two
sites that ask the same thing share one entry. A site inherits the `cache` of
the operation it runs when the port declared one, and writes `"cache": false` to decline it.

**One cache per tree.** `project.json → cache` names the connection, once:

```json
"cache": { "connection": "@connections/cache.connection.json" }
```

and `example/connections/cache.connection.json` says what it is:

```json
{
  "$schema": "@wilanis/connection.schema.json",
  "label": "Answer cache",
  "description": "Where this tree remembers what an operation answered, for as long as the site said, in this process. A tree on several instances names a shared kind here instead; nothing else changes.",
  "kind": "@cache/memory.connection-kind.json",
  "settings": { "maxEntries": 1000 }
}
```

### The monitor's read, cached

`example/features/monitor/data/get-row.graph.json`, one line added to the node that calls the upstream:

```json
{ "type": "@wilanis/node/run.schema.json", "id": "asked", "label": "GET the row",
  "run": "@http/http.port.json#request",
  "cache": { "ttlMs": 60000, "key": "entry:{{in.id}}" },
  "in": { "connection": "@connections/monitor-api.connection.json", "method": "GET", "path": "/monitor/{{in.id}}",
          "produces": "application/json", "returns": "@monitor/edge/EntryRow.shape.json" } }
```

Nothing else in the graph changes: `route` still reads `{{asked.status}}` and `{{asked.body}}`, and gets them from the
cache or from the upstream without knowing which. `update-row.graph.json` and `delete-row.graph.json` gain one node
each, the one an author does write, because only the author knows that a PUT makes the GET's entry stale:

```json
{ "type": "@wilanis/node/run.schema.json", "id": "forgot", "label": "Forget the cached row",
  "run": "@cache/cache.port.json#remove",
  "in": { "connection": "@connections/cache.connection.json", "key": "entry:{{row.id}}" } }
```

`forgot` reads `row`, so it runs once the upstream has answered the new row and not before; nobody reads `forgot`, so
the answer does not wait on it beyond the run's own end. `feature.json → effects` lists `get`, `put` and `remove` beside
the request: the lowered nodes are effects the graph reaches, and a feature lists what it reaches (L003).

**What the kernel receives.** The compiler lowers `asked` to one call whose handler runs a nested plan, the way a
domain operation's binding becomes a nested plan today:

```
asked                      call   cache:@monitor/data/get-row.graph.json#asked      in: the site's inputs, and $key
  ├ cached                 call   @cache/cache.port.json#get       key {{in.$key}}  type: the site's answer type
  ├ known                  switch hit == true && has(value) → hit, else → origin
  ├ hit                    call   @std/object.port.json#make       value {{cached.value}}
  ├ origin                 call   @http/http.port.json#request     in: passed through by name
  └ kept                   call   @cache/cache.port.json#put       value {{origin}}  ttlMs 60000
  output: hit, origin
```

`wilanis run ... --trace` shows exactly this: `asked` with a sub-run of two nodes on a hit (`cached`, `known`, `hit`)
and of four on a miss (`cached`, `known`, `origin`, `kept`). `wilanis rehearse example` walks both, because `asked.cached`
is a stubbed effect that answers `hit: true` on one seed and `false` on another, and the solver already reads switches
inside nested plans (`switchesOf` in `packages/runtime/src/branches.ts`). A warm cache and a cold cache are two
scenarios, named `asked.known → hit` and `asked.known → origin` in the rehearsal report.

### A whole graph, and an operation's default

A data graph that is expensive as a whole says so at its root, and the key is its `in`:

```json
{ "$schema": "@wilanis/graph.schema.json", "label": "Digest", "cache": { "ttlMs": 300000 },
  "in": "@monitor/domain/DigestRequest.shape.json", "out": { ... }, "nodes": [ ... ] }
```

A plugin whose operation's answer usually stands writes the default in its port document, and every site inherits it
unless it writes `"cache": false` or a `cache` of its own:

```json
"discover": { "description": "The issuer's OpenID configuration. Changes rarely; cached for an hour unless a site says otherwise.",
              "accepts": { "connection": { "type": "string", "static": true } }, "returns": "@auth/Discovery.shape.json",
              "idempotent": true, "cache": { "ttlMs": 3600000 } }
```

### When it is refused

```
G0n1  @features/monitor/data/get-row.graph.json#nodes/row/cache
    cache over '@std/object.port.json#make', which is pure
    → a pure operation costs nothing outside the run and has nothing to remember; drop cache

G0n2  @features/monitor/data/create-row.graph.json#nodes/asked/cache
    cache over '@http/http.port.json#request' with method POST, which is not idempotent here
    → a cache answers instead of calling, so the call must be one whose repeat changes nothing; drop cache, or
      make the call idempotent (RFC 0011)

L0n1  @features/monitor/domain/record-entry.graph.json#nodes/recorded/cache
    cache in a domain graph
    → a domain graph says what happens, never for how long an answer stands; cache the data node or the data
      graph behind the port

C0n1  project.json#cache
    a cache is written at @features/monitor/data/get-row.graph.json#nodes/asked and the project names no cache connection
    → name the one connection every cache in this tree uses: "cache": { "connection": "@connections/cache.connection.json" }
```

## Reference

### Documents and schemas

**`common.schema.json`** gains `$defs/cache`: `false`, or an object with `ttlMs` (integer, at least 1: "how long an
answer stands, in milliseconds; a cache entry without a lifetime is a store, RFC 0002") and `key` (string, optional: "the
key the answer is kept under, text with `{{in.*}}` reads; absent: the operation, every input, every resolver value a
cached graph reads, and `ttlMs`, canonicalised; never the caller. Name it where a write elsewhere must `remove` it"). `additionalProperties: false`.

**`node/run.schema.json`** and **`node/map.schema.json`** gain `cache` (`$ref` to `$defs/cache`, optional): "Remember what
this node answers, under its inputs or `key`, for `ttlMs`, over the connection `project.json → cache` names; `false`
declines the operation's own default. Data graphs only (L0n1)." On a `map`, the cache is per element: each element's
call is a site with the element's inputs in its key.

**`graph.schema.json`** gains `cache` (the object form only, optional): "Remember what this graph answers, keyed by its
`in` and every value it reads from its `resolvers`, for `ttlMs`. Data graphs only."

**`port.schema.json`** gains `cache` on an operation (the object form only, optional): "The plugin's default for every
site that runs this operation; a site declines it with `\"cache\": false` or replaces it with its own. Only an operation
that declares `idempotent` may (C0n3)." `key` here may read `{{in.*}}` over the operation's accepted fields.

**`project.schema.json`** gains `cache` (object, optional): `connection` (a document path, required): "The one connection
every `cache` in this tree remembers through, of a kind whose plugin grants a cache port. One per tree, as `blobs` is
one registry per tree." Required when any document writes a `cache` (C0n1).

`model.ts`: `interface Cache { ttlMs: number; key?: string }`; `cache?: Cache | false` on `RunNode` and `MapNode`;
`cache?: Cache` on `GraphDoc` and `Operation`; `cache?: { connection: string }` on `ProjectDoc`. `validate.ts` joins
them as it joins every field. No new kind, so `HOME`, `templates/CLAUDE.md`'s placement rows and `wilanis new` gain
nothing; the template's paragraph on data graphs gains one sentence on `cache`, and its project paragraph one on
`project.json → cache`.

### Ports, operations and kinds granted

**`@wilanis/plugin-cache`, root `@cache`.** `docs/plugin.json` (label, description, `grants.ports`,
`grants.connectionKinds`), `docs/cache.port.json`: "Remember a value under a key for a while. A cache answers what it
knows and forgets on its own; it is never where a value lives. Every operation is safe to repeat." It meets RFC 0023's
adapter contract to the letter, and is the port the compiler lowers to.

| Operation | Accepts | Returns | Declares |
|---|---|---|---|
| `get` | `connection` (static), `key` (string or object: "text, or the inputs of a call; an object is canonicalised -- keys sorted, JSON -- by the kind"), `type` (type, binds `$V`) | `{ hit: boolean, value?: $V }` | `idempotent: true` |
| `put` | `connection`, `key`, `value` (`$V`), `type` (binds `$V`), `ttlMs` (number: "how long the entry stands; required, a cache entry without a lifetime is a store") | `{ key: string, expiresAt: string }` | `idempotent: true` |
| `remove` | `connection`, `key` | `{ removed: boolean }` | `idempotent: true` |

`get` is not `pure`: it reads state outside the run, so a data graph lists it, a domain graph never runs it (L002), and
`rehearse` stubs it, which is what makes both branches of a cache walkable. A stored value that does not conform to the
`type` a `get` asks for is a miss and is dropped, so a shape that changed between two deploys empties the cache rather
than failing every read. `put` judges `value` against `type` before storing, as `@std/object#make` judges. Kinds:
`docs/memory.connection-kind.json`, settings `maxEntries` (number, optional, default 10000: the most entries kept, least
recently used dropped first); no secret, no server, one map per connection per process; the development kind and the
one the example names. A shared kind (Redis, Valkey) brings a client library and is a package of its own,
`@wilanis/plugin-cache-redis`, the plan's last step. The kind's `ttlMs` default RFC 0023 drafted is not here: a
lifetime is the site's fact, and every `put` carries one (X0n2).

**The cache contract, as the compiler reads it.** The compiler never names `@cache`. From `project.json → cache.connection`
it reads the connection, its kind, the plugin whose `plugin.json → grants.connectionKinds` holds that kind, and among
that plugin's `grants.ports` the one port with operations `get`, `put` and `remove` accepting the fields above; that
port is what the lowering names. `cachePortOf(scope, project)` in `packages/compiler/src/cache.ts` answers it, or the
refusal C0n2, and is the one place the contract is stated. A kind shipped by another package (the Redis kind) is found
the same way when its package also grants the port, and by the kind's `serves` field when RFC 0023's deferred question
lands; nothing here changes then.

### Checker rules

Codes are placeholders; numbers are assigned when the implementing pull request lands.

| Code | Where it lives | Refuses when | Hint |
|---|---|---|---|
| C0n1 | `check/project.ts` | any node, graph or site inheriting a port default writes a `cache` and `project.json` has no `cache` | `name the one connection every cache in this tree uses: "cache": { "connection": "@connections/cache.connection.json" }` |
| C0n2 | `check/project.ts` | `project.json → cache.connection` names no connection, or one whose kind's plugin grants no port meeting the cache contract | `name a connection of a cache kind (@cache/memory.connection-kind.json), and name the plugin that grants it in plugins` |
| C0n3 | `check/contracts.ts` | a port operation declares `cache` and is `pure`, `refuses` or `holds`, has no `returns`, or declares neither `idempotent` nor `key` | `a default cache belongs on an effect whose repeat changes nothing and that answers something; drop cache, or declare idempotent (RFC 0011)` |
| L0n1 | `check/graph.ts` | `cache` on a node of a domain graph, or on a domain graph | `a domain graph says what happens, never for how long an answer stands; cache the data node or the data graph behind the port` |
| G0n1 | `check/cache.ts` | `cache` (written or inherited) over an operation that is `pure`, `refuses` or `holds`, has no `returns`, or one the checker cannot resolve at the site | `a pure operation has nothing to remember and a refusal nothing to answer twice; drop cache` |
| G0n2 | `check/cache.ts` | `cache` over an operation not idempotent at the site (`Judge.idempotentAt`, RFC 0011), or on a graph reaching an effect that is not (`effectsReachable`) | `a cache answers instead of calling, so the call must be one whose repeat changes nothing; drop cache, or make the call idempotent` |
| G0n3 | `check/cache.ts` | the site's answer type, or any input in its default key, holds a `blob`; or `key` is not text | `a cache keeps values, not bytes; cache the handle's id, or name a key without it` |

`key` is typed as any value a node writes: a template it holds reads `in` and, on a node, the nodes the node's own `in`
may read, under the G rules that stand. `"cache": false` on a site whose operation declares no default is not refused;
it says nothing and costs nothing. G0n1 to G0n3 are refused against the file that carries the `cache` -- the graph --
at `nodes/<id>/cache` or `cache`; for an inherited default the `at` is the node and the message names the port.

### Runtime behaviour

**Where the lowering lives.** `packages/compiler/src/cache.ts`: `cachedSpec(site)` builds the nested `KernelSpec` shown
under *Guide*, and `cacheOf(node | graph, op)` answers the effective `cache` of a site -- its own, else the operation's
default, else none. `lowerNode` in `compiler.ts`, for a `run` or `map` with an effective cache, lowers the node as today
and then wraps: the node's handler becomes `cache:<graph path>#<node id>`, registered once through `nestedRunner` over
`cachedSpec`, and the node's `in` gains `$key`: the site's `key` lowered as a value in the graph's roots or, absent, one object
source `{ op: <opRef>, in: <the same sources as the node's in>, ttlMs }`, which the kind canonicalises. `graphCall`, for a
graph with a `cache`, does the same around `graph:<path>`, with `{ graph: <path>, in, reads, ttlMs }` where `reads` holds
every resolver value the graph's nodes read, each lowered as the source it lowers to inside the graph: the compiler knows
them from the graph's `resolvers` reference and its templates, and nothing request-dependent is left out of the key. The
caller -- the graph and node the site sits in -- is in no default key. `$` is a character no `ident` allows, so `$key` collides with no
field an author writes, and the report shows the key it used under `in.$key` -- redacted where an input it reads is
marked `secret`, as `redactFor` redacts today. The engine is untouched: `KCall`, `KSwitch`, `KMap`, `KernelSpec` and
`Run` are what they are, and the nested plan is a `KernelSpec` like a binding's.

**The nested plan.** `cached` calls the cache port's `get` with `connection` (the project's, a literal), `key`
(`{{in.$key}}`) and `type` (the site's answer type, resolved with the site's type bindings as `Judge` types a call site;
a site whose answer type cannot be resolved statically is refused as G0n1, which names it). `known` is a
`switch` with one rule, `hit == true && has(value)`, to `hit`, else `origin`. `hit` is `@std/object.port.json#make` of
the cached value under the type. `origin` is the site's own handler with the inputs passed by name (`inputsByName`), so a
retried or bounded site (RFC 0011) keeps its `retry` and `timeoutMs` on `origin`, where the call is. `kept` calls `put`
with `value: {{origin}}`, the type, and `ttlMs`. Output: `hit`, `origin`, whichever settled. On a `map`, the element's
call is the site and the plan runs per element, as the element's handler runs per element today.

**What is reported.** One node, `asked`, whose `handler` is `cache:<site>` and whose `sub` is the nested run's report:
`cached`, `known`, and `hit` or `origin` and `kept`. RFC 0011 kept a retried node's `handler` as the operation because
the node still ran the operation; a cached node may not have, and saying `cache:` is the truth. The operation's own
row -- `http.response.status_code` under RFC 0006's trace -- is `origin`'s, inside `sub`, on a miss, and absent on a
hit, which is what a hit means. A `--trace` prints the sub-run indented under the node as it prints a bound graph's.

**`rehearse`, `fuzz`, `regress`, `run --seed`.** `stubEffects` replaces the cache port's `get` and `put` as it replaces
every effectful native handler, before the plugin is consulted (`nativeHandler`), so a stubbed `get` answers `hit` either
way and nothing reaches the plugin during rehearsal (RFC 0018's rule holds). The solver reads `known` through
`switchesOf`'s `nested` lookup, which already follows a `graph:` handler into its plan and follows a `cache:` handler
the same way (one line: the lookup answers the spec behind any handler the compiler registered as nested). A scenario's
stubs address the nodes by dotted path, `asked.cached`, as they address a bound graph's. `regress` answers a stubbed node
before any handler runs, so a recorded scenario replays whether or not the cache is warm.

**`run` and `start`.** Nothing starts: the memory kind makes its map on first use and drops it with the process; no
`postLoad`, nothing `holds`, no startup step. `wilanis start example` with a `--trace` shows `GET /monitor/{id}` twice
as one request and one hit. A reload (`@reload`) that replaces the tree keeps the process and so keeps the map; a
document change does not empty a cache, the lifetime does.

**Handlers.** `packages/plugin-cache/src/handlers.ts` registers the three, reads the connection through the same
`env.connections[canon(named)]` lookup `@http` uses, refuses at run time with the same two errors for a connection
replaced under a reload, and picks `memory.ts` off the kind. `memory.ts`: a `Map` in insertion order, re-inserted on
read, dropped from the front past `maxEntries`; an entry past its `expiresAt` misses and is dropped on read; an object
key is canonicalised (keys sorted at every depth, `JSON.stringify`). Every handler reads `ctx.signal`. Every value is a
value: a `blob` never reaches a cache (G0n3, X0n3).

### Discoverability

- `wilanis describe <graph>` (`nodeLines`): `cached 60s (key entry:{{in.id}})` on a cached node; `cached 5m (by in)` under
  a cached graph's header; `cached 60s, declined` on a site that wrote `false`.
- `wilanis describe <port>` (`operationLine`): `(idempotent, cached 1h)` beside RFC 0011's marks.
- `wilanis describe project`: a `cache` line naming the connection and its kind, beside `blobs`.
- `wilanis map`: unchanged; the connection is a document it lists.
- The viewer: a badge on a cached node and a cached graph, the port page's operation row, and the project page's cache
  connection; the run view shows the sub-run under the node as it shows a bound graph's.
- The `@cache` README: what the port answers and throws, the kind's settings, how a tree names its cache, and the owner
  line RFC 0023's contract asks for.

### Plugin contract

`PluginModule`, `PluginCheckContext` and `PostLoadContext` in `packages/core/src/plugin.ts` are unchanged. The plugin
uses `root`, `docs`, `handlers` and `check` (X0n1 to X0n4). A plugin that wants a default cache on an operation writes
one word in its port document; nothing is registered.

## Compatibility

IR v1, compatible. Six schemas gain optional fields; every document written before this RFC validates and means what
it meant: no cache. A lowered graph without a `cache` is byte-for-byte what it was; one with a `cache` carries the same
node ids and one handler whose name begins `cache:`, and `Report` gains nothing, since `sub` exists. `@wilanis/access`
is unchanged. The example changes: a plugin entry, `project.json → cache`, one connection, one line in
`get-row.graph.json`, one node each in `update-row.graph.json` and `delete-row.graph.json`, three entries in
`feature.json → effects`. No `schemas-v2`.

## Tests

Sabotage tests in `packages/runtime/test/example.test.ts`, through `sabotage` in `example-harness.ts`:

| Code | The edit |
|---|---|
| C0n1 | the guide's `cache` on `asked` in `get-row.graph.json`, and `project.json → cache` deleted |
| C0n2 | `project.json → cache.connection` naming `@connections/monitor-api.connection.json` (an http kind); naming a path with no document |
| C0n3 | a fake plugin's port (under `docsDir`) whose `pure` operation declares `cache`; one declaring `cache` and neither `idempotent` nor `key` |
| L0n1 | `"cache": { "ttlMs": 1000 }` on `recorded` in `record-entry.graph.json`; on the root of that graph |
| G0n1 | `"cache": { "ttlMs": 1000 }` on `row` in `get-row.graph.json` (`@std/object.port.json#make`, pure); on `missing` (`refuses`) |
| G0n2 | `"cache": { "ttlMs": 1000 }` on `asked` in `create-row.graph.json` (POST); on the root of `create-row.graph.json` |
| G0n3 | `"cache": { "ttlMs": 1000 }` on `drafts` in `import-entries.graph.json` (answers a `blob`); `"key": 12` on `asked` |
| none | the guide's example whole: `codes(...)` is empty, and `rehearse` solves `asked.known → hit` and `asked.known → origin` |

Runtime, in `packages/runtime/test/cache.test.ts` (new), with a fake plugin whose one effect counts its calls and a fake
clock, registered beside `PLUGINS` from the harness, over a copy of the example:

| Case | Asserts |
|---|---|
| a second call hits | two runs of `monitor.get` with one id: the effect ran once; the second report's `asked.sub` has `cached`, `known`, `hit` and no `origin` |
| a lifetime ends | the clock past `ttlMs`: the effect ran twice |
| the key is the inputs | two ids: two calls; the same id twice: one |
| the caller is not the key | two data graphs running the same call with the same inputs: the effect ran once |
| a lifetime is part of the key | two sites, `ttlMs` 60000 and 5000, the same inputs: two entries, the effect ran twice |
| a cached graph reads the request | `cache` on a data graph with a `resolvers` read: two requests differing only in that value: two calls |
| a named key | `key: "entry:{{in.id}}"`: `update` then `get` of the same id calls the effect again (the `forgot` node removed it) |
| a whole graph | `cache` on a data graph's root: one call for one `in`, keyed by it |
| a port default and a decline | a fake port declaring `cache`: cached with no word at the site; `"cache": false` at the site: not |
| a map | `cache` on a `map` node over three elements, one repeated: the effect ran twice |
| the report says what ran | `report.nodes.asked.handler` begins `cache:`; `in.$key` is the key; a `secret` input is redacted in it |
| a retry stays on the call | RFC 0011's `retry` on a cached site: `asked.sub.nodes.origin.attempts` on a scripted fault, and nothing on `cached` |

`packages/plugin-cache/test/cache.test.ts`: `put` then `get` answers `hit: true` and the value; `get` of an unknown key
misses; `remove` answers `removed` and a following `get` misses; an entry past its `ttlMs` misses (fake clock); the
`maxEntries`-plus-first entry evicts the least recently read; a value stored as one shape and read as another misses and
is dropped; `put` of a value that does not conform faults before storing; an object key and its canonical text are one
entry; two connections are two maps. `rules.test.ts`: X0n1 to X0n4. `packages/core/test/validate.test.ts`: the baseline
documents gain a cached node, a cached graph, a cached operation and `project.json → cache`; `ttlMs: 0` and a `cache`
with neither form are refused by the schema. `packages/runtime/test/tools.test.ts`: `describe` of the cached graph prints
`cached 60s`. `packages/view/test`: the badge and the project page.

## Implementation plan

Each step is one pull request and one sub-issue of #265.

1. **`@wilanis/plugin-cache`** (`area:plugin-cache`): the package, `docs/`, the memory kind, the three handlers with
   object keys and the miss-on-mismatch rule, `cache.test.ts`, X0n1 to X0n4 and `rules.test.ts`, a README. Blocked on
   RFC 0011's step 1 (`idempotent` on the port schema). Added to `npm run release` after `plugin-auth`.
2. **Schemas and model** (`area:core`): `$defs/cache`; the field on `node/run`, `node/map`, `graph`, `port` and
   `project`; `Cache` and the fields in `model.ts`; the template's two sentences; the baseline in `validate.test.ts`.
   `good first issue`.
3. **Compiler, the lowering** (`area:compiler`): `cache.ts` with `cachePortOf`, `cacheOf` and `cachedSpec`; `lowerNode`
   and `graphCall` wrap a cached site; `$key`; the `nested` lookup follows `cache:` handlers; `cache.test.ts` in
   `packages/runtime/test`.
4. **Checker** (`area:compiler`): C0n1, C0n2 in `project.ts`; C0n3 in `contracts.ts`; L0n1 in `graph.ts`; `check/cache.ts`
   with G0n1 to G0n3, called from `graph.ts`; the sabotage tests. G0n2 lands after RFC 0011's step 4
   (`Judge.idempotentAt`, `effectsReachable`); until then it refuses only what `pure` and `key` already tell.
5. **Discoverability** (`area:runtime`, `area:view`): `nodeLines`, `operationLine`, the project line; the view model and
   the viewer's badges and project page. `good first issue`.
6. **The example**: the plugin entry, `project.json → cache`, `cache.connection.json`, the line on `asked`, `forgot` in
   the two write graphs, `feature.json → effects`; a paragraph in `example/README.md` and one in the root `README.md`
   beside "Every branch runs before you deploy". `good first issue` once 1 to 4 have landed.
7. **A shared kind** (`@wilanis/plugin-cache-redis`): when a tree on two instances asks; hashes an object key; finds
   its port by RFC 0023's deferred `serves` or by granting the port itself.

## Drawbacks and alternatives

- **Three nodes by hand, RFC 0023's draft.** Every site writes `get`, a `switch`, `make` and `put`, and every one is a
  line a reader can open. The lines are the same at every site, and RFC 0023's own reason for writing them -- report,
  trace, rehearsal -- is met as well by nodes the compiler writes. The one node that differs per site, the `remove` a
  write makes, stays the author's.
- **A handler wrapper, RFC 0011's shape.** `"cache": { ... }` honoured by a wrapper the compiler installs around the
  handler, as `retry` is. RFC 0023 rejected it for three reasons and this RFC agrees with all three: the hit would be an
  effect in no node, so absent from the report and the trace; `rehearse` could not tell warm from cold, since the
  wrapper sits before the handler and stubs answer at the node; and nothing could say what invalidates it. A retry is
  a loop around one call and has no node to be; a cache read is a call of its own and has. Lowering gives it one.
- **A connection per site.** RFC 0023's `connection` input on every cache node. A tree with two caches is a tree that
  has not decided where its answers live; `project.json → blobs` is the precedent for infrastructure named once at the
  root, and a profile that wants a different cache in production names a different connection document under the same
  path, as it does for its upstreams. One mechanism per tree, and the word at the site says only how long.
- **A default lifetime on the connection.** RFC 0023's memory kind carried `ttlMs`, and X0n2 accepted a `put` that
  gave none when the connection did. A lifetime is a fact about the answer, not about the store, and a site that
  forgets it should be told, not defaulted. `ttlMs` is required at the site and on a port default; the kind has none.
- **A key of the inputs, or a key the author names.** The inputs are always right and never wrong to write, so they
  are the default; but a write that must forget a read's entry cannot reproduce the read's canonical inputs, so a site
  may name its key in text and the `remove` names the same text. Both are in the report under `in.$key`.
- **The caller is not in the key.** The answer depends on the call, not on the graph that made it, so two sites asking
  the same thing share one entry and a port's default cache is worth having. Everything the answer can depend on must
  then be in the key as a value: the inputs are, a cached graph's resolver reads are added for that reason, and `ttlMs`
  is added so a site promising five seconds never reads an entry another site kept for a minute. A site that wants an
  entry of its own names a `key` and puts what makes it its own in the text.
- **`cache` on a binding operation.** RFC 0011 put `retry` there because a binding is where the data layer meets a
  domain operation. A bound graph is cached at the graph; a delegation to a native operation is one call and is cached
  by the operation's default or by a one-node data graph. Adding a fourth place would say the same thing twice, and the
  word stays in three.
- **Skipping a call is not repeating one.** G0n2 borrows RFC 0011's `idempotentAt` for the opposite direction: a
  retry repeats a call and must not change anything twice; a cache skips a call and must not skip a change. The
  condition is the same -- a repeat changes nothing -- so the rule is one.
- **The report's `handler` says `cache:`.** A tool keyed on the handler (`fuzz`'s record, RFC 0006's trace) sees the
  operation's row under `sub.nodes.origin` and not at the node. That is what happened: on a hit the operation did not
  run. A reader who wants the operation's row asks for the miss, and the trace has it.
- **One more nested plan per cached site.** A cached site costs a nested run: one `get`, one switch, and on a miss one
  `put`, beside the call. That is the cache-aside's cost wherever it is written, and a site that does not want it does
  not write the word.

## Open questions

None before `accepted`.

**Decided during implementation:** the canonical text of an object key (keys sorted at every depth, `JSON.stringify`,
and whether a shared kind hashes it, which the shared kind decides); how a `map`'s per-element sub-runs are printed by
`--trace` (as the element's report already nests `sub`); whether the viewer shows a cached node's plan collapsed under a
badge or expanded (collapsed first); and the exact wording of the two template sentences.
