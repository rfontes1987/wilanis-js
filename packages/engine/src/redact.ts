/** Secrets never appear in a report: a redacted copy of a value replaces every marked path with a marker. */
import { readPath } from './sources.js';

const SECRET = '«secret»';

/** A copy of `value` with every listed path replaced; a path of no segments redacts the whole value. */
export function redactValue(value: unknown, paths: string[][] | undefined): unknown {
  if (!paths?.length || value === undefined) return value;
  const copy: unknown = JSON.parse(JSON.stringify(value));
  for (const path of paths) {
    if (!path.length) return SECRET;
    redactAt(copy, path);
  }
  return copy;
}

/** Each element of a list redacted on its own: what a map's report shows of its answer. */
export function redactEach(items: unknown[], paths: string[][] | undefined): unknown[] {
  return paths?.length ? items.map(item => redactValue(item, paths)) : items;
}

/** Replace the value at `path` inside `root` in place, when the path leads somewhere. */
function redactAt(root: unknown, path: string[]): void {
  const parent = readPath(root, path.slice(0, -1));
  const last = path[path.length - 1];
  if (parent && typeof parent === 'object' && last in parent) (parent as Record<string, unknown>)[last] = SECRET;
}
