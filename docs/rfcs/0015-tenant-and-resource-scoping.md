# RFC 0015: Tenant and resource scoping as a provenance rule

- **Status:** draft
- **Areas:** `area:core`, `area:compiler`, `area:plugin-storage`, `area:plugin-auth`, `area:runtime`, `area:view`
- **Tracking issue:** #17
- **Depends on:** RFC 0002 (the `store` kind, `@storage/store.port.json`, the `resolves` channel) and RFC 0003
  (`checkStore`, the plugin's rules over a call site, `ensure` and `drift`): this RFC extends both and lands after
  them. RFC 0029 (`reads`): a store names the read it scopes by in that grammar. RFC 0011's `effectsReachable` is the
  walk one rule here makes (A0n2); it lands there or, if this RFC's step lands first, here. RFC 0007 is not needed: an
  access invariant gates domain operations, and what this RFC gates is a store's rows, with a walk of its own.

## Summary

A store's collection says which of its rows a caller may see. The store binds one read of the request under `reads`,
as a data graph does (RFC 0029), and the collection names the column the store keeps and the read that fills it:
`"scoped": { "tenant": "{{tenant}}" }`. The read is a resolver over what the guard established about the caller --
in the example `request.session.attributes.tenant`, an attribute the sign-in wrote into the session, of the shape the
project names under the guard's `settings.session`. The compiler carries the read to every storage operation over
the collection, so no graph writes a scope and none can forget one; a document that writes one is refused. The
checker refuses a scope fed from anything the caller could send -- a header, a route parameter, the body -- and the
guard's plugin refuses the graph that would write the attribute again after sign-in. The domain shape never names the
tenant; the store's engine adds the column, writes it on every `put`, and puts `tenant = $1` on every statement. A
collection that must see every tenant is declared as a `view` of the scoped one, `behind` a policy every trigger
reaching it attaches. Resource ownership is the same rule with a resolver reading `request.principal.subject`. The
guard learns no word of the business: `@wilanis/plugin-auth` signs, verifies and hands what it hands today. "The agent
forgot the tenant filter" cannot be written, and "the agent scoped by the wrong thing" is a refusal with a hint.

## Motivation

Multi-tenant applications are what an agent is asked to write first, and the hole is always the same one: a query
reads another tenant's rows because a `where tenant_id = ...` was left out, or a `GET /things/{id}` looks the row up by
key and never asks whose it is. Frameworks answer with a base repository class, a query scope, a middleware, or the
database's row-level security -- each a rule enforced at run time, in code the reviewer must find, and each with an
escape hatch that is where the holes come back.

This tree does not need a new concept, because it already knows where every value comes from and refuses the ones
that come from the wrong place. `request.*` is read in three places only, and the data layer reads it through
resolvers declared in `edge/` and bound by name under `reads` (`resolvers.schema.json`, RFC 0029; `resolversFor` in
`packages/compiler/src/check/resolvers.ts`); a resolver declared `required` is read as present, and A006 in
`check/triggers.ts` holds every trigger reaching it to guaranteeing it, by a kind that hands the path always or a
policy whose `proves` covers it; B008 refuses a startup step that reaches one at all. Scoping is these rules applied
to a store's column: the value is one resolver, bound where the store can be read, and the resolver reads what the
guard handed and nothing else.

What the code says about how far the tree is from that:

- **A read has a type and no origin.** `Read` in `packages/core/src/types.ts` is `{ type, optional }`. Every
  classification of a template's root happens in a `ResolveRoot` closure (`Scope.valueRead`, `rootReadRaw` in
  `check/graph-reads.ts`) that decides on the root and then discards it, and `Narrowing` in `check/narrowing.ts`
  tracks presence over node ids and nothing tracks identity. Nothing today answers "this value is exactly the
  caller's tenant" once the value has passed through a node. So the proof here is made where the value has passed
  through nothing: at the store, over a template that is the whole of the value, before any graph runs -- and the
  compiler, not an author, carries it to the call sites.
- **A resolver is erased at lowering.** `lowerRef` in `packages/compiler/src/lower.ts` turns `{{tenant}}` into
  `{ ref: 'request', path: ['session', 'attributes', 'tenant'] }`, and the engine's `KSource` has no resolver arm
  (`packages/engine/src/sources.ts` knows `in`, `const`, `request`). The stub said the checker "walks the sources the
  way `sources.ts` does at run time"; it cannot, because by then a resolver read and a hand-written
  `{{request.session.attributes.tenant}}` are the same bytes. The proof is static, over documents, or it is nothing.
- **The stub's location was wrong.** A006 is `checkRequestReach` and `checkNeed` in `check/triggers.ts`; `access.ts`
  mentions it in a comment. The walk both lean on, `opNeeds` in `check/resolvers.ts`, follows an operation to its
  binding's graph and that graph's reads; it does not yet follow a storage call site to the store's scope reads,
  which is the one edge this RFC adds to it.
- **Nothing describes a resolver.** `wilanis describe` on a resolvers document prints the envelope and stops;
  RFC 0029 gives it a case in `kindBody`, which the messages here point at.
- **The guard already hands a carrier the project types, and the first full draft did not use it.** `guard.context`
  in `packages/plugin-auth/docs/plugin.json` hands `session.attributes` as `$Session`, which `settings.session` binds to
  a shape of the project's (`guardBinds` in `packages/core/src/scope.ts`, so a read of an attribute has the field's
  type); `token.port.json#issue` writes the attributes at sign-in from whatever the sign-in graph composed; X103 in
  `packages/plugin-auth/src/rules.ts` judges every later write against the shape. The draft read the scope from
  `request.principal.tenant` instead, which would have made the plugin learn the word: a field of `guard.context`, a
  claim in `issueTokens` (`tokens.ts`), a lift in `fromToken` (`guard.ts`), a column of `SessionRecord`
  (`settings.ts`) -- five edits to the one plugin whose `plugin.json` says it identifies callers and never decides what
  they may do, and the next tree, scoped by an organisation or a workspace, would ask for the same five again. The
  value has one typed home already, and this revision reads it there; the plugin's token, guard and records are
  unchanged.
