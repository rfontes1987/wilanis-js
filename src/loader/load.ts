/**
 * Loads a tree: every *.json under the root plus the native documents of the plugins the project names.
 * Judges each file against its kind schema, canonicalises paths (@root, project aliases, plugin roots),
 * and answers a Registry the checker and compiler share.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { RefusalList, Registry, type AnyDoc, type Loaded, type ProjectDoc } from '../model.js';
import { validateDocument } from '../schema/validate.js';
import type { PluginModule } from '../plugins/plugin.js';

export interface LoadResult { registry: Registry; refusals: RefusalList; root: string; plugins: PluginModule[]; resolve: (ref: string) => string }

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') || name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.json') && name !== 'package.json' && name !== 'tsconfig.json') out.push(p);
  }
  return out;
}

export function featureOf(rel: string): string | undefined {
  const parts = rel.split(sep);
  return parts[0] === 'features' && parts.length > 2 ? parts[1] : undefined;
}

/** The filename stem without the kind suffix: tasks.port.json -> tasks. */
export const stem = (file: string) => basename(file).replace(/\.json$/, '').replace(/\.[a-z-]+$/, '');

/** Canonicalise a reference: expand a project alias (@tasks/x -> @features/tasks/x). Plugin roots and root paths stay as they are. */
export function makeResolver(aliases: Record<string, string>, pluginRoots: Set<string>) {
  return (ref: string): string => {
    const m = /^(@[a-z][a-z0-9-]*)(\/.*)?$/.exec(ref);
    if (!m) return ref;
    const [, alias, rest] = m;
    if (pluginRoots.has(alias) || alias === '@features' || alias === '@connections' || alias === '@scenarios') return ref;
    const target = aliases[alias];
    if (target !== undefined) return target.replace(/\/$/, '') + (rest ?? '');
    return ref;
  };
}

/** Load the tree at `root`. `available` maps plugin alias (@http) to its module. */
export function loadTree(root: string, available: Record<string, PluginModule>): LoadResult {
  const registry = new Registry();
  const refusals = new RefusalList();
  const files = walk(root);

  // project first: aliases and plugins shape every other resolution
  const projectFile = files.find(f => relative(root, f) === 'project.json');
  let project: ProjectDoc | undefined;
  if (!projectFile) refusals.add({ code: 'D005', file: 'project.json', message: 'no project.json at the root', hint: 'wilanis new project <name>' });
  else {
    try {
      const parsed = JSON.parse(readFileSync(projectFile, 'utf8'));
      const v = validateDocument(parsed, 'project.json');
      v.refusals.forEach(r => refusals.add(r));
      if (!v.refusals.length && v.kind === 'project') project = parsed as ProjectDoc;
      else if (!v.refusals.length) refusals.add({ code: 'D003', file: 'project.json', message: 'project.json must be a @wilanis/project.schema.json document' });
    } catch (e) { refusals.add({ code: 'D000', file: 'project.json', message: `not JSON: ${(e as Error).message}` }); }
  }

  const plugins: PluginModule[] = [];
  const pluginRoots = new Set<string>();
  for (const p of project?.plugins ?? []) {
    const mod = available[p.use];
    if (!mod) { refusals.add({ code: 'D006', file: 'project.json', at: 'plugins', message: `unknown plugin '${p.use}'`, hint: `available: ${Object.keys(available).join(', ')}` }); continue; }
    plugins.push(mod); pluginRoots.add(p.use);
  }
  const aliases = project?.aliases ?? {};
  for (const a of Object.keys(aliases)) {
    if (pluginRoots.has(a)) refusals.add({ code: 'D007', file: 'project.json', at: `aliases/${a}`, message: `alias '${a}' collides with plugin root '${a}'` });
    if (['@wilanis', '@features', '@connections', '@scenarios'].includes(a)) refusals.add({ code: 'D007', file: 'project.json', at: `aliases/${a}`, message: `alias '${a}' is reserved` });
    const top = readdirSync(root).filter(n => statSync(join(root, n)).isDirectory());
    if (top.includes(a.slice(1))) refusals.add({ code: 'D007', file: 'project.json', at: `aliases/${a}`, message: `alias '${a}' collides with the folder '${a.slice(1)}/'` });
  }
  const resolve = makeResolver(aliases, pluginRoots);

  for (const abs of files) {
    const rel = relative(root, abs);
    const file = rel.split(sep).join('/');
    let parsed: unknown;
    try { parsed = JSON.parse(readFileSync(abs, 'utf8')); }
    catch (e) { refusals.add({ code: 'D000', file, message: `not JSON: ${(e as Error).message}` }); continue; }
    if (file === 'project.json') { if (project) registry.add({ doc: project, kind: 'project', path: '@project.json', name: project.name }); continue; }
    const v = validateDocument(parsed, file);
    if (v.refusals.length) { v.refusals.forEach(r => refusals.add(r)); continue; }
    const kind = v.kind!;
    const doc = parsed as AnyDoc;
    const feature = featureOf(rel);
    if (kind === 'project') { refusals.add({ code: 'D003', file, message: 'the project document is project.json at the root' }); continue; }
    if (kind === 'feature' && file !== `features/${feature}/feature.json`) { refusals.add({ code: 'D003', file, message: 'a feature lives at features/<name>/feature.json' }); continue; }
    if (['plugin', 'trigger-kind', 'connection-kind', 'codec'].includes(kind)) { refusals.add({ code: 'D004', file, message: `${kind} documents are shipped by plugins, never authored in a tree` }); continue; }
    registry.add({ doc, kind, path: `@${file}`, name: kind === 'feature' ? feature! : stem(file), feature });
  }

  for (const mod of plugins) {
    for (const [path, doc] of Object.entries(mod.docs)) {
      const v = validateDocument(doc, path);
      v.refusals.forEach(r => refusals.add(r));
      if (v.refusals.length) continue;
      registry.add({ doc, kind: v.kind!, path, name: stem(path), native: mod.root } as Loaded);
    }
  }
  return { registry, refusals, root, plugins, resolve };
}
