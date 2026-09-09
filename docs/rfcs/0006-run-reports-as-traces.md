# RFC 0006: Observability: the run report as a trace

- **Status:** accepted
- **Areas:** `area:engine`, `area:runtime`, `area:plugin-http`, `area:core` (one field on a trigger kind, one member on `Serving`)
- **Tracking issue:** #8
- **Depends on:** none

## Summary

Every fire of a trigger already leaves a complete record: the engine's `Report` says which node ran, when it
started and ended, what it answered with secrets removed, which branch a `switch` chose, and nests the report
of every binding graph it called. This RFC turns that record into a **trace** -- one span per thing that
happened, in the tree's own words -- and makes it observable: printed by `wilanis run --trace` and
`wilanis start --trace` with no plugin, and shipped to any OpenTelemetry collector by a `@wilanis/plugin-otel`
package that a project names in its startup list. Nothing is instrumented by an author. The graph *is* the
instrumentation.

## Motivation

A request that answers 502 today leaves one line, written by the http listener in `packages/plugin-http/src/serve.ts`:

```
GET /monitor/golf → 502 (143ms, @monitor/domain/monitor.port.json#get failed)
```

The report behind it knows far more: that `asked` (the `http.request` node) took 131 of those 143 ms against
`@connections/monitor-api.connection.json`, that `route` selected `failed`, that the refusal's reason was
`upstream`. None of it can be seen while serving, none of it can be sent anywhere, and nothing correlates it
with the caller's own trace id. An operator running a wilanis tree beside conventional services has less
visibility into it than into the services, when the tree has more to say than any of them.

What an author cannot express today: nothing, and that is the point. There is no `trace` node to write and
there will be none. The record exists; this RFC gives it a shape and a way out. What the runtime cannot do
today: keep the reports of the policies that *allowed* a run (`Embedder.decide` in
`packages/runtime/src/embed.ts` discards a `done` decision), say how long the guard's `identify` took, give a
run an id, or hand the record to anyone but the trigger kind that fired it.

Out of scope: metrics and logs as OpenTelemetry signals (a span's attributes and status cover what a tree
knows; counters can be derived from spans by the collector), sampling policy, and a dashboard. RFC 0002's
storage operations and RFC 0004's atomic graphs get spans for free once they exist, since they are nodes.

## Guide-level explanation

**A trace** is a run said as spans. A span has a name, a start, an end, a status, and attributes; spans nest.
A run of a trigger is one trace. Its root span is the fire; under it, the guard's identification, each policy's
decision, then the operation itself; under the operation, one span per node that ran, and a binding graph's
nodes under the node that called it. Nothing is added to the tree to get this.

Running the example's `GET /monitor/{id}` with tracing on:

```
$ npx wilanis start example --trace
...
trace 01J8ZK5R9V3Q  GET /monitor/golf → 502  143ms
  fire @monitor/edge/get-entry.trigger.json                    143ms  refused: upstream
    @monitor/domain/monitor.port.json#get                       141ms  refused: upstream
      binding @monitor/data/monitor.binding.json#get            141ms
        get-row (@monitor/data/get-row.graph.json)              140ms  refused: upstream
          asked   @http/http.port.json#request                  131ms  ok   connection=@connections/monitor-api.connection.json status=500
          route   switch → failed                                 0ms  ok
          failed  @std/outcome.port.json#refuse                   0ms  refused: upstream "the monitor API answered 500"
          missing                                                      cancelled
          row                                                          cancelled
```

A gated trigger shows the gate:

```
trace 01J8ZK6D2M7X  DELETE /monitor/golf → 403  9ms  correlation=00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
  fire @monitor/edge/remove-entry.trigger.json                   9ms  denied: forbidden
    identify (@auth)                                             6ms  ok   principal=yes session=yes
    policy @access/edge/signed-in.policy.json                    1ms  allowed
    policy @access/edge/recorder-only.policy.json                1ms  denied: forbidden "the recorder role is required"
```

The same trace as JSON (`--trace=json`) is one object per run on stdout, for a log shipper. To send traces to
a collector instead, a project adds the exporter to what it starts, exactly as it adds the listener:

```json
"plugins": [
  { "use": "@otel", "from": "@wilanis/plugin-otel", "settings": { "endpoint": "{{secrets.OTLP_ENDPOINT}}", "service": "monitor" } }
],
"startup": [
  { "label": "Export traces", "run": "@otel/exporter.port.json#export" },
  { "label": "Listen", "run": "@http/server.port.json#listen" }
]
```

