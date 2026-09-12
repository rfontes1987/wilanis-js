# RFC 0026: The application manifest

- **Status:** draft
- **Areas:** `area:runtime` (`manifest.ts`, the `manifest` command, `packages/runtime/schemas/manifest.schema.json`,
  the version a plugin and an include are resolved with), `area:core` (one optional field on `ResolvedInclude`),
  `area:view` (one endpoint and one link on the project page). Nothing in the engine, the compiler or a plugin.
- **Schemas:** `packages/runtime/schemas/manifest.schema.json` is new: the shape of a command's output, not of a
  document, beside RFC 0019's `diagnostics.schema.json`. No document schema changes.
- **Packages:** none new
- **Tracking issue:** #28
- **Depends on:** RFC 0013 (`reachOf`, and the profile as one place a tree runs: `default`, `connections`,
  `startup[].profiles`) for the per-profile half; RFC 0016 (`permits`) for one field of it; RFC 0019 for the
  stability promise the manifest takes as its own and the place a command's schema lives. RFC 0024 reads this RFC.
  RFC 0002, RFC 0007, RFC 0009, RFC 0010 and RFC 0031 each add a field when they land, and this RFC says how.

## Summary

After this RFC `wilanis manifest <root>` prints what a tree is, as one JSON document a machine reads and two runs
diff to nothing: every document with its kind and layer, the plugins and includes with their versions, every
trigger with the settings its kind declares and whether it is public, every port with its operations and who
fires or binds them, the policies, the connections with their settings as written, the declared secrets and the
startup list; and, per profile, what RFC 0013 derives -- the bindings chosen, the stand-ins, every effect reached
and the connections it is reached with, what is held, what starts, which variables are needed -- beside what
RFC 0016 has the profile permit. It is computed by one pure function over the loaded tree, `manifestOf`, that the
command, the viewer and RFC 0024's image recipe all read; it never reads the environment, the clock or a secret's
value; and its shape is a schema with the promise RFC 0019 made for `check --json`: fields added, never removed
or retyped, a `format` number that says which envelope this is.

## Motivation

The tree knows everything a provisioner, a reviewer or an agent asks before touching it, and says it to a person
only. `wilanis map` (`packages/runtime/src/discovery.ts:339-350`) walks every trigger to its policies, its port,
every binding of the port and the graphs behind them, and answers lines of text with no structure between the
walk and the print; it is profile-blind, printing every binding of a port rather than the one a profile chose
(`:325-336`), and never reaches a connection. `wilanis describe` prints one document in full, and for a project, a
binding, a connection or a feature prints the raw JSON (`:246`). `wilanis ls` sorts the files by kind and path
(`:22-27`). Nothing prints per profile, nothing prints JSON except `run`, and no command reads a `--json` flag
(`packages/runtime/src/cli.ts:42-61`).

Four readers want the same facts as data, and each would otherwise walk the tree itself:

- **RFC 0024's image and chart** want the Node version, the profile to start, the port `listen` opens, every
  variable a secret names, a health route (`0024:29-37`). Today that is a person reading `project.json` and the
  http plugin's port document.
- **RFC 0020's review** wants which triggers are public, which operations they fire, and what each profile
  reaches; RFC 0016's `permits` is the reviewed list, and the manifest is where the derived one is printed
  (`0016:266-268`).
- **An agent about to add to a tree** wants to know what exists: the routes, the ports, the connections, before
  it writes a document that duplicates one. The viewer answers this to a browser; nothing answers it to a
  process.
- **A cost or capacity estimate** wants the effects by connection and the stores, which RFC 0013's `reachOf`
  computes and prints as a `describe` block (`0013:185-199`) and nothing exports.

The discovery code walks every relation already; RFC 0013 adds the one walk that was missing, the reach of a
profile, as a pure function. The manifest is the structure those walks were printing without keeping, said once
and promised stable.

This RFC does not build the image or the chart (RFC 0024). It does not add a document kind, a rule or a runtime
behaviour: the manifest describes; it decides nothing. It does not embed the manifest in `check --json` (RFC
0019 says so, `:429-431`) or make `describe` print JSON. It does not print counts: "12 endpoints" is the reader's
to derive. It does not name a store, an invariant or a scheduled job until the RFC that adds the kind lands, and
says under *Compatibility* how each adds its field.

