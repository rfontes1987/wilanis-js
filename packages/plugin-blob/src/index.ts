/**
 * @wilanis/plugin-blob, the @blob plugin: operations over stored files. A blob value is a handle; the bytes
 * live in the tree's registry (env.blobs) and are streamed here, never held whole beside it. CSV rows and
 * text are values; the file is not.
 */

import { Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import type { BlobStore, PluginModule } from '@wilanis/core';
import { conforms, isBlobHandle, readAll, show, type Type } from '@wilanis/core';
import type { Handler } from '@wilanis/engine';
import { CsvRows } from './csv.js';

export { CsvRows } from './csv.js';

const ROOT = '@blob';
/** The path of a document this plugin ships. */
const shipped = (name: string) => `${ROOT}/${name}`;
const DOCS = fileURLToPath(new URL('../docs', import.meta.url));

type Env = { blobs?: BlobStore; resolveType?: (ref: string) => Type };
type Row = Record<string, unknown>;

const storeOf = (env: Record<string, unknown>): BlobStore => {
  const blobs = (env as Env).blobs;
  if (!blobs) throw new Error('no blob registry in this environment');
  return blobs;
};
const handleOf = (value: unknown, name: string) => {
  if (!isBlobHandle(value)) throw new Error(`${name}: not a blob`);
  return value;
};
const rowType = (env: Record<string, unknown>, ref: unknown): Type | undefined => {
  const resolve = (env as Env).resolveType;
  return resolve && typeof ref === 'string' ? resolve(ref) : undefined;
};

// ---- CSV as rows of a shape ----------------------------------------------------------------------------

/** One text cell as a value of the field's type: numbers and booleans from their spelling, an empty optional cell absent. */
function cell(text: string, type: Type, required: boolean): unknown {
  if (text === '' && !required) return undefined;
  if (type.kind === 'number' && text.trim() !== '' && !Number.isNaN(Number(text))) return Number(text);
  if (type.kind === 'boolean' && (text === 'true' || text === 'false')) return text === 'true';
  return text;
}

/** One CSV row as an object of the row type, cells typed by the fields the header names. */
function rowOf(header: string[], cells: string[], type: Type): Row {
  const row: Row = {};
  for (const [index, name] of header.entries()) {
    const field = type.kind === 'object' ? type.fields[name] : undefined;
    const value = field ? cell(cells[index] ?? '', field.type, field.required) : (cells[index] ?? '');
    if (value !== undefined) row[name] = value;
  }
  return row;
}

/** Rows of a shape, read from a CSV blob as it streams: the first line names the columns. */
class RowReader {
  private header: string[] | undefined;
  private line = 0;
  readonly rows: Row[] = [];

  constructor(private readonly type: Type) {}

  take(rows: string[][]): void {
    for (const cells of rows) {
      this.line++;
      if (!this.header) {
        this.header = cells.map(name => name.trim());
        continue;
      }
      if (cells.length === 1 && cells[0] === '') continue; // a blank line
      const row = rowOf(this.header, cells, this.type);
      const bad = conforms(row, this.type, `row ${this.line}`);
      if (bad) throw new Error(`csv does not fit ${show(this.type)}: ${bad}`);
      this.rows.push(row);
    }
  }
}

async function parse(blobs: BlobStore, file: unknown, type: Type | undefined): Promise<unknown[]> {
  if (!type) throw new Error("parse: 'type' must name the row shape");
  const decoder = new StringDecoder('utf8');
  const csv = new CsvRows();
  const reader = new RowReader(type);
  for await (const chunk of blobs.open(handleOf(file, 'file'))) reader.take(csv.feed(decoder.write(chunk as Buffer)));
  reader.take(csv.feed(decoder.end()));
  reader.take(csv.end());
  return reader.rows;
}

const quote = (value: unknown) => {
  const text = value === undefined || value === null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** The columns a CSV is written with: the shape's fields in order, else the first row's keys. */
function columnsOf(rows: unknown[], type: Type | undefined): string[] {
  if (type?.kind === 'object' && Object.keys(type.fields).length) return Object.keys(type.fields);
  return Object.keys((rows[0] ?? {}) as Row);
}

function* lines(rows: unknown[], type: Type | undefined): Iterable<string> {
  const columns = columnsOf(rows, type);
  yield `${columns.map(quote).join(',')}\r\n`;
  for (const row of rows) yield `${columns.map(column => quote((row as Row)[column])).join(',')}\r\n`;
}

// ---- the operations ------------------------------------------------------------------------------------

const csvParse: Handler = async ({ in: input, ctx }) =>
  parse(storeOf(ctx.env), input.file, rowType(ctx.env, input.type));

const csvWrite: Handler = async ({ in: input, ctx }) => {
  if (!Array.isArray(input.rows)) throw new Error('write: rows is not a list');
  return storeOf(ctx.env).put(Readable.from(lines(input.rows, rowType(ctx.env, input.type))), {
    contentType: 'text/csv; charset=utf-8',
    filename: typeof input.filename === 'string' ? input.filename : undefined,
  });
};

const textRead: Handler = async ({ in: input, ctx }) =>
  (await readAll(storeOf(ctx.env).open(handleOf(input.file, 'file')))).toString('utf8');

const textWrite: Handler = async ({ in: input, ctx }) =>
  storeOf(ctx.env).put(String(input.text ?? ''), {
    contentType: typeof input.contentType === 'string' ? input.contentType : 'text/plain; charset=utf-8',
    filename: typeof input.filename === 'string' ? input.filename : undefined,
  });

const handlers: Record<string, Handler> = {
  [shipped('csv.port.json#parse')]: csvParse,
  [shipped('csv.port.json#write')]: csvWrite,
  [shipped('text.port.json#read')]: textRead,
  [shipped('text.port.json#write')]: textWrite,
};

const plugin: PluginModule = { root: ROOT, docs: DOCS, handlers };
export default plugin;