- **RFC 0002 and RFC 0003 are not implemented.** No `store` kind, no `packages/plugin-storage`; this RFC is written
  against their accepted text and lands after them.

What this RFC does not do. It does not bound an unbounded `find`: RFC 0002 handed that question here "if it is
anyone's", and it is not this RFC's -- a read within a scope is bounded by the scope, and how many rows may leave is a
limit, which is RFC 0012's word. It does not scope a queue or a schedule per tenant (RFC 0009 and RFC 0010 named the
question): a tick or a message has no caller for the guard to establish, so a job over scoped rows goes through a
view behind a policy, or one run per tenant fired by something that knows the tenant. It does not let a scope be
computed -- a lookup in a membership table, a switch on the realm -- since a scope is one read of what the guard
established, and what a caller is must be decided once, at sign-in, and written where the guard hands it back
(*Drawbacks*). It does not use the database's row-level security: the rule would then live in two places and the
checker could see only one (*Drawbacks*). And it adds no way to say "this call site is exempt": an operation that
crosses tenants is a view, declared, behind a policy the checker sees.

## Guide-level explanation

**The words.** A **scope** is a column a store keeps beside a collection's records, filled for every operation over
the collection from one **read** of who is calling. Who is calling is what the guard hands: the principal it
verified, and the session it opened at sign-in, whose attributes are the shape the project names. A tenant, in the
example, is such an attribute: the sign-in wrote it, from what the directory said, and nothing writes it again. The
domain never sees the column: `Entry.shape.json` has no `tenant`, a data graph never makes one, a caller never sends
one. Where the record is kept is the data layer's business, and so is under which tenant.

**Declaring it.** The store binds the read the way a data graph binds one, and the collection names the column and
the read. The monitor's store, once its entries belong to tenants:

```json
{
  "$schema": "https://raw.githubusercontent.com/wilanis/wilanis-js/main/packages/core/schemas/store.schema.json",
  "label": "Entries",
  "description": "Observed calls, one row each, kept per tenant: a caller sees the rows of the tenant their sign-in wrote into the session, and nothing else. every-entry is the support desk's view across tenants.",
  "connection": "@connections/entries.connection.json",
  "reads": { "tenant": "@monitor/edge/request.resolvers.json#tenant" },
  "collections": {
    "entries": {
      "of": "@monitor/domain/Entry.shape.json",
      "key": "id",
      "unique": [["url", "method"]],
      "scoped": { "tenant": "{{tenant}}" }
    },
    "every-entry": {
      "view": "entries",
      "behind": "@access/edge/employees-only.policy.json",
      "description": "the same rows, every tenant's: the digest, for employees"
    }
  }
}
```

Two lines say it whole: `reads` says that `tenant` is a resolver and where it is declared, `scoped` says the column
and that the read fills it. The resolver, in the feature's one `edge/` document that reads the request:

```json
"tenant": {
  "read": "request.session.attributes.tenant",
  "required": true,
  "description": "the caller's tenant, written into the session at sign-in from what the directory said; every row of entries belongs to one"
}
```

`tenant` is `required`, so it is read as present, and A006 holds every trigger reaching any operation over `entries`
to attaching a policy that proves `request.session`, since a storage operation over a scoped collection reads the
store's scope. `GET /monitor/{id}` is public today; once its data graph runs `get` over `entries`, the checker asks
for `signed-in`, or any policy that proves the session, and the trigger gains it. Nothing else about the trigger
changes: it fires `monitor.port.json#get` with the id, as before. The read has a type because the guard's
`settings.session` names `Session.shape.json` and the checker substitutes it for `$Session`: `tenant` is a `string`
there, and a tree that names no session shape reads `unknown`, which C0n1 refuses.

**Where the tenant comes from.** The session shape declares the attribute, and the sign-in graph writes it once, in
the same node that opens the session:

```json
"tenant": {
  "type": "string",
  "description": "written at sign-in from what the directory said about the account; scopes the entry store, and nothing writes it again"
}
```

in `Session.shape.json`, and in the `issued` node of `sign-in-customer.graph.json`:

```json
"attributes": {
  "displayName": "{{checked.identity.name}}",
  "realm": "{{const.realm}}",
  "tenant": "{{checked.identity.attributes.tenant}}"
}
```

The directory said it (*Ports, operations and kinds granted*: what a directory hands beside the subject, name and
groups, typed by a shape the sign-in names); the guard keeps it with the session and hands it back, as
`request.session.attributes.tenant`, on every call the token verifies. It is not in the token, and the guard does not
know it is a tenant. The employee sign-in writes the operator's own tenant from a constant, the way it writes the
realm. A graph that would write the attribute again, however it came by the value, meets the guard's plugin:

```
X1n1  @features/access/data/write-theme.graph.json#nodes/saved/in/values/tenant
    set writes 'tenant', which @monitor/data/entries.store.json scopes entries by; a scope is written at sign-in and never again
    → drop it: a scoped attribute is what the sign-in graph gave token.port.json#issue, and only that
```

**Writing the operation.** A storage operation over `entries` says nothing about its scope:

```json
{
  "type": "@wilanis/node/run.schema.json",
  "id": "asked",
  "label": "Read the entry",
  "run": "@storage/store.port.json#get",
  "in": {
    "store": "@monitor/data/entries.store.json",
    "collection": "entries",
    "key": "{{in.id}}"
  }
}
```

The compiler reads the store, sees `entries` is scoped, and lowers the node with the store's read on its `scope`
input, a source reference like any resolver read: nothing runs. A `get` by key that would find another tenant's row
answers `record` absent, which the graph already routes as `missing`; a `find` answers the tenant's rows; a `put`
writes the tenant beside the record; a `remove` of another tenant's key removes nothing. The store's engine puts the
scope on every statement, and the compiler has made sure every statement carries one. There is no document in which
to forget it, and the one that remembers is refused:

