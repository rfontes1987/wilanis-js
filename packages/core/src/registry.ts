/**
 * What the loader answers: every document as loaded, by canonical path, and the refusals made on the way.
 * The checker and the compiler share one Registry.
 */
import type { AnyDoc, DocByKind, Kind, Layer, ProjectDoc } from './model.js';

/** A document as loaded. */
export interface Loaded<T extends AnyDoc = AnyDoc> {
  doc: T;
  kind: Kind;
  /** Canonical path: @features/tasks/tasks.port.json, or @http/http.port.json for a native document. */
  path: string;
  /** The filename stem. */
  name: string;
  /** The feature folder it sits in, if any. */
  feature?: string;
  /** The layer directory it sits in: what a rule reads instead of inferring from who references it. */
  layer?: Layer;
  /** The plugin alias that shipped it, if native. */
  native?: string;
  /** The package it was included from, when it is another tree's document rather than this one's. */
  included?: string;
  /** Where it is on disk, so a reader can open it: under the tree, or under the plugin's package. */
  file?: string;
}

/** One reason the tree is refused: the file, the rule, and the direction of the fix. */
export interface Refusal {
  code: string;
  message: string;
  file: string;
  at?: string;
  hint?: string;
}

/** One refusal as `wilanis check` prints it: the code and file, then the message, then the fix. */
function formatRefusal(refusal: Refusal): string {
  const where = refusal.at ? `#${refusal.at}` : '';
  const hint = refusal.hint ? `\n    → ${refusal.hint}` : '';
  return `${refusal.code}  ${refusal.file}${where}\n    ${refusal.message}${hint}`;
}

export class RefusalList {
  readonly items: Refusal[] = [];
  add(refusal: Refusal) {
    this.items.push(refusal);
    return this;
  }
  get ok() {
    return this.items.length === 0;
  }
  format(): string {
    return this.items.map(formatRefusal).join('\n');
  }
}

/** Everything the loader found, by canonical path. */
export class Registry {
  private byPath = new Map<string, Loaded>();
  readonly files: Loaded[] = [];
  add(entry: Loaded): Loaded | undefined {
    const dup = this.byPath.get(entry.path);
    this.byPath.set(entry.path, entry);
    this.files.push(entry);
    return dup;
  }
  get<K extends Kind>(kind: K, path: string): Loaded<DocByKind[K]> | undefined {
    const entry = this.byPath.get(path);
    return entry && entry.kind === kind ? (entry as Loaded<DocByKind[K]>) : undefined;
  }
  any(path: string): Loaded | undefined {
    return this.byPath.get(path);
  }
  all<K extends Kind>(kind: K): Loaded<DocByKind[K]>[] {
    return this.files.filter(entry => entry.kind === kind) as Loaded<DocByKind[K]>[];
  }
  get project(): Loaded<ProjectDoc> | undefined {
    return this.all('project')[0];
  }
}

/** Split path#operation. */
export function splitOp(opRef: string): { path: string; op: string } {
  const hash = opRef.lastIndexOf('#');
  return { path: opRef.slice(0, hash), op: opRef.slice(hash + 1) };
}
