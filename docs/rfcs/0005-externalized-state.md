# RFC 0005: Externalized state: every store behind a port the project binds

- **Status:** draft
- **Milestone:** A credible backend
- **Areas:** `area:plugin-auth`, `area:plugin-blob`, `area:runtime`, `area:plugin-storage`
- **Tracking issue:** #NNN (opened when the RFC is proposed)
- **Depends on:** RFC 0002 (the `@storage` plugin: records of a declared shape behind a connection)

## Summary

A tree's documents never say where its state lives; its profile does. Today two things persist on the local
filesystem of the process that runs the tree: the `@auth` plugin's sessions and challenges, and the blob
registry's bytes. After this RFC the auth plugin keeps its memory through a port it *requires* and the host
binds -- to `@storage` collections in production, to the plugin's own file store in development -- and the
blob registry's backing store is a connection the project names, with an S3-compatible object store as the
first external one. The engine stays deterministic; state is provided by explicit effect providers; and a tree
runs on many instances without a single document under `features/` changing.

## Motivation

`wilanis start` on two machines behind a load balancer breaks today in two ways, and neither shows in
`wilanis check`:

- A caller signs in on instance A, which writes `.wilanis/auth/sessions/<id>.json`. Their next request lands
  on instance B, whose guard finds no session and refuses with `invalid_credential`. The one-time code flow
  breaks the same way: the challenge is opened on one process and answered on another. Sessions and
  challenges are process-local because `packages/plugin-auth/src/store.ts` is a directory of JSON files,
  chosen by `settings.store.dir`, a setting only the plugin reads.
- Blobs live in `FileBlobStore` (`packages/runtime/src/blobs.ts`): a directory under `project.json → blobs.dir`
  or the system temp dir, and a `held` map of handles that exists only in the process that wrote them. Within
  one request this is right, and it stays right. But nothing in the model lets a deployment say "the bytes go
  to a bucket", so a tree that must survive a restart or run on several instances cannot say so.

Both are the same defect: a store chosen by code rather than by a binding. The rest of the model already
has the answer. A domain port is met by a binding the profile chooses (`profiles.<name>.bindings`), and an
included tree leaves `identity.port.json` open for the host to bind, refused by B002 until it does. This RFC
extends that precedent to a plugin: a plugin may ship a port it does *not* implement and require the host to
bind it.

This RFC does not add persistence of records to the language -- that is RFC 0002 -- and does not make a
blob outlive the run that produced it (a stored file is a `@storage` record holding a handle, a later RFC).
It does not add a cache, a queue or a lock; those are stores of their own with their own RFCs.

## Guide-level explanation

**A plugin may require a port.** A port a plugin grants is native: the plugin implements it and B003 refuses a
binding of it. A port a plugin *requires* is the opposite: the plugin ships the contract under its `docs/`,
calls it from its own code, and the host decides how it is met, exactly as the host binds an included tree's
open port. `@auth` requires one such port, its memory:

```json
{
  "$schema": "@wilanis/port.schema.json",
  "label": "The guard's memory",
  "description": "Where sessions and challenges live between calls. Required by @auth and bound by the host: to the plugin's own file store for one process, to @storage collections for many.",
  "operations": {
    "getSession":          { "accepts": { "key": { "type": "string" } }, "returns": { "fields": { "record": { "type": "@auth/SessionRecord.shape.json", "required": false } } } },
    "putSession":          { "accepts": { "record": { "type": "@auth/SessionRecord.shape.json" } } },
    "endSession":          { "accepts": { "key": { "type": "string" } }, "returns": { "fields": { "record": { "type": "@auth/SessionRecord.shape.json", "required": false } } } },
    "findSessionByRefresh":{ "accepts": { "refreshHash": { "type": "string" } }, "returns": "@auth/SessionRecord.shape.json[]" },
    "getChallenge":        { "accepts": { "key": { "type": "string" } }, "returns": { "fields": { "record": { "type": "@auth/ChallengeRecord.shape.json", "required": false } } } },
    "putChallenge":        { "accepts": { "record": { "type": "@auth/ChallengeRecord.shape.json" } } },
    "removeChallenge":     { "accepts": { "key": { "type": "string" } } }
  }
}
```

