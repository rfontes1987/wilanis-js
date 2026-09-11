# RFC 0011: Retry, idempotency and timeout as declared properties of an operation

- **Status:** accepted
- **Areas:** `area:core`, `area:engine` (the report's shape and one opaque tag; no behaviour), `area:compiler`, `area:runtime`, `area:plugin-http`, `area:plugin-blob`
- **Tracking issue:** #13
- **Depends on:** none to accept. One rule (G0n4) needs RFC 0004's atomic walk and lands after it; the per-attempt
  stamps use RFC 0006's `clock` where it has landed and `Date.now` where it has not; both steps are marked in the plan.

## Summary

A port operation says, beside `pure`, `refuses` and `holds`, whether it is `idempotent` -- always, or when its
inputs satisfy an expression -- or which accepted field is its idempotency `key`. Where the data layer names an
effect -- a `run` or `map` node of a data graph, or an operation of a binding -- the author may write `retry`
and `timeoutMs`. The checker refuses a retry over anything that is not idempotent at that site, and refuses both
words in a domain graph, which says what happens and never how long or how often. The runtime retries and times
out exactly where the documents say, in a handler wrapper the compiler installs; the engine learns nothing about
time and nothing about retrying, and the report shows one node with the tries it took. A retry never repeats a
declared refusal: it repeats a fault.

## Motivation

An agent writes `charge payment`, `save order`, `send email` as three nodes and the graph looks correct. It is
not: the second can fail after the first succeeded, and a retry of the whole graph charges twice. Nothing in the
tree today lets the checker see that, because the port document does not say what a repeated call does.

The example already shows the smaller, everyday form of the same gap. `@monitor/data/get-row.graph.json` sends
one `GET /monitor/{id}` to a REST upstream; when the network drops the request, `fetch` rejects, the node `asked`
fails on a fault, and the route answers 500. Nothing says that a GET may be sent again, so nobody sends it
again -- or worse, an author who wants resilience writes a second `asked` node routed from the first's failure,
which the language cannot express (a failed node cancels what waits on it, `Run.fail` in
`packages/engine/src/run.ts`), and settles for a retry in the client, which repeats the POSTs too.

What an author cannot express today:

- that `@http/http.port.json#request` with `method: GET` may be repeated and with `method: POST` may not;
- that a call may take at most so long. The one bound that exists, `timeoutMs` on an http connection
  (`Conn.settings.timeoutMs`, enforced in `send` in `packages/plugin-http/src/request.ts`, defaulting to 30000),
  is the transport's and is the same for every call over that connection;
- that a domain operation such as `monitor.get` is safe to repeat -- a promise RFC 0009's queue kinds need when they
  redeliver a message, and that today nobody can make or check.

What this RFC does not do. It does not add compensation across systems (sagas): RFC 0004 keeps atomicity to one
connection and sent it here, and this RFC sends it on to RFC 0021 with the observation below that ordering an
irreversible effect after the retried one needs no construct. It does not give a run a deadline, cancel a run,
bound a `map`'s fan-out or a body's size (RFC 0012 owns the run; this RFC owns the call and names the seam). It
does not say what a failure means to a `switch` (RFC 0014). It does not map a queue message's redelivery to
`idempotent` (RFC 0009 does, on what this RFC declares). It does not cache (RFC 0030 makes a cache a word on a
node, lowered to nodes; it is not one this RFC adds). And it changes nothing about how the engine schedules: every
ready node still starts at once.

## Guide-level explanation

**Idempotent.** An operation is idempotent when calling it again with the same inputs changes nothing further.
A plugin says so about its native operations in the port document it ships, and it may say so conditionally:
an HTTP request is idempotent when its method is one of the methods HTTP defines as such. An operation that is
not idempotent by itself may carry a **key**: one accepted field the plugin uses to recognise a repeat, so that a
caller who gives it makes the call safe to repeat. A payment adapter's `idempotencyKey` is the classic one
(RFC 0023). `pure` operations are idempotent by definition and never say so.

**Retry** and **timeout** are written where the data layer names an effect. A `run` or `map` node of a data graph
and an operation of a binding may say `"timeoutMs": 5000` -- this call fails after five seconds -- and
`"retry": { "times": 2, "backoffMs": 200 }` -- when it faults or times out, try again, at most twice more,
waiting 200 ms and then 400 ms. A retry may also say `when`, an expression over the answer, for an operation
that reports rather than fails: `@http/http.port.json#request` answers a 503 as `{ status: 503 }` and leaves the
decision to a switch, so `"when": "status >= 500"` is how a retry sees it.

The example's read of one entry, made resilient:

```json
{
  "type": "@wilanis/node/run.schema.json",
  "id": "asked",
  "label": "GET the row",
  "run": "@http/http.port.json#request",
  "timeoutMs": 5000,
  "retry": { "times": 2, "backoffMs": 200, "when": "status >= 500" },
  "in": {
    "connection": "@connections/monitor-api.connection.json",
    "method": "GET",
    "path": "/monitor/{{in.id}}",
    "produces": "application/json",
    "returns": "@monitor/edge/EntryRow.shape.json"
  }
}
```

The checker accepts it because `@http/http.port.json#request` declares itself idempotent when
`method == 'GET' || method == 'HEAD' || method == 'PUT' || method == 'DELETE'`, and `method` is the literal `GET`
here. The connection's own `timeoutMs: 10000` still applies; the tighter of the two bounds a request. Write the
same three lines on `asked` in `@monitor/data/create-row.graph.json`, whose method is `POST`, and the checker
answers:

```
G0n2  @features/monitor/data/create-row.graph.json#nodes/asked
    retry over '@http/http.port.json#request', which is not idempotent here: method is "POST"
    → a POST that failed may have been applied, so repeating it may record the entry twice; drop retry, or
      reach a store whose write carries a key
```

A binding may retry the whole of what it runs for an operation. This retries the graph behind `listAll` --
every request it reaches is a GET -- and bounds it:

```json
{
  "$schema": "@wilanis/binding.schema.json",
  "label": "REST storage",
  "description": "monitor.port.json over the REST API: one data graph per operation, each a declared request plus the decision of what its status means.",
  "port": "@monitor/domain/monitor.port.json",
  "operations": {
    "listAll": { "graph": "@monitor/data/list-rows.graph.json", "retry": { "times": 1 }, "timeoutMs": 8000 },
    "get": { "graph": "@monitor/data/get-row.graph.json" }
  }
}
```

A domain graph writes neither word. `@monitor/domain/record-entry.graph.json` says that an entry is recorded
with the recorder the domain chose; whether recording it is a POST to a flaky upstream or a row in a local store
is the profile's business, and so is whether to try twice. Put `retry` on its node `recorded` and the checker
says so:

```
L0n1  @features/monitor/domain/record-entry.graph.json#nodes/recorded
    domain graph declares retry on '@monitor/domain/monitor.port.json#record'
    → the domain says what is done, the data layer how: write retry in the binding that meets the operation,
      or in the data graph that runs the effect
```

A domain port may promise that an operation is idempotent, and the checker holds every profile to it:

```json
"get": {
  "description": "One entry by id. Fails when there is no such entry.",
  "idempotent": true,
  "accepts": { "id": { "type": "string" } },
  "returns": "@monitor/domain/Entry.shape.json"
}
```

holds, because under `live` the binding runs `get-row.graph.json`, whose one effect is a GET. The same word on
`record` is refused, naming the profile and the effect that breaks the promise, since `create-row.graph.json`
POSTs.

**What a retry repeats.** A fault -- the handler threw, or the timeout struck -- and, with `when`, an answer the
expression accepts. Never a refusal: `@std/outcome.port.json#refuse` is the graph deciding, and a decision is not
flaky. A binding operation that retries a graph therefore retries only a graph that broke, never one that
refused `missing`.

**Effects that must not repeat.** The pattern that needs no feature is RFC 0004's: put the irreversible effect
*after* the retried one, reached by a data dependency on its answer. A `notified` node that reads `recorded`
cannot start until `recorded` has settled -- after its last try -- and if `recorded` fails, `Run.execute`
starts nothing still pending, so the mail is never sent and there is nothing to compensate.

## Reference

### Documents and schemas

**`port.schema.json`**, on an operation, beside `pure`, `refuses` and `holds`:

- `idempotent` (boolean or string, optional): "True when calling it again with the same inputs changes nothing
  further. A string is an expression over the operation's accepted fields, in the grammar of a switch rule,
  that says when it is: the checker evaluates it over the literal inputs of each call site that retries.
  A `pure` operation never declares it." A native operation declares it in the plugin's `docs/`; a domain
  operation may declare `true` only (its bindings decide the rest), which the checker verifies under every
  profile (B0n1).
- `key` (identifier, optional): "The accepted field the plugin recognises a repeated call by, so that a caller
  who gives it makes the call safe to repeat. Not written together with `idempotent`: one says the operation
  is repeatable as it is, the other how to make it so." A domain operation never declares it (the field it
  would name belongs to the native operation its binding reaches).

