# RFC 0013: A deployment model: profiles, environments and what a tree needs to run

- **Status:** accepted
- **Areas:** `area:core` (three additive keys on `project.schema.json`; `ProjectDoc`; `Scope.connectionFor`),
  `area:compiler` (`reach.ts`, the walk from a profile to what it reaches; four rules in `check/project.ts`),
  `area:runtime` (the active profile, what `start` verifies and in which order, `describe`), `area:view` (the
  project page). Nothing in the engine, nothing in a plugin.
- **Schemas:** `project.schema.json` gains `profiles.<name>.default`, `profiles.<name>.connections` and
  `startup[].profiles` (additive)
- **Packages:** none new
- **Tracking issue:** #15
- **Depends on:** RFC 0005 (a port a plugin requires is a domain port the profile binds; the guard's reach is
  read off the plugin manifest's `requires.ports`). RFC 0016 builds on this RFC and not the other way round:
  `permits` is the third of the three lists named below, and this RFC defines the middle one.

## Summary

After this RFC a profile is the whole statement of one place a tree runs: which binding meets each domain
port (today), which connection stands in for each connection there, which startup steps run there, and which
profile the laptop gets when nobody names one. From those choices the compiler derives **the reach** of the
profile -- every effectful native operation the tree runs under it, every connection those name, every
secret those read, and every `holds` it starts -- as one pure function, `reachOf`, that `wilanis start`,
`describe`, RFC 0016's rule and RFC 0026's manifest all read. `wilanis start` picks the profile by a fixed
precedence, refuses a tree that declares profiles and names none, and refuses before any plugin's `postLoad`
when a variable the reach needs is not set, naming the variables. A deployable unit is the tree and its
`node_modules`, started by one command; nothing is built.

## Motivation

The tree has the pieces of a deployment model and not the contract between them. Five things go wrong today,
each visible in the code:

- **`start` can run a profile the checker never judged.** The checker judges every declared profile and,
  when none is declared, the one unnamed profile (`Judge.profiles()` in `check/judge.ts`). `wilanis start`
  without `--profile` runs the unnamed profile whether or not profiles are declared (`embedderFor(load,
  { profile: undefined })` in `serve.ts`; `Scope.bindingFor(port, undefined)` in `scope.ts` then takes a
  port's one and only binding). Give `monitor.port.json` a second binding and choose it in `live`: `wilanis
  check example` passes, and `wilanis start example` fails at startup step 1 with `port ... has 2 bindings --
  choose one in a project profile`, a run-time error for something the tree declared.
- **A secret is demanded everywhere it is declared, not where it is read.** `buildEnv` in
  `packages/compiler/src/env.ts` substitutes every connection's settings and notes every missing variable;
  `start` refuses on the whole list. A connection only a development binding reaches costs production a
  variable it never uses, and nothing says which connection wanted it.
- **Startup is one list for every profile.** RFC 0009 (a worker that consumes and does not listen) and
  RFC 0010 (one instance that schedules while the others only listen) both stopped at `runStartup` reading
  the one `project.doc.startup`, and both wrote "a startup list per profile once RFC 0013 says how".
- **A connection that differs by place is a duplicated binding.** A profile swaps bindings and nothing
  else, so a base URL, a pool size or an endpoint that differs between staging and production means a second
  connection *and* a second binding to name it (RFC 0002, *Drawbacks*; RFC 0022 leaves "swapping a connection
  per profile" to this RFC). The alternative in use, `"baseUrl": "{{secrets.monitorBase}}"`, makes a URL a
  secret, and the trace then redacts the one thing an operator wants to read.
- **"What a tree needs to run" has no name.** The compiler already walks from an operation through the
  profile's binding to the graphs it reaches, once, for one payload: `opNeeds` in `check/resolvers.ts`, the
  request reads a startup step may not have (B008). RFC 0003's X210 wants the same walk for another payload
  (which startup step reaches `ensure`), RFC 0009 names "the per-profile walk", RFC 0026 prints its result
  (`effects`, `requires`, `secrets`), RFC 0016 compares it with `permits`. Each RFC assumed another supplied
  it; none did. `feature.json → effects` is not it: L003 judges what a feature *allows* its data layer to
  reach, an upper bound that is the same under every profile.

This RFC does not build the image or the chart (RFC 0024), does not fix the manifest's shape (RFC 0026), and
does not add `permits` (RFC 0016). It does not let a profile swap a connection's *kind*: memory in one place
and PostgreSQL in another stays what RFC 0002 and RFC 0005 made it, two bindings the profile chooses between,
and *Drawbacks* says what the other choice would cost.

## Guide-level explanation

**The words.** A *profile* is one place a tree runs, named in `project.json → profiles`: a laptop, a staging
cluster, production, a worker pool beside production. The *active profile* is the one this process runs
under. The *reach* of a profile is what the tree does there, derived from its documents: the effectful
native operations it runs, the connections those operations name, the secrets those connections and the
plugins read, and what it holds open. Three lists, then, at three altitudes:

| List | Written by | Where | Same under every profile? | Judged by |
|---|---|---|---|---|
| what a feature **allows** its data layer | the feature's author | `feature.json → effects` | yes | L003, today |
| what the tree **reaches** | nobody: derived | `reachOf(scope, profile)` | no | this RFC: secrets at start; RFC 0016: against permits |
| what a place **permits** | the environment's author | `profiles.<name>.permits` | no | RFC 0016 |

The first and the third are allow-lists a person writes; the middle one is what the tree does, and the
checker holds it to both.

**The unit.** A tree is deployed as its documents plus its `node_modules`, which hold the plugins and the
includes `project.json` names, and nothing else: no build output, since documents are what runs. One command
starts it, `wilanis start <root> --profile <name>`, and what the process does there is what the profile says.

**The example, after this RFC.** `example/project.json` declares two profiles. `live` is the laptop and the
default; `production` is the same tree against the real monitor API, with no file watcher:

```json
"profiles": {
  "live": {
    "description": "The laptop: the public test API, the directories written in connections/, and a reload on every saved document.",
    "default": true,
    "bindings": {
      "@monitor/domain/monitor.port.json": "@monitor/data/monitor-rest.binding.json",
      "@access/domain/identity.port.json": "@features/directories/data/identity.binding.json"
    }
  },
  "production": {
    "description": "Behind the load balancer: the same bindings, the real monitor API in place of the test one, nothing watched.",
    "bindings": {
      "@monitor/domain/monitor.port.json": "@monitor/data/monitor-rest.binding.json",
      "@access/domain/identity.port.json": "@features/directories/data/identity.binding.json"
    },
    "connections": {
      "@connections/monitor-api.connection.json": "@connections/monitor-api-production.connection.json"
    }
  }
}
```

`connections` reads like `bindings`: on the left a connection the documents name, on the right the one that
stands in for it under this profile. The stand-in is an ordinary document under `connections/`, of the same
kind, with its own description and its own settings:

```json
{
  "$schema": "@wilanis/connection.schema.json",
  "label": "Monitor API (production)",
  "description": "The monitor's real REST API. Same routes as the test API; authenticated with a key the environment supplies.",
  "kind": "@http/http.connection-kind.json",
  "settings": {
    "baseUrl": "https://monitor.internal/api/v1",
    "timeoutMs": 5000,
    "headers": { "x-api-key": "{{secrets.monitorKey}}" },
    "throttle": { "concurrency": 16 }
  }
}
```

Not one document under `features/` changes: every data graph still says `"connection":
"@connections/monitor-api.connection.json"`, and under `production` that name reaches the stand-in. The
secret it reads is declared once, beside the one the tokens already read:

```json
"secrets": { "jwt": "MONITOR_JWT_SECRET", "monitorKey": "MONITOR_API_KEY" }
```

The watcher is a startup step, and a step may say which profiles run it:

```json
"startup": [
  { "label": "Reach the entry store", "run": "@monitor/domain/monitor.port.json#listAll", "required": true },
  { "label": "Watch for changes", "run": "@reload/watch.port.json#watch", "profiles": ["live"] },
  { "label": "Listen", "run": "@http/server.port.json#listen" }
]
```

A step without `profiles` runs under every profile. The list stays one list, in one order, so `Listen` is
last everywhere and a reader sees at the root what each place starts. RFC 0009's worker is a profile whose
`consume` step names it and whose `listen` step does not.

**Which profile runs.** In order: `--profile <name>` on the command line; else the environment variable
`WILANIS_PROFILE`; else the one profile marked `"default": true`; else, when the project declares no
profiles, the unnamed profile of today (every port has one binding, every step runs); else the start is
refused:

```
$ npx wilanis start example --profile staging
no profile 'staging'; project.json declares: live (default), production
$ WILANIS_PROFILE= npx wilanis start example         # with default removed from live
which profile? project.json declares live, production and marks none default
→ wilanis start example --profile <name>, or set WILANIS_PROFILE, or mark one profile "default": true
```

`wilanis check` takes no profile: it judges every profile the tree declares, so a refusal that would show in
production shows on the laptop. The `--profile` flag its usage line advertises today does nothing and goes.

**What `start` verifies, in order.** Load and judge, as today. Pick the profile. Compute its reach and refuse
when a variable it needs is not set -- before any plugin's `postLoad`, so nothing has opened a socket or a
pool when the message prints:

```
$ npx wilanis start example --profile production
profile production
missing secrets: MONITOR_API_KEY (monitorKey, read by @connections/monitor-api-production.connection.json),
  MONITOR_JWT_SECRET (jwt, read by @auth settings); nothing is serving
```

Variables are named, values never. Then `postLoad`, then the profile's startup steps in order, then nothing:
what listens is what the steps said (unchanged). A stubbed run -- `rehearse`, `fuzz`, `regress`, `run --seed`
-- picks its profile by the same precedence, so the bindings it stubs are the ones the place would run, and
needs no variable, as today.

**Seeing it.** `wilanis describe project.json` prints one block per profile:

```
profile production
  binds     @monitor/domain/monitor.port.json  → @monitor/data/monitor-rest.binding.json
            @access/domain/identity.port.json  → @features/directories/data/identity.binding.json
  stands in @connections/monitor-api.connection.json  → @connections/monitor-api-production.connection.json
  reaches   @http/http.port.json#request       via @connections/monitor-api-production.connection.json
            @auth/identity.port.json#verify    via @connections/employees.connection.json, @connections/customers.connection.json
            @auth/token.port.json#issue, #refresh
            @blob/csv.port.json#parse, #write
  holds     @http/server.port.json#listen
  starts    Reach the entry store · Listen
  needs     MONITOR_API_KEY (monitorKey) · MONITOR_JWT_SECRET (jwt)
```

## Reference

### Documents and schemas

`project.schema.json`, three additive keys, mirrored on `ProjectDoc` in `packages/core/src/model.ts`:

- `profiles.<name>.default` (boolean, optional): the profile a start with no `--profile` and no
  `WILANIS_PROFILE` runs under. At most one profile carries it (C0nn).
- `profiles.<name>.connections` (object, optional): connection path → connection path. Under this profile
  every reference to the left-hand connection -- a data graph's `in.connection`, a store's `connection`
  (RFC 0002), `blobs.connection` (RFC 0005), a trigger's connection (RFC 0009) -- reaches the right-hand one.
  Both are connection documents of the tree (R001), the right-hand one is a different document of the same
  `kind` (C0nn), and the mapping is one step: a stand-in that is itself a key is not followed.
- `startup[].profiles` (array of profile names, optional, `minItems: 1`): the profiles this step runs under;
  absent, every profile. Every name is a declared profile (B0nn).

`Scope` in `packages/core/src/scope.ts` gains `connectionFor(path, profile)`: the stand-in under the profile,
else the connection itself; the same shape as `bindingFor`. `HOME` in `placement.ts`: no change; a stand-in
is a connection under `connections/`. `packages/runtime/templates/CLAUDE.md`: the `project` row names the
three keys; a paragraph under *What the tree starts* says a step may name its profiles. `wilanis new project`
scaffolds its one profile with `"default": true`.

### Ports, operations and kinds granted

None.

### Checker rules

All in `check/project.ts`; numbers are assigned when the implementing pull request lands (current highest:
A006 B008 C008 D010 G013 L008 P003 R001 S001 T006, X103; RFC 0003 took C003-C008).

| Code | Where it lives | Refuses when | Hint |
|---|---|---|---|
| C0nn | `checkProfiles` | more than one profile has `default: true` | `one profile is the default; the others are named with --profile` |
| C0nn | `checkProfileConnections` | `profiles.<name>.connections` maps a connection to itself, or to a connection of another `kind` | `a stand-in is another connection of kind '<kind>'; to reach a different kind, bind the port to another binding` |
| R001 (existing) | `checkProfileConnections` | a key or value of `connections` names no connection document | `wilanis ls connection` |
| C0nn | `checkSecretsRead` | a key of `secrets` is read by nothing: no plugin's settings, no connection's settings, no startup step's `in` | `remove it from project.json → secrets, or read it as {{secrets.<key>}}` |
| B0nn | `checkStep` | a startup step's `profiles` names a profile the project does not declare | `name a declared profile: <list>` |
| B008 (existing) | `checkStepReads` | judged under the profiles a step runs under, not every profile | unchanged |

The rule that a secret is *present* is not a checker rule: the checker never reads the process environment.
It is what `start` verifies, below.

### Runtime behaviour

- **`reachOf(scope, profile): Reach`**, new, `packages/compiler/src/reach.ts`, exported by the compiler. Pure
  over the loaded tree. Its roots under a profile: every trigger's `fire.run`, every policy a trigger attaches
  (`decide.run`), every port a plugin `requires` (RFC 0005: the guard reaches its memory on every gated call),
  and every startup step that runs under the profile. From each root it walks as `opNeeds` walks today: a
  domain operation to the binding `bindingFor(port, profile)` chooses, a bound graph to its nodes, a
  delegation to the native operation it names, a nested domain call back through `bindingFor`. It records
  every native operation that is not `pure` (with the root and the binding it was reached through, for
  messages), every connection an `in` names (resolved through `connectionFor`), every `holds`, and every
  `{{secrets.*}}` read by a reached connection's settings, by any plugin's settings, or by a step's `in`.
  `opNeeds` becomes one reader of the same walk: one traversal, two payloads.
- **The active profile.** `activeProfile(project, given: { flag?: string; env: NodeJS.ProcessEnv })` in
  `packages/runtime/src/profile.ts` answers a name or `undefined` by the precedence above, and throws with the
  two messages shown when a name is unknown or none can be chosen. Every command that runs or stubs a tree
  calls it: `start`, `run`, `rehearse`, `fuzz`, `regress`. `check` does not. `embedderFor` receives the
  answer; nothing below it changes.
- **`buildEnv(scope, env, profile)`** in `env.ts` substitutes each connection's settings from
  `connectionFor(path, profile)`, keyed by the path the documents name: a handler asking `env.connections`
  for `@connections/monitor-api.connection.json` under `production` receives the stand-in's settings and
  never learns a stand-in exists. `Secrets.missing` stays what it is, every declared variable not set; the
  refusal is scoped by the reach.
- **`start`** in `serve.ts`: after `check`, `activeProfile`; log `profile <name>` (or `profile none declared`);
  `reachOf(scope, profile).secrets` minus the variables set → throw `missing secrets: VAR (key, read by
  <document or '@plugin settings'>), ...; nothing is serving`, before `postLoad`. Then `postLoad`, then
  `runStartup(load, emb, log, profile)` over the steps whose `profiles` is absent or names the profile,
  numbered `startup 1/2` over that subset. `Served.reload` (`@reload`) re-derives the reach of the same
  profile and refuses a reload the same way; a reload never changes profile.
- **Stubbed runs.** `rehearse`, `fuzz`, `regress` and `run --seed` take the profile from `activeProfile` and
  are otherwise unchanged: effects stubbed, no variable required, no `postLoad`.

### Discoverability

- `wilanis describe project.json` prints the block shown above per profile, from `reachOf`: `binds`,
  `stands in`, `reaches` (each operation with the connections it was reached with), `holds`, `starts`, `needs`.
  A profile marked default says `(default)` on its first line.
- `wilanis describe <connection>` prints `stands in for <path> under <profile>` when a profile names it on
  the right, and `replaced by <path> under <profile>` when on the left.
- `wilanis start` prints `profile <name>` as its first line.
- The viewer's project page (`renderDocPage` for `project` in `client/index.html`) shows the same block per
  profile, from the same function through `viewOf`.
- `wilanis map` is unchanged: it draws the tree's structure, which is the same under every profile.

### Plugin contract

None. A plugin never learns which profile is active, as a binding never learns which layer named it: the
profile chooses documents, and a handler sees the chosen connection's settings under the name the documents
use. A plugin that behaved differently by profile would be a document a reader cannot open.

## Compatibility

Three additive keys on `project.schema.json`; every project written before this RFC validates. Three
behaviours change, each from a silent gap to a refusal:

- A tree that declares profiles and is started with none named is refused, where today it runs the unnamed
  profile the checker never judged. `example/project.json` marks `live` default so `npx wilanis start
  example` in the README keeps working.
- `wilanis check --profile` is removed from the usage text; the flag never did anything.
- `start` refuses only the variables the profile's reach needs, where today it refuses every declared
  variable not set. A tree that set a variable for a connection its profile never reaches may drop it.

IR v1 unaffected: no lowered form carries a profile.

## Tests

Sabotage, in `packages/runtime/test/sabotage-project.test.ts` (copies of the example hand `@wilanis/access`
in as a `ResolvedInclude`):

- mark both `live` and `production` `default: true` → C0nn;
- map `monitor-api.connection.json` to `employees.connection.json` (another kind) → C0nn; to itself → C0nn;
  to `@connections/nowhere.connection.json` → R001;
- add `"unused": "UNUSED_SECRET"` to `secrets` → C0nn;
- give the `Listen` step `"profiles": ["staging"]` → B0nn;
- bind `monitor.port.json` under `production` to a binding whose graph reads `request.*`, and give the
  `listAll` step `"profiles": ["production"]` → B008 names `production` and no other profile.

The reach, in `packages/runtime/test/example.test.ts`: `reachOf` of the example under `live` holds
`@http/http.port.json#request` via `monitor-api.connection.json`, `@auth/identity.port.json#verify` via the two
directories, the `@auth/token` and `@blob/csv` operations, `listen` and `watch` (and, once RFC 0005 lands,
`@auth/files.port.json` through the state binding); under `production` the stand-in replaces
`monitor-api`, `watch` is absent, and `secrets` holds `jwt` and `monitorKey`.

Start, in `packages/runtime/test/startup.test.ts`, against a plugin whose `postLoad` records that it ran:

- profiles declared, no flag, no `WILANIS_PROFILE`, no default → throws naming both profiles; `postLoad` did
  not run;
- `WILANIS_PROFILE=production` → the log's first line is `profile production`; `--profile live` beside it wins;
- `production` with `MONITOR_API_KEY` unset → throws naming `MONITOR_API_KEY` and the stand-in, and not
  `MONITOR_JWT_SECRET` when that one is set; `postLoad` did not run;
- `production` with a variable set only for a connection `live` alone reaches → starts;
- `production` runs two steps and `live` three, by the log.

## Implementation plan

1. `reach.ts`: `reachOf` and the walk; `opNeeds` rewritten over it; the reach test of the example.
   (`area:compiler`)
2. The three schema keys, `ProjectDoc`, `Scope.connectionFor`, `buildEnv` per profile; C0nn ×3, B0nn, B008
   scoped; the sabotage tests. (`area:core`, `area:compiler`)
3. `activeProfile`; `start`, `run`, `rehearse`, `fuzz`, `regress` through it; the scoped secrets refusal
   before `postLoad`; `runStartup` per profile; `Served.reload`; the usage text; the start tests.
   (`area:runtime`)
4. The example: `production`, the stand-in connection, `monitorKey`, `watch` under `live`, `default` on `live`;
   `wilanis new project`; `templates/CLAUDE.md`; the README's *Try it* and startup paragraphs.
   (`area:runtime`; `good first issue` for the templates and README)
5. `describe project.json` and `describe <connection>`; the viewer's project page.
   (`area:runtime`, `area:view`; `good first issue`)

Step 1 is what RFC 0016 and RFC 0026 wait for; steps 2 to 5 may land in any order after it.

## Drawbacks and alternatives

- **A default profile in the tree.** The stub said the profile is chosen outside the tree. It still is, in
  production: the chart (RFC 0024) always names one. The default exists for the laptop, so the README's one
  command keeps working and a new tree needs no variable set before its first `start`. The alternative, no
  default and `WILANIS_PROFILE` in every shell, was rejected as a paper cut that would teach nobody anything.
- **Stand-in connections rather than settings per profile on the connection.** A `profiles` block inside a
  connection document was considered and rejected: a connection would then know the deployment concept, and
  "not one document changes between profiles" would be false of `connections/`. A stand-in is a whole
  document with its own description, which is what a reviewer of production wants to read. The cost is two
  files where one block would do.
- **Same kind only.** Letting a stand-in change the `kind` would make memory-in-development,
  PostgreSQL-in-production one profile line instead of two bindings, which is what RFC 0002 wished for. It
  would also make every rule that reads a connection's kind -- T001, RFC 0002's `storage` mark, RFC 0022's
  `capabilities`, RFC 0009's delivery guarantee, RFC 0004's atomicity -- a judgement per profile. The
  machinery exists (`Judge.profiles()`), so a later RFC may take it once the duplication has proved heavier
  than the rules; this one keeps a connection's kind a fact about the connection.
- **`profiles` on a step rather than a startup list per profile.** One list in one order keeps `Listen` last
  everywhere and shows at the root what every place starts; per-profile lists would repeat the common steps
  and let their order drift apart.
- **A profile per process role.** RFC 0009's worker and the web process of the same cluster are two profiles
  that repeat their `bindings` and `connections`. An `extends` between profiles was considered and set aside:
  one more indirection a reader follows, for a few repeated lines the manifest prints resolved anyway.
- **The reach is derived, so it cannot be reviewed in a diff.** That is the point of RFC 0016's `permits`: the
  reviewed list, held to the derived one. This RFC gives the derived one a name so that the other can exist.
- **The checker still judges every profile, so `check` grows with the profiles.** It already did for B002 and
  B008; the reach adds one walk per profile. A tree with many profiles pays in seconds, and gets a refusal on
  the laptop for a place it has not deployed to.

## Open questions

None before `accepted`.

**Settled here, so the reasoning survives.**

- **`default` stays.** One profile may carry `"default": true`, and it is what the laptop runs: the README's one
  command keeps working, a new tree needs no variable set before its first `start`, and production still names its
  profile, since the chart always does. Setting `WILANIS_PROFILE` in every shell was rejected as a paper cut that
  would teach nobody anything. *Drawbacks*, first item.
- **A stand-in may also be named directly.** A stand-in is an ordinary connection document: a data graph may name it
  as its `connection` and a profile may name it on the right of a `connections` entry, and neither use refuses the
  other. A rule that a stand-in is named nowhere else is cheap to add if a tree gets confusing, and is not added until
  one does.

**Left to implementation, deliberately:** the exact wording of `describe project.json`, and whether `reaches` groups
by port or by connection; and whether `reachOf` walks a policy that no trigger attaches, which this RFC says it does
not, since the reach is what runs and an unattached policy runs nowhere.
