import type { PluginModule } from '@wilanis/core';
import { cli } from './cli-trigger.js';
import { std } from './std.js';

/** The plugins built into the runtime: pure operations and command-line triggers. Every other plugin is a package named by `from` in project.json. */
export const BUILTIN_PLUGINS: Record<string, PluginModule> = { '@std': std, '@cli': cli };