```
X2n1  @features/monitor/data/create-record.graph.json#nodes/saved/in/scope
    scope is the store's: entries is scoped by {{tenant}} of @monitor/data/entries.store.json, and the compiler puts it here
    → drop "scope": to change how entries are scoped, change the store
```

**The refusal an author meets.** Bind the store's read to a resolver of what the caller chose -- a header, because the
request has an `x-tenant` header and it seemed the obvious source:

```
A0n1  @features/monitor/data/entries.store.json#reads/tenant
    scopes entries, and reads request.headers['x-tenant']: a caller may send any value there
    → a scope reads what the guard hands once it identified the caller (request.principal, request.session); wilanis describe @auth
```

Write the scope as anything but one whole read of a bound name -- a literal, `"{{tenant}}-eu"`, a read the store
does not bind:

```
C0n1  @features/monitor/data/entries.store.json#collections/entries/scoped/tenant
    "acme" is not a read; a scope is exactly one resolver the store binds under using
    → write "scoped": { "tenant": "{{tenant}}" } and bind tenant: "reads": { "tenant": "@monitor/edge/request.resolvers.json#tenant" }
```

**A view across tenants.** The digest lists every entry, whoever recorded it, for the support desk. Its data graph
runs `find` over `every-entry`, which has no scope because a view has none; and every trigger that reaches that
graph must attach `employees-only`, because the view says `behind`. Drop the policy from `digest.trigger.json`:

```
A0n2  @features/monitor/edge/digest.trigger.json#policies
    reaches @monitor/data/digest-rows.graph.json#rows, which reads every-entry, a view of entries across every tenant behind @access/edge/employees-only.policy.json, and attaches no such policy
    → attach "@access/edge/employees-only.policy.json" under policies, or read entries
```

A view is the one way across a scope, and it is a document: `wilanis describe` prints it, the viewer draws it, and
a reader of the store knows exactly which rows leave their tenant and behind what.

**What `describe` says.**

```
store  @monitor/data/entries.store.json  (Entries)
  connection  @connections/entries.connection.json  (engine postgres)
  reads
    tenant ← @monitor/edge/request.resolvers.json#tenant  (request.session.attributes.tenant: string, required)
  collection entries: @monitor/domain/Entry.shape.json
    key         id
    unique      [url, method]  (within the scope)
    scoped by   tenant ← {{tenant}}  (guaranteed at 5 trigger(s) by signed-in, employees-only, can-record)
                written at sign-in by @access/domain/sign-in-customer.graph.json#issued, @access/domain/sign-in-employee.graph.json#issued
    read by     @monitor/data/get-record.graph.json#asked (get), @monitor/data/list-records.graph.json#asked (find)
    written by  @monitor/data/create-record.graph.json#saved (put), @monitor/data/delete-record.graph.json#gone (remove)
  collection every-entry: view of entries, behind @access/edge/employees-only.policy.json
    read by     @monitor/data/digest-rows.graph.json#rows (find)  reached by digest.trigger.json (attaches it)
```

## Reference

### Documents and schemas

**`store.schema.json`** (RFC 0002, extended by RFC 0003) gains, on the document, `reads` (RFC 0029's shape: keys
`ident`, values `resolverRef`, optional): "The reads this store's collections are scoped by: local name → the
resolver that declares it, as a data graph binds them. Every entry is read by some `scoped` (P005)." And on a
collection entry, two shapes it may take beside RFC 0002's and RFC 0003's fields:

- `scoped` (object, optional; keys are identifiers, values are strings): "column → the read that fills it. Each key
  names a column the store keeps beside the record, which the shape does not declare. Each value is exactly
  `{{<name>}}` for a name the store binds under `reads` (C0n1): one whole read, no literal, no interpolation, no
  field of it. The compiler puts the read on every operation over this collection as `scope`; no document writes
  `scope` (X2n1). The engine writes the columns on `put` and puts them on every statement. `unique` constraints hold
  within the scope."
- `view` (identifier, optional) with `behind` (path, required when `view` is): "`view` names a scoped collection of
  this store; this collection is the same rows, unscoped. `behind` names the policy every trigger that reaches an
  operation over it must attach (A0n2). A view declares neither `of`, `key`, `unique`, `refs`, `defaults` nor
  `scoped`: it has the viewed collection's." `description` stays optional.

`StoreDoc` in `packages/core/src/model.ts` gains `using?: Record<string, string>`; `StoreCollection` gains
`scoped?: Record<string, string>`, `view?: string`, `behind?: string`. The schema makes the two shapes exclusive:
a collection with `view` has `behind` and nothing of a collection with `of`.

**`resolvers.schema.json`, `graph.schema.json`, `binding.schema.json`**: unchanged from RFC 0029. **`plugin.schema.json`**,
and the guard's `plugin.json`: unchanged. A scope attribute is a field of the shape the guard's `settings.session`
names, `required` there, and the tree that scopes a store declares it in its own session shape; no kind, schema or
plugin document learns the word `tenant`.

**`packages/runtime/templates/CLAUDE.md`**: the `store` row gains "a collection may be `scoped` by columns the store
keeps, each filled from one read the store binds under `reads` (a `required` resolver over what the guard hands), and
a `view` of a scoped collection sees every row `behind` a policy"; the layers paragraph gains one sentence after
"A resolver is a read, not an operation: nothing runs.": "A store binds a read the same way to scope a collection,
and the compiler carries it to every storage operation over it; a graph never writes a scope (X2n1)." The rule list
gains the codes below.

**Placement**: unchanged; a store is in `data/` (RFC 0002). **`wilanis new store`**: the scaffold gains a commented
`reads` line and a scoped column side by side, so the first store an author sees shows the pattern whole.

