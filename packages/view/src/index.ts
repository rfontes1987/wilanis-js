/**
 * @wilanis/view: a viewer for wilanis trees. `viewOf` answers what a page needs to draw one document
 * (a graph's nodes, typed ports, edges and where each operation leads; every kind's references and
 * callers), `indexOf` lists the tree, `serveView` serves both and the page over HTTP.
 */
export {
  type DocView,
  type IndexEntry,
  indexOf,
  labelOf,
  readable,
  type SchemaView,
  schemaRelOf,
  schemaViewOf,
  type TreeIndex,
  type VEdge,
  type VNode,
  type VNodeKind,
  type VPort,
  type VRef,
  type VTarget,
  viewOf,
} from './model.js';
export { type ServeViewOptions, serveView, type ViewServer, versionOf } from './serve.js';
