# RFC 0010: Scheduled triggers

- **Status:** draft
- **Areas:** a new plugin `@wilanis/plugin-schedule` (the kind, the scheduler, the cron parser, its X rules), `area:runtime` (the example, `describe`, `map`, the template), `area:view`, and `area:plugin-storage` for the lease a storage engine keeps. No change to core, the compiler or the engine.
- **Tracking issue:** #12
- **Depends on:** none to accept. RFC 0012 (the `deadlineMs` setting waits for `FireArgs.signal`; that step is marked in the plan). RFC 0002 (the lease that lets one instance of several fire a tick, and the memory of the last tick that `catchUp` needs, are a table in the storage engine's connection; that step is blocked on its implementation). RFC 0006's traces and RFC 0007's access invariants need nothing here and apply to a scheduled trigger as they apply to a route. RFC 0013 is what a process that runs *only* the schedule waits on (*Drawbacks*, first item). RFC 0009 is the neighbour: a tick that fans work out publishes messages, and this RFC says where the seam is.

## Summary

A trigger fires because the clock says so: a cron expression or an interval in its settings, a time zone, and
the same `fire` into a domain port operation every other trigger has. The tick's time reaches the graph as an
input, `request.scheduled`, so the engine stays clockless and a rehearsal replays a tick like any request. What
runs the schedule is a `holds` operation the project's startup list names, `@schedule/scheduler.port.json#run`;
a tree that does not name it schedules nothing, as a tree that does not name `listen` serves nothing. Nobody is
calling, so a scheduled trigger gives the guard nothing and is public; what a tick does when the previous tick's
run is still going, and whether a tick that fell while no process ran is fired at start, are two settings with
cron's defaults. On several instances the scheduler takes a lease in the storage engine so one instance fires;
without one, every process that names the step fires, and the RFC says so rather than pretending.

## Motivation

A nightly digest, an hourly import, a sweep of expired sessions: every service has a few of these, and today the
only way to run one is a cron outside the tree calling `wilanis run` on a command-line trigger.
`example/features/monitor/edge/digest.trigger.json` is exactly that: `wilanis run @monitor/edge/digest.trigger.json`
prints the digest, and an operator who wants it every night writes `0 3 * * * npx wilanis run …` in a crontab the
tree knows nothing about. The schedule is then invisible to `wilanis check` (a cron line naming a trigger that was
renamed fails at three in the morning), to `wilanis map` and the viewer (the digest looks like a command someone
types), to `rehearse` (which walks the trigger but not the fact that it runs unattended), and to the manifest
RFC 0026 will print (`"scheduled": []`, when the tree is in fact scheduled). The schedule belongs in the document
that fires.

What an author cannot express today: that an operation runs at a time rather than on a request; what the run
should be told about that time; what happens when a run outlasts the interval; and which of several instances
does it.

What this RFC does not do. It does not queue (RFC 0009: a tick is not a message, and a tick that has a hundred
things to do publishes a hundred messages and lets the worker do them, *Guide*). It does not give a run a deadline
or cancel one (RFC 0012; the `deadlineMs` setting here is that RFC's word written in this kind's vocabulary, and
lands after it). It does not decide what a fault means to a `switch` (RFC 0014). It does not scope a schedule per
tenant (RFC 0015). It does not put a clock in the engine, a `now()` in the expression language or a date type in
the schemas: time enters a run as a string the kind hands, and the one comparison a graph needs -- earlier or
later -- is a string comparison of two ISO 8601 instants in UTC, which the expression language already has. It
does not give the runtime a second way to start something: the scheduler is a `holds` operation like the listener
and the watcher. And it does not add a `job` kind: a trigger fires a port, and a schedule is a trigger's business.

## Guide-level explanation

**A tick** is one instant a schedule names. **A scheduled trigger** is a trigger of kind
`@schedule/schedule.trigger-kind.json`. Its settings say when: a five-field `cron` expression in a `timezone`, or
an interval `everyMs` counted from the moment the scheduler started. Its context hands `request.scheduled` (the
tick's instant, ISO 8601 in UTC), `request.fired` (when the run began, which is later when the process was busy)
and `request.missed` (how many ticks since the last run were not fired, and why below); its `fire` runs a domain
port operation with inputs read from that context, exactly as a route's does. Its `out`, where the operation
answers something, is judged and logged, and goes nowhere: nobody is waiting. It has no refusal table: a refusal
is logged with its reason, since there is nobody to answer.

**The scheduler** is `wilanis start` on a tree whose `project.json → startup` names
`@schedule/scheduler.port.json#run`. Delete the step and no tick fires, as deleting `listen` closes the port.

The example, with the digest as a nightly job. One document, `example/features/monitor/edge/nightly-digest.trigger.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/wilanis/wilanis-js/main/packages/core/schemas/trigger.schema.json",
  "label": "nightly digest",
  "description": "At three in the morning, UTC, the digest: the count and one line per entry, logged by the scheduler. The same operation the digest command prints; nobody is calling, so no policy and nothing to answer. A tick that finds the previous night's run still going is skipped and counted.",
  "kind": "@schedule/schedule.trigger-kind.json",
  "settings": {
    "cron": "0 3 * * *",
    "timezone": "UTC"
  },
  "out": "@monitor/edge/DigestView.shape.json",
  "fire": {
    "run": "@monitor/domain/monitor.port.json#digest"
  }
}
```

`project.json` names the plugin and one more step, before the listener:

```json
"plugins": [
  { "use": "@std" },
  { "use": "@cli" },
  { "use": "@schedule", "from": "@wilanis/plugin-schedule" },
  ...
],
"startup": [
  { "label": "Reach the entry store", "run": "@monitor/domain/monitor.port.json#listAll", "required": true },
  { "label": "Watch for changes", "run": "@reload/watch.port.json#watch" },
  { "label": "Keep the schedule", "run": "@schedule/scheduler.port.json#run" },
  { "label": "Listen", "run": "@http/server.port.json#listen" }
]
```

`wilanis start example` then logs
`schedule: 1 trigger(s) -- @monitor/edge/nightly-digest.trigger.json at 0 3 * * * UTC, next 2026-09-11T03:00:00.000Z`
beside `http: listening on :8080`, and each tick one line:
`schedule @monitor/edge/nightly-digest.trigger.json 2026-09-11T03:00:00.000Z → done (61ms, @monitor/domain/monitor.port.json#digest) { count: 12 }`.
The command-line `digest.trigger.json` stays: the same operation, fired by a person instead of the clock, which is
the point of a trigger never naming a graph.

**Reading the tick.** An operation that takes a time reads it from the context like any input. A cleanup of
entries older than the tick, were the example to have one, would be a scheduled trigger with
`"in": "@monitor/edge/CutoffRequest.shape.json"` and `"fire": { "run": "…#purgeBefore", "in": { "before": "{{request.scheduled}}" } }`;
T003 types the read as a string, the shape declares `before` a string, and the data graph compares it to a row's
timestamp with `<`. Nothing in the domain calls a clock, so `wilanis run --seed` and `regress` replay the tick
they were given.

**What a tick may do.** Anything a trigger may do, and it is judged as any trigger is. A scheduled trigger that
fires an operation RFC 0007's access invariant covers -- `monitor.port.json#remove`, say -- is refused by I001,
because the invariant says who may and a tick is nobody. That is the right answer, and the fix is the domain's: an
operation written for the job (`#purgeExpired`, not `#remove`) that the invariant does not cover, or a policy over
the tick that the invariant names. The kind cannot present a token, and this RFC does not invent a "system caller":
who is calling is the guard's business, and nobody is.

**A tick with much to do publishes.** A schedule that must delete a thousand expired rows should fire an operation
whose data graph publishes one message per row to a queue (RFC 0009's `@queue/queue.port.json#publish`) and answer;
the worker deletes them, at its pace, at least once, idempotently, on whichever instance has capacity. The tick's
run then takes milliseconds, `overlap` never bites, and a crash mid-sweep loses nothing. The example does not need
it; the pattern is named so an author does not fan a thousand DELETEs out of a scheduled run.

**The refusal an author meets first.** Write both `cron` and `everyMs`, or a `cron` with six fields, and
`wilanis check` answers:

```
X0n1  @features/monitor/edge/nightly-digest.trigger.json#settings/cron
    '0 3 * * * *' has 6 fields; a cron expression has five: minute hour day-of-month month day-of-week
    → write five fields (for seconds, use everyMs), e.g. "0 3 * * *" for 03:00 every day
```

## Reference

### Documents and schemas

No new document kind and no schema change. The `trigger` kind means what it means: `settings`, `in`, `out`,
`policies`, `fire`. The `trigger-kind`, `port` and `plugin` schemas already say everything the documents below
need. Placement is unchanged: a scheduled trigger is a trigger, `HOME` in `packages/core/src/placement.ts` puts it
in `edge/`, and D008 refuses it elsewhere.

`packages/runtime/templates/CLAUDE.md`: the `trigger` row gains "a scheduled trigger says `cron` (five fields,
in a `timezone`) or `everyMs`, reads the tick as `request.scheduled`, and fires only while a startup step names
`@schedule/scheduler.port.json#run`"; the *What the tree starts* paragraph gains the step beside `listen` and
`watch`; the X list gains `@schedule: X0n1 a schedule that is not one, X0n2 an in nothing fills, X0n3 catchUp with
nothing to remember by`. `wilanis new trigger` (`SCAFFOLDS` in `packages/runtime/src/scaffolds.ts`) gains
`--kind @schedule/schedule.trigger-kind.json`, writing `settings: { cron: "0 3 * * *" }` and no `in`.

### Ports, operations and kinds granted

**`@wilanis/plugin-schedule`** (`packages/plugin-schedule/`, root `@schedule`), depending on `@wilanis/core` and
`@wilanis/engine` only, with no external dependency: the cron parser is ~150 lines of its own (`cron.ts`), since the
same parser judges an expression at check time (X0n1) and computes the next tick at run time, and a dependency for
a minute-resolution matcher is a supply chain for nothing. Why a package and not a plugin built into the runtime,
as the stub proposed, is under *Drawbacks*.

`docs/plugin.json` grants one port and one trigger kind; no connection kind, no codec, no shape. Its settings:

| Setting | Type | Meaning |
|---|---|---|
| `timezone` | string, optional | the zone a `cron` trigger is read in when it names none; absent: `UTC` |
| `leaseTtlMs` | number, optional | how long a lease taken before a tick is held without renewal; absent: 30000 |

`docs/scheduler.port.json`, what a startup step names:

| Operation | `holds` | Accepts | Returns |
|---|---|---|---|
| `run` | true | `lease` (string, optional, `static`: a connection document whose kind is marked `storage`, RFC 0002; absent: this process assumes it is alone) | `{ triggers: number, next?: string }` -- how many scheduled triggers the tree has and the earliest next tick, ISO 8601 |

`run` reads `env.serving` and `env.hold` exactly as `listen` in `packages/plugin-http/src/serve.ts` and `watchTree`
in `packages/plugin-reload/src/index.ts` do, and throws the same way when run from a graph, which L008 has already
refused. B006 admits it in a startup step because it is a native `holds` operation.

`docs/schedule.trigger-kind.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/wilanis/wilanis-js/main/packages/core/schemas/trigger-kind.schema.json",
  "label": "Schedule",
  "description": "Fired by the clock while a startup step names @schedule/scheduler.port.json#run: at every instant a five-field cron expression names in its timezone, or every everyMs milliseconds from the moment the scheduler started. The context hands the tick's instant, when the run actually began, and how many ticks since the last run were not fired; the trigger's input mapping picks what the graph gets. Nobody is calling: the trigger gives the guard nothing, so a policy reading the caller is refused (A005), and the answer is judged against out and logged, never delivered. A refusal is logged with its reason. A tick that finds the previous run still going is skipped, waits, or runs beside it, as overlap says. A tick that fell while no process ran is not fired unless catchUp says so, which needs a lease to remember the last tick by.",
  "settings": {
    "fields": {
      "cron": { "type": "string", "required": false, "description": "five fields: minute hour day-of-month month day-of-week; *, lists, ranges, steps, and month and weekday names. One of cron and everyMs" },
      "everyMs": { "type": "number", "required": false, "description": "an interval in milliseconds, 1000 or more, counted from the scheduler's start; never with a timezone. One of cron and everyMs" },
      "timezone": { "type": "string", "required": false, "description": "the IANA zone the cron expression is read in; absent: the plugin's settings.timezone, and UTC when that is absent too" },
      "overlap": { "type": "string", "enum": ["skip", "wait", "concurrent"], "required": false, "description": "what a tick does when the previous tick's run is still going: skip (default) drops it and counts it in missed; wait fires it once that run ends, one tick waiting at most; concurrent fires it beside the running one" },
      "catchUp": { "type": "boolean", "required": false, "description": "whether a tick that fell while no process ran is fired once at start, as the most recent such tick, with the earlier ones counted in missed; default false. Needs the run step's lease: without a store there is nothing to remember the last tick by (X0n3)" },
      "deadlineMs": { "type": "number", "required": false, "description": "the most a tick's run may take before it is cancelled (RFC 0012); absent: no deadline" }
    }
  },
  "context": {
    "fields": {
      "scheduled": { "type": "string", "description": "the tick's instant, ISO 8601 in UTC (2026-09-11T03:00:00.000Z), whatever the timezone the expression was read in" },
      "fired": { "type": "string", "description": "when this run began, ISO 8601 in UTC; later than scheduled when the process was busy or catching up" },
      "missed": { "type": "number", "description": "ticks between the last fired one and this one that were not fired: skipped by overlap, or fallen while no process ran (known only with a lease); 0 on the first tick after a start without one" }
    }
  }
}
```

`deadlineMs` is RFC 0012's word, written on this kind as that RFC writes it on the http kind ("the deadline is a
setting of the kind's own vocabulary"), and is written into the document once `FireArgs.signal` exists; until then
the field is absent and the kind validates without it. `overlap`'s three words are an `enum` on a string field,
which the type system carries (`Type` in `packages/core/src/types.ts`, `enum` on `string`), so T001 judges them
through `mismatch` and no X rule is needed -- unlike RFC 0009's `outcomes`, whose values sit under an open object.

### Checker rules

Codes are placeholders (`X0n1`); the implementing pull request takes the next free band of X codes as the tree
stands when it lands, as RFC 0002 gave `@storage` one and RFC 0009 gives `@queue` one, and no number here should
be read as reserved. Existing codes named (T001 to T004, A005, L008, B006, B007, D008, R001, I001) were checked
against the source; I001 is RFC 0007's, X203 is RFC 0002's.

**No generic rule.** The T family already judges everything a scheduled trigger shares with a route: T001 the
settings against the kind's contract (`overlap`'s enum among them), T002 `in` against `accepts` and `out` against
`returns`, T003 `fire.in` as reads of the context, typed (`request.scheduled` is a string), T004 a resolver read
under this trigger that the kind does not hand, A005 a policy reading the caller on a trigger that gives the guard
nothing, L008 a graph running `#run`, D008 the trigger outside `edge/`. The compiler learns nothing.

**The plugin's own** (`packages/plugin-schedule/src/rules.ts`, run through `PluginModule.check` with
`PluginCheckContext.scope`), each judging a word only this plugin knows:

