# monitor

A wilanis project: a monitor of observed HTTP calls whose routes talk to a public REST API
(`https://6aa009e23e0d88d3d7e5525d.mockapi.io/api/v1/monitor`). Everything in this directory is JSON;
`package.json` installs the runtime and the one plugin package it uses. The API needs no key, so nothing
here reads a secret and `serve` runs with no environment.

```
npm install
npm run check            # wilanis check .
npm run rehearse         # every trigger, every branch of every switch, effects stubbed
npm run digest           # wilanis run @monitor/edge/digest.trigger.json .  -- the count and one line per entry, for real
npm run serve            # GET /monitor[?method=], POST /monitor on :8080
```

`monitor.port.json` is what the domain needs: `listAll`, `listByMethod`, `get`, `record`, `update`,
`remove`. `monitor-rest.binding.json` meets each with a data graph that issues one declared request and
decides with a `switch` on `status` what the answer means: the rows, the declared refusal `no entry {id}`
when the API answers 404, or a failure for anything else. The API's misspelled `reponseStatus` lives in
the edge shape `EntryRow` and never reaches the domain.

Inside the wilanis workspace this directory is a workspace member and resolves the packages locally.
Copied elsewhere, the same `package.json` installs them from npm.
