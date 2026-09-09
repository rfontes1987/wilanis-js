# @wilanis/runtime

Everything that runs a wilanis tree, and the `wilanis` command line.

```
npm install @wilanis/runtime @wilanis/plugin-http
npx wilanis new project board .
npx wilanis check .
```

- `loadProject(root)` loads a tree with its plugins: the builtins `@std` and `@cli`, plus every package
  `project.json` names in `plugins[].from`, imported from the project's `node_modules`.
- `Embedder` fires a trigger: input mapping, compile once per graph, run, judge and prune the answer.
- `start(load)` runs every plugin's `postLoad`, then the project's `startup` steps -- and nothing else. What listens is what those steps say: a step naming a `holds` operation (`@http/server.port.json#listen`) opens the server, and a tree that names none serves nothing. Answers `{ stop, held }`: how many things are held, and the way to stop them, in reverse, before the postLoad teardowns.
- `runStartup(load, emb, log)` runs `project.json → startup` in order: each step fires one port operation, so a pool is opened, a watcher started or a port listened on where a reader can see it. A step that refuses stops the start and exits nonzero unless it says `"required": false`.
- `Served` is the tree a listener answers from. A `holds` operation reads it as `env.serving` and re-reads it per request, so `reload()` can put a freshly loaded and judged tree behind a socket that never closed -- what `@reload` drives.
- `rehearse`, `fuzz`, `regress` are the gates: every trigger with stubbed effects, recorded scenarios, replay and diff.
- `ls`, `describe`, `map` are discovery; `describe` names the plugin behind a native document (`granted by  @http  (@wilanis/plugin-http)`), so who implements an operation is read rather than grepped; `scaffold` writes new documents; `wilanis init` writes `CLAUDE.md` and agent hooks into a tree.
- `FileBlobStore` is the blob registry: one file per blob under `project.json → blobs.dir` (default: under the system temp dir), streamed in and out, so a file is held once and never as a value. The embedder hands every run a scope of it; `serve` releases a request's blobs once answered. `wilanis run --file path` hands a file as `request.file`; `--out path` receives a blob answer.

Depends on `@wilanis/core`, `@wilanis/engine`, `@wilanis/compiler`.

Part of [wilanis](https://github.com/wilanis/wilanis-js). Apache-2.0.
