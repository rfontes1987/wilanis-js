/**
 * Judges a document against its kind's JSON Schema. The kind is the document's $schema
 * (@wilanis/<kind>.schema.json). A document that fails here is never loaded.
 */
import { Ajv2020 } from 'ajv/dist/2020.js';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KINDS, kindOfSchema, type Kind, type Refusal } from '../model.js';

export const SCHEMAS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'schemas');

let ajv: Ajv2020 | undefined;
function engine(): Ajv2020 {
  if (ajv) return ajv;
  ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
  for (const f of readdirSync(SCHEMAS_DIR).filter(f => f.endsWith('.schema.json'))) ajv.addSchema(JSON.parse(readFileSync(join(SCHEMAS_DIR, f), 'utf8')));
  for (const f of readdirSync(join(SCHEMAS_DIR, 'node'))) ajv.addSchema(JSON.parse(readFileSync(join(SCHEMAS_DIR, 'node', f), 'utf8')));
  return ajv;
}

export const schemaIdFor = (kind: Kind) => `https://wilanis.dev/schemas/1/${kind}.schema.json`;

/** Validate one parsed document. Answers refusals (empty when it conforms) and the kind. */
export function validateDocument(doc: unknown, file: string): { kind?: Kind; refusals: Refusal[] } {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    return { refusals: [{ code: 'D001', file, message: 'a document is a JSON object', hint: 'every file opens with "$schema": "@wilanis/<kind>.schema.json"' }] };
  }
  const kind = kindOfSchema((doc as { $schema?: unknown }).$schema);
  if (!kind) return { refusals: [{ code: 'D001', file, at: '$schema', message: `$schema does not name a wilanis kind`, hint: `one of ${KINDS.map(k => `@wilanis/${k}.schema.json`).join(', ')}` }] };
  const validate = engine().getSchema(schemaIdFor(kind))!;
  if (validate(doc)) return { kind, refusals: [] };
  const errs = (validate.errors ?? []).filter(e => e.keyword !== 'oneOf' && e.keyword !== 'const');
  const depth = (p: string) => p.split('/').length;
  const maxDepth = Math.max(0, ...errs.map(e => depth(e.instancePath)));
  const kept = errs.filter(e => depth(e.instancePath) === maxDepth);
  return {
    kind,
    refusals: (kept.length ? kept : validate.errors ?? []).map(e => ({
      code: 'D001', file, at: e.instancePath.replace(/^\//, '') || undefined,
      message: `${e.message ?? 'invalid'}${e.params && 'additionalProperty' in e.params ? `: '${(e.params as { additionalProperty: string }).additionalProperty}'` : ''}`,
      hint: `see @wilanis/${kind}.schema.json`,
    })),
  };
}