## Guide-level explanation

**The words.** The *manifest* is one JSON object describing one tree. The *envelope* is its outer shape: `format`,
`runtime`, `ir`, then the tree. The tree's *inventory* is what is the same under every profile -- documents,
plugins, includes, features, triggers, ports, policies, connections, secrets, startup. A *profile block* is what
RFC 0013 derives for one profile and what RFC 0016 has it permit. A *row* is one element of one of those arrays,
and every array is sorted by its first key, so a manifest is the same string however the tree was walked.

**The command.**

```
$ npx wilanis manifest example
{
  "format": 1,
  "runtime": "0.1.0",
  "ir": "v1",
  "name": "example",
  "root": "example",
  "plugins": [
    { "use": "@auth", "from": "@wilanis/plugin-auth", "version": "0.1.0", "guard": true },
    { "use": "@blob", "from": "@wilanis/plugin-blob", "version": "0.1.0", "guard": false },
    { "use": "@cli", "from": null, "version": "0.1.0", "guard": false },
    { "use": "@http", "from": "@wilanis/plugin-http", "version": "0.1.0", "guard": false },
    { "use": "@reload", "from": "@wilanis/plugin-reload", "version": "0.1.0", "guard": false },
    { "use": "@std", "from": null, "version": "0.1.0", "guard": false }
  ],
  "includes": [
    { "from": "@wilanis/access", "version": "0.1.0", "features": ["access"] }
  ],
  "features": [
    { "name": "access", "included": "@wilanis/access", "effects": ["@auth/identity.port.json#verify", "@auth/token.port.json#issue", "@auth/token.port.json#refresh"] },
    { "name": "directories", "included": null, "effects": [] },
    { "name": "hello", "included": null, "effects": [] },
    { "name": "monitor", "included": null, "effects": ["@blob/csv.port.json#parse", "@blob/csv.port.json#write", "@http/http.port.json#request"] }
  ],
  "documents": [
    { "path": "@features/monitor/edge/delete-entries.trigger.json", "kind": "trigger", "feature": "monitor", "layer": "edge", "included": null },
    ...
  ],
  "triggers": [
    {
      "path": "@features/monitor/edge/delete-entries.trigger.json",
      "kind": "@http/http.trigger-kind.json",
      "settings": { "method": "DELETE", "route": "/monitor" },
      "fires": "@monitor/domain/monitor.port.json#removeMany",
      "policies": ["@access/edge/employees-only.policy.json", "@access/edge/can-record.policy.json"],
      "public": false,
      "included": null
    },
    ...
  ],
  "ports": {
    "domain": [
      {
        "path": "@monitor/domain/monitor.port.json",
        "feature": "monitor",
        "operations": [
          { "name": "list", "firedBy": ["@features/monitor/edge/list-entries.trigger.json"], "public": true },
          { "name": "removeMany", "firedBy": ["@features/monitor/edge/delete-entries.trigger.json"], "public": false },
          ...
        ],
        "bindings": ["@monitor/data/monitor-rest.binding.json"]
      }
    ],
    "native": [
      {
        "path": "@http/http.port.json",
        "grantedBy": "@http",
        "operations": [{ "name": "request", "pure": false, "holds": false }]
      },
      {
        "path": "@http/server.port.json",
        "grantedBy": "@http",
        "operations": [{ "name": "listen", "pure": false, "holds": true }]
      }
    ]
  },
  "policies": [
    { "path": "@access/edge/employees-only.policy.json", "decides": "@access/domain/access.port.json#requireEmployee", "proves": ["request.principal", "request.session"], "gates": ["@features/monitor/edge/delete-entries.trigger.json", ...], "included": "@wilanis/access" }
  ],
  "connections": [
    { "path": "@connections/monitor-api.connection.json", "kind": "@http/http.connection-kind.json", "settings": { "baseUrl": "https://6aa009e23e0d88d3d7e5525d.mockapi.io/api/v1", "throttle": { "concurrency": 4 }, "timeoutMs": 10000 }, "secrets": [] },
    { "path": "@connections/monitor-api-production.connection.json", "kind": "@http/http.connection-kind.json", "settings": { "baseUrl": "https://monitor.internal/api/v1", "headers": { "x-api-key": "{{secrets.monitorKey}}" }, "timeoutMs": 5000 }, "secrets": ["monitorKey"] }
  ],
  "secrets": { "jwt": "MONITOR_JWT_SECRET", "monitorKey": "MONITOR_API_KEY" },
  "startup": [
    { "label": "Reach the entry store", "run": "@monitor/domain/monitor.port.json#listAll", "required": true, "profiles": null },
    { "label": "Watch for changes", "run": "@reload/watch.port.json#watch", "required": true, "profiles": ["live"] },
    { "label": "Listen", "run": "@http/server.port.json#listen", "required": true, "profiles": null }
  ],
  "profiles": {
    "live": {
      "default": true,
      "description": "The laptop: ...",
      "bindings": { "@access/domain/identity.port.json": "@features/directories/data/identity.binding.json", "@monitor/domain/monitor.port.json": "@monitor/data/monitor-rest.binding.json" },
      "connections": {},
      "reaches": [
        { "operation": "@auth/identity.port.json#verify", "via": ["@connections/customers.connection.json", "@connections/employees.connection.json"] },
        { "operation": "@http/http.port.json#request", "via": ["@connections/monitor-api.connection.json"] },
        ...
      ],
      "holds": ["@http/server.port.json#listen", "@reload/watch.port.json#watch"],
      "starts": ["Reach the entry store", "Watch for changes", "Listen"],
      "needs": [{ "variable": "MONITOR_JWT_SECRET", "key": "jwt", "readBy": ["@auth settings"] }],
      "permits": null
    },
    "production": {
      "default": false,
      ...
      "connections": { "@connections/monitor-api.connection.json": "@connections/monitor-api-production.connection.json" },
      "reaches": [
        { "operation": "@http/http.port.json#request", "via": ["@connections/monitor-api-production.connection.json"] },
        ...
      ],
      "holds": ["@http/server.port.json#listen"],
      "starts": ["Reach the entry store", "Listen"],
      "needs": [
        { "variable": "MONITOR_API_KEY", "key": "monitorKey", "readBy": ["@connections/monitor-api-production.connection.json"] },
        { "variable": "MONITOR_JWT_SECRET", "key": "jwt", "readBy": ["@auth settings"] }
      ],
      "permits": ["@auth/identity.port.json#verify", "@auth/token.port.json", "@blob/csv.port.json", "@connections/customers.connection.json", "@connections/employees.connection.json", "@connections/monitor-api-production.connection.json", "@http/http.port.json#request", "@http/server.port.json#listen"]
    }
  }
}
```

