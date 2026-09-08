import { std } from './std/index.js';
import { http } from './http/index.js';
import { schedule } from './schedule/index.js';
import { cli } from './cli/index.js';
import type { PluginModule } from './plugin.js';

/** Every plugin this toolchain ships, by alias root. */
export const BUILTIN_PLUGINS: Record<string, PluginModule> = { '@std': std, '@http': http, '@schedule': schedule, '@cli': cli };
