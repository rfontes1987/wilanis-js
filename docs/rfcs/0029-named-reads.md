# RFC 0029: `reads`: a document names each read it takes from the request

- **Status:** draft
- **Areas:** `area:core`, `area:compiler`, `area:runtime`, `area:view`
- **Tracking issue:** to be opened when this RFC is proposed
- **Depends on:** none. RFC 0015 is written in this grammar and depends on it; RFC 0005 and RFC 0009 name the
  header this RFC replaces and are amended in the same pull request.

## Summary

A data graph or a binding that reads the request says, at its head, which reads it takes and where each is declared:
`"reads": { "agent": "@monitor/edge/request.resolvers.json#agent" }`, one entry per name, each a path to a resolvers
document and the resolver's name after `#`. The body reads `{{agent}}` as it does today. This replaces the
`"resolvers": "@doc"` header, which bound every name of one document at once and left the reader to open it and
search. After this, every cross-document reference in a tree is a path, a name's origin is one labelled line above
its use, a document may read from two features' resolvers and give a read the name it likes, and the set of reads a
document makes is exactly its `reads` map -- so the checker's walk from a trigger to the request paths it must
guarantee reads a map rather than scanning a body, an entry nothing reads is refused like an unused import, and a
name that shadows a node is a refusal rather than a surprise.

## Motivation

The data layer is the only layer that reads the request, and only through a `resolvers` document in `edge/`: a data
graph or a binding names the document under `resolvers` and reads `{{name}}` wherever a value is used. The rule is
right and stays. Its grammar has three costs, and an agent writing documents pays all of them.

- **The binding is implicit.** `"resolvers": "@monitor/edge/request.resolvers.json"` binds every name of that document,
  and the body's `{{tenant}}` says nothing about being one of them. A reader -- or a small model -- meeting
  `{{tenant}}` must know the convention, open the document and search it. The template CLAUDE.md teaches the
  convention (`packages/runtime/templates/CLAUDE.md`, the layers paragraph and the `resolvers` row); nothing in the
  graph itself says it. Every other reference that crosses a document boundary in this tree is a path, and a path
  is openable without a convention. A resolver read is the one exception.
- **One document, its names.** A graph reads from exactly one resolvers document, and under the names that document
  chose. Two features' resolvers cannot both be read, and two of one name cannot coexist. A store that scopes a
  collection (RFC 0015) wants to call its column `tenant` and read a resolver that another feature named differently,
  and cannot.
- **The set of reads is a scan.** `graphNeeds` in `packages/compiler/src/check/resolvers.ts` finds what a graph reads
  by walking every node's values through `Scope.templateReads` and keeping the roots that happen to be resolver
  names; `rootReadRaw` in `check/graph-reads.ts` tries the resolvers before the nodes, so a node whose id equals a
  resolver's name is shadowed silently. Nothing says "this graph reads exactly these"; the checker infers it, and
  what is inferred cannot be refused for being wrong.

What the code says: `GraphDoc.resolvers?: string` and `BindingDoc.resolvers?: string` in
`packages/core/src/model.ts`; `resolversFor` in `check/resolvers.ts` turns the one path into the judged resolvers of
that document; `quietResolvers` and `requestNeedsOf` build the request needs from body reads whose root is a resolver
name; `lower.ts` builds `roots.resolvers` from the same document; `graphs.ts` in the viewer keeps one `resolversDoc`
per graph and draws one request node whose `opens` is that document. Four documents in this repository name the
header (`example/features/monitor/data/create-row.graph.json`, and `write-theme`, `end-session`, `read-session` under
`libraries/access/features/access/data/`), plus the template, and RFC 0009's example.

