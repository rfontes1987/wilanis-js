/**
 * @wilanis/view: a viewer for wilanis trees. `viewOf` answers what a page needs to draw one document
 * (a graph's nodes, typed ports, edges and where each operation leads; every kind's references and
 * callers), `indexOf` lists the tree, `serveView` serves both and the page over HTTP.
 */
export { viewOf, indexOf, labelOf, readable, type DocView, type VNode, type VPort, type VEdge, type VRef, type VTarget, type VNodeKind, type TreeIndex, type IndexEntry } from './model.js';
export { serveView, versionOf, type ServeViewOptions, type ViewServer } from './serve.js';