`Operation` in `packages/core/src/model.ts` gains `idempotent?: boolean | string` and `key?: string`.

**`node/run.schema.json` and `node/map.schema.json`** gain two optional properties, and `binding.schema.json`
gains the same two on an operation, whether it binds a `graph` or delegates a `run` (the `dependentSchemas.graph`
block keeps forbidding `run` and `in` beside `graph`, and admits these):

- `timeoutMs` (number, exclusive minimum 0): "The most this call may take, in milliseconds, counted from the
  moment the node starts (a map: each element). When it strikes, the call fails as a fault and the handler is
  told through its signal. Absent: the call waits as long as its handler does." Milliseconds because the house
  writes durations as numbers with the unit in the name (`timeoutMs` on the http connection, `accessTtl`, `ttl`).
- `retry` (object, optional), one definition in `common.schema.json` (`$defs/retry`) that the three schemas
  reference:
  - `times` (integer, minimum 1, required): how many more times the call is tried after the first. A node with
    `times: 2` runs at most three times.
  - `backoffMs` (number, minimum 0, default 0): the wait before the second try; doubled before each further one.
  - `when` (string, optional): an expression over the fields of the answer, in the grammar of a switch rule; an
    answer it accepts is tried again. Absent: only a fault or a timeout is.

`RunNode`, `MapNode` and `BindingOp` in `model.ts` gain `retry?: Retry` and `timeoutMs?: number`, with
`Retry { times: number; backoffMs?: number; when?: string }` beside them.