### Ports, operations and kinds granted

No new port, operation, kind or codec. One document of `@wilanis/plugin-storage` changes, and two of
`@wilanis/plugin-auth` -- neither of them the token, the guard or its context:

**`packages/plugin-storage/docs/store.port.json`**: `get`, `find`, `count`, `put`, `patch` and `remove` gain one
optional input, `scope` (`unknown`, like `where`): "The caller's scope over a scoped collection: an object with one
key per column the collection's `scoped` declares, each the read it names. Written by the compiler from the store,
never by a document (X2n1). The engine writes these columns on `put` and holds every read, `patch` and `remove` to
them, so a key of another scope is absent." `newKey` takes none: a key is global to the table, and `uuidv7` or
`identity` (RFC 0002) answers one whatever the scope.

The port document's description gains the paragraph *Scopes*, beside RFC 0002's *The `where` grammar*: a `where`
never names a scope column, since it is not a field of the shape (X206 refuses it as one that is not), and a `patch`
never changes one.

`@storage-memory` and `@storage-postgres` grant what they grant; how each keeps a scope is under *Runtime
behaviour*.

**`packages/plugin-auth/docs/identity.port.json`**: `verify` gains one optional input, `type` (`type`, binds `$I`):
"The shape of what the directory says about an account beside its subject, name and groups. A directory connection's
account carries them under `attributes`; an OIDC identity token carries them as claims of the same names. The handler
reads them, judges them against this shape as a session write is judged against the session shape, and fails the node
when they do not fit: a directory that does not say what the tree asks of it is misconfigured, not a bad credential."
**`packages/plugin-auth/docs/Identity.shape.json`** gains `attributes`, typed `$I`: bound where `verify` is called
with `type`, `unknown` where it is not, so a sign-in that names no shape reads what it read before.
**`packages/plugin-auth/docs/Account.shape.json`** gains `attributes` (object, open, optional): what the development
directory says about the account, in the connection. This is the one change the plugin takes, and it is a mechanism,
not a word: a directory hands attributes -- LDAP and OIDC do -- and which ones is the project's shape, bound the way
the session's is. `guard.context`, `token.port.json`, `session.port.json` and the records in `settings.ts` are as they
are: what the directory said reaches the session through the sign-in graph, which composes `issue.attributes` from it,
and comes back as `request.session.attributes`, the one carrier.

### Checker rules

Codes are placeholders (`C0nn`, `A0n1`, `X1n1`, `X2n1`); the implementing pull request takes the next free code of
each family as the tree stands when it lands -- the storage plugin's X band continues RFC 0003's, which ends at X211,
and the auth plugin's continues its own, which ends at X103 -- and no number here should be read as reserved.
Existing codes named in this RFC (P005, A001, A005, A006, B008, L002, L005, R001, T004, X204, X206) were checked
against the source or the RFC that adds them.

**Three judges, as RFC 0003 draws the line.** The compiler judges the store document against what it names and the
triggers against what they reach -- C and A. The storage plugin judges every call site of `@storage/store.port.json`
-- X2n1 -- because which operation takes `scope` is the plugin's semantics, judged where X206 to X209 judge `where`
and `changes`. The guard's plugin judges every write to a session attribute a scope reads -- X1n1 -- because only
`@auth` knows which of its operations write a session, and that the attributes `issue` opened a session with are the
ones the guard hands back. None computes what another has: the storage plugin reads the store through
`scope.get('store', path)` (RFC 0003); the auth plugin reads a `store`, a core kind (RFC 0002), for its `reads` and
`scoped`, and the resolvers documents they name, and learns nothing of what a scope means to a statement.

**One walk, the compiler's, one edge more.** `opNeeds` in `check/resolvers.ts` answers what request paths an
operation's meeting reads, through its binding under a profile; `effectsReachable` (RFC 0011,
`packages/compiler/src/refusals.ts`) answers the native call sites it reaches. `graphNeeds` gains one edge: a call
site of `@storage/store.port.json` whose static `store` and `collection` name a scoped collection also reads the
store's scope reads, as if the site wrote them -- because, after lowering, it carries them. Which site is over which
collection is read through `documents.ts`, where RFC 0002's `resolves` channel already opens the store document for
a site to bind `$T`, and which gains `collectionOf(site): { store, collection } | undefined`. With that edge, A006,
T004, B008 and A005 judge a scope's read the way they judge any read a trigger reaches.

**One definition of "exactly this read".** A scope's value is judged over the document, before lowering: a string
that `WHOLE_TEMPLATE` (`packages/core/src/templates.ts`) matches, whose path is exactly one segment, and that segment
a name the store binds under `reads`. After `lowerRef` a resolver and a raw request read are the same source, and
nothing downstream can tell them apart; the proof is made here or nowhere.

