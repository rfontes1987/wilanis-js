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
