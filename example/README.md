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
npm run serve            # GET /monitor[?method=], POST /monitor, GET|PUT|DELETE /monitor/{id}, DELETE /monitor, GET|POST /monitor.csv on :8080
```

`project.json → startup` names one step, `monitor.port.json#listAll`, which reads the entries once before the
HTTP server opens: if the API is unreachable, `serve` says so and exits rather than answering every route
with a fault. It is a domain port operation, so whichever binding the profile chose is what gets checked.

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
