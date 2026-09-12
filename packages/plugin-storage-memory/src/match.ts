/**
 * The filter and the ordering, as this engine reads them. @storage parses a `where` and judges what it may
 * say; what is here is the other half -- compiling that tree to a predicate over a record, which is the one
 * thing every engine does differently. A relational engine compiles the same tree to expressions instead.
 */
import type { Order, Record_, Test, Where } from '@wilanis/plugin-storage';

/** Two values in an order: numbers as numbers, everything else as the text it spells. */
export function compare(left: unknown, right: unknown): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  if (typeof left === 'boolean' && typeof right === 'boolean') return Number(left) - Number(right);
  return String(left ?? '').localeCompare(String(right ?? ''));
}

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => String(value ?? '');

/** One test against the value a record holds under the field it names. */
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
      return list(test.value).includes(value);
    case 'notIn':
      return !list(test.value).includes(value);
    case 'has':
      return (value !== undefined) === test.value;
    case 'contains':
      return text(value).includes(text(test.value));
    default:
      return text(value).startsWith(text(test.value));
  }
}

/** Whether one record is one the filter asks for; no filter asks for every record. */
export function matches(where: Where | undefined, record: Record_): boolean {
  if (!where) return true;
  if (where.kind === 'all') return where.of.every(one => matches(one, record));
  if (where.kind === 'any') return where.of.some(one => matches(one, record));
  if (where.kind === 'not') return !matches(where.of, record);
  return where.tests.every(test => passes(test, record[where.field]));
}

/** The records in the order asked for: by the first ordering, then by the next wherever the first ties. */
export function ordered(records: Record_[], order: Order[] | undefined): Record_[] {
  if (!order?.length) return records;
  return [...records].sort((left, right) => {
    for (const one of order) {
      const answer = compare(left[one.by], right[one.by]) * (one.dir === 'desc' ? -1 : 1);
      if (answer !== 0) return answer;
    }
    return 0;
  });
}

/** The page a find asks for: what is left after the skip, cut to the count. */
export function paged(records: Record_[], limit: number | undefined, offset: number | undefined): Record_[] {
  const from = offset ?? 0;
  return records.slice(from, limit === undefined ? undefined : from + limit);
}
