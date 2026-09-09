/**
 * Loads a tree: every *.json under the root, the features of the trees the project includes, and the documents
 * of the plugins the project names, read from each plugin's docs directory.
 * Judges each file against its kind schema, canonicalises paths (@root, project aliases, plugin roots),
 * and answers a Registry the checker and compiler share.
 */
import { join, relative } from 'node:path';
import { Documents, PROJECT_FILE, parseJson, readProject } from './documents.js';
import type { ProjectDoc } from './model.js';
import { makeResolver, RESERVED_ROOTS, subdirectories, treePath, walk } from './paths.js';
import type { PluginModule } from './plugin.js';
import { type Refusal, RefusalList, Registry } from './registry.js';
import { validateDocument } from './validate.js';

export { featureOf, makeResolver, stem } from './paths.js';

export interface LoadResult {
  registry: Registry;
  refusals: RefusalList;
  root: string;
  plugins: PluginModule[];
  resolve: (ref: string) => string;
  /** Every alias in force: the project's, and those the includes brought along. */
  aliases: Record<string, string>;
}

/** A tree this one includes, resolved to where its package sits on disk: the runtime resolves it from the project's node_modules. */
export interface ResolvedInclude {
  from: string;
  dir: string;
  features?: string[];
}

/**
 * Load the tree at `root`. `available` maps plugin alias (@http) to its module; `includes` are the trees the
 * project includes, resolved to their directories. An include's features load as if they sat here -- the same
 * paths, the same rules -- and its aliases come along; its connections, plugins and settings stay behind.
 */
export function loadTree(
  root: string,
  available: Record<string, PluginModule>,
  includes: ResolvedInclude[] = [],
): LoadResult {
  return new Loader(root, available, includes).load();
}

class Loader {
  private readonly registry = new Registry();
  private readonly refusals = new RefusalList();
  private readonly documents = new Documents(this.registry, this.refusals);
  private readonly plugins: PluginModule[] = [];
  private readonly pluginRoots = new Set<string>();
  private readonly aliases: Record<string, string> = {};
  private readonly files: string[];
  private readonly project: ProjectDoc | undefined;

  constructor(
    private readonly root: string,
    private readonly available: Record<string, PluginModule>,
    private readonly includes: ResolvedInclude[],
  ) {
    this.files = walk(root);
    // project first: aliases and plugins shape every other resolution
    this.project = this.loadProject();
  }

  load(): LoadResult {
    this.resolvePlugins();
    Object.assign(this.aliases, this.project?.aliases ?? {});
    for (const alias of Object.keys(this.aliases)) this.checkAlias(alias, `aliases/${alias}`);
    const included = this.includes.filter((include, index) => this.readInclude(include, index));
    this.registerTree();
    this.registerIncludes(included);
    for (const plugin of this.plugins) this.documents.registerPlugin(plugin);
    const resolve = makeResolver(this.aliases, this.pluginRoots);
    return {
      registry: this.registry,
      refusals: this.refusals,
      root: this.root,
      plugins: this.plugins,
      resolve,
      aliases: this.aliases,
    };
  }

  private refuse(refusal: Refusal): void {
    this.refusals.add(refusal);
  }

  // ---- the project --------------------------------------------------------------------------------

  /** D005 without a project.json, D000 when it is not JSON, D003 when it is another kind; its own schema refusals otherwise. */
  private loadProject(): ProjectDoc | undefined {
    const abs = join(this.root, PROJECT_FILE);
    if (!this.files.some(file => relative(this.root, file) === PROJECT_FILE)) {
      this.refuse({
        code: 'D005',
        file: PROJECT_FILE,
        message: 'no project.json at the root',
        hint: 'wilanis new project <name>',
      });
      return undefined;
    }
    const parsed = parseJson(abs, PROJECT_FILE);
    if ('refusal' in parsed) {
      this.refuse(parsed.refusal);
      return undefined;
    }
    const judged = validateDocument(parsed.doc, PROJECT_FILE);
    for (const refusal of judged.refusals) this.refuse(refusal);
    if (judged.refusals.length) return undefined;
    if (judged.kind === 'project') return parsed.doc as ProjectDoc;
    this.refuse({ code: 'D003', file: PROJECT_FILE, message: 'project.json must be a project document' });
    return undefined;
  }

  /** D006: every plugin the project names is available here. */
  private resolvePlugins(): void {
    for (const [index, use] of (this.project?.plugins ?? []).entries()) {
      const plugin = this.available[use.use];
      if (!plugin) {
        this.refuse({
          code: 'D006',
          file: PROJECT_FILE,
          at: `plugins/${index}`,
          message: `unknown plugin '${use.use}'`,
          hint: `available here: ${Object.keys(this.available).join(', ')}. A plugin package is named by "from" in project.json`,
        });
        continue;
      }
      this.plugins.push(plugin);
      this.pluginRoots.add(use.use);
    }
  }

