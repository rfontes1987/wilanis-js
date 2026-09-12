# RFC 0032: The site as a declared input: what the compiler tells an operation about where it was called

- **Status:** draft
- **Areas:** `area:core` (one key on a contract field in `common.schema.json`; `ObjField.provided`; one shape the
  `@std` plugin grants), `area:compiler` (the literal written at lowering; two rules), `area:runtime` (`describe`, the
  `@std` document), `area:view` (the node panel marks the field). Nothing in the engine.
- **Schemas:** `common.schema.json`'s `field` gains `provided` (additive)
- **Packages:** none new
- **Tracking issue:** #298
- **Depends on:** none to accept. RFC 0015 is the precedent this RFC generalises: the compiler carries a value to a call
  site and refuses the document that writes it by hand. RFC 0006 is what already carries the run-time half (which
  trigger fired, which node ran) and why that half is not repeated here. RFC 0019 is what a fault's message is for.
  RFC 0002's `raw` is the first operation that would ask, named in its plan when that plugin lands.

## Summary

A native port operation can say that one of the fields it accepts is written by the compiler rather than by an author:
`"provided": "site"`. Where the operation is called -- a `run` or `map` node, a binding operation, a startup step --
the compiler lowers the field as a literal holding the calling document's path, the node's id, its label and
description, the feature and the layer the document is under. The author writes nothing there, and a document that
does is refused. The handler reads it from its inputs like any other value; the report shows it under the node's `in`;
the checker types it; stubs, rehearsal and `regress` see a literal that is the same on every run. Nothing reaches a
handler that a reader cannot find under the node's `in`, and no operation receives it that did not ask.

## Motivation

A handler today is handed its inputs, a signal, the environment and a `RunContext` whose `nodePath` is a list of node
ids. It does not know which file called it, which feature that file belongs to, which layer it is in, or what the
author called the node. Three consumers want that, and each has a worse answer without it.

**An audit.** RFC 0002's `raw` is the escape hatch: a statement the checker cannot judge, whose contents the security
model (RFC 0020) lists among what is the application's. The first question an operator asks of a raw statement in a
log is which site ran it. The handler can log the statement and cannot log the site, and the report that knows the
site is not where the operator is looking.

**A fault's message.** RFC 0019 wants every message an agent repairs from to name the document and the path. A handler
that throws names what it knows, and the runtime's report adds the node id and the handler; the file is added later,
by whoever reads the report against the tree. A plugin that could say `at features/monitor/data/save.graph.json#nodes/saved`
in its own message would say it once, where the message is made.

**A model's context.** RFC 0025's `complete` is told `instructions`, a literal, and `input`, the caller's data. The
node's `description` is the author's sentence on what this particular call is for -- "classify the ticket for the
weekly digest" -- and it is a literal in the document too. A plugin that wanted to hand it to the model as context could
not, because a handler does not see the node. Whether `complete` asks for it is RFC 0025's owners' to decide; this RFC
makes it possible to ask.

The wider question behind these, raised when RFC 0031 was reviewed, was whether invoking a plugin should *always* carry
metadata about the run: the report so far, or at least what the documents say about the calling node. This RFC answers
that with the platform's own rule -- **one way in**: a node's `in` gives every value an operation takes, and a
reader who opens the node sees everything the operation was handed. So metadata reaches a handler as a declared input
or not at all, and only the operations that declare it receive it.

This RFC does not try to solve: handing a handler the run's report or history (*Drawbacks*, first item); telling a
handler *who* is calling (the principal is the guard's and a policy's, read as `request.*` where the request may be
read, and an operation whose behaviour depends on the caller is a policy written in code); naming the trigger that
fired (a graph is reached from many triggers, so that is a run-time fact, and RFC 0006's span carries it as
`wilanis.trigger`); a `map` element's index (the engine's `nodePath` has it; it is not a fact of the document); and any
provided value other than the site (`provided` takes one word, and a second is a later RFC that adds it to the enum).

## Guide-level explanation

**The words.** A **site** is where a native operation is called: a `run` or `map` node of a graph, an operation of a
binding, or a step of `project.json → startup`. A **provided field** is a field of a native contract the compiler
writes at every site: the author never gives it, the checker refuses one who does, and the handler finds it under its
inputs. `site` is the one word `provided` takes.

**What an author sees.** Nothing new to write. A port that asks for its site declares it once, in the port document; a
reader of `wilanis describe` sees the field marked `(provided)`; a graph that calls the operation gives every other
field and none of this one; a report shows the value under the node's `in` beside what the author gave.

### The worked example