What this RFC does not do. It does not change what a resolver is -- a read of `request.*`, declared once per feature
in `edge/`, `required` when a policy guarantees it -- nor where the request may be read: a trigger's `fire.in`, a
policy's `decide.in`, and a resolvers document's `read`, still the three places. It does not put a resolver reference
in value position (`{ "resolver": "@path" }` where a primitive is allowed): that would be a second notation for a
read beside `{{name}}`, would lose interpolation into strings, and would reserve a key inside literal objects
(*Drawbacks*). And it does not split resolvers into one document each: one resolvers document per feature stays,
and `#` addresses a name inside it, as it addresses an operation inside a port.

## Guide-level explanation

**The words.** A **resolver** is a named read of the request, declared in a feature's `edge/` resolvers document. A
data graph or a binding **uses** a resolver by giving it a local name under `reads`, bound to the document and the
resolver's name: `"<local>": "@<feature>/edge/<file>.resolvers.json#<resolver>"`. The body reads `{{<local>}}` or
`{{<local>.<field>}}`. The local name is usually the resolver's own, and need not be.

**Writing it.** The monitor's `create-row.graph.json` today names one document and reads one resolver:

```json
"resolvers": "@monitor/edge/request.resolvers.json",
```

and after this RFC says which:

```json
"reads": { "agent": "@monitor/edge/request.resolvers.json#agent" },
```

with the body unchanged: `"agent": "{{agent}}"` in the `put`'s record. A reader of the graph sees, in the graph,
that `agent` is a resolver and where it is declared; `wilanis describe` on that path prints what it reads. A binding
uses one the same way, and a delegation reads `{{token}}` in its `in`:

```json
"reads": { "token": "@monitor/edge/request.resolvers.json#token" },
"operations": {
  "enqueueRemoval": {
    "run": "@queue/queue.port.json#publish",
    "in": { "queue": "removals", "message": { "id": "{{in.id}}" }, "headers": { "authorization": "{{token}}" } }
  }
}
```

Two features, or two names for one read, are ordinary:

```json
"reads": {
  "agent": "@monitor/edge/request.resolvers.json#agent",
  "who": "@access/edge/session.resolvers.json#sid"
}
```

**The refusals an author meets.** Name a resolver the document does not declare:

```
P004  @features/monitor/data/create-row.graph.json#reads/agent
    '@monitor/edge/request.resolvers.json' declares no resolver 'agents'
    → wilanis describe @monitor/edge/request.resolvers.json lists its resolvers: agent, tenant
```

Keep an entry the body never reads:

```
P005  @features/monitor/data/create-row.graph.json#reads/tenant
    'tenant' is used by no value of this graph
    → read it as {{tenant}}, or drop the entry: using is exactly what this document reads
```

Give a read a name a node already has:

```
P006  @features/monitor/data/create-row.graph.json#reads/saved
    'saved' is also the id of a node; {{saved}} would be ambiguous
    → rename the read: "reads": { "savedBy": "...#saved" }
```

Read `{{tenant}}` without naming it:

```
G003  @features/monitor/data/create-row.graph.json#nodes/saved/in/record/tenant
    'tenant' is not in, const, a node that runs before this one, or a name under using
    → to read the request, bind the name: "reads": { "tenant": "@monitor/edge/request.resolvers.json#tenant" }
```

Write `reads` on a domain graph, and L002 refuses it as it refuses `resolvers` today: a domain graph never reads the
request.

**What `describe` says.** `wilanis describe` on the graph prints, before its nodes:

```
reads
  agent  ← @monitor/edge/request.resolvers.json#agent  (request.headers['user-agent'])
  tenant ← @monitor/edge/request.resolvers.json#tenant  (request.session.attributes.tenant, required)
```

and on the resolvers document, one line per resolver and who uses it:

```
resolvers  @monitor/edge/request.resolvers.json  (Request context)
  agent   request.headers['user-agent']          used by @monitor/data/create-row.graph.json as {{agent}}
  tenant  request.session.attributes.tenant  required  used by @monitor/data/tenant-scope... as {{tenant}}
```

## Reference

### Documents and schemas

