/**
 * Loads a tree: every *.json under the root, the features of the trees the project includes, and the documents
 * of the plugins the project names, read from each plugin's docs directory.
 * Judges each file against its kind schema, canonicalises paths (@root, project aliases, plugin roots),
 * and answers a Registry the checker and compiler share.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { layerOf, RefusalList, Registry, type AnyDoc, type Kind, type Layer, type Loaded, type ProjectDoc, type Refusal } from './model.js';
import { validateDocument } from './validate.js';
import type { PluginModule } from './plugin.js';

export interface LoadResult {
  registry: Registry; refusals: RefusalList; root: string; plugins: PluginModule[]; resolve: (ref: string) => string;
  /** Every alias in force: the project's, and those the includes brought along. */
  aliases: Record<string, string>;
}

/** A tree this one includes, resolved to where its package sits on disk: the runtime resolves it from the project's node_modules. */
export interface ResolvedInclude { from: string; dir: string; features?: string[] }

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') || name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.json') && name !== 'package.json' && name !== 'package-lock.json' && name !== 'tsconfig.json') out.push(p);
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

/**
 * Where a kind may live. A feature's documents sit in one of three layer directories and the layer is the
 * rule: `edge/` speaks the world, `domain/` holds the business rules, `data/` translates and carries the
 * effects. A connection is a channel shared across features, so it stays at the tree's root.
 */
const HOME: Partial<Record<Kind, { layers?: Layer[]; dir?: string; why: string }>> = {
  trigger: { layers: ['edge'], why: 'a trigger is a way in: it speaks the world\'s vocabulary' },
  policy: { layers: ['edge'], why: 'a policy gates a way in: it reads the request the way a trigger does' },
  graph: { layers: ['domain', 'data'], why: 'a graph is business rules (domain/) or a translation (data/)' },
  binding: { layers: ['data'], why: 'a binding says how a domain port is met, which is the data layer\'s job' },
  port: { layers: ['domain'], why: 'a domain port is the contract the business offers' },
  shape: { layers: ['edge', 'domain'], why: 'a shape is the world\'s (edge/) or ours (domain/)' },
  resolvers: { layers: ['edge'], why: 'a resolvers document names what is read from the request, which is the world\'s vocabulary' },
  connection: { dir: 'connections', why: 'a connection is a channel to an external system, shared across features' },
  scenario: { dir: 'scenarios', why: 'a scenario is a recorded run' },
};

/** The refusal for a document that is not where its kind lives, or null when it is home. */
function misplaced(kind: Kind, file: string, feature: string | undefined, doc: unknown): Refusal | null {
  const home = HOME[kind];
  if (!home) return null;
  if (home.dir) {
    if (file.split('/')[0] === home.dir) return null;
    return { code: 'D008', file, message: `a ${kind} lives under ${home.dir}/`, hint: `${home.why}; move it to ${home.dir}/${stem(file)}.${kind}.json` };
  }
  const layers = home.layers!;
  if (!feature) return { code: 'D008', file, message: `a ${kind} lives inside a feature, under ${layers.map(l => `${l}/`).join(' or ')}`, hint: `${home.why}; move it to features/<name>/${layers[0]}/` };
  const layer = layerOf(`@${file}`);
  // a shape says its layer twice -- in `layer` and in the directory. They must agree, and the directory wins.
  if (kind === 'shape' && layer) {
    const declared = (doc as { layer?: string }).layer === 'edge' ? 'edge' : 'domain';
    if (declared !== layer) return { code: 'D008', file, at: 'layer', message: `shape declares layer '${(doc as { layer?: string }).layer}' but sits in ${layer}/`, hint: `a shape's layer is where it lives; move it to features/${feature}/${declared}/, or set "layer": "${layer === 'edge' ? 'edge' : 'core'}"` };
  }
  if (layer && layers.includes(layer)) return null;
  return {
    code: 'D008', file,
    message: layer ? `a ${kind} may not live in the ${layer} layer` : `a ${kind} must sit in a layer directory (${layers.join(', ')})`,
    hint: `${home.why}; move it to features/${feature}/${layers[0]}/${stem(file)}.${kind}.json`,
  };
}