The monitor has no operation that wants its site, and the first that will, RFC 0002's `raw`, is not in the workspace
yet. The worked example is therefore a test plugin, `packages/runtime/test/fixtures/plugin-note/`, the shape every
plugin has, whose one port keeps a note of who wrote what. Its port, `docs/note.port.json`:

```json
{
  "$schema": "@wilanis/port.schema.json",
  "label": "Note",
  "description": "A note beside a run: the text an author gives, and the site that gave it, kept where the test can read them.",
  "operations": {
    "record": {
      "description": "Keep the text with the site it came from. The site is the compiler's: where this node is, in the author's words.",
      "accepts": {
        "text": { "type": "string", "description": "what to note" },
        "site": { "type": "@std/Site.shape.json", "provided": "site",
                  "description": "where this call was written; the compiler fills it and the note carries it" }
      },
      "returns": "boolean"
    }
  }
}
```

A copy of the example gains the plugin and one node in `features/monitor/data/create-record.graph.json`:

```json
{ "type": "@wilanis/node/run.schema.json", "id": "noted", "label": "Note the record",
  "description": "Every record made through this graph is noted, so the test can see which site made it.",
  "run": "@note/note.port.json#record",
  "in": { "text": "{{in.url}}" } }
```

`text` is the author's. `site` is not written, and the report of a run shows what the compiler wrote:

```json
"noted": { "status": "done", "handler": "@note/note.port.json#record",
  "in": { "text": "https://example.test/", 
          "site": { "file": "@features/monitor/data/create-record.graph.json", "node": "noted",
                    "label": "Note the record",
                    "description": "Every record made through this graph is noted, so the test can see which site made it.",
                    "feature": "monitor", "layer": "data" } },
  "out": true }
```

Write `site` at the node, `"in": { "text": "...", "site": { "file": "elsewhere" } }`, and the checker refuses:

```
G0n1  @features/monitor/data/create-record.graph.json#nodes/noted/in/site
    'site' is provided by the compiler where @note/note.port.json#record is called
    → drop it; the operation is told where it was called without being asked
```

Mark a field of a *domain* operation `provided`, and:

```
L0n1  @features/monitor/domain/monitor.port.json#operations/record/accepts/site
    domain operation 'record' marks 'site' provided -- a domain operation is met by a binding; the site is a native operation's to ask for
    → drop provided, or ask for the site in the native operation the binding runs
```

**What `describe` says.**

```
$ wilanis describe @note/note.port.json
port  @note/note.port.json
  granted by  @note  (a test fixture)
  #record: Keep the text with the site it came from. ...
    accepts  text (string), site (@std/Site.shape.json, provided)
```

**What `rehearse` and `regress` see.** A literal. The stubbed `record` is handed the same `site` a real one is, the
solver has nothing to choose there, and two runs of `regress` differ at `noted` only when the document moved or the node
was renamed -- which is a change, and the diff says so.

## Reference

### Documents and schemas

**One key on a contract field.** `common.schema.json`, `$defs/field`, gains `provided` (string, enum `["site"]`):
"Native contracts only. The compiler writes this field's value where the operation is called; an author never does.
`site`: the calling document and node, of type `@std/Site.shape.json`." `Field` in `model.ts` and `ObjField` in
`types.ts` gain `provided?: 'site'`, filled by `TypeResolver.field`.

**One shape the `@std` plugin grants.** `packages/runtime/docs/std/Site.shape.json`, listed under `grants.shapes` in
`docs/std/plugin.json` (the first entry there): "Where a native operation was called, in the author's words. The
compiler writes it for every field marked `provided: site`; nothing else does." Fields:

| Field | Type | Description |
|---|---|---|
| `file` | string | "the calling document, canonical: a graph, a binding, or `@project.json` for a startup step" |
| `node` | string | "the node id in a graph; the operation name in a binding; `startup/<index>` for a step" |
| `label` | string, optional | "the node's, the binding operation's or the step's `label`, when written" |
| `description` | string, optional | "the same document's `description`, when written" |
| `feature` | string, optional | "the feature the document is under; absent for a startup step" |
| `layer` | string, optional, enum `edge` · `domain` · `data` | "the document's layer, as `layerOf` in `packages/core/src/model.ts` reads it; absent where the document has none" |

Nothing in `placement.ts`, the template or `wilanis new` changes: no document kind is added.

### Ports, operations and kinds granted

`@std` grants `Site.shape.json`. No operation of `@std` declares a provided field. RFC 0002's `raw` is the first that
should, and its plan gains the line when the storage plugin lands: `"site": { "type": "@std/Site.shape.json",
"provided": "site" }`, logged with every statement. RFC 0025's `complete` may ask for one; that is its owners' call.

### Checker rules