**`packages/runtime/templates/CLAUDE.md`**: the `port` row gains "an operation may say `idempotent` (always, or
when an expression over its inputs holds) or name its `key`"; the `graph` row gains "a data graph's node may say
`timeoutMs` and `retry`"; the `binding` row gains "an operation may say `timeoutMs` and `retry`". The layers
paragraph gains one sentence: the domain writes neither.

**Placement**: unchanged; `HOME` in `packages/core/src/placement.ts` already puts data graphs and bindings in
`data/`. **`wilanis new`**: unchanged; these are keys an author adds.

### Ports, operations and kinds granted

No new port, kind or codec. Three existing port documents change:

- `packages/plugin-http/docs/http.port.json`, `request` gains
  `"idempotent": "method == 'GET' || method == 'HEAD' || method == 'PUT' || method == 'DELETE'"`. The four are
  the methods RFC 9110 calls idempotent; `PATCH` and `POST` are not. It declares no `key`: an
  `Idempotency-Key` header is a convention some APIs honour and most do not, and a field the plugin would have to
  read inside `headers`, so a POST is never retried by this plugin. A payment adapter whose contract has the key
  as a field of its own declares it (RFC 0023).
- `packages/plugin-blob/docs/csv.port.json`, `parse` gains `"idempotent": true`: reading a blob twice yields the
  same rows and puts nothing in the registry. `write` stays as it is: every call puts a new handle in the
  registry, and the scope releases them, but two calls are two blobs.
- `packages/runtime/docs/std/*.port.json`: unchanged; every operation there is `pure`.

`@auth`'s operations stay as they are (`issue` mints a new token each time; `verify` is judged by the guard, not
retried by a graph). Which of RFC 0002's store operations are idempotent, and which carry a `key`, is written in
`packages/plugin-storage/docs/store.port.json` when that plugin lands; this RFC gives it the words.

### Checker rules

Codes are placeholders (`C0n1`, `G0n1`); the implementing pull request takes the next free code of each family as
the tree stands when it lands, and no number here should be read as reserved. Existing codes named below (L002,
L003, L008, G011, B002, B005, P001) were checked against the source.

**Idempotent at a site.** One method of `Judge` (`check/judge.ts`) answers whether a call is idempotent where it
is made, and every rule below leans on it -- `Judge.idempotentAt(hit, given): string | undefined`, the reason it
is not, or nothing:

- the operation is `pure`: idempotent (but G0n1 refuses retrying it, since nothing transient can fail);
- `idempotent: true`: idempotent;
- `idempotent` is an expression: the fields it reads must be literals at the site (`Scope.literal`, the test P001
  makes of a static field); it is compiled with `expr.compilePredicate` and evaluated over them; false or a
  non-literal read is the reason (`method is "POST"`, `method is read from {{in.method}}; write it as a literal`);
- `key` declared: idempotent when the key field is given at the site, literal or read; the reason otherwise is
  `'<key>' is not given`;
- none of these: `'<path>#<op>' declares neither idempotent nor key`.

**Effects a retried graph reaches.** A binding operation that retries a graph, and a domain operation that
promises `idempotent`, are judged by the effects the graph reaches under a profile: every `run` and `map` node
of the graph, and -- through each domain operation it names -- of the graph or delegation the profile's binding
runs for it, followed to the native operations. This is the walk `refusalsReachable` in
`packages/compiler/src/refusals.ts` already makes to find reasons; a sibling `effectsReachable` in the same
module answers the native sites with the values given at each, and RFC 0004's L0n1 and L0n2 use it when they land
so the walk exists once.

