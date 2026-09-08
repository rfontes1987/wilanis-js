/**
 * Loading a project for the runtime: the builtin plugins plus every plugin package project.json names with
 * `from`, resolved from the project's own node_modules and imported. Only npm package names are accepted
 * there, so a JSON document can never point at an arbitrary file on disk.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { dirname } from 'node:path';
import { loadTree, type LoadResult, type PluginModule, type Refusal, type ResolvedInclude } from '@wilanis/core';
import { BUILTIN_PLUGINS } from './plugins/index.js';

const PACKAGE_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

export interface PluginResolution { available: Record<string, PluginModule>; refusals: Refusal[] }

/** Import every plugin project.json names with `from`, on top of the builtins and `extra`. */
export async function resolvePlugins(root: string, extra: Record<string, PluginModule> = {}): Promise<PluginResolution> {
  const available: Record<string, PluginModule> = { ...BUILTIN_PLUGINS, ...extra };
  const refusals: Refusal[] = [];
  let entries: unknown;
  try { entries = JSON.parse(readFileSync(join(root, 'project.json'), 'utf8')).plugins; } catch { return { available, refusals }; } // loadTree reports D000 / D005
  if (!Array.isArray(entries)) return { available, refusals };
  const require = createRequire(join(root, 'package.json'));
  const refuse = (at: string, message: string, hint: string) => { refusals.push({ code: 'D006', file: 'project.json', at, message, hint }); };
  for (const [i, p] of (entries as { use?: unknown; from?: unknown }[]).entries()) {
    if (!p || typeof p !== 'object' || typeof p.from !== 'string' || typeof p.use !== 'string') continue;
    const at = `plugins/${i}/from`;
    if (!PACKAGE_NAME.test(p.from)) { refuse(at, `'${p.from}' is not an npm package name`, 'from names a published package, never a file path'); continue; }
    let mod: Record<string, unknown>;
    try { mod = await import(pathToFileURL(require.resolve(p.from)).href) as Record<string, unknown>; }
    catch (e) { refuse(at, `cannot load plugin package '${p.from}': ${(e as Error).message}`, `npm install ${p.from}`); continue; }
    const plugin = (mod.default ?? mod.plugin) as PluginModule | undefined;
    if (!plugin || typeof plugin !== 'object' || typeof plugin.root !== 'string' || !plugin.docs) { refuse(at, `'${p.from}' does not export a wilanis plugin`, 'a plugin package exports its PluginModule as default'); continue; }
    if (plugin.root !== p.use) { refuse(at, `'${p.from}' is the plugin '${plugin.root}', not '${p.use}'`, `"use": "${plugin.root}"`); continue; }
    available[p.use] = plugin;
  }
  return { available, refusals };
}

/**
 * Where each tree project.json includes sits: the package's directory, resolved from the project's own node_modules.
 * Only npm package names are accepted, as for plugins: a JSON document never points at a file on disk.
 */
export function resolveIncludes(root: string): { includes: ResolvedInclude[]; refusals: Refusal[] } {
  const includes: ResolvedInclude[] = [];
  const refusals: Refusal[] = [];
  let entries: unknown;
  try { entries = JSON.parse(readFileSync(join(root, 'project.json'), 'utf8')).includes; } catch { return { includes, refusals }; }
  if (!Array.isArray(entries)) return { includes, refusals };
  const require = createRequire(join(root, 'package.json'));
  for (const [i, inc] of (entries as { from?: unknown; features?: unknown }[]).entries()) {
    if (!inc || typeof inc !== 'object' || typeof inc.from !== 'string') continue;
    const at = `includes/${i}/from`;
    if (!PACKAGE_NAME.test(inc.from)) { refusals.push({ code: 'D010', file: 'project.json', at, message: `'${inc.from}' is not an npm package name`, hint: 'from names a published package, never a file path' }); continue; }
    let dir: string;
    try { dir = dirname(require.resolve(`${inc.from}/package.json`)); }
    catch (e) { refusals.push({ code: 'D010', file: 'project.json', at, message: `cannot find the included package '${inc.from}': ${(e as Error).message}`, hint: `npm install ${inc.from}` }); continue; }
    includes.push({ from: inc.from, dir, ...(Array.isArray(inc.features) ? { features: inc.features.map(String) } : {}) });
  }
  return { includes, refusals };
}

/** Load the tree at root with its plugins and includes resolved: builtins, `extra`, and the packages project.json names. */
export async function loadProject(root: string, opts: { plugins?: Record<string, PluginModule>; includes?: ResolvedInclude[] } = {}): Promise<LoadResult> {
  const { available, refusals } = await resolvePlugins(root, opts.plugins);
  const resolved = resolveIncludes(root);
  const load = loadTree(root, available, [...(opts.includes ?? []), ...resolved.includes]);
  refusals.push(...resolved.refusals);
  // a plugin whose package failed to load is reported once, with the install hint, not also as unknown
  const failed = new Set(refusals.map(r => r.at?.replace(/\/from$/, '')));
  const kept = load.refusals.items.filter(r => !(r.code === 'D006' && failed.has(r.at)));
  load.refusals.items.splice(0, load.refusals.items.length, ...kept, ...refusals);
  return load;
}
