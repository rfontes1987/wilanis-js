# @wilanis/plugin-http

The `@http` plugin for wilanis: routes as triggers with JWT access control, outbound requests
(`@http/http.port.json#request`), HTTP connections, and body codecs (json, text, form, multipart).

```
npm install @wilanis/plugin-http
```

```json
{ "use": "@http", "from": "@wilanis/plugin-http", "settings": {
    "port": 8080,
    "codecs": { "application/json": "@http/codecs/json.codec.json" },
    "jwt": { "secret": "{{secrets.jwt}}", "rolesClaim": "role" } } }
```

Which codec handles which content type is the project's explicit table. Triggers say `consumes` and
`produces`; the plugin's `check` hook refuses (X001, X002) any content type the table does not cover.
`wilanis describe @http/http.trigger-kind.json` lays out the settings and the context a route hands.

Files never pass through the engine. A content type mapped to `@http/codecs/blob.codec.json` is streamed
into the tree's blob registry as it arrives, and the route's input is the handle (`blob`: id, contentType,
size, filename). A route whose `out` is `blob` and whose `produces` maps to the blob codec streams the file
back from the registry with its own content type and a `content-disposition` attachment. Multipart file
parts stream into the registry the same way and arrive as `blob` values beside the text fields. Every blob a
request created is released once the route has answered.

```json
"codecs": { "application/json": "@http/codecs/json.codec.json", "text/csv": "@http/codecs/blob.codec.json" }
```

A route answers a report in three ways. An answer takes the status `response.status` chooses: `default`, or
`from` a path into the answer through `map`. A refusal -- a graph ending on purpose at `@std/outcome.port.json#refuse`
-- is answered as `{ "reason", "message" }` with the status `response.refusals` maps its reason to; the trigger
kind declares that map as where reasons are answered, so `wilanis check` requires every reason the route can
reach to be mapped (T005) and nothing mapped that it cannot reach (T006). A fault (a node that broke) is a 500.

```json
"settings": { "route": "/tasks/{id}", "method": "GET",
  "response": { "refusals": { "missing": 404, "upstream": 502 } } }
```

A connection may pace the requests made against it with `throttle`: `concurrency` is the most in flight at
once, `perSecond` the most started in any one second. Every node that names the connection shares the one
gate, so a `map` that fans out one request per element is held to it; a request past the limit waits, nothing
is dropped. The `check` hook refuses (X003) a throttle that could let nothing through.

```json
{ "kind": "@http/http.connection-kind.json",
  "settings": { "baseUrl": "https://api.example/v1", "throttle": { "concurrency": 4, "perSecond": 10 } } }
```

Depends on `@wilanis/core`, `@wilanis/engine` and `jose`.

Part of [wilanis](https://github.com/rfontes1987/wilanis-js). Apache-2.0.