Codes are placeholders; the implementing pull request takes the next free code of each family.

| Code | Where it lives | Refuses when | Hint |
|---|---|---|---|
| L0n1 | `check/contracts.ts`, beside L006, against the port at `operations/<op>/accepts/<field>` | a domain operation's field carries `provided`; or a native operation's field carries `provided: "site"` and its type is not `@std/Site.shape.json`, or it is `secret`, or `required: false` | `drop provided, or ask for the site in the native operation the binding runs` / `a provided site is @std/Site.shape.json, never secret, always given` |
| G0n1 | `check/inputs.ts`, against the caller at `<site>/in/<field>` | a call site gives a value for a field the contract marks `provided` | `drop it; the operation is told where it was called without being asked` |

G005 (a required field not given) treats a provided field as given, so a contract may leave `required` at its default
and no site is refused for omitting what it may not write. G006 (a value that is not an input) is unchanged: `site` is
an input, and G0n1 is the more specific refusal, judged first. P001 (a static field must be a literal) does not apply:
a provided field is neither static nor read; it is written by the compiler after the checker has judged the site.

### Runtime behaviour

**Lowering.** `packages/compiler/src/compiler.ts` lowers a native call site's inputs through `lowerValues`; where the
operation's contract (`hit.op.accepts`) has a field with `provided: 'site'`, `lowerGraph`, `lowerBindingOp` and
`holdsSpec` add `{ value: <site> }` under that name, beside the author's sources. The value is built by `siteOf` in
`packages/compiler/src/sites.ts` -- the module RFC 0007 adds for its `sitesOf`, or a module of that name if this RFC
lands first -- from the document and the node: `file` is the canonical path the scope already knows; `node`, `label`
and `description` are read off the node document (a binding operation's, a startup step's); `feature` and `layer`
from `layerOf` and the feature directory the loader recorded. The engine is unchanged: `KSource`'s `{ value }` arm
already exists, and the engine never learns what the value means.

**The report.** `in.site` appears on the node as any input does. Nothing in it is secret; `redact.ts` has nothing to do.
At trace level `full` (RFC 0006) it is in `wilanis.in` like every input; at `summary` it is not, like every input.

**`rehearse`, `fuzz`, `regress`, `run --seed`.** `stubEffects` records the inputs it is handed, so a stubbed handler
sees the site; nothing is generated for it, since it is a literal and not a read. `regress` diffs it as any literal.

**`start`.** A startup step that names a native `holds` operation with a provided field receives `{ file:
"@project.json", node: "startup/<index>", label, description }` and no feature or layer.

### Discoverability

- `wilanis describe <port>`: a provided field prints `(provided)` after its type in the operation's `accepts` line, as
  a static one prints `(static)`.
- `wilanis describe <graph>`: nothing new; the author wrote nothing.
- The viewer's node panel lists `site` under the node's inputs, marked `provided` and greyed, with the value the
  compiler would write, so a reader sees what the handler is handed without running anything.
- `packages/runtime/templates/CLAUDE.md`, the sentence on `in`: "a field the port marks `provided` is written by the
  compiler; never give it."

### Plugin contract

`PluginModule` and `HandlerArgs` are unchanged. A handler reads `inputs.site`. `RunContext` is unchanged.

## Compatibility

`common.schema.json` gains an optional key; every contract written before this RFC validates and means what it meant.
IR v1: a lowered spec gains one literal source at the sites of operations that declare a provided field, and nothing
elsewhere; a spec lowered before this RFC is unchanged. `Site.shape.json` is a new document of the built-in plugin; a
tree that names no operation declaring `provided` never sees it.

## Tests

- `packages/core/test/validate.test.ts`: `provided: "site"` accepted on a native port's field; `provided: "run"`
  refused by the schema; `Site.shape.json` validates as a shape.
- `packages/core/test/types.test.ts`: `ObjField.provided` filled from the field.
- `packages/runtime/test/example.test.ts`, over a copy of the example with the fixture plugin under
  `test/fixtures/plugin-note/` and the `noted` node: the run's report has `in.site` equal to the object above; the
  handler received it (the fixture keeps what it was handed); G0n1 when the node writes `site`; L0n1 when
  `monitor.port.json#record` marks a field `provided`, when `note.port.json#record`'s `site` is typed `string`, marked
  `secret`, or `required: false`; the copy unbroken, `codes(...)` empty. A binding operation calling `record` and a
  startup step naming a fixture `holds` operation that declares a site each receive the site their row above says.
- `packages/runtime/test/tools.test.ts`, where `regress` is exercised: two runs diff clean at `noted`; renaming the
  graph file diffs at `noted` and nowhere else; `describe @note/note.port.json` prints `(provided)`.
