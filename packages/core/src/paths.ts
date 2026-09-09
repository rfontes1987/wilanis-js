/** Files and references of a tree: walking a directory for documents, naming them, and canonicalising references. */
import { readdirSync, statSync } from 'node:fs';
import { basename, join, sep } from 'node:path';

const NOT_DOCUMENTS = new Set(['package.json', 'package-lock.json', 'tsconfig.json']);
/** Alias roots the loader itself gives meaning to; a project may not redefine them. */
export const RESERVED_ROOTS = ['@wilanis', '@features', '@connections', '@scenarios'];
const ALIAS_REF = /^(@[a-z][a-z0-9-]*)(\/.*)?$/;

/** Every document under a directory: *.json files, tooling files and hidden directories left out. */
export function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') || name === 'node_modules') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name.endsWith('.json') && !NOT_DOCUMENTS.has(name)) out.push(path);
  }
  return out;
}

/** The directories directly under one. */
export function subdirectories(dir: string): string[] {
  return readdirSync(dir).filter(name => statSync(join(dir, name)).isDirectory());
}

/** A path relative to the tree, written with forward slashes whatever the platform. */
export function treePath(relativePath: string): string {
  return relativePath.split(sep).join('/');
}

/** The feature a path under the tree sits in: features/<name>/... -> name. Either separator. */
export function featureOf(rel: string): string | undefined {
  const parts = rel.split(/[\\/]/);
  return parts[0] === 'features' && parts.length > 2 ? parts[1] : undefined;
}

/** The filename stem without the kind suffix: tasks.port.json -> tasks. */
export const stem = (file: string) =>
  basename(file)
    .replace(/\.json$/, '')
    .replace(/\.[a-z-]+$/, '');

/** Canonicalise a reference: expand a project alias (@tasks/x -> @features/tasks/x). Plugin roots and root paths stay as they are. */
export function makeResolver(aliases: Record<string, string>, pluginRoots: Set<string>) {
  const fixed = new Set(['@features', '@connections', '@scenarios']);
  return (ref: string): string => {
    const match = ALIAS_REF.exec(ref);
    if (!match) return ref;
    const [, alias, rest] = match;
    if (pluginRoots.has(alias) || fixed.has(alias)) return ref;
    const target = aliases[alias];
    return target === undefined ? ref : target.replace(/\/$/, '') + (rest ?? '');
  };
}
