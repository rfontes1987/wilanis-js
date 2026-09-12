/**
 * An engine that keeps its records in a Map, for tests of this package alone. It exists so the suite and the
 * handlers can be run against something without @storage depending on an engine; the real one for development
 * is @wilanis/plugin-storage-memory, its own package and its own plugin.
 */
import type { At, Engine, Query, Record_, Test, Where } from '../src/index.js';

const compare = (left: unknown, right: unknown): number => {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left).localeCompare(String(right));
};

/** One test against one value of a record. */
function passes(test: Test, value: unknown): boolean {
  switch (test.op) {
    case 'eq':
      return value === test.value;
    case 'ne':
      return value !== test.value;
    case 'lt':
      return compare(value, test.value) < 0;
    case 'lte':
      return compare(value, test.value) <= 0;
    case 'gt':
      return compare(value, test.value) > 0;
    case 'gte':
      return compare(value, test.value) >= 0;
    case 'in':
      return (test.value as unknown[]).includes(value);
    case 'notIn':
      return !(test.value as unknown[]).includes(value);
    case 'has':
      return (value !== undefined) === test.value;
    case 'contains':
      return String(value ?? '').includes(String(test.value));
    default:
      return String(value ?? '').startsWith(String(test.value));
  }
}

/** The parsed filter, as a predicate over one record. */
function matches(where: Where | undefined, record: Record_): boolean {
  if (!where) return true;
  if (where.kind === 'all') return where.of.every(one => matches(one, record));
  if (where.kind === 'any') return where.of.some(one => matches(one, record));
  if (where.kind === 'not') return !matches(where.of, record);
  return where.tests.every(test => passes(test, record[where.field]));
}

/** The records in the order asked for: by the first ordering, then the next where the first ties. */
function ordered(records: Record_[], query: Query): Record_[] {
  const order = query.order ?? [];
  if (!order.length) return records;
  return [...records].sort((left, right) => {
    for (const one of order) {
      const sign = one.dir === 'desc' ? -1 : 1;
      const answer = compare(left[one.by], right[one.by]) * sign;
      if (answer !== 0) return answer;
    }
    return 0;
  });
}

export class FakeEngine implements Engine {
  private readonly byCollection = new Map<string, Map<string, Record_>>();
  private serial = 0;

  private at(at: At): Map<string, Record_> {
    const key = `${at.connection}/${at.name}`;
    let records = this.byCollection.get(key);
    if (!records) {
      records = new Map();
      this.byCollection.set(key, records);
    }
    return records;
  }

  async get(at: At, key: unknown) {
    return { record: this.at(at).get(String(key)) };
  }

  async find(at: At, query: Query) {
    const all = [...this.at(at).values()].filter(record => matches(query.where, record));
    const sorted = ordered(all, query);
    const from = query.offset ?? 0;
    return sorted.slice(from, query.limit === undefined ? undefined : from + query.limit);
  }

  async count(at: At, where: Where | undefined) {
    return [...this.at(at).values()].filter(record => matches(where, record)).length;
  }

  async put(at: At, record: Record_, replace: boolean) {
    const records = this.at(at);
    const key = String(record[at.key]);
    if (!replace && records.has(key)) return { conflict: true };
    records.set(key, { ...record });
    return { record: { ...record }, conflict: false };
  }

  async patch(at: At, key: unknown, changes: Record_) {
    const records = this.at(at);
    const before = records.get(String(key));
    if (!before) return {};
    const after = { ...before, ...changes };
    records.set(String(key), after);
    return { record: { ...after } };
  }

  async remove(at: At, key: unknown) {
    const records = this.at(at);
    const before = records.get(String(key));
    records.delete(String(key));
    return { record: before };
  }

  async newKey(at: At) {
    this.serial++;
    return `${at.name}-${this.serial}`;
  }

  async ensure(collections: At[]) {
    for (const at of collections) this.at(at);
  }
}
