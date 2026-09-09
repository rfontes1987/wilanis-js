# @wilanis/core

The wilanis document language.

- `schemas/`: one JSON Schema per document kind (project, feature, shape, port, binding, graph, trigger,
  connection, scenario, and the kinds plugins ship: plugin, trigger-kind, connection-kind, codec), plus the
  node types under `schemas/node/`. Served from `main` so documents can name them by URL; a tag marks each published version from 1.0 on.
- `model.ts`: the TypeScript types that mirror the schemas, `schemaUrl`, `kindOfSchema`; `registry.ts`: `Registry`, `RefusalList`, `Loaded`.
- `types.ts`: the type system the checker reasons with, with `assign.ts` (`assignable`, `unify`, `substitute`),
  `values.ts` (`typeAt`, `conforms`, `toJsonSchema`) and `generate.ts` (values under a seed).
- `expr/`: the switch expression grammar -- its AST, lexer, parser, type checker and evaluator.
- `templates.ts`: the grammar of a `{{root.path}}` read; `scope.ts`: the semantic view over a registry that the
  compiler, runtime and plugins share.
- `validate.ts`: Ajv validation of one document against its kind.
- `load.ts`: loading a tree into a `Registry` with aliases and plugin roots; `documents.ts` reads one document
  in, `placement.ts` says where each kind lives (D008), `paths.ts` walks and names files.
- `plugin.ts`: the `PluginModule` contract a plugin package fulfils: the directory of documents it ships, its handlers, and the `check` and `postLoad` hooks.

Nothing here executes anything. Depends on `@wilanis/engine` for the handler and report types, and on Ajv.

Part of [wilanis](https://github.com/wilanis/wilanis-js). Apache-2.0.