**`common.schema.json`** gains `$defs/resolverRef`: "A resolver of a resolvers document: its path, `#`, and the
resolver's name (`@monitor/edge/request.resolvers.json#agent`)." The pattern is `$defs/path`'s followed by `#` and
`$defs/ident`'s. The description of `$defs/ident` gains nothing: it already says "resolver".

**`graph.schema.json`** and **`binding.schema.json`**: `resolvers` (path) is removed; `reads` (object, optional;
keys are `ident`, values are `resolverRef`, `minProperties: 1`) is added: "The reads this document takes from the
request: local name → the resolver that declares it. The body reads each as `{{name}}` or `{{name.field}}`; every
entry is read by some value (P005), and no name is a node's id or a reserved root (P006). Data graphs and bindings
only: a domain graph never reads the request (L002)." **`resolvers.schema.json`**: the document's description and the
`resolvers` property's say "used under `reads` as `@path#name`" where they say "names this document and reads
`{{name}}`"; the rules are unchanged.

`GraphDoc` and `BindingDoc` in `packages/core/src/model.ts`: `resolvers?: string` becomes
`using?: Record<string, string>`. `splitOp` in `packages/core/src/registry.ts` is renamed `splitRef` and its doc
comment says what `#` now addresses -- an operation of a port, or a resolver of a resolvers document -- with `splitOp`
kept as an alias until its callers are renamed in the same pull request. `Kind` and `HOME` are unchanged: no new
document kind, no placement change.

**`packages/runtime/templates/CLAUDE.md`**: the `resolvers` row says "for data graphs and bindings to bind under
`reads` and read as `{{name}}`"; the layers paragraph's sentence becomes "It is the only layer that reads the
request, and only through resolvers it names: `"reads": { "agent": "@f/edge/request.resolvers.json#agent" }`, then
`{{agent}}` wherever the value is used. A resolver is a read, not an operation: nothing runs."; the `request.*`
bullet is unchanged (the three places are the same three). The rule list gains P004, P005, P006.

**`wilanis new`**: the graph and binding scaffolds in `packages/runtime/src/scaffolds.ts` write no `resolvers` today
and write no `reads`; unchanged.

### Ports, operations and kinds granted

None.

### Checker rules