| Code | Where it lives | Refuses when | Hint |
|---|---|---|---|
| X0n1 | `plugin-schedule/src/rules.ts`, at `settings/cron`, `settings/everyMs`, `settings/timezone` or `settings/deadlineMs` | a scheduled trigger's settings name both `cron` and `everyMs` or neither; `cron` does not parse (`parseCron` in `cron.ts` answers the reason: the field count, a value out of range, an unknown name); `everyMs` is not a whole number of 1000 or more; `timezone` is given with `everyMs`, or is not a zone `Intl.supportedValuesOf('timeZone')` knows; `deadlineMs` is not a whole number of 1 or more | `write five fields (for seconds, use everyMs), e.g. "0 3 * * *" for 03:00 every day` / `everyMs is a whole number of milliseconds, 1000 or more` / `a timezone is for a cron expression; an interval has none` / `name an IANA zone: Europe/Lisbon, UTC` |
| X0n2 | same, at `in` | a scheduled trigger declares `in` and no `fire.in`: nothing arrives on a tick, so the input would be `request.body`, which the kind never hands, and every tick would be refused at the edge | `write fire.in reading request.scheduled, or fire an operation that takes nothing and drop in` |
| X0n3 | same, at `settings/catchUp` | `catchUp: true` on a scheduled trigger while no startup step names `@schedule/scheduler.port.json#run` with a `lease`: no process can know what the last tick was | `give the run step a lease ({ "in": { "lease": "@connections/<store>.connection.json" } }), or drop catchUp` |
| X0n4 | same, at `startup/<i>/in/lease` (against `project.json`) | the `run` step's `lease` names no connection document (R001 would, for a graph; a startup step's `in` is typed by B007 as a string and no more), or one whose kind is not marked `storage` (RFC 0002's marker, read as X203 reads it) | `a lease lives in a storage engine's connection; wilanis ls connection` -- blocked on RFC 0002 |

The same `plugin.check` also judges the plugin's own settings the way `@http`'s judges its throttle
(`judgeThrottle` in `packages/plugin-http/src/rules.ts`): `leaseTtlMs` a whole number of 1000 or more, `timezone`
a known zone, each X0n1 against `project.json` at `plugins/<i>/settings/<name>`. C002 has already held the settings
to their declared types.

**What is not added, because it already holds or is deliberately absent.** A tree with scheduled triggers and no
`run` step is not a refusal, as a tree with routes and no `listen` is not: the tree schedules nothing, on purpose,
and `wilanis start` says so (*Runtime behaviour*). A scheduled trigger with `policies` is not refused as such:
A005 refuses a policy that reads the caller, and a policy that reads only the tick (a maintenance window, deciding
over `request.scheduled`) is a legitimate domain decision the gate runs like any other. The kind declares no
`refusals`, so T005 and T006 never run for it: there is no table because there is no caller to answer, and the log
line carries the reason.

### Runtime behaviour

**The parser** (`packages/plugin-schedule/src/cron.ts`, new). `parseCron(text): Cron | string` reads five fields
-- minute `0-59`, hour `0-23`, day-of-month `1-31`, month `1-12` or `jan..dec`, day-of-week `0-7` or `sun..sat`
with `7` as Sunday -- each `*`, a value, a list `1,15`, a range `1-5`, a step `*/15` or `1-30/5`, and answers the
matcher or the reason it is not one. The five standard macros (`@daily`, `@hourly`, …) are not accepted: X0n1's
hint spells the five-field form, so the parser stays one thing. Day-of-month and day-of-week combine as Vixie cron
does: when both are restricted, a day matching either fires. `nextTick(cron, after: Date, timezone): Date` answers
the first instant strictly after `after` the expression names, computing the wall clock in the zone with
`Intl.DateTimeFormat` and never with a dependency. Across a daylight-saving change: a wall-clock instant that does
not exist (the hour skipped in spring) fires at the first instant after the gap, once; one that occurs twice (the
hour repeated in autumn) fires at its first occurrence only. Both are stated here so that a test can pin them and a
reader is not left to guess.

**The scheduler** (`packages/plugin-schedule/src/scheduler.ts`, new): a class over a `Clock`
(`{ now(): number; wait(ms: number, signal: AbortSignal): Promise<void> }`, defaulting to `Date.now` and
`setTimeout`), so every test hands a fake and steps it, and no test sleeps. Its loop:

1. Read `serving.triggers('@schedule/schedule.trigger-kind.json')` afresh, so a reload is seen
   (`Served.serving()` in `packages/runtime/src/serve.ts` routes every member through `current`). For each trigger,
   the next tick: from `nextTick` for a `cron`, from `startedAt + n * everyMs` for an interval, `n` the first that
   lands after now. Interval ticks count from the moment the step ran, never aligned to the wall clock; cron ticks
   are wall clock.
2. Sleep until the earliest of them, or one minute, whichever is first, and go to 1. The minute is cron's own
   resolution and is what makes a trigger added or edited by a reload seen without the scheduler being told: a
   reload changes the set the next wake-up reads. `serving.reload` notifies no one, and this RFC adds no observer
   for it.
3. At a tick: if `lease` was given, `leases(env).for(kind).acquire(connection, triggerPath, leaseTtlMs)`; a process
   that does not hold it logs nothing and goes on (the holder fires). Then `overlap`: `skip` when a run of this
   trigger is in flight -- count it, log `→ skipped (previous run still going)`, go on; `wait` -- keep at most one
   tick waiting, fire it when the run ends, count any further tick as skipped; `concurrent` -- fire. The context is
   `{ scheduled, fired: now, missed }`; `serving.inputFor(trigger, request)` builds and judges the input (`fire.in`
   over the context, or `undefined` when the trigger declares no `in`; an `in` without `fire.in` is X0n2 and never
   reaches here); `serving.fire({ trigger, input, request, blobs })` with one blob scope per tick
   (`serving.blobs.scope()`), released when the run has answered, as `listen` opens one per request. The embedder's
   gate runs unchanged: with no `policies` it returns at once; with a tick-only policy the guard's `identify` sees no
   credentials and adds nothing, and the policy decides.
4. After the run: the log line, `schedule <trigger> <scheduled> → done (<ms>, <op>) <answer>` or
   `→ refused <reason> (…)` or `→ failed (…)`, through the kind's `encode`; the lease's `markFired(connection,
   triggerPath, scheduled)` when a lease is held, else an in-memory last-tick per trigger; the lease renewed while
   a run is in flight past `leaseTtlMs`, and released at stop.
5. `env.hold({ label: 'schedule', stop })`: `stop` aborts the sleep, takes no further tick, and resolves once every
   run in flight has answered. The runtime stops holds in reverse (`bye` in `start`), so `run` listed before `listen`
   drains after the socket closed. `run` answers `{ triggers, next }` and logs
   `schedule: N trigger(s) -- <path> at <cron> <zone>, next <iso>` per trigger, or
   `schedule: no scheduled trigger in the tree` when there is none.

**`missed`**, precisely. The last fired tick this scheduler knows of is the one it fired itself in this process,
or, with a lease, the one the store's `lastFired` records. `missed` on a tick is the number of ticks the expression
names strictly between that one and this one; without a lease and on the first tick after a start it is 0, since
nothing is known before the start. With `catchUp: true` and a lease, at start the scheduler compares `lastFired`
with the most recent past tick: when that tick is later, it fires once, immediately, with `scheduled` set to that
most recent past tick, `fired` now, and `missed` the ticks between the two. "Once, and say how many" is the stub's
assumption and is kept: a digest run three times at deploy is wrong, and an author who wants each missed tick
handled has `request.missed` to fan the work out from. Without `catchUp` a tick that fell while no process ran is
not fired, which is what cron does and what a tree without a store can do.

**Leases** (`packages/plugin-schedule/src/leases.ts`, new). `@schedule` speaks no store's language. The contract
and the table follow RFC 0002's `engines(env)` and RFC 0009's `brokers(env)` line for line:

```ts
/** What a storage engine does for the scheduler on one connection of the kind it registered; the connection is the canonical path. */
export interface Leases {
  /** Try to hold `name` until now + ttlMs: true when this process holds it, freshly or renewed; false when another holder's has not expired. */
  acquire(connection: string, name: string, ttlMs: number): Promise<boolean>;
  release(connection: string, name: string): Promise<void>;
  /** The tick last recorded as fired for `name`, ISO 8601, or nothing. */
  lastFired(connection: string, name: string): Promise<string | undefined>;
  markFired(connection: string, name: string, scheduled: string): Promise<void>;
}
/** The lease keepers registered for this tree, by the connection kind each grants; created on first use by whichever side reaches it. */
export function leases(env: Record<string, unknown>): { register(kind: string, keeper: Leases): void; for(kind: string): Leases | undefined };
```

A storage plugin registers from its `postLoad` -- `leases(ctx.env).register('@storage-postgres/postgres.connection-kind.json', tableLeases())`
-- and the table is a `WeakMap` keyed by `env` with a default, so plugin order in `project.json` cannot bite and a
reload starts clean, for the reasons RFC 0002 gives at length. The postgres engine keeps one table
`wilanis_schedule` -- `name` (text, primary key), `holder` (text), `held_until`, `last_fired` (timestamptz) --
created by the engine's `ensure`; `acquire` is one `INSERT … ON CONFLICT (name) DO UPDATE … WHERE held_until < now() OR holder = $me RETURNING holder`,
so two instances never both hold one name. This step is blocked on RFC 0002's implementation and marked so in the
plan. `@wilanis/plugin-storage-memory` needs no keeper: one process is alone. Where `lease` names a connection
whose kind registered no keeper, `run` throws before holding anything, naming the connection and the kind (X0n4
has judged the tree; this message is for a plugin that did not load), and a startup step that throws stops the
start (`runStartup`).

**The trigger kind's runtime** (`packages/plugin-schedule/src/index.ts`): `TriggerRuntime.encode(trigger, report)`
answers the report's output, or `{ reason, message, ...detail }` for a refusal, as `@cli`'s does
(`packages/runtime/src/plugins/cli-trigger.ts`), so the log line and `wilanis run` say the same thing. Its `start`
answers a no-op teardown for the contract's sake and nothing more: the runtime does not call `TriggerRuntime.start`
today -- `serve.ts` reads `plugin.triggers` for `encode` alone (`encoded`, line 195) and `start()` runs `postLoad`
and the startup steps -- so the `run` step is where the work is, as RFC 0009's `consume` step is. That the hook is
uncalled is an observation this RFC records and does not act on.

**`rehearse`, `fuzz`, `regress`, `run --seed`.** A scheduled trigger is a trigger: `rehearse` walks it from
`load.registry.all('trigger')` (`packages/runtime/src/rehearse.ts`), `generatedFire` in `stubbing.ts` generates its
context from `scope.contextType(kind, settings)` -- a `scheduled` and a `fired` that are strings, a `missed` that is
a number -- and `inputFor` honours `fire.in`. The generated strings are not instants: a graph comparing
`request.scheduled` to a row's timestamp is walked down whichever branch the comparison takes, which is what a
rehearsal is for, and a scenario written by `fuzz` records the context it used. Nothing in these commands changes.
`wilanis run <scheduled trigger>` builds a command line's context (`requestOf` in `packages/runtime/src/serve.ts`:
`flags`, `args`, `cwd`, `body`, `file`), which hands no `scheduled`; a trigger whose `fire.in` reads it is refused
at the edge with the field named. Whether `wilanis run … --at 2026-09-11T03:00:00Z` should fill the context is left
to implementation, with a recommendation (*Open questions*).

**Traces (RFC 0006).** Every tick is one fire and one trace, rooted `fire <trigger path>`, with no `correlation`:
a tick has no incoming trace to continue. The scheduler's log line is the kind's answer, as a route's status is
the listener's; the trace's root carries the run's status. A skipped tick is a log line and no trace, since no run
began.

**Deadline (RFC 0012).** Once `FireArgs` carries `signal`, the scheduler arms an `AbortController` per tick from
`settings.deadlineMs` and passes it to `serving.fire`, as `answerFor` will for a route; a cancelled run is logged
`→ cancelled (deadline)`. A deadline is what makes `overlap: skip` safe against a hung run: without one, a run that
never ends makes every later tick a skip, and the description of `overlap` says so.

**Shutdown.** `stop` waits for runs in flight, as `listen`'s `server.close` waits for requests. RFC 0012's
shutdown signal, once it exists, is what cuts a run that will not end; this RFC does not add one.

### Discoverability

- `wilanis describe @schedule/scheduler.port.json#run` prints `granted by @schedule (@wilanis/plugin-schedule)` and
  `(holds until stopped)`, as `operationLine` in `packages/runtime/src/discovery.ts` prints for `listen` today.
- `wilanis describe <scheduled trigger>` prints the schedule as written -- `cron 0 3 * * * (UTC)` or `every 60000 ms`
  -- and `overlap`, `catchUp` and `deadlineMs` where set, the way it prints a route's settings. It prints no next
  tick: `describe` is a pure reading of the tree and does not consult a clock; `start` logs the next tick.
- `wilanis map` prints a scheduled trigger the way it prints a route:
  `schedule 0 3 * * * UTC → @monitor/edge/nightly-digest.trigger.json → monitor.port.json#digest → …`.
- `wilanis start` logs each scheduled trigger and its next tick at the `run` step, and one line per tick.
- The viewer's trigger page (`renderDocPage`, `case 'trigger'` in `packages/view/client/index.html`) shows the
  schedule in the chain's `fired by` step -- `@schedule/schedule.trigger-kind.json, at 0 3 * * * UTC` -- and the
  settings as it shows a route's. No new page: a scheduled trigger is an existing kind.
- RFC 0026's manifest gains its `scheduled` rows from these triggers -- `{ trigger, cron | everyMs, timezone,
  fires }` -- and lists `@schedule/scheduler.port.json#run` under `holds`. That RFC owns the shape; this one gives it
  the facts.