The example is the one RFC 0013 and RFC 0016 leave behind. Three things to notice. A trigger's `settings` are
printed as its document wrote them: the route and method of an http trigger, the queue and broker of RFC 0009's,
the cron of RFC 0010's are each the kind's own settings, declared in the kind's schema, so the manifest does not
restate their shape; a reader groups triggers by `kind`. A connection's `settings` are printed as written too:
`{{secrets.monitorKey}}` stays the template text, the value never appears, and `secrets` beside it lists the
keys it reads. Under a profile, `reaches` is RFC 0013's reach, with a stand-in where the profile chose one, and
`permits` is RFC 0016's list or `null` when the profile permits everything.

**One profile.** `wilanis manifest example --profile production` prints the same document with `profiles`
holding that one block, which is what RFC 0024's image reads for one deployment. An unknown name is refused
with RFC 0013's message, `no profile 'staging'; project.json declares: live (default), production`. Without the
flag every profile is printed; `WILANIS_PROFILE` is not consulted, because the manifest describes the tree and
not the process.

**A tree that does not pass.** `manifest` loads and checks first, as `start` does; a tree with refusals prints
them as `check` does and exits 1 with no manifest, because the reach of a tree with an unresolved reference
means nothing. A tree with no declared profile has one block, `profiles: { "": {...} }`, the unnamed profile of
RFC 0013.

**What a reader does with it.**

```
$ npx wilanis manifest example --profile production | jq '.triggers[] | select(.public and .settings.route) | .settings.route'
"/monitor"
"/monitor.csv"
"/monitor/{id}"
$ npx wilanis manifest example --profile production | jq '.profiles.production.needs[].variable'
"MONITOR_API_KEY"
"MONITOR_JWT_SECRET"
$ npx wilanis manifest example > before.json; # edit; npx wilanis manifest example | diff before.json -
```

