/**
 * @wilanis/plugin-storage, the @storage plugin: records of a shape behind one generic port. It says what a
 * store is and what may be asked of one; how the records are kept is an engine plugin's business, reached
 * through the `Engine` contract and the table `engines(env)` holds. This package carries no driver, speaks no
 * engine's language, and depends on core and engine alone.
 */
import { fileURLToPath } from 'node:url';
import type { PluginModule } from '@wilanis/core';
import { handlers } from './handlers.js';

export type { At, Engine, Engines, Order, Query, Record_ } from './engine.js';
export { engines } from './engine.js';
export type { Operator, Test, Where } from './where.js';
export { OPERATORS, parseWhere, whereOf } from './where.js';

const plugin: PluginModule = {
  root: '@storage',
  docs: fileURLToPath(new URL('../docs', import.meta.url)),
  handlers,
};
export default plugin;