### Plugin contract

`PluginModule` in `packages/core/src/plugin.ts` does not change; neither does `Serving`, `FireArgs`,
`TriggerRuntime`, `Hold` or `Guard`. The scheduler reaches the runtime through `env.serving` and `env.hold` inside a
`holds` operation the project's startup list names, as the listener, the watcher and RFC 0009's worker do. A storage
engine reaches `@schedule` through a table `@schedule` exports and the engine fills from `postLoad`, as an engine
reaches `@storage` and a broker reaches `@queue`. The guard is not consulted, changed or told.

## Compatibility

IR v1, unaffected. No schema changes: a scheduled trigger is a `trigger` document with settings its kind declares,
and the kind, the port and the plugin manifest are documents under the new plugin's `docs/`. Every document written
before this RFC validates and means what it meant. `@wilanis/plugin-schedule` is new and optional. This is one of
the accepted RFCs that does not change a schema, and it does not move the 1.0 freeze (RFC 0008).

## Tests

Sabotage tests in `packages/runtime/test/sabotage.test.ts` and `sabotage-project.test.ts`, through `sabotage` and
`codes` in `example-harness.ts` once the example carries `nightly-digest.trigger.json` and `PLUGINS` there names
`@schedule` beside `@http`, `@blob`, `@reload` and `@auth`:

