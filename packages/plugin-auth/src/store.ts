/**
 * Where sessions and challenges live: one JSON file per record under <dir>/<kind>/. A file, not memory, so that
 * a server and the `wilanis run` processes of the same tree share them -- the OTP flow on the command line opens a
 * challenge in one process, issues its code in a second and answers it in a third. A real deployment points
 * `store.dir` at a volume; a store behind a database is its own plugin.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const safe = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, '_');

/** The records of one directory, each kind in its own folder: read one, write one whole, forget one, or list a kind. */
export class Store {
  constructor(readonly dir: string) {}
  private path(kind: string, id: string) {
    return join(this.dir, kind, `${safe(id)}.json`);
  }
  /** The record, or nothing. */
  get<T>(kind: string, id: string): T | undefined {
    try {
      return JSON.parse(readFileSync(this.path(kind, id), 'utf8')) as T;
    } catch {
      return undefined;
    }
  }
  /** Write the record whole. */
  put(kind: string, id: string, record: unknown): void {
    mkdirSync(join(this.dir, kind), { recursive: true });
    writeFileSync(this.path(kind, id), `${JSON.stringify(record, null, 2)}\n`);
  }
  /** Forget the record; nothing happens when there is none. */
  delete(kind: string, id: string): void {
    rmSync(this.path(kind, id), { force: true });
  }
  /** Every record of one kind. */
  list<T>(kind: string): T[] {
    let names: string[];
    try {
      names = readdirSync(join(this.dir, kind));
    } catch {
      return [];
    }
    const out: T[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      try {
        out.push(JSON.parse(readFileSync(join(this.dir, kind, name), 'utf8')) as T);
      } catch {
        /* a half-written file: skip */
      }
    }
    return out;
  }
}

const stores = new Map<string, Store>();
/** The store at a directory, one instance per directory in this process. */
export function storeAt(dir: string): Store {
  let store = stores.get(dir);
  if (!store) {
    store = new Store(dir);
    stores.set(dir, store);
  }
  return store;
}