| Code | Where it lives | Refuses when | Hint |
|---|---|---|---|
| C0n1 | `check/contracts.ts`, `checkPort` | an operation names a `key` that is not a field of its `accepts`; declares both `idempotent` and `key`; declares `idempotent` on a `pure` operation; or its `idempotent` expression does not type as boolean over its accepted fields (`expr.check`, as G011 types a rule) | `key names one accepted field; idempotent is true, or an expression over the accepted fields that is boolean; a pure operation is idempotent already` |
| C0n1 | `check/contracts.ts`, `checkDomainOperation` | a domain operation declares `key`, or an `idempotent` expression | `a domain operation may say "idempotent": true; the field a key names belongs to the native operation its binding reaches` |
| L0n1 | `check/graph.ts`, `checkOperationFits` | a node of a domain graph declares `retry` or `timeoutMs` | `the domain says what is done, the data layer how: write retry in the binding that meets the operation, or in the data graph that runs the effect` |
| G0n1 | `check/attempts.ts` (new), called from `checkGraph` for a node and from `checkBinding` for a binding operation | `retry` over a `pure` operation, or over a binding operation bound to a graph that reaches no effect | `nothing here can fail transiently; delete retry` |
| G0n2 | `check/attempts.ts` | `retry` over a native operation `Judge.idempotentAt` refuses, or over a binding's graph one of whose reached effects it refuses (the message names the node and, for a domain graph, the profile) | `a call that failed may have been applied; drop retry, or reach an operation that is idempotent or carries a key` |
| G0n3 | `check/attempts.ts` | `retry.when` does not type as boolean over the answer's fields, or the answer is not an object type. The answer is typed the way `delegateMeets` in `check/bindings.ts` types a delegate's: `checkInputs` answers the substitution the site's `type` inputs bind, `substitute` applies it to `returns` | `when reads the fields of the answer, e.g. status >= 500; a retry over an answer that is not an object needs no when` |
| G0n4 | `check/attempts.ts`, after RFC 0004 | a node with `retry` inside an atomic graph, or in a graph an atomic graph reaches, or a binding operation with `retry` reached from inside an atomic scope | `a statement inside a transaction is not tried again; retry the binding operation that runs the atomic graph, so the transaction is` |
| B0n1 | `check/project.ts`, beside `checkPortMet` | a domain operation declares `idempotent: true` and, under a profile, the effects its binding reaches include one `Judge.idempotentAt` refuses; the refusal is against the port file at `operations/<op>/idempotent` and names the profile, the binding and the node | `drop idempotent, or bind the operation under that profile to a graph whose effects are idempotent or keyed` |

G0n1 to G0n3 are refused against the file that carries the `retry` -- the graph or the binding -- which is why
they are one family and one module: a binding delegation is a call site the way a node is, and `checkInputs`
already refuses G codes against a binding. B0n1 is judged for every profile in `project.json → profiles`
(`Judge.profiles()`), because the effects a domain operation reaches depend on which binding meets it; a
promise that holds under `live` and fails under a storage profile is refused with the profile named. A
`timeoutMs` alone needs no rule beyond the schema's: bounding a call is always safe.

### Runtime behaviour

**Where the loop lives, and where it does not.** A retry is a loop around one handler invocation, with a clock.
The engine has neither: `Run.start` invokes a handler once through `Run.invoke` and settles the node on what it
answers or throws, and the kernel's one relation to time is the `Date.now()` stamp on each node (RFC 0006 makes
it a `clock`). The embedder sees a run whole (`Embedder.fire`, `startup`, `decide` in
`packages/runtime/src/embed.ts`) and no node in it. The compiler is the one place that knows both the document
(the node with its `retry`) and the handler it lowers to: `Compiler.nativeHandler`, `handlerFor` and `graphCall`
in `packages/compiler/src/compiler.ts` are where every handler is registered, and `nestedRunner` is the handler a
bound graph becomes. So the loop is a handler wrapper the compiler installs -- the same move RFC 0004 makes with
`AtomicScope` around `nestedRunner` -- in a new module `packages/compiler/src/attempts.ts`, since `compiler.ts`
stands at 284 lines and the file limit is 300.

**Naming the site.** Handlers are keyed by operation (`@http/http.port.json#request`, `graph:<path>`) and shared
by every node that names the operation, and the engine writes that key into the report (`report.handler =
node.handler` in `Run.start`). A wrapper keyed per site (`retry:<graph>#<node>`) would change what the report
says a node ran, which `fuzz` records and RFC 0006's trace keys on (`http.response.status_code` when the
handler is `@http/http.port.json#request`). So the handler key stays, and the site is carried beside it:

- `KCall` and `KMap` in `packages/engine/src/spec.ts` gain `site?: string`: "An opaque tag the compiler gives
  this call, handed to the handler as `ctx.site`. The kernel never reads it." `RunContext` gains `site?: string`,
  set in `runCall` and `runElement` from the node.
- The compiler tags a node that declares `retry` or `timeoutMs` with `<graph path>#<node id>` in `lowerNode`, and
  a binding operation that does with `<binding path>#<op>` in `lowerBindingOp`, and records the policy in a table
  on the `Compiler` (`sites: Map<string, Attempts>`). Every handler the compiler registers is wrapped once,
  `attempting(base, sites)`: at call time it reads `sites.get(ctx.site)` and, when there is none, calls the base
  handler and does nothing else. One map lookup per call is the cost of every node.

**The wrapper.** For a site with a policy:

```ts
for (let attempt = 0; ; attempt++) {
  const startedAt = clock();
  const signal = timeoutMs ? AbortSignal.any([ctx.signal, AbortSignal.timeout(timeoutMs)].filter(Boolean)) : ctx.signal;
  try {
    const out = await bounded(base({ in: input, ctx: { ...ctx, signal, attach: keep } }), timeoutMs);
    if (!again(out) || attempt === times) { forward(kept); return out; }
    ctx.attempted({ startedAt, endedAt: clock(), error: `answer retried: ${when}`, sub: kept });
  } catch (error) {
    if (error instanceof Refusal || attempt === times) { forward(kept); throw error; }
    ctx.attempted({ startedAt, endedAt: clock(), error: error.message, sub: kept });
  }
  await wait(backoffMs * 2 ** attempt);
}
```