Codes are the next free in the P family as the tree stands (P001 is `static`, P002 and P003 are the resolvers
document's); the implementing pull request takes what is free when it lands.

| Code | Where it lives | Refuses when | Hint |
|---|---|---|---|
| P004 | `check/resolvers.ts`, `resolversFor`, at `reads/<name>` | a `reads` value is not `path#name` (the schema refuses most; this refuses what it cannot); its path names no resolvers document (R001, as today at `resolvers`); the document is another feature's and not visible (L005 through `judge.visible`, as today); or the document declares no resolver of that name | `wilanis describe <resolvers doc> lists its resolvers: <names>` |
| P005 | `check/graph.ts` after the nodes are judged; `check/bindings.ts` after the operations are | a `reads` name that no value of the document reads (`Scope.templateReads` over every node's values, or every delegation's `in`, has no read rooted at it) | `read it as {{<name>}}, or drop the entry: using is exactly what this document reads` |
| P006 | `check/graph.ts`, at `reads/<name>` | a `reads` name is a node's id, or is in `RESERVED` (`in`, `const`, `request`, `secrets`) | `rename the read: "reads": { "<name>By": "...#<resolver>" }` / `in, const, request and secrets are roots; pick another name` |
| G003 (existing) | `check/graph-reads.ts`, `rootReadRaw` | unchanged in what it refuses; the message names `reads`: `'<root>' is not in, const, a node that runs before this one, or a name under using`, and the hint writes the entry | `to read the request, bind the name: "reads": { "<root>": "@<feature>/edge/<file>.resolvers.json#<root>" }` |
| L002 (existing) | `check/resolvers.ts`, `resolversFor` | a domain graph has `reads` (today: has `resolvers`); the `at` is `reads` | unchanged |
| B-family (existing) | `check/bindings.ts`, `rootRead` | a delegation's value reads a root that is neither an input nor a `reads` name; the message lists the `reads` names where it lists the resolvers today | unchanged |

Everything that judged reads through resolvers judges them through `reads`, with the same codes and the same
meaning: `resolversFor` answers `Record<local, JudgedResolver>` from the map instead of the document; `quietResolvers`
does the same without refusing; `requestNeedsOf` is unchanged, since it already takes that record; so `opNeeds`,
`graphNeeds`, and through them T004, A006 and B008, are unchanged. `rootReadRaw` keeps its order -- `in`, `const`,
`request`, the `reads` names, then nodes -- and P006 makes the order never matter.

### Runtime behaviour

Nothing runs differently. `lowerGraph` and the binding lowering in `packages/compiler/src/lower.ts` build
`roots.resolvers` (local name → the segments below `request`) from the `reads` map and the judged resolvers, and
`lowerRef` turns `{{agent}}` into `{ ref: 'request', path: [...] }` as today. The engine, the embedder, `rehearse`,
`fuzz`, `regress` and `start` see the same IR.

### Discoverability

- `wilanis describe <graph>` and `<binding>` (`kindBody` in `packages/runtime/src/discovery.ts`) print a `reads`
  block before the nodes or the operations: `<name> ← <ref>  (<read>[, required])`.
- `wilanis describe <resolvers document>` gains its case in `kindBody`: one line per resolver -- name, read,
  `required`, description -- and `used by <document> as {{<local>}}` for every graph or binding whose `reads` names
  it. Until now the command printed the envelope and stopped.
- `wilanis map` is unchanged: it prints operations and effects, not reads.
- The viewer: `GraphView` in `packages/view/src/graphs.ts` builds its `resolvers` map from `reads`, one entry per
  local name, each carrying the document it came from; the request node's ports are labelled by the local name and
  each port `opens` its own resolvers document, so a graph using two features' resolvers shows one request node with
  ports that open two documents. `leaves` in `ports.ts` is unchanged: it takes the map.

### Plugin contract

None. A plugin's `check` that reads a graph's or a binding's reads (RFC 0015's X1n1 does) reads `reads` where it
would have read `resolvers`; `PluginCheckContext` is unchanged.

## Compatibility

IR v1, compatible: the lowered IR is byte-for-byte what it was. The schemas change in place, as everything before
1.0 does (RFC 0008): `graph.schema.json` and `binding.schema.json` lose `resolvers` and gain `reads`, so a document
written with `resolvers` no longer validates, and the schema's message says `reads`. The four documents in this
repository migrate in the implementing pull request, one line each; a consumer tree written against the served
schemas migrates the same way, and the refusal it meets says what to write. No `schemas-v2`.

RFC 0005's B0nn ("a binding of a required port names `resolvers`") and its sabotage case are amended to `reads`;
RFC 0009's `publish-removal.graph.json` example is amended to `"reads": { "token": ... }`. RFC 0015 is written in
this grammar. No other RFC names the header.

## Tests

| Test | Where | What it does |
|---|---|---|
| the schema | `packages/core/test/validate.test.ts` | the baseline data graph and binding carry `reads`; a `resolvers` header is refused; a `reads` value without `#`, with a name that is not an identifier, or an empty `reads` is refused |
| `splitRef` | `packages/core/test/registry.test.ts` | splits `@a/b.port.json#op` and `@a/b.resolvers.json#name`; `splitOp` still answers |
| P004 | `packages/runtime/test/example.test.ts`, sabotage | `#agents` (no such resolver); `@monitor/edge/nope.resolvers.json#agent` (R001); `@access/edge/session.resolvers.json#sid` from a monitor graph when access does not export it (L005) |
| P005 | sabotage | `create-row.graph.json` given `"tenant": "...#tenant"` and no read of it |
| P006 | sabotage | `create-row.graph.json` given `"saved": "...#agent"` (a node id); `"in": "...#agent"` (reserved) |
| G003 | sabotage | `{{agent}}` read with `reads` removed: the message names `reads` and the hint writes the entry |
| L002 | sabotage (existing case, edited) | `reads` on `record-entry.graph.json` |
| the walk holds | existing tests, unchanged in expectation | the A006, T004 and B008 cases of `example.test.ts` and `sabotage.test.ts` pass as they do: `opNeeds` answers the same paths |
| the example | `packages/runtime/test/example.test.ts` | `codes(EXAMPLE)` is empty after the migration; the access tree's tests in `libraries/access/test` likewise |
| `describe` | `packages/runtime/test/tools.test.ts` | the graph prints its `reads` block; the resolvers document prints its resolvers and `used by` |
| the viewer | `packages/view/test/view.test.ts` | `create-row`'s request node has a port `agent` that opens `@monitor/edge/request.resolvers.json`; a fixture graph using two documents has two `opens` |