| Code | Where it lives | Refuses when | Hint |
|---|---|---|---|
| C0n1 | `check/contracts.ts`, `checkStore` (RFC 0003), at `collections/<c>/scoped/<column>` | a `scoped` column is a field of the collection's shape; or its value is not exactly `{{<name>}}` (a literal, interpolation, `{{name.field}}`, `{{in.x}}`); or `<name>` is not bound under the store's `reads` (P004 and R001 judge the binding itself, as on a graph); or the bound resolver is not `required`; or its read types as anything but a string or a number (`JudgedResolver.read.type`: so a field of `request.principal.claims`, which is open, and a session attribute of a tree whose guard names no `settings.session`, both `unknown`, are refused here) | `a scope is a column the store keeps, not a field of the shape: rename one` / `write "scoped": { "<column>": "{{<name>}}" } and bind <name>: "reads": { "<name>": "@<feature>/edge/<file>.resolvers.json#<name>" }` / `declare the resolver required: a scope is read as present` / `a scope is a string or a number: declare the attribute in the shape the guard's settings.session names` |
| C0n2 | `checkStore`, at `collections/<c>/view` or `/behind` | `view` names a collection this store does not declare, one that is itself a view, or one that declares no `scoped`; a view declares `of`, `key`, `unique`, `refs`, `defaults` or `scoped` (the schema refuses most; this refuses what it cannot); `behind` names no policy document (R001) | `a view sees every row of one scoped collection of this store` / `a view has the viewed collection's shape and key; declare them there` |
| P005 (RFC 0029) | `checkStore` | a `reads` entry of the store that no `scoped` reads | as RFC 0029 |
| A0n1 | `check/access.ts`, a new `checkStoreScopes(judge)` over every store, at `reads/<name>` | the tree has no guard; or a resolver a `scoped` column reads has a `request.*` path whose first segment is not a key of the guard's `guard.context` (`scope.guard()`, `packages/plugin-auth/docs/plugin.json`: `principal`, `session`, `challenge`) | `add a guarding plugin to project.json → plugins, such as @wilanis/plugin-auth` / `a scope reads what the guard hands once it identified the caller (request.principal, request.session); wilanis describe <guard>` |
| A0n2 | `check/access.ts`, `AccessCheck` per trigger, at `policies` | under some profile, a trigger's `fire.run` reaches (`effectsReachable`) a call site of `@storage/store.port.json` whose static `store` and `collection` name a view, and no attached policy is the view's `behind` by canonical path; the message names the graph, the node, the view and the policy | `attach "<behind>" under policies, or read <viewed>` |
| X2n1 | `plugin-storage/src/rules.ts`, at `nodes/<id>/in/scope` (a binding delegation: `operations/<op>/in/scope`) | a document gives `scope` to any operation of `@storage/store.port.json`: over a scoped collection (the compiler writes it), over one that declares no `scoped`, over a view, or to `newKey` | `drop "scope": to change how <collection> is scoped, change the store` / `this collection keeps no scope; drop it` / `a view sees every row; drop scope, or read <viewed>` |
| X1n1 | `plugin-auth/src/rules.ts`, beside X103, at `nodes/<id>/in/values/<key>` or `/in/keys` (a binding delegation: `operations/<op>/in/...`) | a `session.port.json#set` whose `values` name, or a `#remove` whose `keys` name, an attribute that some store scopes by: from every `store`'s `scoped`, through its `reads`, to a resolver reading `request.session.attributes.<key>`; the message names the store and the collection | `drop it: a scoped attribute is what the sign-in graph gave token.port.json#issue, and nothing writes it again` |

Four things follow from rules that exist, once `graphNeeds` follows the scope edge. **T004 and A006** judge the
store's read under every trigger reaching any operation over the collection: the kind hands `request.session` (the
guard adds it to every kind's context), and it is "sometimes" (a public trigger has no session), so a `required`
scope resolver makes every reaching trigger attach a policy whose `proves` covers `request.session`, or A006 refuses
at `policies` -- the stub's claim, now placed in `check/triggers.ts` where it lives. **B008** refuses a startup step
whose operation reaches a `request.*` read, so a scoped collection is unreachable from startup by construction, and
`ensure` -- which takes the store alone -- is untouched. **A005** refuses a policy reading the caller on a trigger
whose kind gives the guard nothing, so a scheduled trigger (RFC 0010) or a queue trigger without a credential in its
headers (RFC 0009) cannot reach a scoped collection: a job over scoped rows reads a view, behind a policy the kind
can satisfy, or is fired per tenant by something that knows the tenant. **X103** already refuses a session write
naming an attribute the shape does not declare, so X1n1 only has to refuse the one it does declare and a store scopes
by; and `token.port.json#issue` is not a session write in X103's sense, so the sign-in's one write stands. **X206**
refuses a `where` naming a scope column, since it is not a field of the shape; **X204** has already settled which
collection a call names before the compiler reads its `scoped`.

**Why A0n2 is an A rule and not an invariant.** RFC 0007's I001 holds every trigger reaching a *domain operation* to a
policy, named in an invariant document. `behind` is the same judgement over a *data site* -- a node reading a view --
and the author writes it once, on the view, rather than enumerating the domain operations whose bindings happen to
reach the view under each profile. The walk is `effectsReachable`, and which site is over a view is `collectionOf`.

### Runtime behaviour

**The compiler.** One thing lowers differently, and nothing runs differently for it. `lowerGraph` and the binding
lowering in `packages/compiler/src/lower.ts`, at every call site of `@storage/store.port.json` whose `collectionOf`
is a scoped collection, give the site's `scope` input `{ object: { <column>: { ref: 'request', path: [...] } } }`
from the store's read, exactly what `lowerRef` makes of `{{tenant}}` on a graph. The engine hands the handler
`{ tenant: 'acme' }`. No node is added, nothing runs: a scope is a source reference like any resolver read.

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

**The guard** changes nothing. `fromToken` in `packages/plugin-auth/src/guard.ts` already loads the session record on
every verified token, to know the session has not ended, and hands its attributes as `request.session.attributes`; a
scope read there costs no read the guard did not make. The token carries what it carries -- `sub`, `realm`, `roles`,
`sid` and the standard claims -- and `SessionRecord` holds what it holds. `identity.port.json#verify` reads the
account's `attributes` (a directory connection) or the claims the type's fields name (an OIDC identity token), judges
them with `conforms` against the type when one is given, as `judged` does for a session write, and answers them under
`identity.attributes`.

**The embedder** changes nothing: the request reaches the graph as `initial.request` and the scope reads a path into
it, as every resolver does.

**`rehearse`, `fuzz`, `regress`.** Unchanged. Storage operations are effects and are stubbed (RFC 0002: no rehearsal
reaches an engine); the rehearsal generates a request with a session for a gated trigger and the scope reads it;
`fuzz` records the node's `in`, scope included, and `regress` replays it. What the rehearsal proves about scoping is
what the checker proved: a tree that passes `wilanis check` has no operation over a scoped collection without its
scope, and the branch walk exercises each with one. That two tenants never see each other's rows is the engine's
promise, and the shared suite is where it is tested (*Tests*); it is not a property a stubbed run can observe, and
this RFC does not pretend otherwise.