Four rules are in it. **A refusal is never retried**: `Refusal` from `@wilanis/engine` is the graph deciding, and
`nestedFailure` in `compiler.ts` re-throws a nested graph's refusal as one, so a binding operation that retries a
graph retries a graph that broke, not one that refused. **A timeout is a fault**: `bounded` rejects with
`timed out after <n>ms` when the timer fires first, whether or not the handler has stopped; the handler was told
through `ctx.signal` and what it does with that is its own (see the http plugin below); its late answer or
rejection is dropped, and a late `attach` from a nested run is dropped with it. **`when` is a retry, not a
failure**: an answer the expression accepts on the last try stands as the node's answer, so a 503 after three
tries still reaches the switch and becomes the `failed` branch's `upstream`, exactly as today. **The signal
composes**: `AbortSignal.any` (Node 22, the workspace's `engines`) joins the run's signal from `FireOptions` with
the site's timer, so a run cancelled from outside (RFC 0012) cancels the try as well.

The wait between tries is a timer in the compiler package. The compiler thereby learns to wait, which the engine
must never do; the alternative -- handing a `sleep` in through `env` -- would be a fourth run-scope value for no
gain, and a test sets `backoffMs` to 1.

**The report: one node, with its tries.** A node is one entry of `KernelSpec.nodes`, and a `NodeReport` is made
per entry in the `Run` constructor before anything runs; one node per attempt would need the spec to grow while it
runs, or the engine to synthesise reports it does not understand. So the report stays one node, whose `status`,
`out`, `error`, `startedAt` and `endedAt` are the last try's, as the engine already writes them, and gains what
came before:

```ts
/** One try of a node that did not stand: when it ran, why it was tried again, and the nested run when it was a graph. */
export interface Attempt { startedAt: number; endedAt: number; error: string; sub?: Report }
// NodeReport:  attempts?: Attempt[]   -- call, or one element of a map: the tries before the one this report shows. Absent: it ran once.
// RunContext:  attempted: (attempt: Attempt) => void   -- record a try of this node that did not stand.
```

`attempted` is the second door into a node's report after `attach`, and is built the same way in
`Run.contextFor`: `attempt => { (report.attempts ??= []).push(attempt) }`. The stamps come from RFC 0006's
`ctx.clock` once it exists and `Date.now` until then. For a map, every element has its own context and so its
own `attempts` (`runElement` builds one per element). `run.ts` stands at 298 lines; the two lines this adds to
`contextFor`, and the node it must now be handed, put it over 300, so the implementing pull request moves the
report assembly (`report`, `needs`, `unsupplied`) into a module of its own. That is the rule biting as a design
signal, and it is a split along a step the file already names.

**Atomic graphs (RFC 0004).** Inside a transaction a failed statement has aborted the transaction (Postgres
refuses every later statement on it until rollback), so retrying one node of an atomic graph could only fail
again; and a retry of a binding operation reached from *inside* an atomic scope would re-run statements on a
scope that joined the outer transaction. G0n4 refuses both. The retry that makes sense is the one G0n4's hint
names: `retry` on the binding operation that runs the atomic graph. Each try is a fresh `nestedRunner` run, and
RFC 0004 creates the `AtomicScope` per run (`const scope = outer ?? new AtomicScope()`), so each try is a new
transaction, the last one commits, and every earlier one rolled back when its run ended non-`done` -- a
serialisation failure is retried whole, which is what a database asks of its clients. A `timeoutMs` inside an
atomic graph needs no rule: the node fails, the run ends non-`done`, `settle(false)` rolls back; whether the
`ROLLBACK` waits for a statement still in flight is the driver's ordering, not wilanis's.

**The http plugin.** Two changes in `packages/plugin-http/src/request.ts`. `request` takes `ctx.signal` (its
context type today is `{ env }` alone), and `send` composes it with the connection's own timer:
`AbortSignal.any([ctx.signal, control.signal])` in place of `init.signal = control.signal`. Today the handler
ignores the signal the embedder passes through `FireOptions.signal`, so nothing outside the connection's
`timeoutMs` can stop a request in flight; after this, the tighter of the connection's bound and the site's wins
by construction, and so does a cancellation of the run. The connection's timer still counts from the moment the
throttle lets the request through (`throttleFor` in `throttle.ts`); the site's counts from the node's start,
so a call waiting for a throttle slot can time out while it waits. That is the caller's bound, and it is right.

**The embedder** changes nothing. `fire`, `startup` and `decide` pass `signal` and `env` as they do; the policy
rides in the compiled spec. A startup step whose operation's binding retries, retries.

**`rehearse`, `fuzz`, `regress`, `run --seed`.** Unchanged in behaviour. `stubEffects` in
`packages/runtime/src/stubbing.ts` replaces every effectful native handler with a generator that never throws and
never times out, so the wrapper around it never loops, and the rehearsal walks the branches it walks today. The
stub's Sketch proposed a `fuzz` mode that fails an effect once to see the retry happen; the code says it would
record nothing. A scenario keeps what a node answered (`pick` in `fuzz.ts` records `status`, `selected`, `out`),
not how many tries it took, and `regress` answers a stubbed node from `stubs` in `Run.invoke` *before* any
handler -- wrapper included -- runs. A flaky mode would therefore write the same scenario wherever a retry is
declared and break every run wherever one is not, and neither is a finding. The retry is proven by the tests
below, against a handler that fails once.

**Traces (RFC 0006).** `traceOf` in `packages/runtime/src/trace.ts` gains one row: a `run` node or map element
with `attempts` emits one child span per entry, named `<node id> try <n>`, status `failed`, `wilanis.error` at
level `full` only (an `Attempt.error` is a message and follows the rule for messages), and the node's own span
carries `wilanis.attempts` (the count of tries before the one that stood). A timed-out node is a failed span whose
error reads `timed out after <n>ms`; a distinct kind for it is RFC 0014's to give, if it gives failures kinds.

**Cancelling a run (RFC 0012).** Nothing here observes the run's signal in the engine: `Run` forwards
`opts.signal` to handlers and never reads it, so an aborted run today starts every node that becomes ready
until quiescence. This RFC composes the site's timer with that signal and stops at the handler; what the
scheduler does when the signal fires -- settling pending nodes as `cancelled`, answering a report that says so
-- is RFC 0012's, and a timed-out binding operation whose graph is still running is, until then, abandoned by
its caller rather than cancelled. That is the seam, and it is named so 0012 can take it.

### Discoverability

- `wilanis describe <port>` (`operationLine` in `packages/runtime/src/discovery.ts`) adds `(idempotent)`,
  `(idempotent when method == 'GET' || ...)` or `(key: <field>)` beside `(pure)`, `(refuses on purpose)` and
  `(holds until stopped)`.
- `wilanis describe <trigger>` and `<graph>` (`nodeLines`) append `retries 2 (200ms backoff, when status >= 500)`
  and `timeout 5000ms` to a node's line, after `(effect)`; a binding operation's line (`<binding>#<op>`) gets
  the same.
- `wilanis map` is unchanged: a retry is not a document.
- The viewer's graph page (`packages/view/client/index.html`, `renderDocPage`) shows a badge on a node that
  retries or is bounded, and the side panel the policy; the port page lists `idempotent` and `key` with the other
  flags. The view model (`packages/view/src/model.ts`) carries the two fields on a node entry and on a binding
  operation entry.

### Plugin contract

`PluginModule` in `packages/core/src/plugin.ts` does not change, and neither does `Handler`. A handler that wants
to stop when a call is bounded reads `ctx.signal`, which `HandlerArgs` has carried since the engine was written;
the http plugin is the first to honour it. A plugin declares what it knows about repeating in its port document,
which is the one place a reader can open (`wilanis describe @http/http.port.json` shows the expression). Nothing
is registered and no hook is added: the plugin says, the checker judges, the compiler enforces.

## Compatibility

IR v1, compatible. `port.schema.json` gains two optional fields on an operation; `node/run.schema.json`,
`node/map.schema.json` and `binding.schema.json` gain two optional fields each, one of them by reference to a new
`$defs/retry` in `common.schema.json`. Every document written before this RFC validates and means what it meant:
no retry, no bound but the connection's. `KCall`, `KMap` and `RunContext` gain an optional `site`; `NodeReport`
gains an optional `attempts`; `RunContext` gains `attempted`. A report of a node that ran once is byte-for-byte
what it was. `@http/http.port.json` and `@blob/csv.port.json` change in what they declare, not in what they
accept or answer. No `schemas-v2`.

## Tests

Sabotage tests in `packages/runtime/test/example.test.ts` and `sabotage.test.ts`, through `sabotage` in
`example-harness.ts` (copy the example, edit one document, answer the codes):

| Code | The edit |
|---|---|
| C0n1 | a fake plugin's port (under `docsDir`) whose operation declares `key: "nope"` with no such field; one declaring `idempotent: true` and `key`; one whose `idempotent` is `"method"` (a string, not boolean) |
| C0n1 | `"key": "id"` on `@monitor/domain/monitor.port.json#get` |
| L0n1 | `"retry": { "times": 1 }` on `recorded` in `record-entry.graph.json`; `"timeoutMs": 100` on `drafts` in `import-entries.graph.json` |
| G0n1 | `"retry": { "times": 1 }` on `row` in `get-row.graph.json` (`@std/object.port.json#make`, pure) |
| G0n2 | `"retry": { "times": 1 }` on `asked` in `create-row.graph.json` (POST); on `asked` in `update-row.graph.json` with `method` changed to `"{{in.method}}"` (a read, so the expression cannot be judged); on the binding's `record` operation (its graph POSTs) |
| G0n3 | `"when": "status"` on a retry over `asked` in `get-row.graph.json` (number, not boolean); `"when": "has(x)"` on a retry over a binding operation bound to `write-csv.graph.json` (answers a `blob`, not an object) |
| B0n1 | `"idempotent": true` on `monitor.port.json#record`; the refusal names `live`, `monitor-rest.binding.json` and `asked` |
| none | `"idempotent": true` on `monitor.port.json#get` and the retry of the guide's example on `asked` in `get-row.graph.json`: `codes(...)` is empty |

Runtime, in `packages/runtime/test/attempts.test.ts` (new), with a fake plugin whose one effect is counted and
scripted (fail the first n calls, hang, answer `{ status }`), registered beside `PLUGINS` from the harness:

| What | Asserts |
|---|---|
| a fault is retried | fails once, `times: 2`: the node is `done`, `attempts.length === 1`, the handler ran twice |
| tries run out | fails three times, `times: 2`: the node is `failed` with the third error, `attempts.length === 2` |
| a refusal is not retried | throws `Refusal('missing', ...)`: the node is `failed`, `reason: 'missing'`, no `attempts`, the handler ran once |
| a timeout is a fault and is retried | hangs on the first call, `timeoutMs: 20`: the first attempt's error is `timed out after 20ms`, the second answers |
| the handler is told | the hanging handler receives an aborted `ctx.signal` |
| `when` retries an answer and the last stands | answers 503, 503, 200 with `when: status >= 500`: `out.status === 200`, two attempts; answers 503 always: `out.status === 503`, node `done` |
| backoff waits | `backoffMs: 10`, fails twice: `attempts[1].startedAt - attempts[0].endedAt >= 10` |
| a map retries per element | `over` of three, element 1 fails once: only `items[1].attempts` is set |
| a binding operation retries its graph | the graph's effect fails once: the calling node is `done`, `attempts[0].sub` is the failed nested report, `sub` the one that stood |
| a nested refusal is not retried | the graph refuses `missing`: one run, the refusal passes up |
| a node without a policy is untouched | the wrapper calls the base handler once and records nothing; the report equals the pre-RFC report |
| the report's handler is the operation | `report.nodes.asked.handler === '@http/http.port.json#request'` on a retried node |

Engine, in `packages/engine/test/kernel.test.ts`: a handler that calls `ctx.attempted` twice leaves two entries on
the node; `ctx.site` carries the spec's tag to the handler and the kernel never reads it (a spec with and without
`site` runs identically).