| Code | The edit |
|---|---|
| X0n1 | `settings.cron: "0 3 * * * *"` (six fields); `"61 3 * * *"`; `"0 3 * * mon-fry"`; `"@daily"`; both `cron` and `everyMs: 60000`; neither; `everyMs: 500`; `everyMs: 60000` with `timezone: "UTC"`; `timezone: "Mars/Olympus"`; `deadlineMs: 0`; the plugin's `settings.leaseTtlMs: 10` |
| X0n2 | `in: "@monitor/edge/ListRequest.shape.json"` with no `fire.in` |
| X0n3 | `settings.catchUp: true` with the example's `run` step as written (no `lease`) |
| X0n4 | blocked on RFC 0002: `startup[2].in.lease: "@connections/monitor-api.connection.json"` (an http kind, not `storage`); `"@connections/nope.connection.json"` |
| T001 | `settings.overlap: "sometimes"`; `settings.cron: 3` |
| T003 | `fire.in: { "before": "{{request.body.since}}" }` after adding `in` -- the kind hands no `body` |
| T004 | `fire.run: "@monitor/domain/monitor.port.json#submit"` with `fire.in: { "url": "https://x.example/", "method": "GET" }` and the matching `in`: `record-entry.graph.json` reaches `create-row.graph.json`, which reads the `agent` resolver (`request.headers['user-agent']`), and the schedule kind hands no `headers` |
| A005 | `policies: ["@access/edge/can-record.policy.json"]` -- reads the caller, given nothing |
| L008 | a data graph node running `@schedule/scheduler.port.json#run` |
| B006 | a startup step naming `@schedule/schedule.trigger-kind.json#run` (not an operation) |
| D008 | `relocate` the scheduled trigger to `domain/` |
| none | the example as written: `codes(EXAMPLE)` is empty; `rehearse` walks the scheduled trigger as one whole run (no switch under `digest`), and the count of settled graphs grows by exactly one |