(Descriptions elided; every operation carries one.) The operations answer the way `@storage/store.port.json`
answers -- `{ record? }` for a read or a removal, a list for a find, the stored record for a put -- so a
delegation to it fits without a graph in between (B005). The host binds it in a feature of its own, one
delegation per operation, the way `example/features/directories/data/identity.binding.json` binds identity.
In development, to the file store the plugin still ships, now as a native port (`key` and `record` pass
from the operation's `accepts` by name, as a delegation lets them):

```json
{
  "$schema": "@wilanis/binding.schema.json",
  "label": "The guard's memory in files",
  "description": "Sessions and challenges as one JSON file each under .wilanis/auth: one process, a laptop.",
  "port": "@auth/state.port.json",
  "operations": {
    "getSession":           { "run": "@auth/files.port.json#get",    "in": { "collection": "sessions",   "type": "@auth/SessionRecord.shape.json" } },
    "putSession":           { "run": "@auth/files.port.json#put",    "in": { "collection": "sessions",   "type": "@auth/SessionRecord.shape.json" } },
    "endSession":           { "run": "@auth/files.port.json#remove", "in": { "collection": "sessions",   "type": "@auth/SessionRecord.shape.json" } },
    "findSessionByRefresh": { "run": "@auth/files.port.json#find",   "in": { "collection": "sessions",   "type": "@auth/SessionRecord.shape.json", "field": "refreshHash", "equals": "{{in.refreshHash}}" } },
    "getChallenge":         { "run": "@auth/files.port.json#get",    "in": { "collection": "challenges", "type": "@auth/ChallengeRecord.shape.json" } },
    "putChallenge":         { "run": "@auth/files.port.json#put",    "in": { "collection": "challenges", "type": "@auth/ChallengeRecord.shape.json" } },
    "removeChallenge":      { "run": "@auth/files.port.json#remove", "in": { "collection": "challenges", "type": "@auth/ChallengeRecord.shape.json" } }
  }
}
```

In production, to `@storage` (RFC 0002). The host declares what it keeps, a store document in the same
feature, its two collections `of` the shapes `@auth` grants:

```json
{
  "$schema": "@wilanis/store.schema.json",
  "label": "The guard's memory",
  "description": "Sessions and challenges of the @auth plugin, kept where the state connection points: memory alone, PostgreSQL behind a load balancer.",
  "connection": "@connections/state.connection.json",
  "collections": {
    "sessions":   { "of": "@auth/SessionRecord.shape.json",   "key": "id" },
    "challenges": { "of": "@auth/ChallengeRecord.shape.json", "key": "id" }
  }
}
```

and binds the same seven operations to `@storage/store.port.json`, every delegation naming the store, the
collection and the collection's shape as `type`, the way RFC 0002's example binds the monitor's entries:

```json
{
  "$schema": "@wilanis/binding.schema.json",
  "label": "The guard's memory in a store",
  "description": "Sessions and challenges as records of auth.store.json: every instance of the tree sees the same ones.",
  "port": "@auth/state.port.json",
  "operations": {
    "getSession":           { "run": "@storage/store.port.json#get",    "in": { "store": "@features/state/data/auth.store.json", "collection": "sessions",   "type": "@auth/SessionRecord.shape.json" } },
    "putSession":           { "run": "@storage/store.port.json#put",    "in": { "store": "@features/state/data/auth.store.json", "collection": "sessions",   "type": "@auth/SessionRecord.shape.json" } },
    "endSession":           { "run": "@storage/store.port.json#remove", "in": { "store": "@features/state/data/auth.store.json", "collection": "sessions",   "type": "@auth/SessionRecord.shape.json" } },
    "findSessionByRefresh": { "run": "@storage/store.port.json#find",   "in": { "store": "@features/state/data/auth.store.json", "collection": "sessions",   "type": "@auth/SessionRecord.shape.json", "where": { "refreshHash": "{{in.refreshHash}}" }, "limit": 1 } },
    "getChallenge":         { "run": "@storage/store.port.json#get",    "in": { "store": "@features/state/data/auth.store.json", "collection": "challenges", "type": "@auth/ChallengeRecord.shape.json" } },
    "putChallenge":         { "run": "@storage/store.port.json#put",    "in": { "store": "@features/state/data/auth.store.json", "collection": "challenges", "type": "@auth/ChallengeRecord.shape.json" } },
    "removeChallenge":      { "run": "@storage/store.port.json#remove", "in": { "store": "@features/state/data/auth.store.json", "collection": "challenges", "type": "@auth/ChallengeRecord.shape.json" } }
  }
}
```

`key` and `record` pass through by name; `put` answers the stored record, which the port ignores since
`putSession` returns nothing. The feature lists the seven `@storage/store.port.json` operations under
`feature.json → effects` (L003). A collection's `of` here names a shape a plugin grants rather than a core
shape of a feature: this RFC widens RFC 0002's X201 to accept either, since a granted shape is visible to
every feature and is already legal as a type in any contract. The alternative, the host copying the two
records into core shapes of its own, would make the plugin's record layout the host's to keep in step.
The profile picks:

```json
"profiles": {
  "live":       { "bindings": { "@auth/state.port.json": "@features/state/data/auth-files.binding.json" } },
  "production": { "bindings": { "@auth/state.port.json": "@features/state/data/auth-storage.binding.json" } }
}
```

Forget to bind it and the checker says so, as it does for any open port:

```
B002  project.json#profiles/production/bindings
    profile 'production': '@auth/state.port.json' (required by @auth) has no binding
    → wilanis new binding state/auth-storage --port @auth/state.port.json
```

**The blob registry names its store.** `project.json → blobs` gains `connection`: a connection whose kind a
plugin offers a blob store for. Absent, the registry is the file store it is today.

```json
"blobs": { "connection": "@connections/uploads.connection.json" }
```

```json
{
  "$schema": "@wilanis/connection.schema.json",
  "label": "Uploads bucket",
  "kind": "@s3/bucket.connection-kind.json",
  "settings": { "endpoint": "https://s3.eu-west-1.amazonaws.com", "region": "eu-west-1", "bucket": "monitor-uploads", "accessKeyId": "{{secrets.s3Key}}", "secretAccessKey": "{{secrets.s3Secret}}" }
}
```

Nothing under `features/` changes: a graph still holds a handle, a codec still streams a body in and out, and
the bytes now stream to and from the bucket.

## Reference

### Documents and schemas

- `plugin.schema.json` gains `requires.ports`: paths under the plugin's `docs/` of ports the plugin calls but
  does not implement. A path may not appear under both `grants.ports` and `requires.ports` (D0nn). The
  `PluginDoc` interface in `model.ts` mirrors it. The loader (`load.ts`) registers a required port as a domain
  port with no feature, `native: undefined`, `requiredBy: '@auth'`, so `bindingFor` and B002 apply to it unchanged.
- `project.schema.json → blobs` gains `connection` (a `path`), beside `dir`. `ProjectDoc` mirrors it.
- `@auth/plugin.json`: `settings.store` is removed; `requires.ports: ["@auth/state.port.json"]`;
  `grants.ports` gains `@auth/files.port.json`; `grants.shapes` gains `@auth/SessionRecord.shape.json` and
  `@auth/ChallengeRecord.shape.json`, the two records `packages/plugin-auth/src/settings.ts` already types.
- `HOME` in `placement.ts`: no change. A binding of a required port is a binding: `data/` of a feature.
- `packages/runtime/templates/CLAUDE.md`: a paragraph under bindings, "a port a plugin requires is yours to bind".
- `wilanis new project` scaffolds `features/state/` with the file binding when `@auth` is among the plugins,
  and `wilanis init` leaves an existing tree alone.

### Ports, operations and kinds granted

`@auth`:

- `@auth/state.port.json`, **required**: the seven operations above. None `pure`. `SessionRecord` is `id`,
  `subject`, `realm`, `roles`, `createdAt`, `refreshHash?`, `refreshExpiresAt?`, `attributes` (an open object;
  the session shape judges it in the plugin, as `judged()` does today). `ChallengeRecord` is `id`, `method`,
  `policy`, `trigger`, `subject?`, `createdAt`, `expiresAt`, `attempts`, `codeHash?`, `codeExpiresAt?`.
- `@auth/files.port.json`, **granted**: `get`, `put`, `remove`, `find` over `collection` (static, `sessions` |
  `challenges`), `dir` (static, optional, default `.wilanis/auth`, relative to the tree), `type` (binds `$R`).
  `get` takes `key` and answers `{ record?: $R }`; `put` takes `record: $R` and answers it; `remove` takes `key` and
  answers `{ record?: $R }`; `find` takes `field` and `equals` and answers every record whose field is equal, `$R[]`:
  a scan, and it says so. The same answers as `@storage/store.port.json`, so either meets `state.port.json` unchanged.
  This is `Store` from `store.ts` behind a contract, one file per record as today.

`@s3` (`@wilanis/plugin-s3`, new): `@s3/bucket.connection-kind.json` with `endpoint`, `region`, `bucket`,
`prefix?`, `accessKeyId` (secret), `secretAccessKey` (secret), `forcePathStyle?`. It grants no port: the store
is reached by the runtime through the plugin contract, never by a graph, since no graph touches bytes.

`@storage` (RFC 0002) grants `@storage/store.port.json`, what the production binding delegates to; nothing is
added to it. X201 is widened so that a collection's `of` may name a shape a plugin grants.

### Checker rules

| Code | Where it lives | Refuses when | Hint |
|---|---|---|---|
| B002 (existing) | `check/project.ts` `checkPortMet` | a required port has no binding under a profile; the message gains `(required by @auth)` | `wilanis new binding <feature>/<name> --port <path>` |
| B0nn | `check/bindings.ts` | a binding of a required port names `resolvers`, or one of its graphs reads `request.*`: the guard runs before the policies, with no request judged yet | remove `resolvers`; a state operation reads only its `in` |
| B0nn | `check/bindings.ts` | a binding of a required port delegates to an operation that `holds` or `refuses`: memory answers or fails, it never ends the run on purpose | delegate to `@auth/files.port.json` or `@storage/store.port.json` |
| C0nn | `check/project.ts` | `blobs.connection` names a connection whose kind no named plugin offers a blob store for, or names no connection | `wilanis ls connection-kind`; name a plugin that offers one |
| D0nn | `validate.ts` / loader | a plugin lists a path under both `grants.ports` and `requires.ports`, or a required port is not under its `docs/` | list it once |
| X10n | `packages/plugin-auth/src/rules.ts` | `@auth/files.port.json` is delegated to with a `dir` that is not under the tree, or under a directory the loader reads (`features/`, `connections/`) | `.wilanis/auth`, or an absolute path outside the tree |

Numbers are assigned when the implementing pull request lands (current highest: A006 B008 C002 D010 G013 L008
P003 R001 S001 T006, X103).

### Runtime behaviour

- **Firing a required port from a plugin.** The embedder (`packages/runtime/src/embed.ts`) adds `env.ports` to
  the environment handlers see: `(op: string, input: Record<string, unknown>) => Promise<unknown>`, which runs the
  active profile's binding for `op` as a nested run, the way a binding graph already runs nested for a domain
  operation, and answers the operation's `returns`. It refuses any `op` not under a port some plugin requires,
  so a handler cannot reach an arbitrary domain port. A refusal or a failure inside the binding surfaces as a
  thrown error in the handler, which the guard turns into `invalid_credential` for a missing session and into a
  failed run for an unreachable store, as an unreachable directory does today.
- **The auth plugin.** `storeOf(env)` in `settings.ts` disappears. `tokens.ts` and `guard.ts` call
  `env.ports('@auth/state.port.json#getSession', { key })` and the six others. `refresh` calls
  `findSessionByRefresh(sha(refreshToken))` and takes the first record instead of listing every session;
  `sessionEnd` answers `ended` as whether `endSession` answered a record. Lifetimes stay the plugin's:
  a session ends when `refreshExpiresAt` has passed (checked on read, then `endSession`), a challenge when
  `expiresAt` has passed or `attempts` reaches the limit (`removeChallenge`), and `settle` removes an answered
  challenge as today. A store may purge expired records on its own; the plugin never relies on it.
- **The guard's ordering.** `Embedder.gate` runs `identify` before any policy. The state binding therefore runs
  with no `request.*` in scope, which the B0nn rule above guarantees statically.
- **The blob registry.** `Embedder`'s constructor builds `this.blobs` from `blobs.connection` when present: it
  finds the plugin whose `PluginModule.blobStores` maps the connection's kind to a factory, and calls it with the
  connection's settings, secrets substituted. `FileBlobStore` stays the default. The `BlobStore` interface in
  `plugin.ts` is unchanged: `put` streams to the store, `open` streams from it, `drop` deletes, `scope()` deletes
  what a run put when the run releases. The S3 store implements `put` as a multipart upload fed by the source
  stream, counting `size` as bytes pass, and `open` as the body stream of a get; nothing is buffered whole,
  which keeps the invariant `blobs.ts` states.
- **Handles across instances.** `FileBlobStore.open` refuses a handle its `held` map has not seen. An external
  store cannot: a handle written on instance A is opened on instance B. The S3 store keys objects
  `<prefix>/<run id>/<uuid>` and `open` refuses a handle whose `id` is not of that form; whether a handle also
  carries an HMAC over `id`, `contentType` and `size` so that a forged handle opens nothing is an open question.
- **`wilanis start`.** A tree wants its store reached before it listens. The example's startup gains a step
  `{ "label": "Reach the guard's memory", "run": "@auth/state.port.json#getSession", "in": { "id": "startup" } }`:
  an absent session answers `{}`, an unreachable store fails the step, and `runStartup` in `serve.ts` refuses
  to serve, the existing behaviour. B006 is widened: a startup step may name a required port, since it is a
  domain port for every purpose. The blob store is opened in the constructor; a bucket that cannot be reached
  fails the first `put`, so `@s3`'s `postLoad` probes the bucket once and fails the start when it cannot.
- **Stubbed gates.** `rehearse`, `fuzz`, `regress` and `run --seed` never call the guard, never run `postLoad`,
  and stub every effect: a `@storage` delegation in the state binding is stubbed like an `http.request`. A
  rehearsal still exercises the binding's graphs, if any. The blob registry of a stubbed run is the temp file
  store, as today.

### Discoverability

- `wilanis describe @auth/state.port.json` prints `required by  @auth  (@wilanis/plugin-auth)` in the block that
  today prints `granted by`, then `bound by  profile live → @features/state/data/auth-files.binding.json` for
  every profile (`discovery.ts`, the function that answers who granted a document).
- `wilanis describe @auth/plugin.json` lists `requires` after `grants`.
- `wilanis map` shows the state port under the guard, once, not under every gated trigger.
- `wilanis describe project.json` prints the blob store: `blobs  files under .wilanis/blobs` or
  `blobs  @connections/uploads.connection.json (@s3/bucket.connection-kind.json)`.
- The viewer's plugin page lists required ports with the binding each profile chose; the port page shows the
  same `bound by` lines.

### Plugin contract

`PluginModule` in `packages/core/src/plugin.ts` gains one optional member:

```ts
/** connection-kind path -> the blob store a connection of that kind opens, for project.json → blobs.connection. */
blobStores?: Record<string, (settings: Record<string, unknown>) => BlobStore & { close?(): Promise<void> }>;
```

`PostLoadContext.env` and a handler's `ctx.env` gain `ports`, typed in `plugin.ts` as `FirePort`. No plugin
imports another: `@auth` names `@storage` nowhere; the host's binding does.

## Compatibility

IR v1 changes in place, before 1.0: `plugin.schema.json` gains `requires`, `project.schema.json → blobs` gains
`connection`, and `@auth/plugin.json` drops `settings.store`. A project that still writes `settings.store` is
refused with C002 and the hint names this RFC. `example/`, `libraries/access` and the runtime's templates are
updated in the same pull request. No document under a feature changes meaning.

## Tests

Sabotage, in `packages/runtime/test/example.test.ts` (copies of the example hand `@wilanis/access` in as a
`ResolvedInclude`):

- delete the state binding from the `live` profile → B002 naming `@auth/state.port.json` and `required by @auth`;
- add `resolvers` to the state binding → B0nn; delegate `getSession` to `@http/server.port.json#listen` → B0nn;
- set `blobs.connection` to `@connections/monitor-api.connection.json` → C0nn;
- list `@auth/state.port.json` under `grants.ports` in a copied plugin manifest → D0nn (`packages/core/test/validate.test.ts`);
- delegate `files.port.json#get` with `dir: "features"` → X10n (`packages/plugin-auth/test`).

End to end:

- `packages/plugin-auth/test`: sign-in, refresh, the OTP challenge and `settle`, run twice: once with the
  file binding, once with `state.port.json` bound to an in-memory fake `@storage` module registered through
  `loadTree`'s plugin map, asserting the same records reach both.
- `packages/plugin-auth/test`: two `Embedder`s over the same tree and the same store, a token issued by one
  verified by the other.
- `packages/plugin-s3/test`: `put` of a 10 MB stream, `open` back, `scope().release()` deleting, against an
  in-process fake implementing the handful of S3 calls used (put, multipart create/upload/complete, get, delete),
  with a memory-usage assertion that the store held no buffer the size of the body.
- `packages/runtime/test`: `wilanis start` on a tree whose state store is unreachable exits nonzero before listening.

## Implementation plan

1. `plugin.schema.json → requires`, `PluginDoc`, the loader registering a required port as an open domain port,
   D0nn, B002's message; `wilanis describe` lines. (`area:core`, `area:compiler`, `area:runtime`)
2. `env.ports` in the embedder, limited to required ports; B0nn on bindings of required ports. (`area:runtime`, `area:compiler`)
3. `@auth/state.port.json`, the two record shapes, `@auth/files.port.json`; `tokens.ts` and `guard.ts` over
   `env.ports`; `settings.store` removed; X10n. (`area:plugin-auth`)
4. The example's `features/state/`, the access tree's `-dev` binding, the runtime templates, the startup step;
   the sabotage tests. (`area:runtime`, `good first issue` for the templates and CLAUDE.md row)
5. `project.json → blobs.connection`, `PluginModule.blobStores`, C0nn, `Embedder` choosing the store. (`area:core`, `area:runtime`)
6. `@wilanis/plugin-s3`: the connection kind, the streaming store, the fake, the tests, `docs/`. (new package)
7. `auth.store.json`, the production binding of `state.port.json` over `@storage/store.port.json`, X201 widened,
   once RFC 0002 has landed; the two-instance test.

Steps 1 to 4 need nothing from RFC 0002 and can land first.

## Drawbacks and alternatives

- **Seven operations instead of a generic store port.** Requiring `@storage/store.port.json` itself would
  be shorter, but a binding binds every operation once, so the host could not choose per collection, and the
  checker could not type the records. Concrete operations cost lines and buy B005 on every one.
- **A plugin calling a host-bound port** adds a second direction to the plugin contract: the runtime not only
  calls plugins, plugins ask the runtime to run a binding. The alternative, an `AuthStore` interface a second
  plugin implements and the runtime wires by name, would be code a reader of the tree cannot see, which is the
  thing the model refuses. `env.ports` is the smallest version: it fires bindings, never graphs by path, and
  only under ports a manifest requires.
- **Blob stores as connections rather than a new document kind.** A `blob-store` kind was considered and
  rejected: a connection already carries settings, secrets and a kind a plugin grants, and C001/C002 judge it.
- **Putting S3 in `@blob`.** Rejected: `@wilanis/plugin-blob` has no external dependency and reads rows out of
  files; the AWS client is a dependency and a concern of its own, so it is its own package.
- **A TTL in the store** (`expiresAt` respected by `@storage`) would purge dead sessions without the plugin's
  help. It is left to RFC 0002 to offer and to this plugin to ignore: correctness never depends on the purge.

## Open questions

Before `accepted`:

- Does a handle carry an HMAC so that a forged handle opens nothing on an external store, or is the
  `<prefix>/<run id>/<uuid>` key shape enough given that a graph can only hold handles the runtime issued?
- Does `findSessionByRefresh` stay, or does `refresh` look the session up by `sid` carried in the refresh
  token, removing the only non-key read from the port? The second is simpler for every store and changes the
  refresh token's shape.
- Is the state binding in its own feature (`features/state/`) or beside identity in `features/directories/`?

During implementation:

- The exact shape of `env.ports`' error when the binding refuses, and what `wilanis run` prints for it.
- Whether `@s3`'s `postLoad` probe is a `HeadBucket` or a `put`/`drop` of one byte under the prefix.
