# RFC 0015: Tenant and resource scoping as a provenance rule

- **Status:** draft
- **Areas:** `area:core`, `area:compiler`, `area:plugin-storage`, `area:runtime`, `area:view`
- **Tracking issue:** #17
- **Depends on:** RFC 0002 (the `store` kind, `@storage/store.port.json`, the `resolves` channel) and RFC 0003
  (`checkStore`, the plugin's rules over a call site, `ensure` and `drift`): this RFC extends both and lands after
  them. RFC 0011's `effectsReachable` is the walk one rule here makes (A0n2); it lands there or, if this RFC's step
  lands first, here. RFC 0007 is not needed: an access invariant gates domain operations, and what this RFC gates is a
  store's rows, with a walk of its own.

## Summary

A store's collection says which of its rows a caller may see: `"scoped": { "tenant": "tenant" }` names a column the
store keeps and the resolver that feeds it, a read of what the guard established about the caller
(`request.principal.tenant`). Every storage operation over the collection then carries `"scope": { "tenant":
"{{tenant}}" }`, and the checker refuses the operation that does not: one that leaves `scope` out, one that feeds it a
literal, `{{in.tenant}}`, a field of the body, or a resolver of another document. The domain shape never names the
tenant; the store's engine adds the column, writes it on every `put`, and puts `tenant = $1` on every statement. A
collection that must see every tenant is declared as a `view` of the scoped one, `behind` a policy every trigger
reaching it attaches. Resource ownership is the same rule with the resolver reading `request.principal.subject`.
"The agent forgot the tenant filter" is a refusal with a hint, and there is no document in which to forget it.

## Motivation

Multi-tenant applications are what an agent is asked to write first, and the hole is always the same one: a query
reads another tenant's rows because a `where tenant_id = ...` was left out, or a `GET /things/{id}` looks the row up by
key and never asks whose it is. Frameworks answer with a base repository class, a query scope, a middleware, or the
database's row-level security -- each a rule enforced at run time, in code the reviewer must find, and each with an
escape hatch that is where the holes come back.

This tree does not need a new concept, because it already knows where every value comes from and refuses the ones
that come from the wrong place. `request.*` is read in three places only, and the data layer reads it through one
`resolvers` document per feature in `edge/` (`resolvers.schema.json`, `resolversFor` in
`packages/compiler/src/check/resolvers.ts`); a resolver declared `required` is read as present, and A006 in
`check/triggers.ts` holds every trigger reaching it to guaranteeing it, by a kind that hands the path always or a
policy whose `proves` covers it; B008 refuses a startup step that reaches one at all; a `static` field must be a
literal at every call site (P001 in `check/inputs.ts`). Scoping is these rules applied to a store's column: the value
must be one particular read, of what the guard handed, and nothing else.

What the code says about how far the tree is from that:

- **A read has a type and no origin.** `Read` in `packages/core/src/types.ts` is `{ type, optional }`. Every
  classification of a template's root happens in a `ResolveRoot` closure (`Scope.valueRead`, `rootReadRaw` in
  `check/graph-reads.ts`) that decides on the root and then discards it. `Scope.templateReads` keeps the roots but
  not where in the value each sat, nor whether the value was one whole template. Nothing today answers "this input
  is exactly the resolver `tenant`", and one rule, L007's `checkNotPassThrough` in `check/graph.ts`, approximates it
  with string equality against `` `{{in.${name}}}` ``, which `WHOLE_TEMPLATE` in `packages/core/src/templates.ts`
  tolerating `{{ in.name }}` makes unsound. A false negative in L007 misses boilerplate; a false negative here is
  another tenant's rows.
- **A resolver is erased at lowering.** `lowerRef` in `packages/compiler/src/lower.ts` turns `{{tenant}}` into
  `{ ref: 'request', path: ['principal', 'tenant'] }`, and the engine's `KSource` has no resolver arm
  (`packages/engine/src/sources.ts` knows `in`, `const`, `request`). The stub said the checker "walks the sources the
  way `sources.ts` does at run time"; it cannot, because by then a resolver read and a hand-written
  `{{request.principal.tenant}}` are the same bytes. The proof is static, over document values, or it is nothing.
- **The stub's location was wrong.** A006 is `checkRequestReach` and `checkNeed` in `check/triggers.ts`; `access.ts`
  mentions it in a comment. The walk both lean on, `opNeeds` in `check/resolvers.ts`, translates a resolver's name
  into its `request.*` path at once (`requestNeedsOf`), so the name `tenant` is gone before A006 sees it.
- **Nothing describes a resolver.** `wilanis describe` on a resolvers document prints the envelope and stops:
  `kindBody` in `packages/runtime/src/discovery.ts` has no case for it. A rule whose hint says "read the resolver
  `tenant`" points at a document the command cannot lay out.
- **RFC 0002 and RFC 0003 are not implemented.** No `store` kind, no `packages/plugin-storage`; this RFC is written
  against their accepted text and lands after them.