Unit tests in `packages/plugin-schedule/test/`, no clock and no sleep:

| What | Asserts |
|---|---|
| `parseCron` | every field form parses (`*`, value, list, range, step, names, `7` as Sunday); the reason for six fields, `61`, `fry`, `@daily`, an empty field |
| `nextTick` | a table of (expression, zone, after) → next, including: `0 3 * * *` in `Europe/Lisbon` across the spring change (03:00 on the day the clock skips 01:00→02:00 still fires at 03:00 local; `30 1 * * *` on that day fires at the first instant after the gap, once) and the autumn change (`30 1 * * *` fires at the first 01:30 only); `0 0 31 * *` skips months without a 31st; `0 0 1 * 1` fires on the 1st and on Mondays; `*/15 * * * *` from 10:07 → 10:15 |
| the scheduler over a fake clock | a `cron` trigger fires at its tick with `scheduled` the tick and `fired` the clock's now; an `everyMs: 60000` trigger fires at start + 60 s, + 120 s, counted from the step, not aligned |
| `overlap` | a run that takes three intervals: `skip` fires ticks 1 and 4 with `missed` 2 on the fourth; `wait` fires 1 then 2 as soon as 1 ends, ticks 3 skipped, 4 fired with `missed` 1; `concurrent` fires all four |
| `missed` and `catchUp` | without a lease: first tick after start has `missed` 0; with a fake `Leases` whose `lastFired` is three ticks back and `catchUp: true`: one immediate fire, `scheduled` the most recent past tick, `missed` 2; `catchUp` absent: no immediate fire |
| a lease decides who fires | two schedulers over one fake `Leases`: each tick is fired by exactly one; the holder's lease is renewed past `leaseTtlMs` while its run is in flight; the other takes over once the holder's expires |
| a reload is seen | `serving.triggers` answers a new set after the fake clock passes a minute; the new trigger's tick fires; the removed one's does not |
| stop drains | `stop()` during a run resolves after that run's outcome; no tick fires after `stop()` began |
| the gate runs on a tick | a tick-only policy (its decision reads `request.scheduled`) allows on one instant and refuses on another, and the refusal is logged with its reason; `can-record` attached is A005 at check, never reached |
| an answer is judged | `out` declared and the operation answering something else: the run is `failed` at `out`, logged |
| no keeper registered | `lease` naming a kind no plugin registered: `run` throws naming the connection and the kind; `start` stops |
| `encode` | a report refusing `missing` answers `{ reason: 'missing', message }`; a `done` report answers its output |
| rules | one sabotage per X rule against a small tree, as `packages/plugin-auth/test` does for X101 to X103 |

