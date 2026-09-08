import { afterAll, describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import { existsSync, readdirSync } from 'node:fs';
import { FileBlobStore } from '@wilanis/runtime';
import { TypeResolver, readAll, type Type } from '@wilanis/core';
import plugin, { CsvRows } from '../src/index.js';

const store = new FileBlobStore(process.cwd());
afterAll(() => store.destroy());
const types = new TypeResolver(() => undefined);
const ROW: Type = types.inline({ fields: { url: { type: 'string' }, method: { type: 'string', enum: ['GET', 'POST'] }, hits: { type: 'number', required: false }, ok: { type: 'boolean', required: false } } });
const env = { blobs: store, resolveType: (ref: string) => (ref === 'Row' ? ROW : types.ref(ref)) };
const ctx = { env, nodePath: [], attach: () => {} } as never;
const run = (op: string, i: Record<string, unknown>) => plugin.handlers[`@blob/${op}`]({ in: i, ctx });
const text = async (r: Readable) => (await readAll(r)).toString('utf8');

describe('the file store', () => {
  it('streams bytes in, counts them, hands a handle; streams them back out; drops them', async () => {
    const h = await store.put(Readable.from([Buffer.from('ab'), Buffer.from('cde')]), { contentType: 'text/plain', filename: 'x.txt' });
    expect(h).toMatchObject({ contentType: 'text/plain', filename: 'x.txt', size: 5 });
    expect(existsSync(`${store.dir}/${h.id}`)).toBe(true);
    expect(await text(store.open(h))).toBe('abcde');
    await store.drop(h);
    expect(existsSync(`${store.dir}/${h.id}`)).toBe(false);
    expect(() => store.open(h)).toThrow('no blob');
  });
  it('opens nothing it does not hold: a handle written by hand is refused, whatever its id says', () => {
    expect(() => store.open({ id: '../../etc/passwd', contentType: 'text/plain', size: 1 })).toThrow('no blob');
    expect(() => store.open({ id: '00000000-0000-4000-8000-000000000000', contentType: 'text/plain', size: 1 })).toThrow('no blob');
  });
  it('a scope releases what was put through it, and only that', async () => {
    const kept = await store.put('kept', { contentType: 'text/plain' });
    const scope = store.scope();
    const mine = await scope.put('mine', { contentType: 'text/plain' });
    expect(await text(scope.open(kept))).toBe('kept'); // a scope reads the whole store
    await scope.release();
    expect(() => store.open(mine)).toThrow('no blob');
    expect(await text(store.open(kept))).toBe('kept');
    await store.drop(kept);
    expect(readdirSync(store.dir)).toEqual([]);
  });
});

describe('CSV rows, fed in pieces', () => {
  const rows = (pieces: string[]) => { const p = new CsvRows(); const out = pieces.flatMap(x => p.feed(x)); return [...out, ...p.end()]; };
  it('splits fields and lines, CRLF or LF, and keeps the last line without a newline', () => {
    expect(rows(['a,b\r\n1,2\n3,4'])).toEqual([['a', 'b'], ['1', '2'], ['3', '4']]);
  });
  it('quotes: a comma, a newline and a doubled quote inside a quoted field are text', () => {
    expect(rows(['"x,y","line\nbreak","say ""hi"""\n'])).toEqual([['x,y', 'line\nbreak', 'say "hi"']]);
  });
  it('a chunk boundary anywhere -- inside a field, a quote, or a CRLF -- changes nothing', () => {
    const whole = 'a,"b,c"\r\n"d""e",f\r\n';
    const one = rows([whole]);
    for (let i = 1; i < whole.length; i++) expect(rows([whole.slice(0, i), whole.slice(i)]), `split at ${i}`).toEqual(one);
  });
  it('an empty trailing field and an empty file', () => {
    expect(rows(['a,\n'])).toEqual([['a', '']]);
    expect(rows([''])).toEqual([]);
  });
});

describe('csv.port.json', () => {
  it('parse: rows of the declared shape, numbers and booleans from text, empty optional cells absent', async () => {
    const file = await store.put('url,method,hits,ok\nhttps://a/,GET,3,true\n"https://b/?x=1,2",POST,,\n', { contentType: 'text/csv' });
    expect(await run('csv.port.json#parse', { file, type: 'Row' })).toEqual([{ url: 'https://a/', method: 'GET', hits: 3, ok: true }, { url: 'https://b/?x=1,2', method: 'POST' }]);
  });
  it('parse: a row that does not fit the shape fails with its line', async () => {
    const file = await store.put('url,method\nhttps://a/,PATCH\n', { contentType: 'text/csv' });
    await expect(run('csv.port.json#parse', { file, type: 'Row' })).rejects.toThrow('row 2.method: "PATCH" not in');
  });
  it("write: the shape's columns in order, quoting what needs it; the handle carries the filename; parse reads it back", async () => {
    const h = await run('csv.port.json#write', { rows: [{ url: 'https://a/', method: 'GET', hits: 1 }, { method: 'POST', url: 'https://b/,c', ok: false }], type: 'Row', filename: 'out.csv' }) as { id: string; contentType: string; size: number };
    expect(h).toMatchObject({ contentType: 'text/csv; charset=utf-8', filename: 'out.csv' });
    expect(await text(store.open(h))).toBe('url,method,hits,ok\r\nhttps://a/,GET,1,\r\n"https://b/,c",POST,,false\r\n');
    expect(await run('csv.port.json#parse', { file: h, type: 'Row' })).toEqual([{ url: 'https://a/', method: 'GET', hits: 1 }, { url: 'https://b/,c', method: 'POST', ok: false }]);
  });
});

describe('text.port.json', () => {
  it('write then read, round trip, with the content type given or the default', async () => {
    const h = await run('text.port.json#write', { text: 'héllo', contentType: 'text/markdown', filename: 'a.md' });
    expect(h).toMatchObject({ contentType: 'text/markdown', filename: 'a.md', size: 6 });
    expect(await run('text.port.json#read', { file: h })).toBe('héllo');
    expect(await run('text.port.json#write', { text: 'x' })).toMatchObject({ contentType: 'text/plain; charset=utf-8' });
  });
  it('read refuses a value that is not a blob', async () => {
    await expect(run('text.port.json#read', { file: 'not a handle' })).rejects.toThrow('file: not a blob');
  });
});