  /** D007: an alias collides with nothing -- not a plugin root, not a reserved root, not a folder of the tree. */
  private checkAlias(alias: string, at: string): void {
    const collision = (message: string) => this.refuse({ code: 'D007', file: PROJECT_FILE, at, message });
    if (this.pluginRoots.has(alias)) collision(`alias '${alias}' collides with plugin root '${alias}'`);
    if (RESERVED_ROOTS.includes(alias)) collision(`alias '${alias}' is reserved`);
    if (subdirectories(this.root).includes(alias.slice(1)))
      collision(`alias '${alias}' collides with the folder '${alias.slice(1)}/'`);
  }

  /** Every document of this tree; the project document takes its place under @project.json. */
  private registerTree(): void {
    for (const abs of this.files) {
      const file = treePath(relative(this.root, abs));
      if (file !== PROJECT_FILE) {
        this.documents.register(abs, file);
        continue;
      }
      if (this.project) {
        this.registry.add({
          doc: this.project,
          kind: 'project',
          path: '@project.json',
          name: this.project.name,
          file: abs,
        });
      }
    }
  }

  // ---- includes -----------------------------------------------------------------------------------

  /**
   * An include is a wilanis tree of its own. Its aliases come along, so its documents keep naming themselves;
   * its plugins must be ones this project names, since the host configures them; nothing else of its
   * project.json is read (D010, D007). Answers whether the include can be walked.
   */
  private readInclude(include: ResolvedInclude, index: number): boolean {
    const at = `includes/${index}`;
    const theirs = readProject(include.dir, `${include.from}/project.json`);
    if (!theirs) {
      this.refuse({
        code: 'D010',
        file: PROJECT_FILE,
        at,
        message: `'${include.from}' is not a wilanis tree: no project.json in ${include.dir}`,
        hint: 'an include is a package holding project.json and features/',
      });
      return false;
    }
    for (const use of theirs.plugins) {
      if (this.pluginRoots.has(use.use)) continue;
      const from = use.use === '@std' || use.use === '@cli' ? '' : `, "from": "..."`;
      this.refuse({
        code: 'D010',
        file: PROJECT_FILE,
        at,
        message: `'${include.from}' uses plugin '${use.use}', which this project does not name`,
        hint: `add { "use": "${use.use}"${from} } to project.json → plugins, with the settings its README says`,
      });
    }
    for (const [alias, target] of Object.entries(theirs.aliases ?? {})) this.adoptAlias(alias, target, include, at);
    return true;
  }

  /** An include's alias comes along; one this project also declares must mean the same thing. */
  private adoptAlias(alias: string, target: string, include: ResolvedInclude, at: string): void {
    if (!(alias in this.aliases)) {
      this.aliases[alias] = target;
      this.checkAlias(alias, at);
      return;
    }
    if (this.aliases[alias] === target) return;
    this.refuse({
      code: 'D007',
      file: PROJECT_FILE,
      at,
      message: `alias '${alias}' is '${this.aliases[alias]}' here and '${target}' in '${include.from}'`,
      hint: 'an include brings its aliases along; drop yours or rename it',
    });
  }

  /** Every include's features, as if they sat here; one both here and there is refused rather than shadowed (D009). */
  private registerIncludes(included: ResolvedInclude[]): void {
    const taken = new Set(
      this.registry.files.map(entry => entry.feature).filter((name): name is string => Boolean(name)),
    );
    for (const include of included) {
      const index = this.includes.indexOf(include);
      const dir = join(include.dir, 'features');
      const wanted = (this.featuresShipped(include, dir, index) ?? []).filter(
        name => !include.features || include.features.includes(name),
      );
      for (const name of wanted) this.registerFeature(include, index, name, taken);
    }
  }

  /** One feature of an include: every document under it, marked as included from that package. */
  private registerFeature(include: ResolvedInclude, index: number, name: string, taken: Set<string>): void {
    if (taken.has(name)) {
      this.refuse({
        code: 'D009',
        file: PROJECT_FILE,
        at: `includes/${index}`,
        message: `feature '${name}' is both in this tree and included from '${include.from}'`,
        hint: 'rename the local feature, or leave it out of the include with "features"',
      });
      return;
    }
    taken.add(name);
    for (const abs of walk(join(include.dir, 'features', name))) {
      this.documents.register(abs, treePath(relative(include.dir, abs)), include.from);
    }
  }

  /** The features an include ships, or nothing when it ships no features/ directory; each one asked for must be among them. */
  private featuresShipped(include: ResolvedInclude, dir: string, index: number): string[] | undefined {
    let names: string[];
    try {
      names = subdirectories(dir);
    } catch {
      this.refuse({
        code: 'D010',
        file: PROJECT_FILE,
        at: `includes/${index}`,
        message: `'${include.from}' ships no features/ directory`,
      });
      return undefined;
    }
    for (const want of include.features ?? []) {
      if (names.includes(want)) continue;
      this.refuse({
        code: 'D010',
        file: PROJECT_FILE,
        at: `includes/${index}/features`,
        message: `'${include.from}' ships no feature '${want}' (it ships ${names.join(', ') || 'none'})`,
      });
    }
    return names;
  }
}
