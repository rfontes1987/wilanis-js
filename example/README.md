# monitor

A wilanis project: a monitor of observed HTTP calls whose routes talk to a public REST API
(`https://6aa009e23e0d88d3d7e5525d.mockapi.io/api/v1/monitor`), with sign-in, sessions and policies over its
writes, and a command-line greeting gated by a one-time code. Everything in this directory is JSON;
`package.json` installs the runtime and the plugin packages it uses. The API needs no key; the one secret is
the key our tokens are signed with, `MONITOR_JWT_SECRET`, which `start` and `run` need in the environment.

```
npm install
export MONITOR_JWT_SECRET=$(openssl rand -base64 32)
npm run check            # wilanis check .
npm run rehearse         # every trigger, every policy, every branch of every switch, effects stubbed
npm run digest           # wilanis run @monitor/edge/digest.trigger.json .  -- the count and one line per entry, for real
npm run start            # GET /monitor[?method=], POST /monitor, GET|PUT|DELETE /monitor/{id}, DELETE /monitor, GET|POST /monitor.csv,
                         # POST /api/v1/auth-customers | auth-employees | token/refresh | sign-out, GET|PUT /api/v1/me/preferences on :8080
npm run hello            # wilanis run @hello/edge/hello-gated.trigger.json .  -- challenged until a one-time code is answered
```

## Who may do what

Reads are public. Every write (`POST /monitor`, `PUT|DELETE /monitor/{id}`, `DELETE /monitor`, `POST /monitor.csv`)
attaches two policies, and gives the guard the token where the route reads it:

```json
"policies": [
  { "policy": "@access/edge/employees-only.policy.json",
    "in": { "token": ["{{request.headers.authorization}}", "{{request.cookies.session}}"] } },
  "@access/edge/can-record.policy.json"
]
```

The `access` feature is not written here: `project.json → includes` names `@wilanis/access` (`libraries/access` in
this workspace), and its `features/access` loads as if it sat in this tree -- the same paths, the same rules,
`included from @wilanis/access` in `wilanis describe` and the viewer. What this project adds is `features/directories`:
the binding of the included `identity.port.json` to this project's two directory connections. It has two sign-in routes. `POST /api/v1/auth-employees` verifies the credential against the
employee directory (`connections/employees.connection.json`: bo / bo-pass holds the `recorder` group, cy / cy-pass
only `viewer`); `POST /api/v1/auth-customers` against the customer directory (ana / ana-pass). Both are directories
written in the connection, for development; a production profile binds the same `identity.port.json` to an
OIDC issuer or LDAP, in `features/directories`, and nothing in the included tree changes. Either way the caller gets **our** token, signed by the `@auth`
plugin: the sign-in graph writes the realm (`employee`, `customer`) and the directory's groups as roles, and
that is the domain's decision, not the caller's. Present it as `Authorization: Bearer ...`; the route also sets
it as the `session` cookie, so a browser needs no header.

```
curl -s localhost:8080/api/v1/auth-employees -d '{"username":"bo","password":"bo-pass"}' -H 'content-type: application/json'
curl -s localhost:8080/monitor -d '{"url":"https://x.example/","method":"GET"}' -H 'content-type: application/json' -H "authorization: Bearer $TOKEN"
```

On a write, the `@auth` guard verifies the token and hands `request.principal`; then `employees-only` decides on the
realm (a customer's perfectly valid token is `forbidden`, a 403) and `can-record` on the role (cy is `forbidden` too;
no token is `anonymous`, a 401; a bad token is `invalid_credential`, a 401). Each decision is a domain graph in
`features/access/domain/require-*.graph.json`, one `switch` each -- `has(principal) && 'recorder' in principal.roles`
-- and `wilanis rehearse` walks every branch of every one of them. The policies map each reason to deny; the
routes map each reason to a status.

## The session

`PUT /api/v1/me/preferences {"theme":"dark"}` stores the theme in the caller's session and `GET` reads it back on a
later call, with the same token or a refreshed one (`POST /api/v1/token/refresh` trades the refresh token for a new
pair and spends the old one). The session's attributes are the core shape `Session.shape.json`, named by the
plugin's `settings.session`; sign-in writes `displayName` and `realm` into it, `savePreferences` writes `theme`, and
`wilanis describe @access/domain/Session.shape.json` lists who writes what. The session id reaches the data graphs
as `{{sid}}` through `session.resolvers.json`, declared `required` because the `signed-in` policy proves it.
`POST /api/v1/sign-out` ends the session: its tokens stop verifying and the cookie is cleared.