Http, in `packages/plugin-http/test/http.test.ts` against the fake upstream in `harness.ts`: an upstream that
answers 503 once then 200, with the guide's retry on `get-row.graph.json`, answers `GET /monitor/{id}` 200; an
upstream that holds the socket, with `timeoutMs: 50` on the site and `timeoutMs: 10000` on the connection, fails
the node in about 50 ms, not 10 s; a run signal aborted mid-request rejects the fetch.

Core, in `packages/core/test/validate.test.ts`: the baseline documents gain a retried node and a keyed
operation; `retry.times: 0` and `timeoutMs: 0` are refused by the schema.

Discoverability, in `packages/runtime/test/tools.test.ts`: `describe @http/http.port.json` prints `idempotent when`;
`describe` of the retried graph prints `retries 2`.

## Implementation plan

1. **Schemas and model** (`area:core`): `idempotent` and `key` on `port.schema.json`; `$defs/retry` in
   `common.schema.json`; `retry` and `timeoutMs` on `node/run.schema.json`, `node/map.schema.json` and
   `binding.schema.json`; the fields on `Operation`, `RunNode`, `MapNode`, `BindingOp` and `Retry` in `model.ts`;
   the template's rows; the baseline in `validate.test.ts`. `good first issue`.
2. **Engine** (`area:engine`): `site` on `KCall`, `KMap`, `RunContext`; `Attempt`, `NodeReport.attempts`,
   `RunContext.attempted`; `contextFor` handed the node; the report assembly moved out of `run.ts`; the kernel
   tests.
