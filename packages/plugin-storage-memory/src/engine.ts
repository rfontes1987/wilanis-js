/**
 * Records in a Map, for exactly as long as the process runs. One Map per collection -- and a collection is
 * the pair of its connection and its name, as @storage says it is, so two features declaring the same name
 * over one connection meet the same records rather than two sets of them.
 *
 * Nothing here is module state: the maps hang off the instance, and a new instance is registered for every
 * environment, so loading a tree a second time starts empty.
 */
import { randomUUID } from 'node:crypto';
import type { Type } from '@wilanis/core';
import type { At, Engine, Query, Record_, Where } from '@wilanis/plugin-storage';
import { matches, ordered, paged } from './match.js';

/** The type of the field that identifies a record, so a new key can be one the collection would accept. */
function keyType(at: At): Type | undefined {
  return at.shape.kind === 'object' ? at.shape.fields[at.key]?.type : undefined;
}

/** An @storage engine keeping records in maps that live as long as the process, and no longer. */
export class MemoryEngine implements Engine {
  /** connection/name -> the records kept under it, by the text of their key. */
  private readonly collections = new Map<string, Map<string, Record_>>();
  /** How many keys this engine has made, so a number key can be one no record has. */
  private made = 0;

  /** The records of one collection, made on first use: `ensure` is therefore nothing to do here. */
  private records(at: At): Map<string, Record_> {
    const where = `${at.connection}/${at.name}`;
    let kept = this.collections.get(where);
    if (!kept) {
      kept = new Map();
      this.collections.set(where, kept);
    }
    return kept;
  }

  /**
   * A deep copy, so what a graph does with a record it was given cannot reach what is kept, and what a caller
   * does with the record it handed over cannot either. A shallow copy would share every nested object, which
   * is a store that changes without being written to; records are the JSON a shape describes, so cloning one
   * is defined for everything a collection can hold.
   */
  private static copy(record: Record_ | undefined): Record_ | undefined {
    return record && MemoryEngine.kept(record);
  }

  /** The same copy, of a record there certainly is one of. */
  private static kept(record: Record_): Record_ {
    return structuredClone(record) as Record_;
  }

  /** The record kept under that key, or `record` absent where the collection holds none. */
  async get(at: At, key: unknown) {
    return { record: MemoryEngine.copy(this.records(at).get(String(key))) };
  }

  /** Every record the filter matches, in the order asked for and cut to the page asked for. */
  async find(at: At, query: Query) {
    const matching = [...this.records(at).values()].filter(record => matches(query.where, record));
    return paged(ordered(matching, query.order), query.limit, query.offset).map(record => MemoryEngine.kept(record));
  }

  /** How many records the filter matches. */
  async count(at: At, where: Where | undefined) {
    return [...this.records(at).values()].filter(record => matches(where, record)).length;
  }

  /** Write the whole record under its own key; with `replace` false, answer a conflict and write nothing. */
  async put(at: At, record: Record_, replace: boolean) {
    const kept = this.records(at);
    const key = String(record[at.key]);
    if (!replace && kept.has(key)) return { conflict: true };
    kept.set(key, MemoryEngine.kept(record));
    return { record: MemoryEngine.kept(record), conflict: false };
  }

  /** The record after the change, or `record` absent where the collection holds none under that key. */
  async patch(at: At, key: unknown, changes: Record_) {
    const kept = this.records(at);
    const before = kept.get(String(key));
    if (!before) return {};
    const after = MemoryEngine.kept({ ...before, ...changes });
    kept.set(String(key), after);
    return { record: MemoryEngine.kept(after) };
  }

  /** The record that was removed, or `record` absent where there was none. */
  async remove(at: At, key: unknown) {
    const kept = this.records(at);
    const before = MemoryEngine.copy(kept.get(String(key)));
    kept.delete(String(key));
    return { record: before };
  }

  /**
   * A key no record of the collection has, of the type the collection's key field declares: a uuid for a
   * string, one past the highest for a number. A key of any other type is the tree's to write, since this
   * engine has nothing to generate that would still be that type.
   */
  async newKey(at: At) {
    const type = keyType(at);
    if (type?.kind === 'string') return randomUUID();
    if (type?.kind === 'number') {
      const kept = [...this.records(at).values()].map(record => Number(record[at.key]));
      this.made = Math.max(this.made, ...kept.filter(Number.isFinite)) + 1;
      return this.made;
    }
    throw new Error(
      `newKey: this engine makes a key for a string or a number, and '${at.key}' is ${type?.kind ?? 'of no known type'}`,
    );
  }

  /** Every collection exists as soon as it is asked for, so there is nothing to create and nothing to alter. */
  async ensure(collections: At[]) {
    for (const at of collections) this.records(at);
  }
}