### Discoverability

- `wilanis describe <store>` (RFC 0003's marks in `packages/runtime/src/discovery.ts`) prints the store's `reads`
  block as RFC 0029 prints a graph's, and per scoped collection `scoped by  <column> ← {{<name>}}  (guaranteed at N
  trigger(s) by <policies>)`, the policies being those whose `proves` cover the read on the triggers that reach the
  collection, and beneath it `written at sign-in by <graph>#<node>, ...`: every call site of
  `@auth/token.port.json#issue`, found through the bindings the way `describe` finds any native site, whose
  `attributes` gives the key -- so a reader sees where the value a scope trusts was decided; `unique` gains `(within
  the scope)`. A view prints `view of <collection>, behind <policy>` and, beside each reader, the triggers reaching
  it and that each attaches the policy.
- `wilanis describe <resolvers document>` (RFC 0029) lists, under `used by`, the store as `@monitor/data/entries.store.json
  as {{tenant}} (scopes entries)`.
- `wilanis describe <graph>` (`nodeLines`) prints `scope tenant ← {{tenant}} of @monitor/data/entries.store.json` after
  a storage node's line: what the compiler carries there, named.
- `wilanis describe <trigger>` prints, after its policies, `reaches every-entry (a view) behind
  @access/edge/employees-only.policy.json: attached`.
- `wilanis map` prints a scoped store as `store entries (get, scoped by tenant)` and a view as `view every-entry (find)`.
- The viewer (`packages/view/src/graphs.ts`, `ports.ts`; `renderDocPage` in `client/index.html`): a storage node over a
  scoped collection carries a `scope` badge naming the column and linking the store page, from documents alone; the
  store page draws its `reads` as a graph's request node is drawn -- one port per read, each opening its resolvers
  document -- marks a scoped column with the read that fills it, and draws a view as a second entry linking the viewed
  collection and the policy; the trigger page's *Gated by* list marks the policy a view requires.

### Plugin contract

`PluginModule` is unchanged. `PluginCheckContext` (`packages/core/src/plugin.ts`) is unchanged: X2n1 reads the store
through `scope`; X1n1 reads every `store` through `scope.registry.all('store')` and its resolvers documents through
`scope.get('resolvers', path)`, core kinds both. The auth plugin learns which session attributes a store scopes by
and nothing of what the storage plugin does with them; the storage plugin learns nothing of sessions. The compiler's
`effectsReachable`, `graphNeeds` and `collectionOf` are the compiler's; a plugin never imports them, which is why
A0n1 and A0n2 -- the rules that need the walk -- are the compiler's and not a plugin's.

## Compatibility

IR v1, compatible. `store.schema.json` gains optional `reads`, `scoped`, `view` and `behind`; `store.port.json`
gains an optional `scope` on six operations; `Engine` gains a parameter every engine implements; lowering fills
`scope` only at sites over a scoped collection, and a tree with none lowers as before. `@auth/identity.port.json#verify`
gains an optional `type`, and `Account.shape.json` and `Identity.shape.json` an optional `attributes`; the guard's
`plugin.json`, the token's claims and `SessionRecord` are unchanged, so a token issued before this RFC verifies after
it and a session opened before it reads as it did. A store, a graph, a binding written before this RFC validates and
means what it meant: no scope, every row. No `schemas-v2`.

The stub's dependency on RFC 0007 is dropped, and its citation of `check/access.ts` for A006 corrected to
`check/triggers.ts`; neither file changes for that.

## Tests

Sabotage tests through `sabotage` in `packages/runtime/test/example-harness.ts` (copy the example, edit one document,
answer the codes), in a new `sabotage-scoping.test.ts`, once the example keeps its entries in a scoped store (step 9):