3. **Compiler, the wrapper** (`area:compiler`): `attempts.ts` with `attempting`, `bounded`, the site table;
   `lowerNode` and `lowerBindingOp` tag sites; `nativeHandler`, `handlerFor` and `graphCall` register through the
   wrapper; `attempts.test.ts` in `packages/runtime/test` with the scripted fake plugin. Uses `ctx.clock` when
   RFC 0006's step 1 has landed, `Date.now` otherwise.
4. **Checker** (`area:compiler`): `Judge.idempotentAt`; `effectsReachable` in `refusals.ts`; C0n1 in
   `contracts.ts`; L0n1 in `graph.ts`; `check/attempts.ts` with G0n1, G0n2, G0n3, called from `graph.ts` and
   `bindings.ts`; the sabotage tests.
5. **Checker, the promise** (`area:compiler`): B0n1 in `project.ts`, per profile; its sabotage tests.
6. **Http** (`area:plugin-http`): `request` reads `ctx.signal`, `send` composes it; `http.port.json` declares the
   `idempotent` expression; the three tests against the fake upstream.
7. **Blob** (`area:plugin-blob`): `parse` declares `idempotent: true`. `good first issue`.
8. **Discoverability** (`area:runtime`, `area:view`): `operationLine` and `nodeLines`; the view model and the
   viewer's badges. `good first issue`.
