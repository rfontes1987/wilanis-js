/**
 * The tree as static files: every answer the page asks a server for, written once beside it, so the viewer
 * shows a tree from any static host with nothing running. `siteOf` answers the files -- the index, one view
 * per document, and every schema core ships -- and `writeSite` puts them on disk beside a copy of the page.
 * Paths are written relative to a base, so a published site names no one's disk.
 */

import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PluginModule } from '@wilanis/core';
import { WILANIS } from '@wilanis/core';
import { loadProject } from '@wilanis/runtime';
import { indexOf, schemaRelOf, schemaViewOf, viewOf } from './model.js';
import { PAGE, versionOf } from './serve.js';

export interface SiteOptions {
  /** Plugins beyond the builtins and the packages project.json names (tests). */
  plugins?: Record<string, PluginModule>;
  /** The directory every path is written relative to. Default: the tree's parent. */
  base?: string;
}

/** A value with every path under prefix written relative to it, so a published site names no one's disk. */
function withoutPrefix(value: unknown, prefix: string): unknown {
  if (typeof value === 'string') {
    return value.startsWith(prefix) ? value.slice(prefix.length).split(sep).join('/') : value;
  }
  if (Array.isArray(value)) return value.map(item => withoutPrefix(item, prefix));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, held]) => [key, withoutPrefix(held, prefix)]));
  }
  return value;
}

/** Where one document's view is written, under the site root: its path with the leading @ dropped. */
function fileOf(path: string): string {
  const rel = path.replace(/^@/, '');
  if (rel.split('/').some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`'${path}' cannot be a file of a site; a document path names its feature and its file`);
  }
  return `docs/${rel}`;
}

/** Every schema the installed core ships, by the path a document names it with: node/run.schema.json. */
async function schemasOf(): Promise<Record<string, unknown>> {
  const dir = dirname(fileURLToPath(import.meta.resolve('@wilanis/core/schemas/graph.schema.json')));
  const schemas: Record<string, unknown> = {};
  for (const name of await readdir(dir, { recursive: true })) {
    const rel = name.split(sep).join('/');
    if (schemaRelOf(`${WILANIS}/${rel}`) === undefined) continue;
    schemas[rel] = JSON.parse(await readFile(join(dir, name), 'utf8'));
  }
  return schemas;
}

/** Every file of the static site by its path under the site root: the index, one view per document, the schemas. */
export async function siteOf(root: string, opts: SiteOptions = {}): Promise<Record<string, unknown>> {
  const tree = resolve(root);
  const prefix = `${resolve(opts.base ?? dirname(tree))}${sep}`;
  const load = await loadProject(tree, { plugins: opts.plugins });
  const index = indexOf(load);
  const files: Record<string, unknown> = {
    'index.json': withoutPrefix({ ...index, version: versionOf(tree) }, prefix),
  };
  for (const entry of index.docs) {
    const view = viewOf(load, entry.path);
    if (view) files[fileOf(entry.path)] = withoutPrefix(view, prefix);
  }
  for (const [rel, schema] of Object.entries(await schemasOf())) files[`schemas/${rel}`] = schemaViewOf(rel, schema);
  return files;
}

/** Write the site for a tree into out: the page, then every file `siteOf` answers. Answers what was written. */
export async function writeSite(root: string, out: string, opts: SiteOptions = {}): Promise<string[]> {
  const files = await siteOf(root, opts);
  const site = resolve(out);
  await mkdir(site, { recursive: true });
  await cp(PAGE, join(site, 'index.html'));
  for (const [rel, body] of Object.entries(files)) {
    const file = join(site, ...rel.split('/'));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(body));
  }
  return ['index.html', ...Object.keys(files)];
}
