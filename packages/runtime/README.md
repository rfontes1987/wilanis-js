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
- `serve(load)` runs every plugin's `postLoad`, then the project's `startup` steps, then starts every trigger kind; the function it answers stops them and runs the teardowns.
- `runStartup(load, emb, log)` runs `project.json → startup` in order: each step fires a domain port operation once, before anything listens, so a pool is opened or a queue declared where a reader can see it. A step that refuses stops serving and exits nonzero unless it says `"required": false`.
- `rehearse`, `fuzz`, `regress` are the gates: every trigger with stubbed effects, recorded scenarios, replay and diff.
- `ls`, `describe`, `map` are discovery; `scaffold` writes new documents; `wilanis init` writes `CLAUDE.md` and agent hooks into a tree.
- `FileBlobStore` is the blob registry: one file per blob under `project.json → blobs.dir` (default: under the system temp dir), streamed in and out, so a file is held once and never as a value. The embedder hands every run a scope of it; `serve` releases a request's blobs once answered. `wilanis run --file path` hands a file as `request.file`; `--out path` receives a blob answer.

Depends on `@wilanis/core`, `@wilanis/engine`, `@wilanis/compiler`.

Part of [wilanis](https://github.com/rfontes1987/wilanis-js). Apache-2.0.
