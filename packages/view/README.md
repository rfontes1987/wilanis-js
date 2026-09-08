# @wilanis/view

A viewer for wilanis trees. Every graph is drawn as a canvas: one box per node, its inputs down the left
with the literal written for each (a filled pin is required, a hollow one optional), its outputs down the
right as the fields of what the operation answers, and an edge for every `{{node.field}}` read, from the
field to the input that reads it. Each node has a colour, and every edge wears the colour of the node it
feeds. A decision fans out one dashed edge per rule, labelled with the rule. The output node shows the
fields the graph answers, fed by its candidates in order. A node that runs a domain port carries an arrow:
click it, or double-click the node, and the canvas becomes the graph that implements it. The browser's
back button walks back.

A document's kind badge, a node's kind in the details panel, and every `$schema`, node `type` or `$ref`
in the source view open the schema that judges it, read from the installed `@wilanis/core` rather than
fetched from the network, so the page shows the schema version the tree is actually judged against.

Everything is named by its `label` (a document's, a node's, a resolver's), or by its file name made
readable when none is written. Every other kind of document has a page of its own: a trigger as the chain
it fires, a port as its operations and the bindings that meet them, a binding as how each operation is
met, a shape as its fields, the project as its plugins and profiles. The JSON is one click away behind
"source". The side panel names what a document uses and, in the other direction, everything that reaches
it, including the graph nodes that reach a data graph through its port operation.

```
npm install --save-dev @wilanis/view
npx wilanis-view .              # http://127.0.0.1:4400/
npx wilanis-view . --port 4500 --open
```

Open `http://127.0.0.1:4400/#@features/tasks/graphs/create.graph.json` to land on a document. The tree
is reloaded on every request, so a saved edit shows on the next paint; the page polls for changes and
repaints by itself. Refusals from `wilanis check` are shown on the document they belong to.

## From code

```ts
import { loadProject } from '@wilanis/runtime';
import { viewOf, indexOf, serveView } from '@wilanis/view';

const load = await loadProject(root);
indexOf(load);                              // every document, every refusal
viewOf(load, '@features/x/y.graph.json');   // nodes, ports, edges, target of each call, refs and callers
const s = await serveView(root, { port: 4400 });
await s.close();
```

`viewOf` is pure over a loaded tree and answers JSON; the page under `client/` is one static file that
lays it out. An editor preview is a web view pointing at the same server with the open file's path in
the hash.