- `packages/view/test/view.test.ts`: the node panel shows `site` marked `provided`.

## Implementation plan

Each step one pull request and one sub-issue of the tracking issue. Steps 1 and 2 make the RFC `implemented`.

1. **Core** (`area:core`, `area:runtime`): `provided` on `field` in `common.schema.json`, `Field` and
   `ObjField.provided`, `TypeResolver.field`; `packages/runtime/docs/std/Site.shape.json` and `grants.shapes` in the
   `@std` manifest; the validate and types tests. `good first issue`.
2. **Compiler** (`area:compiler`, `area:runtime`): `siteOf`, the literal at lowering in the three places, L0n1 and
   G0n1, G005's exemption; the fixture plugin and every case of `example.test.ts` and `tools.test.ts` above.
3. **Discoverability** (`area:runtime`, `area:view`): `(provided)` in `describe`, the template sentence, the viewer's
   node panel. `good first issue`.
4. **The first consumer**: a line in RFC 0002's plan for `raw`, written by that RFC's owners when the storage plugin
   lands; nothing here.

## Drawbacks and alternatives

- **Not the report.** The proposal that opened this was to hand every handler the kernel report so far. Rejected: a
  handler that reads what ran before it takes an input nobody declared, that no report shows under `in`, that the
  checker never typed, and that `regress` cannot replay -- a graph written in code, hidden behind a node. It would also
  teach plugins the run, which the engine keeps to itself. What a handler may know of its neighbours is what the author
  read into its `in`.
- **Not `ctx.site`.** A field on `RunContext` would cost one line and reach every handler. Rejected for the same reason
  in a smaller form: invisible under `in`, untyped, unseen by the checker, and `describe` could never print that an
  operation reads its site because nothing would say so. `RunContext` is the engine's, and the engine never learns
  about files.
- **Not always.** Providing the site to every native handler would put it in every node's `in` in every report, for the
  many operations that have no use for it, and would make a plugin's dependence on it undeclared. An operation that
  wants its site says so in its contract, where `describe` prints it and a reviewer sees it.
- **A literal in the lowered spec, repeated.** Every site of a declaring operation carries its own object in the IR,
  a few hundred bytes each. The alternative, a source arm the engine resolves (`{ site: true }`), would teach the engine
  a fact about documents, which it has never had. The bytes are cheaper.
- **`regress` churns on a rename.** Moving a graph or renaming a node changes `in.site` at every declaring node in it,
  and the baseline diffs. That is a true change of what the handler was handed, and the diff names the node; the cost
  is one re-baseline per rename, only for trees with declaring operations.
- **Prose in a handler's hands.** `label` and `description` are the author's sentences, and a plugin may log them or,
  as RFC 0025 might, hand them to a model. They are literals in a document; no reader's data reaches them; and they are
  exactly what a reader opening the tree sees. Nothing new is exposed.
- **Not provenance of who.** A site says where, never who or for whom. RFC 0015's scope is a read of what the guard
  established, carried by the compiler; this is a fact of the document, carried by the compiler. Both use the same
  mechanism and neither replaces the other.
- **The shape lives in `@std`, and the compiler knows its fields.** The compiler builds the literal from a field list of
  its own (`siteOf`), and the checker types the field against `@std/Site.shape.json`; if the two drift the literal does
  not fit the shape and the test fails at the first site. The alternative, a core type constant like `BLOB_HANDLE`
  with a type-ref word `site`, would keep both in core and give a reader nothing to open; `describe` and the viewer show
  a shape document and cannot show a constant. The shape is the discoverable answer, and the test holds the two together.

## Open questions

**Before `accepted`:**

1. **`@std/Site.shape.json` or a core type.** *Drawbacks*, last item, recommends the `@std` shape and says the cost. The
   maintainer decides.
2. **Whether RFC 0025's `complete` asks for its site.** This RFC makes it possible and takes no position; if RFC 0025's
   owners want the node's `description` handed to the model as context, it is one field on `complete`'s contract and
   one sentence in its port document saying what the model is told.

**Settled here, so the reasoning survives.**

- **A declared input, not the report and not the context.** *Drawbacks*, first three items.
- **Only operations that ask.** *Drawbacks*, third item.
- **One word, `site`.** A second provided value -- the profile in force, the tree's version from RFC 0026's manifest --
  is a later RFC that adds a word to the enum and a row to the table; this one adds the mechanism and its one use.

**Left to implementation, deliberately:** the exact `node` string for a binding operation and a startup step beyond
what the table says; how the viewer greys a provided field; and whether `siteOf` lives in RFC 0007's `sites.ts` or a
module of its own, which depends on which lands first.