The last line is the point of the sorting: a diff of two manifests is a diff of what the tree does.

**In the viewer.** The project page gains one link, *manifest*, that opens `/api/manifest` -- the same JSON from
the same function, one profile when the page's profile selector (RFC 0013) has one chosen. The viewer shows the
document as JSON because JSON is what it is: a machine's document a person may read, not a document of the tree
the viewer renders as a page.

## Reference

### Documents and schemas

No document kind or field changes. `ResolvedInclude` in `packages/core/src/load.ts:28-32` gains `version?:
string`, filled by `resolveIncludes` in `packages/runtime/src/project.ts:105-117` from the package's
`package.json`, which it already resolves (`:146`); a document marked `included` keeps recording the package name
alone (`documents.ts:79`), and the manifest joins the two. The runtime's plugin resolution
(`packages/runtime/src/project.ts:31-47`) records the version beside `from` the same way; a plugin `@wilanis/runtime`
ships (`@std`, `@cli`) reports the runtime's own version.

`packages/runtime/schemas/manifest.schema.json` (`$id` under the same published base as RFC 0019's
`diagnostics.schema.json`; `title` `manifest`): the envelope and every row, each property with a description,
`additionalProperties: false` on the envelope, so that a field added later is a schema change a reader can see.
It is not under `packages/core/schemas/`, whose baseline test reads every schema there as a document kind
(`packages/core/test/validate.test.ts:9-41`; RFC 0019 `:297-303` says the same). `packages/runtime/templates/CLAUDE.md`
gains one sentence under the commands: "`wilanis manifest <root>` prints what the tree is, as JSON, before you add to it".

### Ports, operations and kinds granted

None.

### Checker rules

None. The manifest is derived from a tree that passed; an inconsistency in it is a checker rule elsewhere.

### Runtime behaviour

- **`manifestOf(load, options): Manifest`**, new, `packages/runtime/src/manifest.ts`, exported by `tools.ts`. Pure
  over a `LoadResult` that passed `checkTree`; `options.profile` narrows the blocks; `options.runtime` and
  `options.root` are the two strings the command supplies (the runtime package's version, as RFC 0019's
  `diagnosticsOf` takes it; the root as given). It reads the registry, `Scope`, and `reachOf(scope, profile)` from
  the compiler (RFC 0013) for every profile of `Judge.profiles()`, never `process.env`, never the clock. Every
  array is sorted: rows by `path` (or `name`, `variable`, `operation`, `label` in order of appearance for
  `startup`, which keeps its declared order because the order is meaning), object maps by key. `format` is the
  literal `1`. `ir` is RFC 0008's segment of `SCHEMA_BASE` (`packages/core/src/model.ts:48`): `v1` while the base
  ends in `main` or `schemas-v1`.
- **The inventory**, from the registry: `documents` (`path`, `kind`, `feature`, `layer`, `included`, each `null`
  where it does not apply); `plugins` (`use`, `from`, `version`, `guard`); `includes` (`from`, `version`,
  `features`); `features` (`name`, `included`, `effects`); `triggers` (`path`, `kind`, `settings` as written,
  `fires`, `policies` in attached order, `public` = no policy attached, `included`); `ports.domain` (`path`,
  `feature`, `operations[]` with `firedBy` = the triggers whose `fire.run` is the operation and `public` = any of
  them is public, `bindings` = every binding of the port, since the inventory is profile-independent);
  `ports.native` (`path`, `grantedBy`, `operations[]` with `pure` and `holds`); `policies` (`path`, `decides`,
  `proves`, `gates` = the triggers that attach it, `included`); `connections` (`path`, `kind`, `settings` as
  written, `secrets` = the keys its templates read, from `Scope.templateReads`); `secrets` as declared; `startup`
  (`label`, `run`, `required` defaulted to `true`, `profiles` or `null`).
- **A profile block**, from RFC 0013: `default`, `description`, `bindings` as chosen, `connections` as mapped,
  `reaches` (each effectful native operation with `via`, the connections it was reached with, resolved through
  `connectionFor`), `holds`, `starts` (the labels of the steps that run there, in order), `needs` (`variable`,
  `key`, `readBy` -- a connection path or `@<plugin> settings`), and `permits` from RFC 0016, `null` when absent.
  Until RFC 0016's step 1 lands the key is absent from the schema and the output; it is added by that step.
