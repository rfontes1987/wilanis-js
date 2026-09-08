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

Depends on `@wilanis/core`, `@wilanis/engine` and `jose`.

Part of [wilanis](https://github.com/rfontes1987/wilanis-js). Apache-2.0.