/**
 * Load the tree at `root`. `available` maps plugin alias (@http) to its module; `includes` are the trees the
 * project includes, resolved to their directories. An include's features load as if they sat here -- the same
 * paths, the same rules -- and its aliases come along; its connections, plugins and settings stay behind.
 */
export function loadTree(root: string, available: Record<string, PluginModule>, includes: ResolvedInclude[] = []): LoadResult {
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
      else if (!v.refusals.length) refusals.add({ code: 'D003', file: 'project.json', message: 'project.json must be a project document' });
    } catch (e) { refusals.add({ code: 'D000', file: 'project.json', message: `not JSON: ${(e as Error).message}` }); }
  }

  const plugins: PluginModule[] = [];
  const pluginRoots = new Set<string>();
  for (const [i, p] of (project?.plugins ?? []).entries()) {
    const mod = available[p.use];
    if (!mod) { refusals.add({ code: 'D006', file: 'project.json', at: `plugins/${i}`, message: `unknown plugin '${p.use}'`, hint: `available here: ${Object.keys(available).join(', ')}. A plugin package is named by "from" in project.json` }); continue; }
    plugins.push(mod); pluginRoots.add(p.use);
  }
  const aliases: Record<string, string> = { ...(project?.aliases ?? {}) };
  const checkAlias = (a: string, at: string) => {
    if (pluginRoots.has(a)) refusals.add({ code: 'D007', file: 'project.json', at, message: `alias '${a}' collides with plugin root '${a}'` });
    if (['@wilanis', '@features', '@connections', '@scenarios'].includes(a)) refusals.add({ code: 'D007', file: 'project.json', at, message: `alias '${a}' is reserved` });
    const top = readdirSync(root).filter(n => statSync(join(root, n)).isDirectory());
    if (top.includes(a.slice(1))) refusals.add({ code: 'D007', file: 'project.json', at, message: `alias '${a}' collides with the folder '${a.slice(1)}/'` });
  };
  for (const a of Object.keys(aliases)) checkAlias(a, `aliases/${a}`);

  // includes: each is a wilanis tree of its own. Its aliases come along, so its documents keep naming themselves; its
  // plugins must be ones this project names, since the host configures them; nothing else of its project.json is read
  const included: { inc: ResolvedInclude; i: number }[] = [];
  for (const [i, inc] of includes.entries()) {
    const at = `includes/${i}`;
    let theirs: ProjectDoc | undefined;
    try {
      const parsed = JSON.parse(readFileSync(join(inc.dir, 'project.json'), 'utf8'));
      const v = validateDocument(parsed, `${inc.from}/project.json`);
      if (!v.refusals.length && v.kind === 'project') theirs = parsed as ProjectDoc;
    } catch { /* reported below */ }
    if (!theirs) { refusals.add({ code: 'D010', file: 'project.json', at, message: `'${inc.from}' is not a wilanis tree: no project.json in ${inc.dir}`, hint: 'an include is a package holding project.json and features/' }); continue; }
    for (const p of theirs.plugins) if (!pluginRoots.has(p.use)) refusals.add({ code: 'D010', file: 'project.json', at, message: `'${inc.from}' uses plugin '${p.use}', which this project does not name`, hint: `add { "use": "${p.use}"${p.use === '@std' || p.use === '@cli' ? '' : `, "from": "..."`} } to project.json → plugins, with the settings its README says` });
    for (const [a, target] of Object.entries(theirs.aliases ?? {})) {
      if (a in aliases) { if (aliases[a] !== target) refusals.add({ code: 'D007', file: 'project.json', at, message: `alias '${a}' is '${aliases[a]}' here and '${target}' in '${inc.from}'`, hint: 'an include brings its aliases along; drop yours or rename it' }); continue; }
      aliases[a] = target; checkAlias(a, at);
    }
    included.push({ inc, i });
  }
  const resolve = makeResolver(aliases, pluginRoots);

  /** Judge and register one tree document, the host's or an include's. */
  const register = (abs: string, file: string, from?: string) => {
    let parsed: unknown;
    try { parsed = JSON.parse(readFileSync(abs, 'utf8')); }
    catch (e) { refusals.add({ code: 'D000', file, message: `not JSON: ${(e as Error).message}` }); return; }
    const v = validateDocument(parsed, file);
    if (v.refusals.length) { v.refusals.forEach(r => refusals.add(r)); return; }
    const kind = v.kind!;
    const doc = parsed as AnyDoc;
    const feature = featureOf(file.split('/').join(sep));
    if (kind === 'project') { refusals.add({ code: 'D003', file, message: 'the project document is project.json at the root' }); return; }
    if (kind === 'feature' && file !== `features/${feature}/feature.json`) { refusals.add({ code: 'D003', file, message: 'a feature lives at features/<name>/feature.json' }); return; }
    if (['plugin', 'trigger-kind', 'connection-kind', 'codec'].includes(kind)) { refusals.add({ code: 'D004', file, message: `${kind} documents are shipped by plugins, never authored in a tree` }); return; }
    const bad = misplaced(kind, file, feature, doc);
    if (bad) { refusals.add(bad); return; }
    registry.add({ doc, kind, path: `@${file}`, name: kind === 'feature' ? feature! : stem(file), feature, layer: layerOf(`@${file}`), file: abs, ...(from ? { included: from } : {}) });
  };

  for (const abs of files) {
    const rel = relative(root, abs);
    const file = rel.split(sep).join('/');
    if (file === 'project.json') { if (project) registry.add({ doc: project, kind: 'project', path: '@project.json', name: project.name, file: abs }); continue; }
    register(abs, file);
  }

  // an include's features, as if they sat here; one both here and there is refused rather than shadowed
  const featuresHere = new Set(registry.files.map(f => f.feature).filter((f): f is string => Boolean(f)));
  for (const { inc, i } of included) {
    const dir = join(inc.dir, 'features');
    let names: string[];
    try { names = readdirSync(dir).filter(n => statSync(join(dir, n)).isDirectory()); } catch { refusals.add({ code: 'D010', file: 'project.json', at: `includes/${i}`, message: `'${inc.from}' ships no features/ directory` }); continue; }
    for (const want of inc.features ?? []) if (!names.includes(want)) refusals.add({ code: 'D010', file: 'project.json', at: `includes/${i}/features`, message: `'${inc.from}' ships no feature '${want}' (it ships ${names.join(', ') || 'none'})` });
    for (const name of names) {
      if (inc.features && !inc.features.includes(name)) continue;
      if (featuresHere.has(name)) { refusals.add({ code: 'D009', file: 'project.json', at: `includes/${i}`, message: `feature '${name}' is both in this tree and included from '${inc.from}'`, hint: 'rename the local feature, or leave it out of the include with "features"' }); continue; }
      featuresHere.add(name);
      for (const abs of walk(join(dir, name))) register(abs, relative(inc.dir, abs).split(sep).join('/'), inc.from);
    }
  }

  for (const mod of plugins) {
    let docs: string[];
    try { docs = walk(mod.docs); } catch (e) { refusals.add({ code: 'D006', file: 'project.json', message: `plugin '${mod.root}' has no documents at ${mod.docs}: ${(e as Error).message}` }); continue; }
    if (!docs.some(f => relative(mod.docs, f) === 'plugin.json')) refusals.add({ code: 'D006', file: 'project.json', message: `plugin '${mod.root}' ships no plugin.json in ${mod.docs}` });
    for (const abs of docs) {
      const path = `${mod.root}/${relative(mod.docs, abs).split(sep).join('/')}`;
      let parsed: unknown;
      try { parsed = JSON.parse(readFileSync(abs, 'utf8')); }
      catch (e) { refusals.add({ code: 'D000', file: path, message: `not JSON: ${(e as Error).message}` }); continue; }
      const v = validateDocument(parsed, path);
      v.refusals.forEach(r => refusals.add(r));
      if (v.refusals.length) continue;
      registry.add({ doc: parsed as AnyDoc, kind: v.kind!, path, name: stem(path), native: mod.root, file: abs } as Loaded);
    }
  }
  return { registry, refusals, root, plugins, resolve, aliases };
}
