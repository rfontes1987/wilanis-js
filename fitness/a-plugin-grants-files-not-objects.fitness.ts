/**
 * Claim: a plugin grants files not objects.
 * Why: `CLAUDE.md` says it of every plugin: "every port, kind, codec or shape a plugin grants is a file
 *   under `docs/`, never an object in code: what the DSL names, a reader can open". A `docs/plugin.json` is
 *   the manifest that says what the plugin grants, and `files` is what npm publishes -- a plugin whose
 *   manifest is not shipped grants nothing to a consumer tree, however well its handlers work. Discovery
 *   rests on it: `wilanis describe` prints `granted by @http (@wilanis/plugin-http)` by reading these files,
 *   and the viewer links the manifest.
 * Retire when: a plugin grants through something a reader can open that is not a file under `docs/`, and an
 *   RFC says what. An object in code is not that thing.
 */
import { manifestOf } from './lib/jsonc.js';
import { fileExists, packageDirs } from './lib/sources.js';

/** The claim this module holds, and the title the runner gives its test. */
export const claim = 'a plugin grants files not objects';

/** Every plugin package, with whether its manifest is there and whether `docs` is published. */
export const gather = () =>
  packageDirs()
    .filter(dir => dir.startsWith('packages/plugin-'))
    .map(dir => ({ dir, manifest: fileExists(`${dir}/docs/plugin.json`), files: manifestOf(dir).files }));

/** Every plugin that grants nothing a reader can open, one sentence each, naming the package and the fix. */
export const judge = (plugins: ReturnType<typeof gather>): string[] =>
  plugins.flatMap(({ dir, manifest, files }) => [
    ...(manifest ? [] : [`${dir} has no docs/plugin.json; a plugin says what it grants in a file, not in code`]),
    ...(files.includes('docs')
      ? []
      : [`${dir} does not list docs in its files; a published plugin ships what it grants`]),
  ]);

/** The proof that the judge bites: a plugin with no manifest, and one that publishes without its docs. */
export const sabotage = [
  {
    input: [{ dir: 'packages/plugin-http', manifest: false, files: ['dist', 'docs'] }],
    violation: 'packages/plugin-http has no docs/plugin.json; a plugin says what it grants in a file, not in code',
  },
  {
    input: [{ dir: 'packages/plugin-blob', manifest: true, files: ['dist', 'README.md'] }],
    violation: 'packages/plugin-blob does not list docs in its files; a published plugin ships what it grants',
  },
];