End to end, in `packages/plugin-schedule/test/start.test.ts`, one real second: a small tree with `everyMs: 1000`
and the `run` step, served through `start` from `@wilanis/runtime` (a devDependency for tests only, as the http
tests do in `packages/plugin-http/test/harness.ts`): the operation ran once within two seconds, the log carries the
tick line, `stop` resolves. Postgres, in `packages/plugin-storage-postgres/test/leases.test.ts` behind
`WILANIS_TEST_POSTGRES_URL` (blocked on RFC 0002): two `acquire`s of one name, one holder; an expired hold is taken
over; `markFired` then `lastFired` round-trips. Discoverability, in `packages/runtime/test/tools.test.ts`: `describe`
of the scheduled trigger prints the schedule; `map` prints the schedule line. View, in `packages/view/test`: the
example's scheduled trigger page.

## Implementation plan

1. **`@wilanis/plugin-schedule`** (`area:plugin-schedule`, new label): the package, `docs/` (plugin.json,
   scheduler.port.json, schedule.trigger-kind.json without `deadlineMs`), `cron.ts` with its table tests,
   `scheduler.ts` over a `Clock`, `leases.ts` with the contract and the table, `run.ts` (the handler), `rules.ts` with
   X0n1 to X0n3, the trigger runtime, a README saying what a lease keeper implements. Workspace member; added to
   `npm run release` after `plugin-auth`. The parser and its tests can be taken first and alone: `good first issue`.
