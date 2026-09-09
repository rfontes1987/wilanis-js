/**
 * The grammar of a read. A template `{{root.path}}` reads a value where it is written; a read path is a root,
 * then segments: `.name` for an identifier, or a quoted key in brackets for a name that is not one --
 * request.headers['user-agent']. Single or double quotes; single needs no escaping inside a JSON string.
 */

/** The {name} placeholders of a templated string setting, such as an http route. */
export const PLACEHOLDER = /\{([A-Za-z0-9_]+)\}/g;

const ROOT = '[a-z][A-Za-z0-9_]*';
const SEGMENT = String.raw`(?:\.[A-Za-z0-9_]+|\[(?:'[^'\]]*'|"[^"\]]*")\])`;
const IDENTIFIER = /^[A-Za-z0-9_]+$/;

/** Every template in a text, its read path captured. */
export const TEMPLATE = new RegExp(String.raw`\{\{\s*(${ROOT}${SEGMENT}*)\s*\}\}`, 'g');
/** A text that is one template and nothing else, its read path captured. */
export const WHOLE_TEMPLATE = new RegExp(String.raw`^\{\{\s*(${ROOT}${SEGMENT}*)\s*\}\}$`);
/** A bare read path, the way a resolver writes it. */
export const READ_PATH = new RegExp(`^${ROOT}${SEGMENT}*$`);
const SEGMENTS = new RegExp(String.raw`^(${ROOT})|\.([A-Za-z0-9_]+)|\[(?:'([^'\]]*)'|"([^"\]]*)")\]`, 'g');

/** The root and segments of a read path, quotes stripped: request.headers['user-agent'] → ['request', 'headers', 'user-agent']. */
export function splitPath(path: string): string[] {
  const out: string[] = [];
  for (const match of path.matchAll(SEGMENTS)) out.push(match[1] ?? match[2] ?? match[3] ?? match[4] ?? '');
  return out;
}

/** Segments written back as a read path: an identifier as .name, anything else quoted in brackets. */
export function joinPath(segments: string[]): string {
  const [root, ...rest] = segments;
  return root + rest.map(segment => (IDENTIFIER.test(segment) ? `.${segment}` : `['${segment}']`)).join('');
}