- **`manifest`** in `cli.ts`: `wilanis manifest <root> [--profile <name>]`; `check()` first, as `start`; then
  `JSON.stringify(manifestOf(...), null, 2)` to stdout and exit 0. `--profile` naming no profile exits 1 with
  RFC 0013's message. The usage text gains the line.
- `rehearse`, `fuzz`, `regress`, `run`, `start`: unchanged.

### Discoverability

- `wilanis manifest <root>` is the command; `wilanis --help` lists it.
- The viewer: `GET /api/manifest?profile=` in `packages/view/src/serve.ts`, from `manifestOf`; a *manifest* link
  on the project page (`renderDocPage` for `project`).
- `wilanis describe project.json` is unchanged: RFC 0013's block is the manifest's profile half for a person.
- `packages/runtime/templates/CLAUDE.md`: one sentence, above.
- `README.md`: a paragraph under *What a tree starts* or beside it, "What a tree is: the manifest", with the
  `jq` lines above.

### Plugin contract

None. A plugin contributes nothing to the manifest but what its documents already say: its ports and their
flags, its trigger and connection kinds, whether it has a guard. A plugin that wanted a field of its own would
be a document a reader cannot open, and there is none.

## Compatibility

No document schema changes; every tree validates and means what it meant. One new command; one new schema for
its output. The manifest takes RFC 0019's promise as its own from 1.0: a field is added and never removed or
retyped; a row's keys are added and never removed; `format` is bumped for a breaking change and the old envelope
is not printed; the sort is part of the promise. Until 1.0, the shape may change in place as the schemas do.

A later RFC adds a field by naming it under its own *Discoverability*, adding the row to
`manifest.schema.json`, and extending `manifestOf` in the step that lands the kind; the field is absent, not
`null`, until then. Known additions: `stores` (RFC 0002, RFC 0003, RFC 0022: the store documents with their
kind, connection and capabilities, and `ensure` under `starts`); `invariants` (RFC 0007: `path`, class, `over` or
`on`); `intents` (RFC 0031: `path`, the route it names); RFC 0009's queue triggers and RFC 0010's scheduled ones
appear as `triggers` rows with their kinds' settings, and their `consume` and scheduler operations under a
profile's `holds`, which RFC 0010 asked this RFC to own (`0010:408-410`). A `raw` storage operation, if RFC 0002
ever grants one, appears under `reaches` like any effect and is marked `raw: true` on its row, the "counted
separately" RFC 0002 asks for (`0002:695`). `ir` follows RFC 0008: `v2` when the base URL does.

## Tests

`packages/runtime/test/manifest.test.ts`, over the example (copies hand `@wilanis/access` in as a
`ResolvedInclude` with a version):

- **Golden.** `manifestOf` of the example: `format` 1; `plugins` six rows with `@auth` `guard: true` and `@std` `from: null`;
  `includes` one row with `@wilanis/access` and its version; `documents` includes the access triggers marked
  `included`; `delete-entries.trigger.json` has `public: false` and two policies in order, `list-entries` has
  `public: true`; `monitor.port.json#removeMany` is `firedBy` the delete trigger and not public; `listen` has
  `holds: true`; `monitor-api.connection.json`'s settings equal the document's and `secrets` is empty;
  `startup` has three rows in declared order.
- **Per profile** (after RFC 0013's steps 1 and 4): `profiles.live.reaches` holds `watch` and the test API;
  `profiles.production` does not hold `watch`, holds the stand-in and not `monitor-api`, `needs` holds
  `MONITOR_API_KEY` and `MONITOR_JWT_SECRET`, `starts` has two labels; `permits` is `null` under `live` and the
  list under `production` (after RFC 0016's step 2).
- **Determinism.** Two calls answer equal strings; a registry whose `all()` is reversed answers the same string;
  the string contains no timestamp and no value of any environment variable set for the test.
- **Schema.** The output validates against `manifest.schema.json` with Ajv; a row with an extra key fails it.
- **The command**, in `packages/runtime/test/tools.test.ts`: `manifest example` exits 0 and its stdout
  parses; `--profile staging` exits 1 with RFC 0013's message; a sabotaged copy that fails `check` exits 1 and
  prints no JSON.
- **The viewer**, in `packages/view/test`: `/api/manifest` answers the same string as `manifestOf`.

No end-to-end test against a fake: nothing runs.

## Implementation plan

1. `manifest.schema.json` and the inventory half of `manifestOf`; `version` on `ResolvedInclude` and on the
   runtime's plugin resolution; the `manifest` command and its usage line; the golden, determinism, schema and
   command tests. (`area:runtime`, `area:core`)
2. The profile blocks over `reachOf`: `bindings`, `connections`, `reaches`, `holds`, `starts`, `needs`;
   `--profile`; the per-profile tests. Blocked on RFC 0013's step 1 (`reach.ts`) and step 2 (`connectionFor`,
   `default`, `startup[].profiles`). (`area:runtime`)
3. `permits` on the profile block, `null` when absent. Blocked on RFC 0016's step 1. (`area:runtime`;
   `good first issue`)
