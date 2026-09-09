# @wilanis/engine

The wilanis kernel. Stateless and clockless: it takes a `KernelSpec` (nodes, sources, handlers by name),
pre-supplied values, and runs every node the instant its sources have settled, concurrently. It routes
through switches, cancels the branches not taken, and answers a `Report` at quiescence: `done` with an
output, `failed` with the node that threw, or `blocked` with the root paths it still needs. A handler that
throws a `Refusal` ends the run on purpose: the node's report carries its `reason`, and `refusalOf(report)`
answers it, so an embedder can tell a declared outcome from a fault.

It knows nothing about files, references, shapes, ports or triggers. `@wilanis/compiler` lowers a graph
document to a spec; `@wilanis/runtime` embeds it. Depends on nothing.

```ts
import { Kernel } from '@wilanis/engine';
const report = await new Kernel(handlers).run(spec, { initial: { in: { x: 21 } } });
```

`initial` pre-supplies values: the pseudo-nodes `in` and `request`, any node by id (the node is `seeded`,
not executed -- that is replay), and one element of a `map` as `'<id>.<index>'`. A map settles only once
every element has, and its report lists each element's outcome in `items`, so after a failure the embedder
can seed the elements that answered and run only the rest.

Part of [wilanis](https://github.com/wilanis/wilanis-js). Apache-2.0.
