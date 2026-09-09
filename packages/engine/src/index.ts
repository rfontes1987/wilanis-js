/**
 * @wilanis/engine: the stateless kernel. It knows nodes, sources, handlers and pre-supplied values; nothing
 * about files, references, shapes, ports or triggers. The compiler lowers a graph document to a KernelSpec.
 */

export * from './kernel.js';
export { redactValue } from './redact.js';
export { nodeRefs, PSEUDO, readPath, refsOf } from './sources.js';
export * from './spec.js';
