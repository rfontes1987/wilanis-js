/**
 * @wilanis/plugin-blob, the @blob plugin: operations over stored files. A blob value is a handle; the bytes
 * live in the tree's registry (env.blobs) and are streamed here, never held whole beside it. CSV rows and
 * text are values; the file is not.
 */
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import type { BlobStore, PluginModule } from '@wilanis/core';
import { conforms, isBlobHandle, readAll, show, type Type } from '@wilanis/core';
import type { Handler } from '@wilanis/engine';

const ROOT = '@blob';
const P = (f: string) => `${ROOT}/${f}`;
const DOCS = fileURLToPath(new URL('../docs', import.meta.url));

type Env = { blobs?: BlobStore; resolveType?: (ref: string) => Type };
const storeOf = (env: Record<string, unknown>): BlobStore => { const b = (env as Env).blobs; if (!b) throw new Error('no blob registry in this environment'); return b; };
const handleOf = (v: unknown, name: string) => { if (!isBlobHandle(v)) throw new Error(`${name}: not a blob`); return v; };
const rowType = (env: Record<string, unknown>, ref: unknown): Type | undefined => { const r = (env as Env).resolveType; return r && typeof ref === 'string' ? r(ref) : undefined; };

// ---- CSV, incrementally ------------------------------------------------------------------------------

/** RFC 4180 rows out of text fed in pieces: a field may be quoted, a quote inside it doubled, a line ended by LF or CRLF. */
export class CsvRows {
  private field = ''; private row: string[] = []; private inQuotes = false; private afterQuote = false; private quoted = false;
  feed(text: string): string[][] {
    const rows: string[][] = [];
    for (const ch of text) {
      if (this.inQuotes) {
        if (!this.afterQuote) { if (ch === '"') this.afterQuote = true; else this.field += ch; continue; }
        if (ch === '"') { this.field += '"'; this.afterQuote = false; continue; }
        this.inQuotes = false; this.afterQuote = false; // the quote closed the field; ch is a separator or a line end
      }
      if (ch === '"' && this.field === '' && !this.quoted) { this.inQuotes = true; this.quoted = true; continue; }
      if (ch === ',') { this.row.push(this.field); this.field = ''; this.quoted = false; continue; }
      if (ch === '\r') continue;
      if (ch === '\n') { this.row.push(this.field); rows.push(this.row); this.row = []; this.field = ''; this.quoted = false; continue; }
      this.field += ch;
    }
    return rows;
  }
  end(): string[][] {
    if (this.field === '' && !this.row.length && !this.quoted) return [];
    this.row.push(this.field); const last = this.row; this.row = []; this.field = ''; this.quoted = false;
    return [last];
  }
}

/** One text cell as a value of the field's type: numbers and booleans from their spelling, an empty optional cell absent. */
function cell(v: string, t: Type, required: boolean): unknown {
  if (v === '' && !required) return undefined;
  if (t.kind === 'number' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  if (t.kind === 'boolean' && (v === 'true' || v === 'false')) return v === 'true';
  return v;
}

const quote = (v: unknown) => { const s = v === undefined || v === null ? '' : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

async function parse(blobs: BlobStore, file: unknown, t: Type | undefined): Promise<unknown[]> {
  if (!t) throw new Error("parse: 'type' must name the row shape");
  const decoder = new StringDecoder('utf8');
  const csv = new CsvRows();
  let header: string[] | undefined;
  const out: unknown[] = [];
  let line = 0;
  const take = (rows: string[][]) => {
    for (const r of rows) {
      line++;
      if (!header) { header = r.map(h => h.trim()); continue; }
      if (r.length === 1 && r[0] === '') continue; // a blank line
      const o: Record<string, unknown> = {};
      header.forEach((h, i) => {
        const f = t.kind === 'object' ? t.fields[h] : undefined;
        const v = f ? cell(r[i] ?? '', f.type, f.required) : (r[i] ?? '');
        if (v !== undefined) o[h] = v;
      });
      const bad = conforms(o, t, `row ${line}`);
      if (bad) throw new Error(`csv does not fit ${show(t)}: ${bad}`);
      out.push(o);
    }
  };
  for await (const chunk of blobs.open(handleOf(file, 'file'))) take(csv.feed(decoder.write(chunk as Buffer)));
  take(csv.feed(decoder.end())); take(csv.end());
  return out;
}

function lines(rows: unknown[], t: Type | undefined): Iterable<string> {
  const columns = t?.kind === 'object' && Object.keys(t.fields).length ? Object.keys(t.fields) : Object.keys((rows[0] ?? {}) as Record<string, unknown>);
  return (function* () {
    yield columns.map(quote).join(',') + '\r\n';
    for (const r of rows) yield columns.map(c => quote((r as Record<string, unknown>)[c])).join(',') + '\r\n';
  })();
}

const handlers: Record<string, Handler> = {
  [P('csv.port.json#parse')]: async ({ in: i, ctx }) => parse(storeOf(ctx.env), i.file, rowType(ctx.env, i.type)),
  [P('csv.port.json#write')]: async ({ in: i, ctx }) => {
    if (!Array.isArray(i.rows)) throw new Error('write: rows is not a list');
    return storeOf(ctx.env).put(Readable.from(lines(i.rows, rowType(ctx.env, i.type))), { contentType: 'text/csv; charset=utf-8', filename: typeof i.filename === 'string' ? i.filename : undefined });
  },
  [P('text.port.json#read')]: async ({ in: i, ctx }) => (await readAll(storeOf(ctx.env).open(handleOf(i.file, 'file')))).toString('utf8'),
  [P('text.port.json#write')]: async ({ in: i, ctx }) => storeOf(ctx.env).put(String(i.text ?? ''), { contentType: typeof i.contentType === 'string' ? i.contentType : 'text/plain; charset=utf-8', filename: typeof i.filename === 'string' ? i.filename : undefined }),
};

const plugin: PluginModule = { root: ROOT, docs: DOCS, handlers };
export default plugin;