`wilanis describe @otel/exporter.port.json#export` prints `granted by @otel (@wilanis/plugin-otel) (holds until stopped)`,
and a reader of `project.json` sees at the root that this tree exports traces, to where, and under which
service name. Delete the step and nothing is exported: no runtime decides on its own that a tree should phone
home.

Which header carries the caller's correlation id is the trigger kind's business, since only the kind knows its
context. The http kind declares it once, in `http.trigger-kind.json`:

```json
"correlation": "headers.traceparent"
```

## Reference

### Documents and schemas

**`trigger-kind.schema.json`** gains one optional field:

- `correlation` (string): the dotted path, within this kind's `context`, of the value that correlates a run
  with the caller's own trace. The runtime copies it into the trace as an opaque string; parsing it (W3C
  `traceparent`, an `x-request-id`) is the exporter's business. Absent: runs of this kind carry no
  correlation and the exporter starts a new trace for each.

`TriggerKindDoc` in `packages/core/src/model.ts` gains `correlation?: string`. No new document kind, no
placement change, no scaffold change. `packages/runtime/templates/CLAUDE.md` does not change: an author of
documents never touches this field, a plugin does.

**`plugin-http/docs/http.trigger-kind.json`** declares `"correlation": "headers.traceparent"`, and one path,
not a list. A policy reads its credential from a list because a caller may legitimately present a token in
more than one place and the guard must accept any of them; a correlation id has no such claim on the runtime
-- it is copied opaquely, and a kind that wants a different header says a different path. Making the field a
list, or a string-or-list, is a schema shape that every reader and every kind then carries, and one this RFC
cannot retract once documents are written against it; a single path can become a list later without
invalidating a document, while the reverse cannot. A deployment that puts its id in `x-request-id` is served
by a kind that says so.
**`runtime/docs/cli/cli.trigger-kind.json`** declares none: a command line has no caller trace.

### Ports, operations and kinds granted

A new package `packages/plugin-otel/` (`@wilanis/plugin-otel`, root `@otel`), depending on core, engine and
the OpenTelemetry packages (`@opentelemetry/api`, `@opentelemetry/sdk-trace-base`,
`@opentelemetry/exporter-trace-otlp-http`). It carries an external dependency, so it is its own package.

