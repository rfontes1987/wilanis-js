/**
 * Reading the JSON Schemas core serves. A claim about what a schema tells its reader asks this file for every
 * property of a set of schemas and whether each is described -- directly, or by a `$ref` to a definition that
 * describes itself, which is a description given once rather than repeated. A `$ref` resolves within the set:
 * `#/$defs/x` in its own file, and a path naming a file in that file.
 */
import { basename } from 'node:path';
import { entriesUnder, textOf } from './sources.js';

/** One property or definition of one schema: where it lives, whether it says what it is, and what it points at. */
export interface Property {
  file: string;
  path: string;
  described: boolean;
  ref: string | null;
}

/** A JSON value as this reader walks it, since a schema is data and its keywords are keys. */
type Json = Record<string, unknown>;

/** The keywords whose value is one schema, walked as one. */
const ONE = ['items', 'additionalProperties', 'not', 'then', 'else', 'if', 'contains'];

/** The keywords whose value is a list of schemas, walked in order. */
const MANY = ['oneOf', 'anyOf', 'allOf'];

/** The keywords whose value is a map of named schemas a reader writes, so each entry is a property. */
const NAMED = ['properties', '$defs'];

/** The keywords whose value is a map of schemas that judge rather than name, walked but never counted. */
const JUDGING = ['patternProperties', 'definitions', 'dependentSchemas', 'propertyNames'];

/** Every property of every `*.schema.json` under these directories, with whether each is described. */
export function propertiesOf(dirs: string[]): Property[] {
  const files = dirs.flatMap(dir => entriesUnder(dir, ['.schema.json']));
  const parsed = new Map(files.map(file => [file, JSON.parse(textOf(file)) as Json]));
  return files.flatMap(file => propertiesIn(file, parsed));
}

/** Every property one file declares, at whatever depth and under whatever keyword holds it. */
function propertiesIn(file: string, parsed: Map<string, Json>): Property[] {
  const found: Property[] = [];
  walk(parsed.get(file) ?? {}, '', (path, schema) => {
    const ref = typeof schema.$ref === 'string' ? schema.$ref : null;
    const described = typeof schema.description === 'string' || describedByRef(ref, file, parsed);
    found.push({ file, path, described, ref });
  });
  return found;
}

/** Whether a `$ref` points at a definition that describes itself, which describes the property by reference. */
function describedByRef(ref: string | null, from: string, parsed: Map<string, Json>): boolean {
  const definition = ref === null ? undefined : resolve(ref, from, parsed);
  return typeof definition?.description === 'string';
}

/** The definition a `$ref` names, resolved in its own file or in the file of the set its path names. */
function resolve(ref: string, from: string, parsed: Map<string, Json>): Json | undefined {
  const [where, pointer] = ref.split('#');
  const file = where === '' ? from : fileNamed(where, parsed);
  const schema = file === undefined ? undefined : parsed.get(file);
  return schema === undefined ? undefined : at(schema, (pointer ?? '').split('/').filter(Boolean));
}

/** The file of the set a `$ref`'s path names, by its base name, since a path may climb out of a directory. */
function fileNamed(where: string, parsed: Map<string, Json>): string | undefined {
  const name = basename(where);
  return [...parsed.keys()].find(file => basename(file) === name);
}

/** The value at a pointer's segments within a parsed schema, or nothing where the pointer names none. */
function at(schema: Json, segments: string[]): Json | undefined {
  let here: unknown = schema;
  for (const segment of segments) {
    if (typeof here !== 'object' || here === null) return undefined;
    here = (here as Json)[segment];
  }
  return typeof here === 'object' && here !== null ? (here as Json) : undefined;
}

/** Every named schema under a schema, at whatever depth, announced with the path a reader would follow. */
function walk(schema: Json, path: string, visit: (path: string, schema: Json) => void): void {
  for (const keyword of NAMED) named(schema[keyword], `${path}/${keyword}`, visit);
  for (const keyword of JUDGING) judging(schema[keyword], `${path}/${keyword}`, visit);
  for (const keyword of ONE) child(schema[keyword], `${path}/${keyword}`, visit);
  for (const keyword of MANY) each(schema[keyword], `${path}/${keyword}`, visit);
}

/** A map of schemas that judge a key rather than name one: walked for what it holds, never counted itself. */
function judging(value: unknown, path: string, visit: (path: string, schema: Json) => void): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return;
  for (const [name, entry] of Object.entries(value as Json)) child(entry, `${path}/${name}`, visit);
}

/** A map of named schemas: each is a property, and each is walked for the properties it holds. */
function named(value: unknown, path: string, visit: (path: string, schema: Json) => void): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return;
  for (const [name, entry] of Object.entries(value as Json)) {
    if (typeof entry !== 'object' || entry === null) continue;
    visit(`${path}/${name}`, entry as Json);
    walk(entry as Json, `${path}/${name}`, visit);
  }
}

/** One schema under a keyword: not a property itself, but it may hold some. */
function child(value: unknown, path: string, visit: (path: string, schema: Json) => void): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return;
  walk(value as Json, path, visit);
}

/** A list of schemas under a keyword, each walked in turn. */
function each(value: unknown, path: string, visit: (path: string, schema: Json) => void): void {
  if (!Array.isArray(value)) return;
  for (const [index, entry] of value.entries()) child(entry, `${path}/${index}`, visit);
}
