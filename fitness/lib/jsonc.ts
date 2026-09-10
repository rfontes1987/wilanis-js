/**
 * Reading the configuration files that carry a decision. `biome.jsonc` holds comments, so `JSON.parse` cannot
 * read it; `jsonc-parser` can, and reports what it could not read rather than throwing. A fitness function
 * over configuration reads the file here and judges the value, so a malformed file fails as a claim, not a crash.
 */
import { readFileSync } from 'node:fs';
import { type ParseError, parse, printParseErrorCode } from 'jsonc-parser';

/** The value a JSON-with-comments file holds; throws with the file and the reason where it cannot be read. */
export function readJsonc(file: string): unknown {
  const errors: ParseError[] = [];
  const value = parse(readFileSync(file, 'utf8'), errors, { allowTrailingComma: true });
  if (errors.length > 0) throw new Error(`${file} is not readable as JSONC: ${reasons(errors)}`);
  return value;
}

/** The value a plain JSON file holds, such as a `package.json` or a `tsconfig.json` without comments. */
export function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** The value at a dotted path within a read object, or undefined where the path names nothing. */
export function at(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((here, key) => record(here)?.[key], value);
}

/** A value as a record of its own keys, or null where it is not one, so a reader never indexes a scalar. */
export function record(value: unknown): Record<string, unknown> | null {
  const isRecord = typeof value === 'object' && value !== null && !Array.isArray(value);
  return isRecord ? (value as Record<string, unknown>) : null;
}

/** Every parse error as `code at offset`, for a message that says where the file stopped being readable. */
function reasons(errors: ParseError[]): string {
  return errors.map(error => `${printParseErrorCode(error.error)} at offset ${error.offset}`).join(', ');
}

/** A package's manifest as the direction claims read it: its name, and what each section names. */
export interface Manifest {
  name: string;
  dependencies: string[];
  devDependencies: string[];
  files: string[];
}

/** The manifest of a package directory, with each dependency section as a sorted list of names. */
export function manifestOf(dir: string): Manifest {
  const value = record(readJson(`${dir}/package.json`)) ?? {};
  return {
    name: typeof value.name === 'string' ? value.name : dir,
    dependencies: Object.keys(record(value.dependencies) ?? {}).sort(),
    devDependencies: Object.keys(record(value.devDependencies) ?? {}).sort(),
    files: Array.isArray(value.files) ? value.files.filter(one => typeof one === 'string') : [],
  };
}
