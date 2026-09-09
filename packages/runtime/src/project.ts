/**
 * Loading a project for the runtime: the builtin plugins plus every plugin package project.json names with
 * `from`, resolved from the project's own node_modules and imported. Only npm package names are accepted
 * there, so a JSON document can never point at an arbitrary file on disk.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type LoadResult, loadTree, type PluginModule, type Refusal, type ResolvedInclude } from '@wilanis/core';
import { BUILTIN_PLUGINS } from './plugins/index.js';

const PACKAGE_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

export interface PluginResolution {
  available: Record<string, PluginModule>;
  refusals: Refusal[];
}

/** The array project.json holds under one key, or none when the file or the key is not there. loadTree reports D000 / D005. */
function listedIn(root: string, key: 'plugins' | 'includes'): unknown[] {
  try {
    const found = JSON.parse(readFileSync(join(root, 'project.json'), 'utf8'))[key];
    return Array.isArray(found) ? found : [];
  } catch {
    return [];
  }
}

/** Import every plugin project.json names with `from`, on top of the builtins and `extra`. */
export async function resolvePlugins(
  root: string,
  extra: Record<string, PluginModule> = {},
): Promise<PluginResolution> {
  const available: Record<string, PluginModule> = { ...BUILTIN_PLUGINS, ...extra };
  const refusals: Refusal[] = [];
  const require = createRequire(join(root, 'package.json'));
  for (const [at, entry] of listedIn(root, 'plugins').entries()) {
    const named = entry as { use?: unknown; from?: unknown };
    if (!named || typeof named !== 'object' || typeof named.from !== 'string' || typeof named.use !== 'string')
      continue;
    const found = await pluginFrom(require, named.from, named.use, `plugins/${at}/from`);
    if ('refusal' in found) refusals.push(found.refusal);
    else available[named.use] = found.plugin;
  }
  return { available, refusals };
}

/** One D006: what a plugin entry got wrong. */
const badPlugin = (at: string, message: string, hint: string): Refusal => ({
  code: 'D006',
  file: 'project.json',
  at,
  message,
  hint,
});

/** The plugin one entry names, imported and checked to be the plugin it says it is. */
async function pluginFrom(
  require: NodeJS.Require,
  from: string,
  use: string,
  at: string,
): Promise<{ plugin: PluginModule } | { refusal: Refusal }> {
  if (!PACKAGE_NAME.test(from))
    return {
      refusal: badPlugin(
        at,
        `'${from}' is not an npm package name`,
        'from names a published package, never a file path',
      ),
    };
  let mod: Record<string, unknown>;
  try {
    mod = (await import(pathToFileURL(require.resolve(from)).href)) as Record<string, unknown>;
  } catch (error) {
    return {
      refusal: badPlugin(
        at,
        `cannot load plugin package '${from}': ${(error as Error).message}`,
        `npm install ${from}`,
      ),
    };
  }
  const plugin = (mod.default ?? mod.plugin) as PluginModule | undefined;
  if (!plugin || typeof plugin !== 'object' || typeof plugin.root !== 'string' || !plugin.docs)
    return {
      refusal: badPlugin(
        at,
        `'${from}' does not export a wilanis plugin`,
        'a plugin package exports its PluginModule as default',
      ),
    };
  if (plugin.root !== use)
    return {
      refusal: badPlugin(at, `'${from}' is the plugin '${plugin.root}', not '${use}'`, `"use": "${plugin.root}"`),
    };
  return { plugin };
}

/**
 * Where each tree project.json includes sits: the package's directory, resolved from the project's own node_modules.
 * Only npm package names are accepted, as for plugins: a JSON document never points at a file on disk.
 */
export function resolveIncludes(root: string): { includes: ResolvedInclude[]; refusals: Refusal[] } {
  const includes: ResolvedInclude[] = [];
  const refusals: Refusal[] = [];
  const require = createRequire(join(root, 'package.json'));
  for (const [at, entry] of listedIn(root, 'includes').entries()) {
    const named = entry as { from?: unknown; features?: unknown };
    if (!named || typeof named !== 'object' || typeof named.from !== 'string') continue;
    const found = includeFrom(require, { ...named, from: named.from }, `includes/${at}/from`);
    if ('refusal' in found) refusals.push(found.refusal);
    else includes.push(found.include);
  }
  return { includes, refusals };
}

/** One D010: what an include entry got wrong. */
const badInclude = (at: string, message: string, hint: string): Refusal => ({
  code: 'D010',
  file: 'project.json',
  at,
  message,
  hint,
});

/** Where the tree one entry includes sits, resolved from the project's own node_modules. */
function includeFrom(
  require: NodeJS.Require,
  named: { from: string; features?: unknown },
  at: string,
): { include: ResolvedInclude } | { refusal: Refusal } {
  if (!PACKAGE_NAME.test(named.from))
    return {
      refusal: badInclude(
        at,
        `'${named.from}' is not an npm package name`,
        'from names a published package, never a file path',
      ),
    };
  try {
    return {
      include: {
        from: named.from,
        dir: dirname(require.resolve(`${named.from}/package.json`)),
        ...(Array.isArray(named.features) ? { features: named.features.map(String) } : {}),
      },
    };
  } catch (error) {
    return {
      refusal: badInclude(
        at,
        `cannot find the included package '${named.from}': ${(error as Error).message}`,
        `npm install ${named.from}`,
      ),
    };
  }
}

/** Load the tree at root with its plugins and includes resolved: builtins, `extra`, and the packages project.json names. */
export async function loadProject(
  root: string,
  opts: { plugins?: Record<string, PluginModule>; includes?: ResolvedInclude[] } = {},
): Promise<LoadResult> {
  const { available, refusals } = await resolvePlugins(root, opts.plugins);
  const resolved = resolveIncludes(root);
  const load = loadTree(root, available, [...(opts.includes ?? []), ...resolved.includes]);
  refusals.push(...resolved.refusals);
  // a plugin whose package failed to load is reported once, with the install hint, not also as unknown
  const failed = new Set(refusals.map(refusal => refusal.at?.replace(/\/from$/, '')));
  const kept = load.refusals.items.filter(item => !(item.code === 'D006' && failed.has(item.at)));
  load.refusals.items.splice(0, load.refusals.items.length, ...kept, ...refusals);
  return load;
}