What this RFC does not do. It does not bound an unbounded `find`: RFC 0002 handed that question here "if it is
anyone's", and it is not this RFC's -- a read within a scope is bounded by the scope, and how many rows may leave is a
limit, which is RFC 0012's word. It does not scope a queue or a schedule per tenant (RFC 0009 and RFC 0010 named the
question): a tick or a message has no caller for the guard to establish, so a job over scoped rows goes through a
view behind a policy, or one run per tenant fired by something that knows the tenant. It does not prove provenance
through an intervening node -- `{{made.tenant}}` where `made` copied the resolver -- since `Narrowing` in
`check/narrowing.ts` tracks presence over node ids and nothing tracks identity; the scope is read at the call site,
directly, and that is the whole grammar (*Drawbacks*). It does not use the database's row-level security: the rule
would then live in two places and the checker could see only one (*Drawbacks*). And it adds no way to say "this
call site is exempt": an operation that crosses tenants is a view, declared, behind a policy the checker sees.

## Guide-level explanation

**The words.** A **scope** is a column a store keeps beside a collection's records, fed from one read of who is
calling, that every operation over the collection is held to. The domain never sees it: `Entry.shape.json` has no
`tenant`, a data graph never makes one, a caller never sends one. Where the record is kept is the data layer's
business, and so is under which tenant.

**Declaring it.** The store names the resolvers document its feature reads, the way a data graph does, and the
collection names a column and the resolver that feeds it. The monitor's store, once its entries belong to tenants:

```json
{
  "$schema": "https://raw.githubusercontent.com/wilanis/wilanis-js/main/packages/core/schemas/store.schema.json",
  "label": "Entries",
  "description": "Observed calls, one row each, kept per tenant: a caller sees the rows of the tenant the guard put in their token, and nothing else. every-entry is the support desk's view across tenants.",
  "connection": "@connections/entries.connection.json",
  "resolvers": "@monitor/edge/request.resolvers.json",
  "collections": {
    "entries": {
      "of": "@monitor/domain/Entry.shape.json",
      "key": "id",
      "unique": [["url", "method"]],
      "scoped": { "tenant": "tenant" }
    },
    "every-entry": {
      "view": "entries",
      "behind": "@access/edge/employees-only.policy.json",
      "description": "the same rows, every tenant's: the digest, for employees"
    }
  }
}
```

and the resolver, in the feature's one `edge/` document that reads the request:

```json
{
  "$schema": "https://raw.githubusercontent.com/wilanis/wilanis-js/main/packages/core/schemas/resolvers.schema.json",
  "label": "Request context",
  "description": "What this feature reads from the request beyond its body and route: the caller's user agent, and the tenant the guard put in the token, which scopes the entry store.",
  "resolvers": {
    "agent": { "read": "request.headers['user-agent']", "description": "absent when the caller sent none" },
    "tenant": {
      "read": "request.principal.tenant",
      "required": true,
      "description": "the caller's tenant, established at sign-in and carried in the token; every row of entries belongs to one"
    }
  }
}
```

`tenant` is `required`, so it is read as present, and A006 already holds every trigger reaching a graph that reads
it to attaching a policy that proves `request.principal`. `GET /monitor/{id}` is public today; once its data graph
reads `{{tenant}}`, the checker asks for `signed-in`, or any policy that proves the principal, and the trigger
gains it. Nothing else about the trigger changes: it fires `monitor.port.json#get` with the id, as before.

**Writing the operation.** Every storage operation over `entries` says its scope, and says it one way:

```json
{
  "type": "@wilanis/node/run.schema.json",
  "id": "asked",
  "label": "Read the entry",
  "run": "@storage/store.port.json#get",
  "in": {
    "store": "@monitor/data/entries.store.json",
    "collection": "entries",
    "scope": { "tenant": "{{tenant}}" },
    "key": "{{in.id}}"
  }
}
```

The graph names `"resolvers": "@monitor/edge/request.resolvers.json"` -- the store's document -- and `{{tenant}}` is
the whole of the value: not `"{{in.tenant}}"`, not `"acme"`, not `"{{tenant}}-eu"`, not a field of a record the
caller sent. A `get` by key that would find another tenant's row answers `record` absent, which the graph already
routes as `missing`; a `find` answers the tenant's rows; a `put` writes the tenant beside the record; a `remove` of
another tenant's key removes nothing. The store's engine puts the scope on every statement, and the checker has made
sure every statement carries one.

**The refusal an author meets.** Write the scope from the body, because the request has a `tenant` field and it
seemed the obvious source:

```
X2n1  @features/monitor/data/create-record.graph.json#nodes/saved/in/scope/tenant
    scope 'tenant' of entries is fed from {{in.tenant}}; the store scopes it by the resolver 'tenant' of @monitor/edge/request.resolvers.json
    → write "scope": { "tenant": "{{tenant}}" } and name that resolvers document: a scope is who is calling, which the guard established, never what the caller sent
```