## Implementation plan

1. Core: `resolverRef` in `common.schema.json`; `reads` replaces `resolvers` in `graph.schema.json`,
   `binding.schema.json`, `GraphDoc`, `BindingDoc`; `splitRef`; the validate baseline; the template rows and
   sentence. Migrate the four documents. (`good first issue`)
2. Compiler: `resolversFor` and `quietResolvers` over the map; P004; L002's `at`; G003's and the binding's messages;
   `lower.ts` roots from the map. The existing tests hold.
3. Compiler: P005 and P006, with sabotage tests.
4. Runtime: `describe` blocks for graph, binding and the resolvers document. (`good first issue`)
5. Viewer: the `resolvers` map from `reads`, per-port `opens`. Test.
6. Documents: amend RFC 0005 and RFC 0009; RFC 0015 is written in this grammar already; the README index.

## Drawbacks and alternatives

- **A line per read.** A graph that reads five resolvers writes five lines where it wrote one. That is the point:
  the five are the graph's contract with the edge, and a reader sees them without opening anything. `describe`
  prints them, and P005 keeps them honest.
- **A reference in value position.** `{ "resolver": "@path#name" }` wherever a primitive is allowed was considered:
  the origin sits at the leaf, one lookup away, and no header is needed. It would be a second notation for a read
  beside `{{name}}`, which the body must keep for `in`, `const` and node reads; a resolver could no longer be
  interpolated into a string (`https://{{tenant}}.example.com` would need a `text#fill` node); an object with a
  reserved key would have to be told apart from a literal object that happens to carry it; and the set of reads a
  document makes would again be a scan of the body. `reads` gives the same openable path one line from the use,
  keeps the body as it is, and makes the read set a map.
- **The header as it is.** Keeping `"resolvers": "@doc"` and teaching the convention harder was considered. The
  convention is already taught; the cost is that the graph itself says nothing, that one document is the limit, and
  that shadowing is silent. A change that removes three costs and adds one line per read is the cheaper side.
- **A document per resolver.** `@monitor/edge/tenant.resolver.json` would make every reference a plain path with no
  `#`. It multiplies files, breaks "one resolvers document per feature says what the feature takes from the request",
  and adds a document kind for what `#name` already expresses on a port.
- **`reads` instead of `reads`.** `reads` is the tree's word for what a resolver is, and `"reads": { ... }` would say
  so. `reads` says what the document does with them and reads well against `run`, `in`, `out`. The name is the
  maintainer's; this RFC uses `reads` and nothing else depends on the word.
- **A shorthand `"reads": "@doc"` for every name of a document** was considered and rejected: it is the implicit
  binding again, and P005 could not judge it.

## Open questions

To decide before `accepted`:

1. The word: `reads` or `reads`.
2. Whether P005 (an entry nothing reads) is a refusal, as written, or a note `describe` prints; a refusal keeps
   `reads` exactly the read set, which is what makes the walk a map and what a small model can be held to.

To decide during implementation:

3. Whether `splitOp` is removed once renamed, or stays as the port-specific alias.
