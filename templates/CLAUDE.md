# Working in this tree

This project is a wilanis tree: behaviour is JSON documents, judged by `wilanis check`, run by a stateless kernel.
You do not write handler code. You write documents and the compiler tells you what is wrong, with the file, the rule and the fix.

## The loop

1. Edit or add documents. After every edit the hook runs `wilanis check` -- read the refusal, fix it, do not work around it.
2. Before you stop, `wilanis rehearse` runs every trigger with stubbed effects. A graph that ends `blocked` has a wiring hole.
3. `wilanis fuzz` writes scenarios; `wilanis regress` replays them. Run regress after any change to a graph or binding.
4. When a contract is unclear: `wilanis describe <path>`. When you need the lay of the land: `wilanis ls`, `wilanis map`.

## Vocabulary (every file opens with its `$schema`)

| `$schema` | what it is | where |
|---|---|---|
| `@wilanis/project.schema.json` | aliases, plugins + settings (incl. the codecs table), secrets, profiles | `project.json` |
| `@wilanis/feature.schema.json` | dependsOn, exports, effects allowlist | `features/<name>/feature.json` |
| `@wilanis/shape.schema.json` | a named object type; `layer: edge` (the world's) or `core` (ours) | anywhere in the feature |
| `@wilanis/port.schema.json` | a contract: operations with accepts / params / returns. In a feature = domain port | |
| `@wilanis/binding.schema.json` | how a domain port is met: per operation a data graph or a delegation (`run` + `params`) | |
| `@wilanis/graph.schema.json` | dataflow: nodes of type run / switch / map, `in`, `out.from`, constants, resolvers | |
| `@wilanis/trigger.schema.json` | a way in: `kind`, `settings`, `in`, `input` mapping, `out`, `graph` | |
| `@wilanis/connection.schema.json` | a channel to an external system, settings read `{{secrets.*}}` | `connections/` |
| `@wilanis/scenario.schema.json` | a recorded run (fuzz writes, regress replays) | `scenarios/` |

Every reference is a path from the root: `@features/tasks/tasks.port.json`, or through an alias in `project.json`: `@tasks/tasks.port.json`.
Plugins are alias roots: `@std/list.port.json`, `@http/http.port.json`. An operation is `path#operation`.

## Rules you will meet

- **Layers.** Triggers speak edge shapes. Domain graphs (behind triggers) speak core shapes and domain ports; the only native operations they may run are pure (`@std`). Data graphs and bindings (behind domain ports) speak native ports and may name edge shapes -- they translate.
- **Effects.** Every effectful native operation a feature's data layer reaches is listed in `feature.json → effects`. L003 means add it there, deliberately.
- **No absence.** A field is required unless it says `required: false`. An optional read cannot feed a required input (G004). Route around it: a `switch` rule `has(x)` proves `x` present for the node it routes to.
- **Types are declared.** `@std/data.port.json#object`, `#merge`, `@std/list.port.json#first`, `#concat`, `#slice` and `@http/http.port.json#request` take a `type` / `returns` param naming the result type. The checker verifies what you wired fits it; the operation judges the value at run time.
- **`request.*`** (the trigger kind's context: headers, query, params, body, principal, firedAt...) is read in exactly two places: a trigger's `input` mapping and a resolver's `in`. Nowhere else.
- **`http.request`** executes and reports `status`, `headers`, `body`. It does not decide what a 404 means -- a `switch` on `status` does.
- **Content types** are explicit: `consumes` / `produces` on triggers and `http.request` params must be in the `@http` codecs table in `project.json`.
- **Reconvergence** happens only at `out.from`: a list of candidates, each behind a switch, the first that settled answers.

## Refusal codes

D documents · R references · L layers, effects, visibility · G graphs (edges, types, routing, cycles, unused) · P params and resolvers · B bindings and profiles · T triggers · C connections and settings · S scenarios · X plugin-specific (codecs).

If a refusal seems wrong, it is far more likely the contract is wrong than the checker; read `wilanis describe` on the port before arguing with it.
