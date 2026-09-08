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
- `serve(load)` runs every plugin's `postLoad`, then starts every trigger kind; the function it answers stops them and runs the teardowns.
- `rehearse`, `fuzz`, `regress` are the gates: every trigger with stubbed effects, recorded scenarios, replay and diff.
- `ls`, `describe`, `map` are discovery; `scaffold` writes new documents; `wilanis init` writes `CLAUDE.md` and agent hooks into a tree.

Depends on `@wilanis/core`, `@wilanis/engine`, `@wilanis/compiler`.

Part of [wilanis](https://github.com/rfontes1987/wilanis-js). Apache-2.0.