9. **The example**: the guide's `timeoutMs` and `retry` on `asked` in `get-row.graph.json`, `retry` on the
   binding's `listAll`, `idempotent: true` on `monitor.port.json#get`; a paragraph in `example/README.md` and one
   in the root `README.md` beside "Every branch runs before you deploy".
10. **G0n4** (`area:compiler`): blocked on RFC 0004's implementation (the atomic walk it judges against).
11. **Trace rows** (`area:runtime`): blocked on RFC 0006's `trace.ts`.

## Drawbacks and alternatives

**Retry at the domain call site.** The stub's sketch put `retry` on any `run` node. A domain graph node names a
domain operation whose binding differs per profile: under `live`, `monitor.record` is a POST that must not be
repeated; under a storage profile it is a keyed `put` that may be. The knowledge of whether repeating is *safe*
(the native operation's idempotency, or its key) and whether it *helps* (a flaky transport) is the binding's --
"how a port is met" -- and a domain graph that wrote `retry` would fix a transport policy in the one layer that
knows no transport, and would be wrong under one of the profiles. So `retry` and `timeoutMs` live where the data
layer names an effect: a data graph's node, or a binding's operation, whether it delegates one native call or
runs a whole graph. A later RFC may relax L0n1 for a domain node whose operation declares `idempotent: true`,
since the checker would already have proven it safe; this one does not, because "safe" is not "useful" and the
usefulness is still the transport's fact.

**Timeout on the operation, or on the connection only.** A plugin cannot know how long a call may take in a
given deployment, so `timeoutMs` in a port document would be a default nobody set on purpose; and a bound on a
domain operation ("every binding answers within 5 s") is a contract the checker cannot prove. The connection's
`timeoutMs` is right for what it is -- the transport's ceiling, one per upstream -- and stays. The call's bound
is the call site's, and the two compose through the signal with no rule about which wins: the tighter does.

**Durations as strings.** `"5s"` reads well and needs a parser; the house writes `timeoutMs`, `accessTtl: 900`,
`ttl: 300`. Numbers with the unit in the name, as everywhere else.

**One node per attempt.** Rejected on the code: a `NodeReport` exists per spec node before the run starts, and a
retry is decided during it. Attempts on the node, through `ctx.attempted`, follow the one precedent for a handler
writing into its own report, `ctx.attach`.

**A per-site handler key.** `retry:<graph>#<node>` would have needed no `site` on the spec, and would have made
the report say a node ran `retry:...` where `fuzz` and the trace expect the operation. The opaque tag costs the
engine one optional field it never reads, the way `env` is one value it never reads.

**A `flaky` mode of `fuzz`.** Proposed by the stub, dropped for the reasons under *Runtime behaviour*: a scenario
records answers, not tries, and `regress` never reaches a handler. Generating scenarios that exercise a fault is
RFC 0018's ground.

**An effect-class enum** (`read | idempotent-write | write`). Three facts in one field, and a plugin whose
operation is idempotent under a condition has no value to write. `idempotent` as a boolean-or-expression and
`key` as a field name are each one fact, and the expression reuses the grammar a switch rule already has.

**Jitter on the backoff.** Doubling without jitter synchronises retries across concurrent runs against one
upstream. It is left to implementation (below) because the connection's `throttle` already paces requests
against one upstream, and a backoff is one number an author reads.

**A `key` reachable inside `headers`** (`"key": "headers.idempotency-key"`) would let a POST with an
`Idempotency-Key` retry. The convention is not universal and the field is nested; a port whose contract has the
key as a field of its own (RFC 0023) needs no path, so `key` stays a field name.

**Cost.** Every handler the compiler registers is wrapped, and every call pays one `Map.get` on `ctx.site`.
`compiler.ts` grows by three calls into `attempts.ts`; `run.ts` loses its report assembly to a module of its
own. A retried binding operation that runs a graph re-runs the pure nodes of that graph too; that is the price of
retrying the transaction whole, and the alternative -- retrying the failed statement inside it -- does not work.

## Open questions

Settled here, with the reasoning in the text: `retry` is the data layer's, at the call site of an effect or on a
binding operation, never the domain's (*Drawbacks*, first item); `timeoutMs` is the call site's and composes with
the connection's through the signal (*Drawbacks*, second item); a retry is one node with its `attempts`, because
the report's shape is fixed before the run (*The report*). The stub's *Drawbacks* asked whether `idempotent` on a
domain operation, verifiable only through a profile's bindings, is a refusal or a note: it is a refusal, B0n1,
per profile with the profile named -- the profiles are the deployments the tree admits, a promise a queue kind or
a caller leans on cannot be true in one and unchecked in another, and RFC 0004's L0n1 and L0n2 already refuse
per profile for the same reason.

Nothing else must be decided before `accepted`. Decided during implementation:

1. Whether the backoff gains jitter, and its shape, once the tests exist to show synchronised retries against
   the fake upstream.
2. Whether `Attempt.sub` is kept for a failed nested run or the attempt carries only the innermost failed node's
   path and error (`failedLeaf` in `stubbing.ts` finds it): the full report is more honest, and larger.
3. The exact text of the timeout's error, `timed out after <n>ms`, which RFC 0014 may turn into a kind.
