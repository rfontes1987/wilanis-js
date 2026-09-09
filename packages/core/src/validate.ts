/**
 * Judges a document against its kind's JSON Schema. The kind is the document's $schema: the published URL
 * (schemaUrl) or the short alias (@wilanis/<kind>.schema.json). A document that fails here is never loaded.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020, type ErrorObject } from 'ajv/dist/2020.js';
import { KINDS, type Kind, kindOfSchema, schemaRef, schemaUrl } from './model.js';
import type { Refusal } from './registry.js';

export const SCHEMAS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'schemas');

/** Keywords that only group other keywords: the error inside them says what is wrong. */
const CONTAINERS = new Set(['oneOf', 'anyOf', 'allOf', 'if', 'propertyNames']);

let ajv: Ajv2020 | undefined;

function loadSchemas(engine: Ajv2020, dir: string): void {
  for (const name of readdirSync(dir).filter(file => file.endsWith('.schema.json'))) {
    engine.addSchema(JSON.parse(readFileSync(join(dir, name), 'utf8')));
  }
}

function engine(): Ajv2020 {
  if (ajv) return ajv;
  // Plain JSON Schema 2020-12, no extensions: what validates here validates in any editor.
  // verbose: errors carry the schema they failed, so a pattern can be explained by its definition's description.
  ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true, verbose: true });
  loadSchemas(ajv, SCHEMAS_DIR);
  loadSchemas(ajv, join(SCHEMAS_DIR, 'node'));
  return ajv;
}

const last = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** One error, said the way the schema's author would: what was expected there, and why. */
function explain(error: ErrorObject): string {
  const params = error.params as Record<string, unknown>;
  const description = (error.parentSchema as { description?: string } | undefined)?.description;
  switch (error.keyword) {
    case 'false schema':
      return `'${last(error.instancePath)}' is not allowed here`;
    case 'additionalProperties':
      return `unknown property '${params.additionalProperty}'`;
    case 'required':
      return `missing '${params.missingProperty}'`;
    case 'enum':
      return `must be one of ${(params.allowedValues as unknown[]).map(value => JSON.stringify(value)).join(', ')}`;
    case 'const':
      return `must be ${JSON.stringify(params.allowedValue)}`;
    case 'pattern': {
      const property = error.propertyName !== undefined ? `property name '${error.propertyName}' ` : '';
      return `${property}must match ${JSON.stringify(params.pattern)}${description ? ` -- ${description}` : ''}`;
    }
    default:
      return error.message ?? 'invalid';
  }
}

/** Errors by the path they sit at, containers left out. */
function groupByPath(errors: ErrorObject[]): Map<string, ErrorObject[]> {
  const byPath = new Map<string, ErrorObject[]>();
  for (const error of errors) {
    if (CONTAINERS.has(error.keyword)) continue;
    const at = error.instancePath.replace(/^\//, '');
    const group = byPath.get(at) ?? [];
    group.push(error);
    byPath.set(at, group);
  }
  return byPath;
}

/** The one value a const error wanted, or the JSON type a type error wanted. */
function wanted(error: ErrorObject): string {
  if (error.keyword === 'const') return JSON.stringify((error.params as { allowedValue: unknown }).allowedValue);
  return String((error.params as { type: string }).type);
}

/**
 * The messages for one path. Where alternatives disagree about the JSON type, the type errors are the less
 * telling half: folded into one line, or dropped when a sharper error (a pattern, an enum) sits at the path.
 */
function messagesFor(group: ErrorObject[]): Set<string> {
  const typeErrors = group.filter(error => error.keyword === 'type' || error.keyword === 'const');
  const sharp = group.filter(error => error.keyword !== 'type' && error.keyword !== 'const');
  const messages = new Set<string>();
  if (sharp.length) {
    const consts = [...new Set(typeErrors.filter(error => error.keyword === 'const').map(wanted))];
    const prefix = consts.length ? `must be ${consts.join(' or ')}, or ` : '';
    for (const error of sharp) messages.add(`${prefix}${explain(error)}`);
  } else if (typeErrors.length) {
    messages.add(`must be ${[...new Set(typeErrors.map(wanted))].join(' or ')}`);
  }
  return messages;
}

/** Turn Ajv's errors into refusals, one per deviation. */
function refusalsOf(errors: ErrorObject[], file: string, kind: Kind): Refusal[] {
  const out: Refusal[] = [];
  for (const [at, group] of groupByPath(errors)) {
    for (const message of messagesFor(group)) {
      out.push({ code: 'D001', file, at: at || undefined, message, hint: `see ${schemaUrl(kind)}` });
    }
  }
  return out;
}

const ANY_KIND = '<kind>' as Kind;

/** Validate one parsed document. Answers refusals (empty when it conforms) and the kind. */
export function validateDocument(doc: unknown, file: string): { kind?: Kind; refusals: Refusal[] } {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    const hint = `every file opens with "$schema": "${schemaUrl(ANY_KIND)}" (or ${schemaRef(ANY_KIND)})`;
    return { refusals: [{ code: 'D001', file, message: 'a document is a JSON object', hint }] };
  }
  const kind = kindOfSchema((doc as { $schema?: unknown }).$schema);
  if (!kind) {
    const base = schemaUrl(ANY_KIND).replace('/<kind>.schema.json', '');
    const hint = `one of ${KINDS.map(name => schemaRef(name)).join(', ')}, or the same under ${base}`;
    return { refusals: [{ code: 'D001', file, at: '$schema', message: '$schema does not name a wilanis kind', hint }] };
  }
  const validate = engine().getSchema(schemaUrl(kind));
  if (!validate) throw new Error(`no schema loaded for kind '${kind}'`);
  if (validate(doc)) return { kind, refusals: [] };
  return { kind, refusals: refusalsOf(validate.errors ?? [], file, kind) };
}
