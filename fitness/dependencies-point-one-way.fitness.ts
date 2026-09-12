/**
 * Claim: dependencies point one way.
 * Why: `CLAUDE.md` states the direction as a sentence -- "engine <- core <- compiler <- runtime <- view, and
 *   plugins depend on core and engine only" -- and adds that "if a change needs an import against this rule,
 *   the design is wrong, not the import rule". Nothing read a `package.json` to hold it: an import resolves
 *   because npm hoists the workspace, whichever section declared it, so a `src/` file could reach a package
 *   named only under `devDependencies` for tests, and a plugin could reach the runtime, and everything would
 *   still build, lint and pass. This reads the fact where it lives: a `src/` file may import only what its
 *   own `dependencies` names, a test also its `devDependencies`, and among `@wilanis/*` only what comes
 *   earlier in the order.
 * Retire when: the workspace stops being one npm workspace, or the layering changes and an RFC gives the new
 *   order. Adding a package changes ORDER, which is a list, not a decision.
 */
import { manifestOf } from './lib/jsonc.js';
import { importsOf, packageDirs, packageOf, sourceFiles, textOf } from './lib/sources.js';

/** The one order the workspace layers in: each package may import only those before it. */
const ORDER = ['engine', 'core', 'compiler', 'runtime', 'view'];

/** What a plugin may import of the workspace, whatever its own manifest names. */
const PLUGIN_MAY_IMPORT = ['@wilanis/core', '@wilanis/engine'];

/**
 * The plugins that are a contract rather than an implementation of one: one plugin says what may be asked,
 * and others answer it. A plugin may import the contract it implements, and a contract imports no
 * implementation, so the arrow still points one way. RFC 0002 introduces the first -- @storage says what a
 * store is, and an engine is a plugin that keeps one. Like ORDER, this is a list rather than a decision:
 * naming the next contract here is not a change of what the claim holds.
 */
const CONTRACT_PLUGINS = ['@wilanis/plugin-storage'];

/** Declared once at the workspace root, so no package names it and every test may import it. */
const ROOT_DEV = ['vitest'];

/** One import a claim judges: the file, the directory it sits in, and the package it names. */
interface Reach {
  file: string;
  dir: 'src' | 'test';
  named: string;
}

/** A package as this claim reads it: its directory, its manifest, and every package its files reach for. */
interface Package {
  dir: string;
  name: string;
  dependencies: string[];
  devDependencies: string[];
  reaches: Reach[];
}

/** The claim this module holds, and the title the runner gives its test. */
export const claim = 'dependencies point one way';

/** Every package under `packages/`, with what its manifest names and what its files import. */
export const gather = (): Package[] => packageDirs().map(dir => ({ ...manifestOf(dir), dir, reaches: reachesOf(dir) }));

/** Every import against the direction, one sentence each, naming the file and the fix. */
export const judge = (packages: Package[]): string[] =>
  packages.flatMap(pkg => pkg.reaches.flatMap(reach => faults(pkg, reach)));

/** Every package a directory's files import, with the directory that did the importing. */
function reachesOf(dir: string): Reach[] {
  const dirs: ('src' | 'test')[] = ['src', 'test'];
  return dirs.flatMap(which =>
    sourceFiles(`${dir}/${which}`).flatMap(file =>
      importsOf(textOf(file))
        .map(packageOf)
        .filter((named): named is string => named !== null && !named.startsWith('node:'))
        .map(named => ({ file, dir: which, named })),
    ),
  );
}

/** Whichever of the two rules one import breaks: what its manifest allows, and what the order allows. */
function faults(pkg: Package, reach: Reach): string[] {
  return [...undeclared(pkg, reach), ...againstOrder(pkg, reach)];
}

/** The violation an import is when no section of the package's manifest names what it reaches. */
function undeclared(pkg: Package, reach: Reach): string[] {
  const { named, dir, file } = reach;
  if (named === pkg.name || ROOT_DEV.includes(named)) return [];
  if (pkg.dependencies.includes(named)) return [];
  if (dir === 'test' && pkg.devDependencies.includes(named)) return [];
  const section = pkg.devDependencies.includes(named) ? 'only under devDependencies' : 'nowhere';
  const fix = dir === 'src' ? 'import it from test/ or declare it' : `declare ${named} under devDependencies`;
  return [`${file} imports ${named}, which ${pkg.name} names ${section}; ${fix}`];
}

