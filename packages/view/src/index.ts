/**
 * @wilanis/view: a viewer for wilanis trees. `viewOf` answers what a page needs to draw one document
 * (a graph's nodes, typed ports, edges and where each operation leads; every kind's references and
 * callers), `indexOf` lists the tree, `serveView` serves both and the page over HTTP, and `writeSite` writes the
 * same answers as static files, for a tree shown from a host that runs nothing.
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
export { type SiteOptions, siteOf, writeSite } from './static.js';