## The one-time code

```
$ npm run hello
{ "reason": "otp", "message": "this command needs a one-time code",
  "challenge": { "id": "K7Q2-M9XA", "method": "otp", "expiresAt": "..." },
  "how": "wilanis run @access/edge/issue-otp.trigger.json --challenge-id=K7Q2-M9XA; then repeat this call with --challenge-id=K7Q2-M9XA --code=<code>" }
$ npx wilanis run @access/edge/issue-otp.trigger.json . --challenge-id=K7Q2-M9XA
{ "id": "K7Q2-M9XA", "code": "482913", "expiresAt": "..." }
$ npx wilanis run @hello/edge/hello-gated.trigger.json . --challenge-id=K7Q2-M9XA --code=482913
{ "greeting": "hello, gated" }
```

`hello-gated` attaches the `otp-verified` policy, giving the guard the challenge answer from `--challenge-id` and `--code`; the policy's outcome for `otp` is a challenge. The
guard opens one and tells the caller how to answer it in the kind's own words; `issue-otp` gives it a code
(printed here, delivered by whatever a production profile binds `deliverCode` to); the guard verifies the code
the caller presents and hands `request.challenge`, the policy allows, and the challenge is spent by the run.
The three processes share the challenge through the plugin's store under `.wilanis/auth/`.

`project.json → startup` says what this tree starts, in order, and nothing else runs. `monitor.port.json#listAll`
reads the entries once: if the API is unreachable, `start` says so and exits rather than answering every route
with a fault. `@reload/watch.port.json#watch` serves the tree again whenever a document changes, without
closing the port. `@http/server.port.json#listen` opens :8080 -- **delete that step and nothing listens**, since
no runtime opens a port merely because http triggers exist. The first is a domain port operation, so whichever
binding the profile chose is what gets checked; the last two are `holds` operations, which a plugin grants and
the runtime stops when the process ends. `wilanis describe @http/server.port.json` says which plugin grants it.

`monitor.port.json` is what the domain needs: `listAll`, `listByMethod`, `get`, `record`, `update`,
`remove`, `parseDrafts`, `toCsv`, `removeMany`, `submit`, `list`, `digest`, `import`, `export`. `monitor-rest.binding.json` meets the first eight with a data
graph each, which issues one declared request and decides with a `switch` on `status` what the answer means:
the rows, the declared refusal `no entry {id}` with reason `missing` when the API answers 404, or the refusal
`upstream` for anything else. The http triggers map those two words to statuses (`"refusals": { "missing": 404, "upstream": 502 }`),
so the graphs never mention HTTP and a client is told `{ "reason": "missing", "message": "no entry 7" }` with a 404. The
last four are met by domain graphs that compose those operations: `list` routes on whether a method filter
is present, `submit` attributes the entry to its recorder and records it, `removeMany` maps `remove` over the ids,
`digest` counts the entries and lays them out as text. The API's misspelled `reponseStatus` lives in
the edge shape `EntryRow` and never reaches the domain.

`POST /monitor.csv` takes a CSV file (`url,method` per line) and `GET /monitor.csv` answers one. The file never
enters a graph: `text/csv` is mapped to the blob codec in `project.json`, so the upload streams into the blob
registry and the route hands the domain a handle; `import-entries` has the data layer read it as drafts
(`@blob/csv.port.json#parse`, typed by `EntryDraft`) and submits each one the way a single POST is;
`export-entries` lists everything and has the data layer write `monitor.csv` (`#write`), which the route streams
back as a download. Both operations are effects, listed in `feature.json`.

`DELETE /monitor` takes a body of ids (`{"ids": ["1", "2"]}`) and fires `removeMany`; the domain graph
`remove-entries` maps `remove` over the ids, so every deletion is issued at once and the answer -- the
deleted entries, in the order asked -- leaves only after the last one settled. One id that does not exist
refuses the whole batch as `missing`, a 404. The connection paces this: `monitor-api.connection.json` declares
`"throttle": { "concurrency": 4 }`, so however many ids arrive, at most four requests are in flight
against the API at a time.

Inside the wilanis workspace this directory is a workspace member and resolves the packages locally.
Copied elsewhere, the same `package.json` installs them from npm.