/** The violation an import is when the workspace's own order, or the plugin rule, forbids it. */
function againstOrder(pkg: Package, reach: Reach): string[] {
  const { named, file } = reach;
  if (!named.startsWith('@wilanis/') || named === pkg.name) return [];
  const isPlugin = pkg.name.startsWith('@wilanis/plugin-');
  const allowed = [...PLUGIN_MAY_IMPORT, ...CONTRACT_PLUGINS];
  if (isPlugin && reach.dir === 'src' && !allowed.includes(named)) {
    const may = `${PLUGIN_MAY_IMPORT.join(' and ')}, and a contract it implements (${CONTRACT_PLUGINS.join(', ')})`;
    return [`${file} imports ${named}; a plugin imports only ${may}`];
  }
  const here = ORDER.indexOf(pkg.name.replace('@wilanis/', ''));
  const there = ORDER.indexOf(named.replace('@wilanis/', ''));
  if (here < 0 || there < 0 || there < here) return [];
  return [`${file} imports ${named}, which comes after ${pkg.name} in the order; ${ORDER.join(' <- ')}`];
}

/** A package as a sabotage case states it: the manifest facts, and the one import under judgement. */
function reaching(name: string, reach: Reach, sections: Partial<Package> = {}): Package[] {
  return [
    {
      dir: `packages/${name.replace('@wilanis/', '')}`,
      name,
      dependencies: [],
      devDependencies: [],
      reaches: [reach],
      ...sections,
    },
  ];
}

/** The proof that the judge bites: one case per rule it holds. */
export const sabotage = [
  {
    input: reaching(
      '@wilanis/plugin-http',
      { file: 'packages/plugin-http/src/index.ts', dir: 'src', named: '@wilanis/runtime' },
      { devDependencies: ['@wilanis/runtime'] },
    ),
    violation:
      'packages/plugin-http/src/index.ts imports @wilanis/runtime, which @wilanis/plugin-http names only under devDependencies; import it from test/ or declare it',
  },
  {
    input: reaching(
      '@wilanis/plugin-http',
      { file: 'packages/plugin-http/src/index.ts', dir: 'src', named: '@wilanis/runtime' },
      { dependencies: ['@wilanis/runtime'] },
    ),
    violation:
      'packages/plugin-http/src/index.ts imports @wilanis/runtime; a plugin imports only @wilanis/core and @wilanis/engine, and a contract it implements (@wilanis/plugin-storage)',
  },
  {
    input: reaching(
      '@wilanis/plugin-blob',
      { file: 'packages/plugin-blob/src/index.ts', dir: 'src', named: '@wilanis/plugin-http' },
      { dependencies: ['@wilanis/plugin-http'] },
    ),
    violation:
      'packages/plugin-blob/src/index.ts imports @wilanis/plugin-http; a plugin imports only @wilanis/core and @wilanis/engine, and a contract it implements (@wilanis/plugin-storage)',
  },
  {
    input: reaching(
      '@wilanis/core',
      { file: 'packages/core/src/model.ts', dir: 'src', named: '@wilanis/compiler' },
      { dependencies: ['@wilanis/compiler'] },
    ),
    violation:
      'packages/core/src/model.ts imports @wilanis/compiler, which comes after @wilanis/core in the order; engine <- core <- compiler <- runtime <- view',
  },
  {
    input: reaching('@wilanis/plugin-blob', {
      file: 'packages/plugin-blob/test/blob.test.ts',
      dir: 'test',
      named: '@wilanis/compiler',
    }),
    violation:
      'packages/plugin-blob/test/blob.test.ts imports @wilanis/compiler, which @wilanis/plugin-blob names nowhere; declare @wilanis/compiler under devDependencies',
  },
];