Leave `scope` out, and the same code says `entries is scoped by tenant, and this get gives no scope`. Read the
scope from `{{tenant}}` but name a different resolvers document, and it names the two. The hint is the whole edit.

**A view across tenants.** The digest lists every entry, whoever recorded it, for the support desk. Its data graph
runs `find` over `every-entry` and gives no `scope`, because a view has none; and every trigger that reaches that
graph must attach `employees-only`, because the view says `behind`. Drop the policy from `digest.trigger.json`:

```
A0n2  @features/monitor/edge/digest.trigger.json#policies
    reaches @monitor/data/digest-rows.graph.json#rows, which reads every-entry, a view of entries across every tenant behind @access/edge/employees-only.policy.json, and attaches no such policy
    → attach "@access/edge/employees-only.policy.json" under policies, or read entries with a scope
```

A view is the one way across a scope, and it is a document: `wilanis describe` prints it, the viewer draws it, and
a reader of the store knows exactly which rows leave their tenant and behind what.

**The other refusal.** A scope is who is calling. A resolver that reads what the caller chose -- a header, a route
parameter, the body -- cannot scope anything, however it is declared:

```
A0n1  @features/monitor/data/entries.store.json#collections/entries/scoped/tenant
    scoped by 'tenant', which reads request.headers['x-tenant']: a caller may send any value there
    → a scope reads what the guard hands once it identified the caller (request.principal, request.session); wilanis describe @auth
```

**What `describe` says.**

```
store  @monitor/data/entries.store.json  (Entries)
  connection  @connections/entries.connection.json  (engine postgres)
  resolvers   @monitor/edge/request.resolvers.json
  collection entries: @monitor/domain/Entry.shape.json
    key         id
    unique      [url, method]  (within the scope)
    scoped by   tenant ← {{tenant}}  (request.principal.tenant, required; guaranteed at 5 trigger(s) by signed-in, employees-only, can-record)
    read by     @monitor/data/get-record.graph.json#asked (get), @monitor/data/list-records.graph.json#asked (find)
    written by  @monitor/data/create-record.graph.json#saved (put), @monitor/data/delete-record.graph.json#gone (remove)
  collection every-entry: view of entries, behind @access/edge/employees-only.policy.json
    read by     @monitor/data/digest-rows.graph.json#rows (find)  reached by digest.trigger.json (attaches it)
```

## Reference

### Documents and schemas

**`store.schema.json`** (RFC 0002, extended by RFC 0003) gains, on the document, `resolvers` (path, optional): "The
resolvers document (edge/) whose reads scope this store's collections. Named the way a data graph names one; every
graph or binding that operates over a scoped collection names the same document." And on a collection entry, two
shapes it may take beside RFC 0002's and RFC 0003's fields:

- `scoped` (object, optional; keys are identifiers, values are identifiers): "column → resolver. Each key names a
  column the store keeps beside the record, which the shape does not declare; each value names a resolver of the
  store's `resolvers` document, declared `required` and reading what the guard hands. Every operation over this
  collection gives `scope` with exactly these keys, each fed from exactly that resolver (X2n1); the engine writes the
  columns on `put` and puts them on every statement. `unique` constraints hold within the scope."
- `view` (identifier, optional) with `behind` (path, required when `view` is): "`view` names a scoped collection of
  this store; this collection is the same rows, unscoped. `behind` names the policy every trigger that reaches an
  operation over it must attach (A0n2). A view declares neither `of`, `key`, `unique`, `refs`, `defaults` nor
  `scoped`: it has the viewed collection's." `description` stays optional.

`StoreDoc` in `packages/core/src/model.ts` gains `resolvers?: string`; `StoreCollection` gains
`scoped?: Record<string, string>`, `view?: string`, `behind?: string`. The schema makes the two shapes exclusive:
a collection with `view` has `behind` and nothing of a collection with `of`.

**`resolvers.schema.json`**: unchanged. **`graph.schema.json`, `binding.schema.json`**: unchanged; `resolvers` on
each is the path it is today.

**`packages/runtime/templates/CLAUDE.md`**: the `store` row gains "a collection may be `scoped` by columns the store
keeps, each fed from one `required` resolver reading what the guard hands, and a `view` of a scoped collection sees
every row `behind` a policy"; the layers paragraph gains one sentence after "A resolver is a read, not an
operation": "A scoped store's operations read the scope from that resolver and nowhere else (X2n1); the domain
never names a tenant." The rule list gains the codes below.

**Placement**: unchanged; a store is in `data/` (RFC 0002). **`wilanis new store`**: unchanged; `scoped` and `view`
are keys an author adds.

### Ports, operations and kinds granted

No new port, operation, kind or codec. One document of `@wilanis/plugin-storage` changes:

**`packages/plugin-storage/docs/store.port.json`**: `get`, `find`, `count`, `put`, `patch` and `remove` gain one
optional input, `scope` (`unknown`, like `where`): "The caller's scope over a scoped collection: an object with one
key per column the collection's `scoped` declares, each fed from the resolver it names and nothing else (X2n1). The
engine writes these columns on `put` and holds every read, `patch` and `remove` to them, so a key of another scope is
absent. Not given over a collection that declares no `scoped`, nor over a `view`." `newKey` takes none: a key is
global to the table, and `uuidv7` or `identity` (RFC 0002) answers one whatever the scope.

The port document's description gains the paragraph *Scopes*, beside RFC 0002's *The `where` grammar*: a `where`
never names a scope column, since it is not a field of the shape (X206 refuses it as one that is not), and a `patch`
never changes one.

`@storage-memory` and `@storage-postgres` grant what they grant; how each keeps a scope is under *Runtime
behaviour*.

### Checker rules

Codes are placeholders (`C0nn`, `A0n1`, `X2n1`); the implementing pull request takes the next free code of each
family as the tree stands when it lands -- the X band continues RFC 0003's, which ends at X211 -- and no number here
should be read as reserved. Existing codes named in this RFC (P001, P002, P003, A001, A005, A006, B008, L002, L005,
L007, R001, T004, X202, X204, X206, I001) were checked against the source or the accepted RFC that adds them.

**Two judges, as RFC 0003 draws the line.** The compiler judges the store document against what it names and the
triggers against what they reach -- C and A. The storage plugin judges every call site of `@storage/store.port.json`
against the collection it names -- X -- because which operation takes `scope` and what a scope means to a statement
is the plugin's semantics, judged where X206 to X209 judge `where` and `changes`. Neither computes what the other has:
the plugin reads the store through `scope.get('store', path)` (RFC 0003) and the graph's or binding's `resolvers`
through the registry, and classifies a value with the one helper below.

