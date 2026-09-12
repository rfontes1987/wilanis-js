/**
 * @wilanis/plugin-storage-memory, the @storage-memory engine: an @storage store kept in a Map for as long as
 * the process lives. It grants one connection kind and no port -- what may be asked of a store is @storage's
 * business -- and it is a package of its own rather than an entry point of @storage, because "every engine is
 * a plugin" is the design and the first two engines both obeying it is what keeps that claim honest.
 *
 * It registers itself from `postLoad`, the hook whose meaning is "the tree is loaded and judged", which is
 * exactly when an engine may exist. It opens nothing, so it holds nothing to tear down.
 */
import { fileURLToPath } from 'node:url';
import type { PluginModule } from '@wilanis/core';
import { engines } from '@wilanis/plugin-storage';
import { MemoryEngine } from './engine.js';

export { MemoryEngine } from './engine.js';

const ROOT = '@storage-memory';
const KIND = `${ROOT}/memory.connection-kind.json`;

const plugin: PluginModule = {
  root: ROOT,
  docs: fileURLToPath(new URL('../docs', import.meta.url)),
  handlers: {},
  async postLoad(ctx) {
    engines(ctx.env).register(ctx.scope.canon(KIND), new MemoryEngine());
  },
};
export default plugin;
