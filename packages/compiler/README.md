# @wilanis/compiler

`checkTree(load)` judges a loaded tree against every rule and answers a `RefusalList`: each refusal with
its code, file, location and hint. Rule families: D documents, R references, L layers and effects, G
graphs, P params and resolvers, B bindings and profiles, T triggers, C connections and settings, S
scenarios; plugins add X through their `check` hook.

`Compiler` lowers a judged graph to an engine spec: every `path#operation` becomes a handler, a plugin
function or a nested spec for a domain port's binding; resolver templates become edges; constants are
baked; secret paths are marked for redaction. `buildEnv` builds the environment handlers see;
`runGraph` runs a compiled graph once.

Depends on `@wilanis/core` and `@wilanis/engine`.

Part of [wilanis](https://github.com/rfontes1987/wilanis). Apache-2.0.
