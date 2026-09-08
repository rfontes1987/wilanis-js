/**
 * Judges a document against its kind's JSON Schema. The kind is the document's $schema: the published URL
 * (schemaUrl) or the short alias (@wilanis/<kind>.schema.json). A document that fails here is never loaded.
 */
import { Ajv2020, type ErrorObject } from 'ajv/dist/2020.js';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KINDS, kindOfSchema, schemaRef, schemaUrl, type Kind, type Refusal } from './model.js';

export const SCHEMAS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'schemas');

let ajv: Ajv2020 | undefined;
function engine(): Ajv2020 {
  if (ajv) return ajv;
  // Plain JSON Schema 2020-12, no extensions: what validates here validates in any editor.
  // verbose: errors carry the schema they failed, so a pattern can be explained by its definition's description.
  ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true, verbose: true });
  for (const f of readdirSync(SCHEMAS_DIR).filter(f => f.endsWith('.schema.json'))) ajv.addSchema(JSON.parse(readFileSync(join(SCHEMAS_DIR, f), 'utf8')));
  for (const f of readdirSync(join(SCHEMAS_DIR, 'node'))) ajv.addSchema(JSON.parse(readFileSync(join(SCHEMAS_DIR, 'node', f), 'utf8')));
  return ajv;
}

const last = (p: string) => p.slice(p.lastIndexOf('/') + 1);

/** One error, said the way the schema's author would: what was expected there, and why. */
function explain(e: ErrorObject): string {
  const p = e.params as Record<string, unknown>;
  const desc = (e.parentSchema as { description?: string } | undefined)?.description;
  switch (e.keyword) {
    case 'false schema': return `'${last(e.instancePath)}' is not allowed here`;
    case 'additionalProperties': return `unknown property '${p.additionalProperty}'`;
    case 'required': return `missing '${p.missingProperty}'`;
    case 'enum': return `must be one of ${(p.allowedValues as unknown[]).map(v => JSON.stringify(v)).join(', ')}`;
    case 'const': return `must be ${JSON.stringify(p.allowedValue)}`;
    case 'pattern': return `${e.propertyName !== undefined ? `property name '${e.propertyName}' ` : ''}must match ${JSON.stringify(p.pattern)}${desc ? ` -- ${desc}` : ''}`;
    default: return e.message ?? 'invalid';
  }
}

/**
 * Turn Ajv's errors into refusals, one per deviation. Container errors (oneOf, anyOf) say nothing a
 * reader can act on and go. Where alternatives disagree about the JSON type at one path, the type
 * errors are the less telling half: they are folded into one line, or dropped when a sharper error
 * (a pattern, an enum) sits at the same path.
 */
function refusalsOf(errors: ErrorObject[], file: string, kind: Kind): Refusal[] {
  const byPath = new Map<string, ErrorObject[]>();
  for (const e of errors) {
    if (['oneOf', 'anyOf', 'allOf', 'if', 'propertyNames'].includes(e.keyword)) continue; // containers: the error inside them says what is wrong
    const at = e.instancePath.replace(/^\//, '');
    if (!byPath.has(at)) byPath.set(at, []);
    byPath.get(at)!.push(e);
  }
  const out: Refusal[] = [];
  for (const [at, group] of byPath) {
    const typeErrors = group.filter(e => e.keyword === 'type' || e.keyword === 'const');
    const sharp = group.filter(e => e.keyword !== 'type' && e.keyword !== 'const');
    const messages = new Set<string>();
    const consts = [...new Set(typeErrors.filter(e => e.keyword === 'const').map(e => JSON.stringify((e.params as { allowedValue: unknown }).allowedValue)))];
    if (sharp.length) sharp.forEach(e => messages.add(`${consts.length ? `must be ${consts.join(' or ')}, or ` : ''}${explain(e)}`));
    else if (typeErrors.length) messages.add(`must be ${[...new Set(typeErrors.map(e => e.keyword === 'const' ? JSON.stringify((e.params as { allowedValue: unknown }).allowedValue) : String((e.params as { type: string }).type)))].join(' or ')}`);
    for (const message of messages) out.push({ code: 'D001', file, at: at || undefined, message, hint: `see ${schemaUrl(kind)}` });
  }
  return out;
}

/** Validate one parsed document. Answers refusals (empty when it conforms) and the kind. */
export function validateDocument(doc: unknown, file: string): { kind?: Kind; refusals: Refusal[] } {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    return { refusals: [{ code: 'D001', file, message: 'a document is a JSON object', hint: `every file opens with "$schema": "${schemaUrl('<kind>' as Kind)}" (or ${schemaRef('<kind>' as Kind)})` }] };
  }
  const kind = kindOfSchema((doc as { $schema?: unknown }).$schema);
  if (!kind) return { refusals: [{ code: 'D001', file, at: '$schema', message: `$schema does not name a wilanis kind`, hint: `one of ${KINDS.map(k => schemaRef(k)).join(', ')}, or the same under ${schemaUrl('<kind>' as Kind).replace('/<kind>.schema.json', '')}` }] };
  const validate = engine().getSchema(schemaUrl(kind))!;
  if (validate(doc)) return { kind, refusals: [] };
  return { kind, refusals: refusalsOf(validate.errors ?? [], file, kind) };
}