4. The viewer's endpoint and link; the README paragraph; the template sentence. (`area:view`, `area:runtime`;
   `good first issue`)

Step 1 may land before RFC 0013; RFC 0024 waits for steps 1 and 2.

## Drawbacks and alternatives

- **A shape that is a contract.** Every consumer of the manifest depends on its keys, so a wrong first version
  costs a `format` bump. That is why the first version prints what the documents say and what RFC 0013 derives,
  and nothing computed further: no counts, no groupings, no "endpoints" list a reader can build from `triggers`
  by `kind`. The stub's `privileged` and `scheduled` are gone for that reason: `privileged` is `public: false` on
  an operation, and a scheduled job is a trigger of RFC 0010's kind.
- **Settings printed as written.** A connection's `baseUrl` and a trigger's route are in the manifest, so the
  manifest is not a public document of a private tree. It never held a secret's value, only the key a template
  reads; RFC 0013 says a URL is not a secret, and a tree that treats one as such writes `{{secrets.*}}` and the
  manifest prints the template. The alternative, omitting settings, would leave RFC 0024 without the port to
  expose and a reviewer without the host a connection reaches.
- **Includes both ways.** An included document is inline, marked with its package, because its triggers are this
  tree's routes and a provisioner must see them; and the `includes` list names the package and version, because
  an auditor asks what was included, not which files. The stub asked which; the answer is that they are two
  questions. The cost is one optional field on `ResolvedInclude`.
- **Computed by the runtime, not the compiler.** Everything in the manifest is static, and `reachOf` is the
  compiler's; but the versions of plugins and includes, and the runtime's own version, are what the runtime
  resolves from `node_modules`, and the compiler never learns about packages. RFC 0019 put `diagnosticsOf` in the
  runtime for the same reason. The viewer already depends on the runtime, so the layering holds.
- **`check` first.** A manifest of a refused tree could be useful to an agent asking what exists in a broken
  tree; it would also be wrong wherever a reference fails to resolve. `check --json` (RFC 0019) is what a broken
  tree answers with. A `--unchecked` flag was considered and set aside until someone needs it.
- **The whole inventory, not just the interesting parts.** `documents` makes the manifest long. It is `ls` as data,
  and the question an agent asks first -- what is here -- is the one it answers. A reader who wants less filters.
- **`WILANIS_PROFILE` is ignored.** RFC 0013's precedence is for a process choosing where it runs; the manifest
  is of the tree. Reading the variable would make two manifests of one tree differ by shell, which is the one
  thing the sorting exists to prevent.

## Open questions

Before `accepted`:

- **Whether `manifest` prints every profile by default**, or requires `--profile`. This RFC recommends every
  profile: the document is the tree's, and a profile is one of its parts; RFC 0024 narrows with the flag.
- **Whether trigger and connection `settings` are printed as written.** This RFC recommends yes, for the reasons
  under *Drawbacks*; the alternative is a manifest RFC 0024 cannot build an image from.
- **Whether `documents` is in the first version.** This RFC recommends yes: it is what `ls` prints, it is the
  first question an agent asks, and dropping it later is a `format` bump while adding it later is not; so the
  question is only whether it is worth its length now.

During implementation:

- The exact sort key of `reaches` (by `operation`, then `via`) and whether `via` lists connection paths or
  connection kinds beside them.
- Whether `needs[].readBy` names a plugin as `@auth settings` or as the plugin's `use` alone.
- Where `manifestOf` reads the runtime's version from, shared with RFC 0019's `diagnosticsOf`.
