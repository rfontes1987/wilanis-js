/**
 * Claim: typescript is strict in every package.
 * Why: `strict: true` sits once in `tsconfig.base.json` and every package extends it, so no package can
 *   loosen the compiler for itself. Two things keep that true and neither was held: a package's own
 *   `tsconfig.json` setting nothing but `rootDir` and `outDir`, since any other option there is a rule
 *   changed in one corner; and every package being a reference of the root, since `npm run build` is
 *   `tsc -b` over those references -- a package missing from the list is a package the build never type
 *   checks, and `CLAUDE.md` calls that build order a fitness function already.
 * Retire when: a package genuinely needs a compiler option of its own, and an RFC says which and why. A
 *   package that merely fails under `strict` is a package with a type to fix.
 */
import { at, readJson, record } from './lib/jsonc.js';
import { fileExists, packageDirs } from './lib/sources.js';

/** What a package's own tsconfig may set: where its sources are, and where its build goes. */
const OWN_OPTIONS = ['rootDir', 'outDir'];

/** The claim this module holds, and the title the runner gives its test. */
export const claim = 'typescript is strict in every package';

/** The base's strictness, the root's references, and what each package's own tsconfig extends and sets. */
export const gather = () => ({
  strict: at(readJson('tsconfig.base.json'), 'compilerOptions.strict') === true,
  references: referencePaths(),
  packages: packageDirs()
    .filter(dir => fileExists(`${dir}/tsconfig.json`))
    .map(dir => ({
      dir,
      extends: at(readJson(`${dir}/tsconfig.json`), 'extends'),
      options: Object.keys(record(at(readJson(`${dir}/tsconfig.json`), 'compilerOptions')) ?? {}).sort(),
    })),
});

/** Every way the compiler could be loosened for one package, one sentence each, naming the file and the fix. */
export const judge = (found: ReturnType<typeof gather>): string[] => [
  ...(found.strict ? [] : ['tsconfig.base.json does not set strict: true; every package extends it, so set it there']),
  ...found.packages.flatMap(pkg => faults(pkg, found.references)),
];

/** Whichever of the three rules one package breaks. */
function faults(pkg: { dir: string; extends: unknown; options: string[] }, references: string[]): string[] {
  const own = pkg.options.filter(name => !OWN_OPTIONS.includes(name));
  return [
    ...(pkg.extends === '../../tsconfig.base.json'
      ? []
      : [`${pkg.dir}/tsconfig.json does not extend ../../tsconfig.base.json; strictness lives there`]),
    ...(own.length === 0
      ? []
      : [`${pkg.dir}/tsconfig.json sets ${own.join(', ')}; a package sets only ${OWN_OPTIONS.join(' and ')}`]),
    ...(references.includes(pkg.dir)
      ? []
      : [`${pkg.dir} is no reference of tsconfig.json; tsc -b never type checks it, so add it`]),
  ];
}

/** The paths the root tsconfig names as project references. */
function referencePaths(): string[] {
  const refs = at(readJson('tsconfig.json'), 'references');
  if (!Array.isArray(refs)) return [];
  return refs.map(one => record(one)?.path).filter((path): path is string => typeof path === 'string');
}

/** The proof that the judge bites: a loose base, an option of one's own, and a package the build never sees. */
export const sabotage = [
  {
    input: { strict: false, references: [], packages: [] },
    violation: 'tsconfig.base.json does not set strict: true; every package extends it, so set it there',
  },
  {
    input: {
      strict: true,
      references: ['packages/core'],
      packages: [
        { dir: 'packages/core', extends: '../../tsconfig.base.json', options: ['outDir', 'rootDir', 'strict'] },
      ],
    },
    violation: 'packages/core/tsconfig.json sets strict; a package sets only rootDir and outDir',
  },
  {
    input: {
      strict: true,
      references: [],
      packages: [{ dir: 'packages/view', extends: '../../tsconfig.base.json', options: ['outDir', 'rootDir'] }],
    },
    violation: 'packages/view is no reference of tsconfig.json; tsc -b never type checks it, so add it',
  },
];
