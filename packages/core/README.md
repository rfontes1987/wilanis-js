# @wilanis/core

The wilanis document language.

- `schemas/`: one JSON Schema per document kind (project, feature, shape, port, binding, graph, trigger,
  connection, scenario, and the kinds plugins ship: plugin, trigger-kind, connection-kind, codec), plus the
  node types under `schemas/node/`. Published from the `schemas-v1` branch so documents can name them by URL.
- `model.ts`: the TypeScript types that mirror the schemas, `Registry`, `RefusalList`, `schemaUrl`, `kindOfSchema`.
- `types.ts`: the type system the checker reasons with (`assignable`, `typeAt`, `conforms`, `generate`).
- `expr.ts`: the switch expression grammar.
- `validate.ts`: Ajv validation of one document against its kind.
- `load.ts`: loading a tree into a `Registry` with aliases and plugin roots.
- `scope.ts`: the semantic view over a registry that the compiler, runtime and plugins share.
- `plugin.ts`: the `PluginModule` contract a plugin package fulfils: the directory of documents it ships, its handlers, and the `check` and `postLoad` hooks.

Nothing here executes anything. Depends on `@wilanis/engine` for the handler and report types, and on Ajv.

Part of [wilanis](https://github.com/rfontes1987/wilanis-js). Apache-2.0.
