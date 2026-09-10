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

/**
 * Every reason a tree is refused, gathered rather than thrown: loading and checking carry on after one so a
 * reader sees the whole picture at once, in the order the rules found it.
 */
export class RefusalList {
  readonly items: Refusal[] = [];
  /** Record one more reason the tree is refused, and answer the list so refusals may be added in a chain. */
  add(refusal: Refusal) {
    this.items.push(refusal);
    return this;
  }
  /** Whether the tree stands: nothing has refused it. */
  get ok() {
    return this.items.length === 0;
  }
  /** Every refusal as `wilanis check` prints it, one after another. */
  format(): string {
    return this.items.map(formatRefusal).join('\n');
  }
}

/** Everything the loader found, by canonical path. */
export class Registry {
  private byPath = new Map<string, Loaded>();
  readonly files: Loaded[] = [];
  /** Take one loaded document in, answering the one it displaced when a path was already taken (D002). */
  add(entry: Loaded): Loaded | undefined {
    const dup = this.byPath.get(entry.path);
    this.byPath.set(entry.path, entry);
    this.files.push(entry);
    return dup;
  }
  /** The document at a canonical path when it is of the kind asked for; nothing when it is absent or another kind. */
  get<K extends Kind>(kind: K, path: string): Loaded<DocByKind[K]> | undefined {
    const entry = this.byPath.get(path);
    return entry && entry.kind === kind ? (entry as Loaded<DocByKind[K]>) : undefined;
  }
  /** The document at a canonical path whatever its kind, for a rule that reports what it found instead. */
  any(path: string): Loaded | undefined {
    return this.byPath.get(path);
  }
  /** Every document of one kind, in load order, for a rule that judges a family rather than one path. */
  all<K extends Kind>(kind: K): Loaded<DocByKind[K]>[] {
    return this.files.filter(entry => entry.kind === kind) as Loaded<DocByKind[K]>[];
  }
  /** The tree's project document, the one place its plugins, aliases, profiles and startup are declared. */
  get project(): Loaded<ProjectDoc> | undefined {
    return this.all('project')[0];
  }
}

/** Split path#operation. */
export function splitOp(opRef: string): { path: string; op: string } {
  const hash = opRef.lastIndexOf('#');
  return { path: opRef.slice(0, hash), op: opRef.slice(hash + 1) };
}
