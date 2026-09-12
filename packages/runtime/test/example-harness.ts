/**
 * What the example's tests run against: the tree itself, the plugins and the included access tree it loads with, and
 * the copies a sabotage test breaks one document in.
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkTree } from '@wilanis/compiler';
import { loadTree, type ResolvedInclude } from '@wilanis/core';
import auth from '@wilanis/plugin-auth';
import blobs from '@wilanis/plugin-blob';
import http from '@wilanis/plugin-http';
import reload from '@wilanis/plugin-reload';
import { BUILTIN_PLUGINS } from '../src/index.js';

export const EXAMPLE = fileURLToPath(new URL('../../../example', import.meta.url));
export const PLUGINS = { ...BUILTIN_PLUGINS, '@http': http, '@blob': blobs, '@reload': reload, '@auth': auth };

/** The tree the example includes, as the runtime would resolve it from the example's node_modules. */
export const INCLUDES: ResolvedInclude[] = [
  {
    from: '@wilanis/access',
    dir: fileURLToPath(new URL('../../../libraries/access', import.meta.url)),
    features: ['access'],
  },
];

/** The refusal codes a tree answers with. */
export const codes = (root: string) => checkTree(loadTree(root, PLUGINS, INCLUDES)).items.map(refusal => refusal.code);

/** A plugin's docs directory, written from name -> document. */
export function docsDir(docs: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'wilanis-docs-'));
  for (const [name, doc] of Object.entries(docs)) writeFileSync(join(dir, name), JSON.stringify(doc));
  return dir;
}

/** A throwaway copy of the example, without what a check must not read. */
function copyOfExample(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wilanis-'));
  cpSync(EXAMPLE, dir, { recursive: true, filter: path => !path.includes('node_modules') });
  return dir;
}

/** The refusal codes a copy answers with, once it has been broken; the copy does not outlive the answer. */
function codesAfter(change: (dir: string) => void): string[] {
  const dir = copyOfExample();
  change(dir);
  const out = codes(dir);
  rmSync(dir, { recursive: true, force: true });
  return out;
}

/** Copy the example, apply an edit to one file, answer the refusal codes. */
export function sabotage(file: string, edit: (doc: any) => void): string[] {
  return codesAfter(dir => {
    const path = join(dir, file);
    const doc = JSON.parse(readFileSync(path, 'utf8'));
    edit(doc);
    writeFileSync(path, JSON.stringify(doc));
  });
}

/** Copy the example, move one document to another path, and answer the refusal codes. */
export function relocate(from: string, to: string): string[] {
  return codesAfter(dir => {
    mkdirSync(dirname(join(dir, to)), { recursive: true });
    renameSync(join(dir, from), join(dir, to));
  });
}

/** Copy the example, write raw bytes over one file, and answer the refusal codes. */
export function corrupt(file: string, bytes: string): string[] {
  return codesAfter(dir => writeFileSync(join(dir, file), bytes));
}

/** Copy the example, delete one file, and answer the refusal codes. */
export function without(file: string): string[] {
  return codesAfter(dir => rmSync(join(dir, file), { force: true }));
}

/** Copy the example, add a document at a path it does not have, and answer the refusal codes. */
export function planted(file: string, doc: unknown): string[] {
  return codesAfter(dir => {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), JSON.stringify(doc));
  });
}

/** Copy the example, add several documents at paths it does not have, and answer the refusal codes. */
export function plantedAll(docs: Record<string, unknown>): string[] {
  return codesAfter(dir => {
    for (const [file, doc] of Object.entries(docs)) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), JSON.stringify(doc));
    }
  });
}