2. **The example** (`area:runtime`): `nightly-digest.trigger.json`, the plugin and the `run` step in `project.json`,
   `example/README.md`'s paragraph; `PLUGINS` in `example-harness.ts`; the sabotage tests above.
3. **Discoverability** (`area:runtime`, `area:view`): `describe`, `map`, the template's rows and X list, the
   `wilanis new trigger --kind` scaffold, the viewer's trigger page and view model. `good first issue`.
4. **`deadlineMs`** on the kind and the `AbortController` per tick: blocked on RFC 0012's `FireArgs.signal`.
5. **Leases in the storage engine** (`area:plugin-storage`): `wilanis_schedule` in `ensure`, `tableLeases()`
   registered from `postLoad`, the postgres test behind the environment variable, X0n4, and the example's `lease`
   under its storage profile. Blocked on RFC 0002's implementation.
6. **A process that runs only the schedule** (`area:runtime`): blocked on RFC 0013. See *Drawbacks*, first item.
7. **`wilanis run --at`**: decided during implementation (*Open questions*); one small pull request either way.
8. **README**: a paragraph beside "Every branch runs before you deploy" on the clock as a way in, and the roadmap's
   M08 row updated with the example's nightly digest.

## Drawbacks and alternatives

**One process schedules, listens and works; two processes need RFC 0013.** As RFC 0009 found for its worker, a
profile is a set of bindings and nothing else (`project.schema.json → profiles` has `bindings`; `runStartup` reads
the one `project.doc.startup` for every profile), so every process that runs the tree runs every step. Two
instances of the example behind a load balancer both run `run`, and without a `lease` both fire the digest at
03:00. This RFC gives the honest answers in order: one instance, or the `lease` on the storage engine (step 5), or
a startup list per profile once RFC 0013 says how, so that one process schedules and the others only listen. It
adds no second way to say it. The manifest (RFC 0026) prints the scheduled triggers per profile so a reviewer sees
what fires where.