**One definition of "exactly this read".** `packages/core/src/templates.ts` gains
`readsExactly(value: unknown, expected: string[]): boolean` -- true when `value` is a string that `WHOLE_TEMPLATE`
matches and whose `splitPath` equals `expected`, so `{{tenant}}`, `{{ tenant }}` and nothing else. L007's
`checkNotPassThrough` adopts it in place of `` value === `{{in.${name}}}` ``, so the tree has one notion of a value
being one read and the sound one. Provenance is judged over the document value at the call site (`site.given` in
`check/inputs.ts`, the plugin's node `in`), before lowering: after `lowerRef` a resolver and a raw request read are
the same source, and nothing downstream can tell them apart.

| Code | Where it lives | Refuses when | Hint |
|---|---|---|---|
| C0n1 | `check/contracts.ts`, `checkStore` (RFC 0003), at `collections/<c>/scoped/<column>` | a `scoped` column is a field of the collection's shape; or its resolver is not one of the store's `resolvers` document (R001 when the store names none or names a document that does not exist; L005 through `judge.visible` when it is another feature's); or that resolver is not `required`; or its read types as anything but a string or a number (`JudgedResolver.read.type`) | `a scope is a column the store keeps, not a field of the shape: rename one` / `name the resolver in <resolvers doc> and declare it required` / `a scope is a string or a number` |
| C0n2 | `checkStore`, at `collections/<c>/view` or `/behind` | `view` names a collection this store does not declare, one that is itself a view, or one that declares no `scoped`; a view declares `of`, `key`, `unique`, `refs`, `defaults` or `scoped` (the schema refuses most; this refuses what it cannot); `behind` names no policy document (R001) | `a view sees every row of one scoped collection of this store` / `a view has the viewed collection's shape and key; declare them there` |
| A0n1 | `check/access.ts`, a new `checkStoreScopes(judge)` over every store, at `collections/<c>/scoped/<column>` | the resolver a column is scoped by reads a `request.*` path whose first segment is not a key of the guard's `guard.context` (`scope.guard()`, `packages/plugin-auth/docs/plugin.json`: `principal`, `session`, `challenge`); or the tree has no guard | `a scope reads what the guard hands once it identified the caller (request.principal, request.session); wilanis describe <guard>` / `add a guarding plugin to project.json → plugins, such as @wilanis/plugin-auth` |
| A0n2 | `check/access.ts`, `AccessCheck` per trigger, at `policies` | under some profile, a trigger's `fire.run` reaches (`effectsReachable`, RFC 0011) a call site of `@storage/store.port.json` whose static `store` and `collection` name a view, and no attached policy is the view's `behind` by canonical path; the message names the graph, the node, the view and the policy | `attach "<behind>" under policies, or read <viewed> with a scope` |
| X2n1 | `plugin-storage/src/rules.ts`, at `nodes/<id>/in/scope` or `/in/scope/<column>` (a binding delegation: `operations/<op>/in/scope`) | over a collection with `scoped`: `scope` is not given; is not a literal object; its keys are not exactly the `scoped` columns (one missing, one extra); or a value is not `readsExactly` the whole template of the resolver the column names; or the graph or binding names no `resolvers`, or one that is not the store's | `write "scope": { "<column>": "{{<resolver>}}" } and name <resolvers doc> under resolvers: a scope is who is calling, which the guard established, never what the caller sent` |
| X2n2 | `rules.ts`, at `nodes/<id>/in/scope` | `scope` is given over a collection that declares no `scoped`, or over a view; or given to `newKey` | `this collection keeps no scope; drop it` / `a view sees every row; drop scope, or read <viewed>` |

Three things follow from rules that exist. **T004 and A006** already judge the resolver's read under every trigger
reaching the graph: the kind hands `request.principal` (the guard adds it to every kind's context), and it is
"sometimes" (a public trigger has no principal), so a `required` scope resolver makes every reaching trigger attach a
policy whose `proves` covers `request.principal`, or A006 refuses at `policies` -- the stub's claim, now placed in
`check/triggers.ts` where it lives. **B008** refuses a startup step whose operation reaches a `request.*` read, so a
scoped collection is unreachable from startup by construction, and `ensure` -- which takes the store alone -- is
untouched. **A005** refuses a policy reading the caller on a trigger whose kind gives the guard nothing, so a
scheduled trigger (RFC 0010) or a queue trigger without a credential in its headers (RFC 0009) cannot reach a scoped
collection: a job over scoped rows reads a view, behind a policy the kind can satisfy, or is fired per tenant by
something that knows the tenant. **X206** refuses a `where` naming a scope column, since it is not a field of the
shape; **X204** has already settled which collection a call names before X2n1 reads its `scoped`.

**Why A0n2 is an A rule and not an invariant.** RFC 0007's I001 holds every trigger reaching a *domain operation* to a
policy, named in an invariant document. `behind` is the same judgement over a *data site* -- a node reading a view --
and the author writes it once, on the view, rather than enumerating the domain operations whose bindings happen to
reach the view under each profile. The walk is RFC 0011's `effectsReachable` in `packages/compiler/src/refusals.ts`,
which answers the native call sites a trigger reaches with the values given at each, under a profile; which site is
over a view is read through `documents.ts`, where RFC 0002's `resolves` channel already opens the store document
for a site to bind `$T`, and which gains `collectionOf(site): { store, collection } | undefined` so the compiler
matches on a fact it already holds rather than on the storage port's path.

### Runtime behaviour

**The compiler.** Nothing lowers differently. `scope` is an input like `where`: `lowerValues` turns
`{ "tenant": "{{tenant}}" }` into `{ object: { tenant: { ref: 'request', path: ['principal', 'tenant'] } } }`, and
the engine hands the handler `{ tenant: 'acme' }`. The proof was made before this line; the runtime trusts it, as it
trusts every type the checker proved.

**`@storage`'s handlers** (RFC 0002) read `input.scope` where they read
`input.where`, judge it at run time as they judge `where` -- an object whose keys are the collection's `scoped`
columns, each a string or a number -- and fail the node on anything else (a check-time rule cannot see a value that
arrives typed `unknown` from an edge; the run-time judgement is RFC 0002's, kept). They hand the scope to the engine
beside the key, the filter or the record. Over a collection with `scoped` and no `scope` the handler fails the node
-- unreachable in a checked tree, honest under a reload.

**The `Engine` interface** (`packages/plugin-storage/src/engine.ts`, RFC 0002): every method but `newKey` and
`ensure` takes `scope: Record<string, string | number> | undefined`. The contract, which the shared suite holds both
engines to:

| Operation | With a scope |
|---|---|
| `get`, `patch`, `remove` | the row is matched by key **and** every scope column; a row of another scope is absent (`record` absent, nothing patched, `removed: false`) |
| `find`, `count` | every scope column is an equality beside `where`; `where` never names one |
| `put` | the scope columns are written beside the record, whatever the record says (it cannot say anything: they are not its fields); `replace` replaces within the scope, and a key that exists under another scope is a `conflict` -- the key is global, and one tenant cannot take another's row |
| `unique` | judged within the scope: RFC 0003's constraint `[url, method]` becomes `[tenant, url, method]` |
| a view | the same table, no scope: every method as RFC 0002 has it; `put` and `patch` through a view are refused by the handler -- a view reads; a write must say whose row it is |

**`@storage-postgres`.** A scope column is `text` or `double precision` by the resolver's type, `NOT NULL`, part of
every `unique` constraint, and indexed with the primary key (`(tenant, id)`), so a scoped `get` is one index read.
Every statement over a scoped collection carries `AND <column> = $n` per scope column. `ensure` (RFC 0003) adds a
scope column to a table that lacks it when the table is empty, and refuses `drift` when it has rows: a row without a
tenant cannot be given one by a declaration, and RFC 0017's planner is where that migration is written. A view is
not a database object: it is the same table read without the predicate, and `ensure` creates nothing for it.

**`@storage-memory`.** The map is keyed by the key as today; each record is kept with its scope columns beside it,
and every method compares them. The shared suite (`packages/plugin-storage/test/suite.ts`, RFC 0002) gains the
scope cases below and both engines run them.

**Row-level security is not used.** PostgreSQL could enforce the same predicate with a policy on the table and a
session variable per request. It would enforce the rule a second time, in a place the checker, `describe` and the
viewer cannot see, with a session state the pool must set and reset on every checkout; and the memory engine could
not enforce it at all, so a tree would be safe under one profile and not another. The rule is enforced once, where
the statement is built, and proved once, where the document is checked.

**The embedder** changes nothing: the request reaches the graph as `initial.request` and the resolver reads a path
into it, as today.

**`rehearse`, `fuzz`, `regress`.** Unchanged. Storage operations are effects and are stubbed (RFC 0002: no rehearsal
reaches an engine); the rehearsal generates a request with a principal for a gated trigger and the scope reads it;
`fuzz` records the node's `in`, scope included, and `regress` replays it. What the rehearsal proves about scoping
is what the checker proved: a tree that passes `wilanis check` has no operation over a scoped collection without its
scope, and the branch walk exercises each with one. That two tenants never see each other's rows is the engine's
promise, and the shared suite is where it is tested (*Tests*); it is not a property a stubbed run can observe, and
this RFC does not pretend otherwise.

### Discoverability

- `wilanis describe <store>` (RFC 0003's marks in `packages/runtime/src/discovery.ts`) prints a `resolvers` line and,
  per scoped collection, `scoped by  <column> ← {{<resolver>}}  (<read>, required; guaranteed at N trigger(s) by
  <policies>)`, the policies being those whose `proves` cover the read on the triggers that reach the collection;
  `unique` gains `(within the scope)`. A view prints `view of <collection>, behind <policy>` and, beside each reader,
  the triggers reaching it and that each attaches the policy.
- `wilanis describe <resolvers document>` gains a case in `kindBody`: one line per resolver -- name, read, `required`,
  description -- and `scopes @monitor/data/entries.store.json#entries.tenant` where a store names it. This is the
  precursor the hints above need: a hint that says "read the resolver `tenant`" must point at something the command
  can lay out.
- `wilanis describe <graph>` (`nodeLines`) prints `scope tenant ← {{tenant}}` after a storage node's line.
- `wilanis describe <trigger>` prints, after its policies, `reaches every-entry (a view) behind
  @access/edge/employees-only.policy.json: attached`.
- `wilanis map` prints a scoped store as `store entries (get, scoped by tenant)` and a view as `view every-entry (find)`.
- The viewer (`packages/view/src/graphs.ts`, `ports.ts`; `renderDocPage` in `client/index.html`): the request node a
  data graph reads through its resolvers already exists, its ports the paths the resolvers name; `VEdge` gains `via`
  (the resolver's name) set by `leaves` in `ports.ts`, and the edge into a storage node's `scope` input is drawn from
  that port, emphasised, with a `scope` badge on the port -- the stub's "draws the resolver's wire into every scoped
  node", from documents alone. The store page marks a scoped column and its resolver on each collection, and draws a
  view as a second entry linking the viewed collection and the policy. The trigger page's *Gated by* list marks the
  policy a view requires.

### Plugin contract

`PluginModule` is unchanged. `PluginCheckContext` (`packages/core/src/plugin.ts`) is unchanged: X2n1 and X2n2 read
the store, the graph's `resolvers` and the resolvers document through `scope`, and judge a value with
`readsExactly` from `@wilanis/core`, which a plugin already depends on. The compiler's `effectsReachable` and
`collectionOf` are the compiler's; a plugin never imports them, which is why A0n2 -- the one rule that needs the
trigger walk -- is the compiler's and not the plugin's.

## Compatibility

IR v1, compatible. `store.schema.json` gains optional `resolvers`, `scoped`, `view` and `behind`; `store.port.json`
gains an optional `scope` on six operations; `Engine` gains a parameter every engine implements; `VEdge` gains an
optional `via`; `templates.ts` gains a function. A store, a graph, a binding written before this RFC validates and
means what it meant: no scope, every row. L007 judges the same documents it judged, with one false negative fewer
(`{{ in.name }}` with spaces is now the forward it always was). No `schemas-v2`.

The stub's dependency on RFC 0007 is dropped, and its citation of `check/access.ts` for A006 corrected to
`check/triggers.ts`; neither file changes.

## Tests

Sabotage tests through `sabotage` in `packages/runtime/test/example-harness.ts` (copy the example, edit one document,
answer the codes), in a new `sabotage-scoping.test.ts`, once the example keeps its entries in a scoped store (step 9):

| Code | The edit |
|---|---|
| C0n1 | `"scoped": { "url": "tenant" }` (a field of the shape); `{ "tenant": "agent" }` (not required); `{ "tenant": "nope" }` (no such resolver); the store's `resolvers` removed (R001); `tenant`'s read changed to `request.principal.roles` (a list) |
| C0n2 | `"view": "nope"`; `"view": "every-entry"` (a view of a view); a view with `"of"` beside it; `"behind": "@access/edge/nope.policy.json"` (R001) |
| A0n1 | `tenant`'s read changed to `request.headers['x-tenant']`; to `request.params.id`; to `request.body.tenant`; the `@auth` plugin removed from `project.json` (with the access feature's other refusals filtered) |
| A0n2 | `employees-only` dropped from `digest.trigger.json` |
| A006 | `signed-in` dropped from `get-entry.trigger.json`: the message names `request.principal` |
| X2n1 | `"scope": { "tenant": "{{in.tenant}}" }` on `saved` in `create-record.graph.json` (the M11 demo); `"scope": { "tenant": "acme" }`; `"scope": { "tenant": "{{tenant}}-eu" }`; `"scope": {}`; `"scope": { "tenant": "{{tenant}}", "owner": "{{tenant}}" }`; `scope` deleted from `asked` in `get-record.graph.json`; the graph's `resolvers` changed to another feature's document |
| X2n2 | `"scope": { "tenant": "{{tenant}}" }` on the `find` over `every-entry`; on a `newKey` |
| X206 | `"where": { "tenant": "acme" }` on the `find` over `entries` |
| none | the example as written: `codes(EXAMPLE)` is empty; `describe` of the store prints the lines above |

Runtime, in `packages/plugin-storage/test/suite.ts`, run by both engines (`plugin-storage-memory/test/engine.test.ts`,
`plugin-storage-postgres/test/engine.test.ts` behind `WILANIS_TEST_POSTGRES_URL`, as RFC 0002 arranges):

| What | Asserts |
|---|---|
| a `put` writes the scope | put under `acme`; `find` under `acme` answers it; `find` under `globex` answers `[]`; `count` under `globex` is 0 |
| a key does not cross | `get`, `patch` and `remove` of `acme`'s key under `globex` answer `record` absent, patch nothing, remove nothing; the row is still there under `acme` |
| the key is global | `put` of the same key under `globex` with `replace: true` answers `conflict: true` and writes nothing |
| `unique` within the scope | `[url, method]` taken under `acme` is free under `globex`; taken twice under `acme` answers `violated` |
| a view sees every row | `find` over the view with no scope answers both tenants' rows; `put` through the view fails the node |
| a scope that does not fit | `scope: { tenant: 7 }` on a string column, or `{ nope: 'x' }`, fails the node with the store's words |
| `ensure` on postgres | creates the scope column `NOT NULL`, the composite unique and the `(tenant, id)` index; on a table with rows and no scope column refuses `drift` |

Compiler and core:

| Test | Where | What it does |
|---|---|---|
| `readsExactly` | `packages/core/test/scope.test.ts` | true for `{{tenant}}` and `{{ tenant }}`; false for `{{tenant.id}}`, `x{{tenant}}`, `{{in.tenant}}`, a non-string |
| L007 still bites, and through spaces | `packages/runtime/test/sabotage.test.ts` | the existing L007 case; a forwarder written `{{ in.id }}` is L007 too |
| `collectionOf` | `packages/runtime/test/example.test.ts` | the `get` node of `get-record.graph.json` names `entries`; the digest's `rows` names `every-entry`; an http node names nothing |
| the view gate under a profile | `sabotage-scoping.test.ts` | a second profile binding `digest` to a graph that reads `entries` with a scope: A0n2 is not raised; binding it to the view graph without the policy: raised, naming the profile |
| the schema | `packages/core/test/validate.test.ts` | the baseline store gains a scoped collection and a view; a view with `of`, a `scoped` whose value is not an identifier, and `view` without `behind` are refused |

Discoverability, in `packages/runtime/test/tools.test.ts`: `describe` of the store prints `scoped by`, `within the
scope` and `view of`; `describe` of the resolvers document prints its two resolvers and `scopes`; `map` prints
`scoped by tenant`. Viewer, in `packages/view/test/view.test.ts`: the `get-record` view's edge into `asked.scope` has
`via: 'tenant'`; the store page carries the scope and the view.

Access, in `libraries/access/test`: an identity from either directory the access tree tests against carries its tenant into the token, and the
principal the guard hands has `tenant`.

## Implementation plan

1. Core: `readsExactly` in `templates.ts`; L007 adopts it. Tests. (`good first issue`)
2. Core: `store.schema.json` and `StoreDoc` gain `resolvers`, `scoped`, `view`, `behind`; the validate baseline; the
   template row. (`good first issue`, after RFC 0003's step 1)
3. Compiler: C0n1 and C0n2 in `checkStore`; A0n1 in `check/access.ts`; `describe <resolvers>` in `discovery.ts`, so
   the hints have something to point at. Sabotage tests.
4. Compiler: `collectionOf` in `documents.ts` over the `resolves` channel; `effectsReachable` in `refusals.ts` if
   RFC 0011's step has not landed; A0n2 with its per-profile test.
5. Plugin: `scope` on the six operations of `store.port.json` and the *Scopes* paragraph; X2n1 and X2n2 in
   `rules.ts`; the handlers' run-time judgement of `scope`.
6. Plugin: `Engine` takes `scope`; the memory engine; the shared suite's scope cases.
7. Plugin: `@storage-postgres` -- the column, the composite unique, the index, the predicate on every statement,
   `ensure` and `drift`; the postgres suite.
8. Runtime: `describe <store>`, `<graph>`, `<trigger>` and `map` lines. (`good first issue`)
9. The example, the M11 demo: `libraries/access` -- the identities of the directories it tests against carry a tenant (two values),
   sign-in writes it into the token, `Identity.shape.json` and `Principal.shape.json` gain `tenant`; the example's
   `request.resolvers.json` gains `tenant`; the store gains `scoped` and `every-entry`; every storage node gains
   `scope`; `get-entry` and `list-entries` attach `signed-in`; the digest's graph reads the view and its trigger
   attaches `employees-only`; `sabotage-scoping.test.ts`; the README's storage paragraph gains a sentence on scope.
10. Viewer: `VEdge.via`, the emphasised scope edge and the port badge; the store page's scope and view. Test.

## Drawbacks and alternatives

- **The store keeps the tenant; the shape does not.** The stub asked whether the scoped field exists on the shape.
  It does not, and that is the design: a domain graph cannot read the request (L002), so a tenant on the shape would
  have to arrive through the trigger's `fire.in` and the domain graph's `make`, and the value the store writes would
  then come from `in.tenant`, exactly the provenance the rule refuses. Keeping it in the store puts the scope where
  the request is read, in the data layer, and lets `Entry` mean an entry. The cost is that a domain graph that wants
  to *display* the tenant reads it through `in` from the trigger, like any request value, and that value is not the
  scope: the scope is the store's.
- **Several scopes.** `scoped` is a map, so a collection may be scoped by a tenant and an owner at once, each column
  fed from its resolver; every operation gives every key. The stub's second question is answered by not choosing.
- **A view is the exemption, and it is a document.** The alternative -- `"scope": "*"`, or a flag on the node, or a
  policy named at the call site -- puts the exemption where the hole was. A view is a collection: `describe` lists
  who reads it, the viewer draws it, and A0n2 holds every trigger reaching it to one policy the store named.
  Its cost is a second collection entry per crossing, which is the price of being able to find them all.
- **Direct reads only.** The scope must be `{{<resolver>}}` at the call site. A value that went through a node --
  `{{made.tenant}}` where `made` copied the resolver -- is refused, though it might be the same value, because
  nothing in the checker tracks identity through nodes: `Narrowing` tracks presence over node ids, and `Read` has no
  origin. Tracking identity through pure nodes is future work with a real cost in `check/graph-reads.ts` and no
  case in the example that needs it. A rule that is narrower than the truth and never wider is the right one here.
- **Not row-level security.** Stated under *Runtime behaviour*: one rule, one place, both engines.
- **A `Field.scoped` contract keyword** -- the dual of `static`, judged generically in `inputs.ts`'s `readOf` --
  was considered. It would judge the *form* of the read generically but still need the store's `scoped` to know
  which resolver, so the storage knowledge lands in the compiler; RFC 0003 drew the line at the plugin for
  everything that reads the store, and this RFC keeps to it. `readsExactly` is the generic part, and it is in core.
- **`resolvers` on the store rather than `path#name`.** The stub wrote `"by": "@monitor/edge/tenant.resolvers.json#tenant"`.
  No document addresses a resolver with `#` today (`splitOp` splits ports), and a store that named a document per
  column could name two documents whose `tenant` differ. Naming the document once, as a graph does, and the
  resolver by name, makes "the graph reads the store's resolver" one path comparison.

## Open questions

Settled here, with the reasoning in the text: the scope is the store's column and not the shape's field; a
collection may have several; a view behind a policy is the one way across; provenance is direct; the engine
enforces the predicate and the checker proves the document, and the rehearsal observes neither.

To decide during implementation:

1. Whether `describe <store>` names the policies that guarantee the scope (the *Discoverability* line's `by
   signed-in, employees-only, can-record`) or only the count, since the list is per trigger and can be long.
2. Whether a view may be `behind` more than one policy (`behind: [a, b]`, all attached) or exactly one, as written;
   one is enough for the example, and a list is compatible later.
3. Whether the `(tenant, id)` index on postgres is the primary key's order or a second index; the suite judges
   behaviour and the planner (RFC 0017) may later prefer one.