| Code | The edit |
|---|---|
| C0n1 | `"scoped": { "url": "{{tenant}}" }` (a field of the shape); `"acme"`; `"{{tenant}}-eu"`; `"{{tenant.id}}"`; `"{{in.tenant}}"`; `"{{agent}}"` with `agent` not under the store's `reads`; the resolver `tenant` without `required`; its read changed to `request.principal.roles` (a list); to `request.principal.claims.tenant` (open, so unknown); `settings.session` removed from the `@auth` plugin in `project.json` (the attribute reads unknown; the access tree's own refusals filtered) |
| C0n2 | `"view": "nope"`; `"view": "every-entry"` (a view of a view); a view with `"of"` beside it; `"behind": "@access/edge/nope.policy.json"` (R001) |
| P004, P005 | `"reads": { "tenant": "...#nope" }`; a second `reads` entry no `scoped` reads |
| A0n1 | the resolver `tenant` read changed to `request.headers['x-tenant']`; to `request.params.id`; to `request.body.tenant`; the `@auth` plugin removed from `project.json` (with the access feature's other refusals filtered) |
| A0n2 | `employees-only` dropped from `digest.trigger.json` |
| A006 | `signed-in` dropped from `get-entry.trigger.json`: the message names `request.session`, read by the store |
| B008 | a startup step naming `@monitor/domain/monitor.port.json#count` over `entries`: the message names the store's read |
| X2n1 | `"scope": { "tenant": "{{tenant}}" }` written on `asked` in `get-record.graph.json` (the M11 demo: "the agent added the filter by hand"); on the `find` over `every-entry`; on a `newKey` |
| X1n1 | `"values": { "theme": "{{in.theme}}", "tenant": "globex" }` in `write-theme.graph.json`; `"keys": ["tenant"]` on a `session.port.json#remove`; the same through a binding delegation |
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
| `collectionOf` | `packages/runtime/test/example.test.ts` | the `get` node of `get-record.graph.json` names `entries`; the digest's `rows` names `every-entry`; an http node names nothing |
| the scope edge | `packages/runtime/test/example.test.ts` | `opNeeds` of `monitor.port.json#get` includes `request.session.attributes.tenant`, required; of `#digest` it does not |
| lowering | `packages/runtime/test/example.test.ts` | the lowered `get-record` graph's `asked` node has `scope.tenant` as `{ ref: 'request', path: ['session', 'attributes', 'tenant'] }`, and no node was added; the lowered `digest-rows` graph's `rows` has no `scope` |
| the view gate under a profile | `sabotage-scoping.test.ts` | a second profile binding `digest` to a graph that reads `entries`: A0n2 is not raised; binding it to the view graph without the policy: raised, naming the profile |
| the schema | `packages/core/test/validate.test.ts` | the baseline store gains `reads`, a scoped collection and a view; a view with `of`, a `scoped` whose value is not a string, a `reads` value without `#`, and `view` without `behind` are refused |

Discoverability, in `packages/runtime/test/tools.test.ts`: `describe` of the store prints `reads`, `scoped by`,
`within the scope` and `view of`; `describe` of the resolvers document prints `used by ... (scopes entries)`; `map`
prints `scoped by tenant`. Viewer, in `packages/view/test/view.test.ts`: the `get-record` view's `asked` node carries
the `scope` badge; the store page carries the read, the scope and the view.

Access, in `libraries/access/test`: a customer of the directory the access tree tests against carries
`attributes.tenant`, sign-in writes it into the session, and the session the guard hands on the next call has
`attributes.tenant` and the token's claims do not; the employee sign-in writes the operator's tenant; a customer whose
account lacks the attribute fails the sign-in's `checked` node with the directory's words. In
`packages/plugin-auth/test`: `verify` with `type` over a directory account whose `attributes` fit, and one whose do
not; over the fake OIDC issuer, the claims the type's fields name are read and the rest are not; `verify` without
`type` answers what it answered before.

## Implementation plan

1. Core: `store.schema.json`, `StoreDoc` and `StoreCollection` gain `reads`, `scoped`, `view`, `behind`; the validate
   baseline; the template row; the `wilanis new store` scaffold. (`good first issue`, after RFC 0003's step 1 and
   RFC 0029's step 1)
2. Compiler: `collectionOf` in `documents.ts` over the `resolves` channel; the scope edge in `graphNeeds` and
   `effectsReachable` (RFC 0011's step if it has not landed); C0n1 and C0n2 in `checkStore`, P005 over the store's
   `reads`. Sabotage tests, including the A006 and B008 cases that need only the edge.
3. Compiler: A0n1 in `check/access.ts`; A0n2 with its per-profile test.
4. Compiler: lowering fills `scope` at every site over a scoped collection.
5. Plugin: `scope` on the six operations of `store.port.json` and the *Scopes* paragraph; X2n1 in `rules.ts`; the
   handlers' run-time judgement of `scope`.
6. Plugin: `Engine` takes `scope`; the memory engine; the shared suite's scope cases.
7. Plugin: `@storage-postgres` -- the column, the composite unique, the index, the predicate on every statement,
   `ensure` and `drift`; the postgres suite.
8. Runtime: `describe <store>`, `<resolvers>`, `<graph>`, `<trigger>` and `map` lines. (`good first issue`)
9. Auth plugin: `verify` gains `type` (`$I`), `Identity.shape.json` and `Account.shape.json` gain `attributes`, the
   handler reads and judges them for both directory kinds; X1n1 in `rules.ts`. Tests in `packages/plugin-auth/test`.
10. The example, the M11 demo: `libraries/access` -- the customer directory's accounts carry `attributes.tenant` (two
    values), the `identity.binding.json` delegation of `verifyCustomer` and `verifyEmployee` gives `verify` the
    tree's identity-attributes shape, `Session.shape.json` gains `tenant` (required), `sign-in-customer.graph.json`
    writes it from `{{checked.identity.attributes.tenant}}` and `sign-in-employee.graph.json` from a constant;
    `Principal.shape.json`, the guard's `plugin.json` and the token are untouched. The example's monitor feature: the
    `request.resolvers.json` gains `tenant` reading `request.session.attributes.tenant`; the store gains `reads`,
    `scoped` and `every-entry`; no storage node changes; `get-entry` and `list-entries` attach `signed-in`; the
    digest's graph reads the view and its trigger attaches `employees-only`; `sabotage-scoping.test.ts`; the README's
    storage paragraph gains a sentence on scope.
11. Viewer: the `scope` badge; the store page's `reads`, scope and view. Test.

## Drawbacks and alternatives

- **The read is bound on the store, in the tree's grammar for a read.** Three earlier drafts spelled the scope's
  source three other ways. A bare name, `"scoped": { "tenant": "tenant" }`, said nothing about its kind, and the call
  site had to repeat `"scope": { "tenant": "{{tenant}}" }`, with the checker catching the site that forgot: a document
  in which to forget it after all. A `{ "resolver": "tenant" }` object said the kind but invented a key no other
  document uses. A port operation, `"tenant": "@monitor/domain/monitor.port.json#tenant"`, used a notation the tree
  reserves for `run` keys -- a trigger's `fire`, a policy's `decide`, a binding, a startup step -- and let a
  profile's binding decide what a caller is, per call, which is the swap this RFC exists to forbid; its gain, a
  computed scope, belongs at sign-in. RFC 0029 gives a store what a data graph has: `reads` binds the read and says
  where it is declared, `{{tenant}}` is the tree's one spelling of a read, and the compiler, not the author, carries
  it to every site. The cost is one edge in the compiler's walk and one lowering step that fills an input; the gain is
  that no document carries a scope, so none can forget one, and the proof is an identity judged in one place over a
  value that passed through nothing.
- **A session attribute, not a principal field.** The first full draft read the scope from `request.principal.tenant`,
  which made `tenant` a field the guard hands: a claim `issueTokens` signs, a field `fromToken` lifts, a column of
  `SessionRecord`, a field of `guard.context`, and an input of `token.port.json#issue` -- the same fact in five places
  of a plugin that should not know it, and a plugin release for every tree whose word is not `tenant`. The guard
  already hands `request.session.attributes`, typed by the shape the project names and written once by the sign-in
  graph; the tenant is one more attribute of it, declared where the tree declares its session, and the guard is as
  ignorant of it as of `displayName`. The cost is one rule the move opens: a session attribute can be written again
  through `session.port.json#set`, where a claim in a token cannot, so X1n1 holds a scoped attribute to its sign-in
  write. What the move does not cost is a read: the guard loads the session record on every verified token already.
  `realm` and `roles` sit in both places today, a claim and (for `realm`) an attribute written by the same node;
  whether they should be attributes too is a question about the guard, not about scoping, and is left where RFC 0020
  draws the guard's contract.
- **A configurable claim set.** Considered: the sign-in graph composes the token's payload -- one port call or one
  literal per claim, an object nowhere -- and the store names the claim. The composition exists: `issue.attributes` is
  that object, each value a node's output, a constant or a literal, typed by the shape the sign-in's port names, and
  the store reads the attribute. What a claim set would add is a second carrier beside the session, readable by the
  client without the key (a JWT's payload is signed, not sealed) and a second typing question (`principal.claims` is
  open, so a claim types `unknown`). If the guard ever verifies statelessly -- no session read on a call -- which
  session attributes fold into the token becomes a setting of the plugin (`tokens.claims: [...]`, read back into
  `session.attributes` on verification), and the store's read is unchanged. Not this RFC's. Where sessions live
  between calls -- files, memory, PostgreSQL, a cache -- is RFC 0005's, and this RFC reads them wherever they are.
- **What the directory says is the one plugin change kept.** A tenant has to come from somewhere, and in the demo it
  comes from the directory: the first draft's "the identities carry a tenant" hid a change to `@auth/Identity.shape.json`
  that would have taught the plugin the word from the other side. `verify`'s `type` and `Identity.attributes: $I` teach
  it a mechanism instead -- a directory hands attributes, and the tree says which, the way `settings.session` says
  which a session holds. The alternative, deriving a tenant from a group name (`tenant:acme`), asks the sign-in graph
  to parse a string and puts the business word in the directory's group list; the other alternative, a plugin setting
  `identity` beside `session` binding `$Identity` for every directory at once, is compatible later if a tree wants
  one shape for all its directories, and `type` at the call site is what the session port does today.
- **The store keeps the tenant; the shape does not.** The stub asked whether the scoped field exists on the shape.
  It does not, and that is the design: a domain graph cannot read the request (L002), so a tenant on the shape would
  have to arrive through the trigger's `fire.in` and the domain graph's `make`, and the value the store writes would
  then come from what the caller sent, exactly the provenance the rule refuses. Keeping it in the store puts the scope
  where the request is read, in the data layer, and lets `Entry` mean an entry. The cost is that a domain graph that
  wants to *display* the tenant reads it through `in` from the trigger, like any request value, and that value is not
  the scope: the scope is the store's.
- **Several scopes.** `scoped` is a map, so a collection may be scoped by a tenant and an owner at once, each column
  filled from its read; the compiler carries every key. The stub's second question is answered by not choosing.
- **A view is the exemption, and it is a document.** The alternative -- `"scope": "*"`, or a flag on the node, or a
  policy named at the call site -- puts the exemption where the hole was. A view is a collection: `describe` lists
  who reads it, the viewer draws it, and A0n2 holds every trigger reaching it to one policy the store named.
  Its cost is a second collection entry per crossing, which is the price of being able to find them all.
- **One read, not a computation.** A scope is `{{name}}` and nothing else: no interpolation, no field of a read, no
  graph between the guard and the column. An employee's tenant is therefore decided at sign-in and written into the
  session, not derived from the realm at every call; a "subject → tenant" membership table is read at sign-in, once,
  and its answer written where the guard hands it back. Tracking identity through pure nodes, or admitting a read of
  a store whose every writer is behind a named policy, is future work with a real cost and no case in the example
  that needs it. A rule that is narrower than the truth and never wider is the right one here.
- **Not row-level security.** Stated under *Runtime behaviour*: one rule, one place, both engines.
- **A `Field.scoped` contract keyword** -- the dual of `static`, judged generically in `inputs.ts`'s `readOf` --
  was considered. It would judge the *form* of a value at a call site, and there is no value at the call site any
  more; the storage knowledge stays where RFC 0003 put it, in the plugin, and the judgement of the store's read in
  `checkStore`.

## Open questions

Settled here, with the reasoning in the text: the scope is the store's column and not the shape's field; a
collection may have several; a view behind a policy is the one way across; the scope is one read the store binds
under `reads` in RFC 0029's grammar, and the compiler carries it to every storage site so no document writes it;
the engine enforces the predicate and the checker proves the document, and the rehearsal observes neither; the value
the example's scope reads is a session attribute the project declared and the sign-in wrote, never a field the
guard's plugin learns.

To decide during implementation:

1. Whether `describe <store>` names the policies that guarantee the scope (the *Discoverability* line's `by
   signed-in, employees-only, can-record`) or only the count, since the list is per trigger and can be long.
2. Whether a view may be `behind` more than one policy (`behind: [a, b]`, all attached) or exactly one, as written;
   one is enough for the example, and a list is compatible later.
3. Whether the `(tenant, id)` index on postgres is the primary key's order or a second index; the suite judges
   behaviour and the planner (RFC 0017) may later prefer one.
4. Whether `verify`'s `type` stays at the call site or a plugin setting `identity` binds `$I` for every directory of
   the tree; the call site is the session port's pattern and enough for the example.
