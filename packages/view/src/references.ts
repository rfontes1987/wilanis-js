/**
 * Which documents reference which: the index built once over the tree, and the callers of one document, so a reader can
 * walk the tree in both directions.
 */
import type { Kind, Loaded, LoadResult, Scope } from '@wilanis/core';
import type { VRef } from './types.js';
import { labelOf } from './types.js';

// ---- references -----------------------------------------------------------------------------------

export interface IndexedRef {
  from: string;
  to: string;
  kind: Kind;
  at: string;
  opName?: string;
}

/** The document a string names, and the operation it named on it, or undefined when it names none. */
function referenceOf(scope: Scope, from: Loaded, text: string, at: string): IndexedRef | undefined {
  if (!text.startsWith('@') || text.startsWith('@wilanis/')) return undefined;
  const hash = text.lastIndexOf('#');
  const path = hash < 0 ? text : text.slice(0, hash);
  const operation = hash < 0 ? undefined : text.slice(hash + 1);
  const target = scope.any(path.replace(/(\[\])+$/, ''));
  if (!target || target.path === from.path) return undefined;
  return { from: from.path, to: target.path, kind: target.kind, at, opName: operation };
}

/** Every field of a value that a walk descends into, as a pointer segment and what sits there. */
function below(value: unknown): [string, unknown][] {
  if (Array.isArray(value)) return value.map((each, index): [string, unknown] => [String(index), each]);
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).filter(([key]) => key !== '$schema');
}

/** Every string in every document that names another document, with the JSON pointer it sits at. */
export function referenceIndex(load: LoadResult, scope: Scope): IndexedRef[] {
  const out: IndexedRef[] = [];
  const walk = (from: Loaded, value: unknown, at: string) => {
    if (typeof value === 'string') {
      const found = referenceOf(scope, from, value, at);
      if (found) out.push(found);
      return;
    }
    for (const [segment, each] of below(value)) walk(from, each, `${at}/${segment}`);
  };
  for (const file of load.registry.files) walk(file, file.doc, '');
  return out;
}

/**
 * Everyone who reaches a graph through one binding operation: every node and trigger that runs the port operation
 * this binding meets, with `via` naming it.
 */
function throughBinding(reference: IndexedRef, index: IndexedRef[], scope: Scope): VRef[] {
  const binding = scope.registry.get('binding', reference.from);
  const operation = /^\/operations\/([^/]+)\//.exec(reference.at);
  if (!binding || !operation) return [];
  const port = scope.canon(binding.doc.port);
  const named = operation[1];
  return index
    .filter(caller => caller.opName === named && caller.to === port)
    .map(caller => ({
      path: caller.from,
      label: labelOf(scope.registry.any(caller.from)),
      kind: caller.kind,
      at: caller.at,
      via: `${port}#${named}`,
    }));
}

/**
 * Who names this document. A graph behind a binding operation is also reached by every node and every
 * trigger that runs the port operation the binding meets, so those are added with `via` naming the operation.
 */
export function callersOf(path: string, index: IndexedRef[], scope: Scope): VRef[] {
  const direct = index.filter(reference => reference.to === path);
  const out: VRef[] = direct.map(reference => ({
    path: reference.from,
    label: labelOf(scope.registry.any(reference.from)),
    kind: reference.kind,
    at: reference.at,
  }));
  for (const reference of direct)
    for (const reached of throughBinding(reference, index, scope))
      if (!out.some(one => one.path === reached.path && one.at === reached.at)) out.push(reached);
  // the index carries the target's kind; a caller's is its own
  return out.map(caller => ({ ...caller, kind: scope.registry.any(caller.path)?.kind ?? caller.kind }));
}