`docs/plugin.json` -- settings: `endpoint` (string, the OTLP/HTTP collector URL, a `{{secrets.*}}` read
in practice), `service` (string, `service.name`), `headers` (open object of strings, optional, for a
collector's auth), `level` (`"summary" | "full"`, optional, default `summary`; see redaction below).

`docs/exporter.port.json` -- one operation:

| Operation | `holds` | Accepts | Returns |
|---|---|---|---|
| `export` | true | `level` (string, optional; absent: the plugin's setting) | `{ endpoint: string, service: string }` |

`export` reads `env.serving` and `env.hold` like `@http/server.port.json#listen` and `@reload/watch.port.json#watch`
do, subscribes to the runtime's traces through `serving.observe`, converts each to OTLP spans, and hands back
the unsubscribe and the exporter's flush as its teardown. Run from a graph it throws the same way `listen`
does; L008 refuses it there before it ever runs.

### Checker rules

| Code | Where it lives | Refuses when | Hint |
|---|---|---|---|
| T0nn | `check/triggers.ts` (the kind, judged once) | a trigger kind's `correlation` is not a path into its `context` fields | `name a field of context, e.g. headers.traceparent, or remove correlation` |
| X0nn | `plugin-otel` `check` | `settings.endpoint` is neither a `{{secrets.*}}` read nor an `http(s)://` URL, or `level` is not `summary`/`full` | `set endpoint to a URL or a secret read; level is summary or full` |

Numbers are assigned when the implementing PR lands. B006 already admits `export` in a startup step, since
it is a native `holds` operation; L008 already refuses it in a graph. No rule is added for the step itself.

### Runtime behaviour

**Engine (`packages/engine/src/run.ts`, `spec.ts`).** The report already stamps `startedAt`/`endedAt` on the
run and on every node and map element with `Date.now()`. The kernel is "clockless" in the sense that matters
-- it never waits on time and never decides to run again -- and this RFC keeps that. Two small additions:

- `RunOptions.clock?: () => number`, defaulting to `Date.now`. The embedder passes one clock to every nested
  run through `RunContext` (add `clock` beside `signal`), so a test can freeze time and a trace is
  reproducible. Nothing else in the engine changes; the stamping stays where it is because the engine is the
  only thing that knows when a node started, and wrapping handlers in the embedder would miss `switch`
  nodes and map elements, which have no handler.
- `NodeReport` gains nothing. The connection an effect used is already in `report.in.connection` of the
  node (the http request handler reads `input.connection`, `connectionOf` in `packages/plugin-http/src/request.ts`),
  and the trace reads it from there. Whether a node was an effect is known to the trace builder from the
  scope (`pure` on the operation), not to the engine.

**Embedder (`packages/runtime/src/embed.ts`).** `fire` keeps its signature and its answer. Internally it
records what the gate did instead of dropping it: `gate` and `decide` collect `{ policy, report }` for every
decision, allowed or not, and the guard's `identify` is timed with its outcome (`context` keys it added, or
the refusal's reason). At the end of `fire` -- after `settle` and the out-type judgement -- the embedder
assembles a `Fired` record:

```ts
interface Fired {
  id: string;                       // ULID, new per fire
  trigger: string; kind: string;    // canonical paths
  correlation?: string;             // read from the request at the kind's `correlation` path
  identify?: { startedAt: number; endedAt: number; added: string[]; refused?: string };
  decisions: { policy: string; report: Report; effect?: 'deny' | 'challenge' }[];
  run?: Report;                     // absent when the gate ended the run
  answer: Report;                   // what fire answers: the run's, or the gate's
  startedAt: number; endedAt: number;
}
```

and hands it to every observer registered through a new `Embedder.observe(listener): () => void`. A stubbed
embedder (`rehearse`, `fuzz`, `regress`, `run --seed`) records nothing: the gate never runs there and no
observer is registered. Startup steps are fired through `Embedder.startup` and produce a trace of their own,
rooted `startup <label>`, never a `Fired` wearing the step as its trigger: a step is not a trigger, it has no
kind, no correlation and no gate, and putting its label in `Fired.trigger` would make every reader of a trace
-- the printer, an exporter, a later query -- handle a trigger that does not exist. `Fired` keeps meaning one
trigger fired; a startup root carries the step's index and label and the same span tree beneath it, so the
trace of a `start` still shows what the pool's `open` did.

**Trace (`packages/runtime/src/trace.ts`, new).** `traceOf(fired, scope): Trace` is pure. It walks the
reports and yields spans:

| What ran | Span name | Status | Attributes |
|---|---|---|---|
| the fire | `fire <trigger path>` | `refused: <reason>` / `denied` / `challenged` / `failed` / `ok` | `wilanis.trigger`, `wilanis.kind`, `wilanis.run.id`, `wilanis.correlation` |
| `identify` | `identify (<guard root>)` | ok / refused | `wilanis.principal` (present: yes/no), `wilanis.session` (yes/no) |
| a policy | `policy <policy path>` | `allowed` / `denied: <reason>` / `challenged: <reason>` | `wilanis.policy.outcome` |
| the operation | `<port>#<operation>` | from its report | `wilanis.port`, `wilanis.operation` |
| a binding | `binding <binding path>#<op>` | from the nested report | `wilanis.binding` |
| a graph (nested report) | `<graph path>` | from `report.status` | `wilanis.graph` |
| a `run` node | `<node id> <handler>` | `ok` / `refused: <reason>` / `failed` / `cancelled` / `seeded` | `wilanis.node`, `wilanis.effect` (true when the operation is not `pure`), `wilanis.connection` when `in.connection` is a string, `http.response.status_code` when the handler is `@http/http.port.json#request` and `out.status` is a number |
| a `switch` | `<node id> switch → <selected>` | ok | `wilanis.selected`, `wilanis.rule` (the label of the rule that fired, or `else`) |
| a `map` | `<node id> map ×<n>` | from the node | one child span per element, named `<node id>.<index>` |

A cancelled node has no duration and is emitted as a zero-length span with status `cancelled`, so a reader
sees the branches not taken; the `full` level keeps them, the `summary` level drops them.

**Redaction.** The report's `in` and `out` are already redacted at the node (`redactValue` in
`packages/engine/src/redact.ts`, applied in `runCall`, `runElement` and to a map's answer). A trace never
carries the request: only the correlation string. At level `summary` a span carries status, timing and the
attributes above, and never a value. At level `full` a span also carries `wilanis.in` and `wilanis.out` as JSON
of the report's redacted `in`/`out`, and `wilanis.error` as the node's message. A refusal's `message` and a
fault's `error` can interpolate values (`"no entry {{in.id}}"`), so `trace.ts` passes every message through
`redactValue` with the union of the node's redact paths applied to the *values* the message may contain: the
rule is that `summary` carries the reason alone and never the message; the message appears at `full` only.
A reason is a word the author declared in `refuses`, a closed set that cannot leak; a message is prose that
interpolates whatever the author wrote into it, and `redactValue` blanks only the paths a document *marked*
secret. The value nobody thought to mark is exactly the one that ends up in a message, so the level that is
safe to export by default cannot carry one, and turning on `full` is the author saying they have read what
their messages say.
`detail` (a challenge's id and how to answer it) never enters a trace at any level.

**An observer outlives a reload, and that has to be written.** `Served.reload` builds a fresh `Embedder` and
carries only `emb.held` across (`packages/runtime/src/serve.ts`); an observer registered on the old embedder
would be dropped, and the exporter -- which is a `holds` operation, so it is *not* rebuilt -- would go quiet
without saying so. The observers therefore live on `Served`, beside `held`, and not on the embedder: `serving()`
already routes every member through `current`, so `observe` registers with the server and `Embedder.fire` hands
its `Fired` to whatever `Served` is listening. `reload` then needs no line about observers at all, which is the
point: the exporter holds the server, never the tree it came from, exactly as the listener does.

**Serving (`packages/core/src/plugin.ts`).** `Serving` gains one member:

```ts
/** Be told of every fire while this tree is served; answers the way to stop listening. Survives a reload. */
observe(listener: (trace: Trace) => void): () => void;
```

`Served.serving()` in `packages/runtime/src/serve.ts` implements it against the *current* embedder and keeps
the listeners on `Served`, the way it keeps `held`, so a reload's new embedder inherits them. `Trace` is a
type exported from core beside `Serving` (spans as plain data: `{ name, startedAt, endedAt, status, attributes, children }`),
because a plugin sees core and engine only.

**`wilanis start --trace[=text|json]` and `wilanis run --trace[=text|json]`** (`packages/runtime/src/cli.ts`,
work in `packages/runtime/src/trace.ts`). `start` registers a printing observer before the startup steps run,
so their traces print too. `run` prints the one trace after the answer, on stderr, where `--verbose` already
prints `summarize(report)`. `--verbose` is kept; `--trace` supersedes what it printed and `summarize` in
`stubbing.ts` becomes the text form of a trace, one implementation.

**`@otel/exporter.port.json#export`.** Builds a `BasicTracerProvider` with an OTLP/HTTP span exporter for
`settings.endpoint`, maps each `Trace` to spans with the root span's parent taken from `correlation` when it
parses as a W3C `traceparent`, and holds `{ label: 'otel → <endpoint>', stop: flush and shutdown }`. Export is
asynchronous and batched: a slow collector never delays an answer.

**Rehearse, fuzz, regress.** Unchanged in behaviour. Two small gains: `fuzz` records `handler` beside
`status`/`out`/`selected` in a scenario's `expect.nodes` (`pick` in `packages/runtime/src/fuzz.ts`), so a
`regress` diff can say *what* changed at a node and not only that it did; and the rehearsal report's
`branchLine` (`rehearsal-report.ts`) can print a branch's duration under `--verbose`. Durations never enter a
scenario: they are not reproducible.

### Discoverability

- `wilanis describe @otel/exporter.port.json#export` says `granted by @otel (@wilanis/plugin-otel) (holds until stopped)`,
  as it does for any `holds` operation today.
- `wilanis describe <trigger kind>` prints `correlation: headers.traceparent` when declared.
- `wilanis map` is unchanged: a trace is a run, not a document.
- The viewer (`packages/view/client/index.html`) gains nothing in this RFC. A later RFC may replay a JSON
  trace over the drawn graph; the span names carry graph paths and node ids so that it can.

### Plugin contract

`PluginModule` does not change. The exporter reaches the runtime the way the listener and the watcher do:
through `env.serving` and `env.hold` inside a `holds` operation the project's startup list names. The one
addition is `Serving.observe`, in core, which a plugin may call and the runtime implements. This keeps every
rule in `CLAUDE.md`: the runtime never reaches into a plugin, a plugin never imports the runtime, and what a
tree starts is written in `project.json`, never decided by the runtime.

The alternative, a `PluginModule.observe` hook that the runtime calls for every fire, was rejected: it would
be the first plugin hook that runs without being named by the tree, and a reader of `project.json` could not
tell that traces leave the process.

## Compatibility

IR v1, compatible: `trigger-kind.schema.json` gains an optional field; no document written before this RFC
changes meaning. `Report` gains nothing; `RunOptions` and `RunContext` gain an optional `clock`. `Serving`
gains a member, which only plugins that hold something ever see. `@wilanis/plugin-otel` is new and optional.

## Tests

| Test | Where | What it does |
|---|---|---|
| a frozen clock stamps every node | `packages/engine/test/kernel.test.ts` | run a spec with `clock` counting 1, 2, 3; expect the stamps |
| a fire yields a trace with the right spans | `packages/runtime/test/trace.test.ts` (new) | fire `GET /monitor/{id}` through the example harness with stubs; expect `fire → #get → binding → get-row → asked/route/failed`, statuses and `wilanis.connection` |
| a gated fire shows identify and every policy | `packages/runtime/test/trace.test.ts` | fire `DELETE /monitor/{id}` with a token from the access tree's fake directory; expect `identify` then two `policy` spans, the second `denied: forbidden` |
| a startup step is traced | `packages/runtime/test/startup.test.ts` | `start` with a printing observer; expect one trace per step |
| an allowed decision is kept, a stubbed run records nothing | `packages/runtime/test/trace.test.ts` | rehearse the example; expect no observer call |
| `summary` carries no value, `full` carries redacted ones | `packages/runtime/test/trace.test.ts` | fire sign-in; expect `«secret»` in `wilanis.in` at `full`, and no `wilanis.in` at `summary` |
| the correlation is read from the kind's path | `packages/runtime/test/trace.test.ts` | send `traceparent`; expect it on the root span |
| T0nn: a kind whose `correlation` names no context field | `packages/runtime/test/sabotage.test.ts` | copy the example with a sabotaged http kind under a fake plugin; expect T0nn |
| X0nn: a bad endpoint | `packages/plugin-otel/test/rules.test.ts` | `endpoint: "collector"`; expect X0nn |
| spans reach a collector | `packages/plugin-otel/test/export.test.ts` | start the example with `export` pointed at an in-process http server that captures OTLP/JSON; fire one route; expect a root span named `fire @monitor/edge/get-entry.trigger.json` with a child `asked @http/http.port.json#request` carrying `wilanis.connection` |
| `--trace=json` prints one object per run | `packages/runtime/test/tools.test.ts` | run a cli trigger; parse stderr |

## Implementation plan

1. Engine: `clock` on `RunOptions`/`RunContext`, threaded through `Run.start`, `runElement`, `report()` and
   the compiler's `nestedRunner`. Test. (`good first issue`)
2. Core: `correlation` on `TriggerKindDoc` and its schema; T0nn in `check/triggers.ts` with its sabotage
   test; `http.trigger-kind.json` declares `headers.traceparent`.
3. Runtime: `Fired` assembled in `Embedder.fire`/`startup` (the gate keeps allowed decisions, `identify` is
   timed); `Embedder.observe`; `Served` keeps listeners across a reload and `serving().observe`.
4. Runtime: `trace.ts` with `traceOf` and the text and JSON printers; `summarize` in `stubbing.ts` becomes the
   text printer; `--trace` on `start` and `run`. Tests against the example.
5. Core: the `Trace` type and `Serving.observe`.
6. `packages/plugin-otel`: package, `docs/plugin.json`, `docs/exporter.port.json`, the `export` handler, X0nn,
   the fake-collector test, a README. Add to `npm run release` order after `plugin-auth`.
7. `fuzz` records `handler`; the rehearsal report prints durations under `--verbose`. (`good first issue`)
8. README: a "See what a request did" paragraph beside "Every branch runs before you deploy"; the example's
   `project.json` gains the exporter step under a `required: false` so it runs without a collector.

## Drawbacks and alternatives

- **Cost.** Building a `Trace` per fire allocates; at `summary` it is a walk over a report that already
  exists, and observers are consulted only when registered. `wilanis start` without `--trace` and without an
  exporter step builds nothing.
- **A clock in the engine.** The kernel gains one optional function. The alternative, stamping in the
  embedder, cannot time a `switch` or a map element and would duplicate what `run.ts` already does.
- **OpenTelemetry only.** Other backends (Zipkin, Datadog, Honeycomb) all accept OTLP; a plugin per vendor is
  not needed. A plugin that speaks another protocol would be another `holds` operation over the same
  `Serving.observe`, with no runtime change.
- **A `trace` document kind** (per-trigger sampling, span naming) was considered and rejected: it would be a
  document an author writes for the operator's benefit, against the rule that a tree says what happens and
  the runtime how it is observed. Sampling belongs in the collector.

## Decided during implementation

1. ULID or UUIDv7 for `id`. Either sorts by time; Node 22 has `crypto.randomUUID()` and no ULID, so UUIDv7
   is the way to avoid a dependency for it.
2. Whether `wilanis run --trace` prints before or after the answer on stdout when the answer is a blob
   streamed to stdout (`deliver`): the trace goes to stderr regardless, so ordering only affects a terminal.