**A package, not a plugin built into the runtime.** The stub put the kind beside `@std` and `@cli` because it
carries no external dependency. Three facts moved it. The lease contract must be importable by a storage engine,
and a plugin never imports the runtime (`CLAUDE.md`; `fitness/dependencies-point-one-way.fitness.ts`), so a
contract in the runtime could not be met by `@wilanis/plugin-storage-postgres`; in its own package it can, as
`@wilanis/plugin-queue-memory` depends on `@wilanis/plugin-queue`. `@std` and `@cli` are built in because the
toolchain itself uses them -- `wilanis run` is the cli kind -- and nothing in the toolchain fires a schedule.
And `@reload` has no external dependency either and is its own package: "no dependency" was never the rule for
being built in. The cost is one more package, README and release entry.

**Time is an input, and the graph cannot compute with it.** A graph gets `request.scheduled` as an ISO string
and can compare it, pass it to an effect, and write it; it cannot subtract a day from it, because the expression
language has no dates and this RFC adds none. The alternative -- handing `request.scheduled` also as epoch
milliseconds, or adding date arithmetic to `expr/` -- was not taken: the first is a second spelling of one fact,
and the second is a language change no other RFC asks for. An operation that needs "the tick minus a day" takes
`before` and is bound to a data graph whose native operation does the arithmetic; today that is a `@std` gap an
author would meet in a route just the same, and it is not this RFC's to fill.

**`skip` by default, and `once, and say how many`.** A tick that finds the previous run going could queue behind
it; a service that falls behind would then run continuously, each run answering a stale tick, which is worse than
the gap. `skip` is what cron does (it simply starts another, which is `concurrent`; `skip` is the safer reading of
"the job is still running") and `request.missed` makes the gap visible to the graph. Firing each missed tick after
downtime was rejected for the same reason; `catchUp` fires once, as `anacron` does, and only when a store remembers
the last tick, because a scheduler that cannot know what it missed should not pretend to.

**A wall clock in a plugin.** The scheduler is the one place in the workspace that waits on time on purpose, beside
RFC 0011's retry backoff and RFC 0012's deadline. The engine stays clockless (RFC 0006's `clock` on `RunOptions`
is a stamp, not a wait), and rehearsal never reaches the scheduler: `rehearse` fires the trigger with a generated
context and the `run` step is never run by `check`, `rehearse` or `run`.

**Its own cron parser.** A dependency (`croner`, `cron-parser`) would parse more dialects and carry its own zone
handling; it would also make the plugin's `check` depend on a package's idea of validity, and put a supply chain
behind a minute matcher. The parser here accepts the five-field form and nothing else, on purpose; a dialect an
author wants is an edit to `cron.ts` with a table test.

**Cost.** One package, one README, one entry in `npm run release`; one table in the storage engine when step 5
lands. The scheduler holds one timer and one blob scope per tick in flight. Nothing is buffered.

## Open questions

Settled here, with the reasoning in the text: **overlap** is a setting, `skip` | `wait` | `concurrent`, default
`skip`, judged by T001 through its enum, and `request.missed` counts what `skip` dropped (*Runtime behaviour*;
*Drawbacks*, third item). **Missed ticks after downtime** are fired once with `request.missed` saying how many, and
only when `catchUp` says so and a lease store remembers the last tick (X0n3); without one, they are not fired, which
is what cron does. **Multiple instances** are decided by a lease in the storage engine's connection, named by the
`run` step's `lease`, through a contract `@schedule` exports and the engine fills from `postLoad` as RFC 0002's
`engines(env)` and RFC 0009's `brokers(env)` are; this makes the *lease step* depend on RFC 0002 and leaves the RFC
itself with no dependency to accept (*Runtime behaviour*, *Leases*; *Drawbacks*, first item). **Where the kind
lives** is its own package, for the reasons under *Drawbacks*, second item.

Nothing else must be decided before `accepted`. Decided during implementation:

1. Whether `wilanis run <scheduled trigger> --at 2026-09-11T03:00:00Z` fills `request.scheduled` (and `fired` as
   now, `missed` as 0), so a scheduled trigger can be fired by hand against a real tree. The runtime must not learn
   the kind's vocabulary, so this is either an optional `TriggerRuntime.requestOf?(given)` hook -- the one contract
   change this RFC would make, and the recommendation, since RFC 0009's queue kind asked the same question of
   `--in` -- or nothing, with `wilanis run` refusing at the edge as it does today. Whichever lands answers both
   RFCs' question in one place.
2. The exact log lines, and whether the tick line prints the answer whole, its first line, or nothing beyond the
   status.
3. Whether the memory lease keeper (`@wilanis/plugin-storage-memory`) registers a `Leases` that always grants, so a
   tree written for a storage profile checks and runs under the memory profile with `lease` and `catchUp` set --
   X0n3 and X0n4 would then hold under both profiles -- or whether `lease` is simply absent under the memory profile.
4. Whether `nextTick` honours `L` and `W` (last day, nearest weekday) or the parser stays at the five standard field
   forms.
