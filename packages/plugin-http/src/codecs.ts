/**
 * The body codecs @http ships. Which content type each handles is the project's decision, written in the
 * plugin's settings table; the codec only knows how to turn a body into a value of the declared type and back.
 *
 * A body arrives as a stream. json, text and form need it whole and read it; blob streams it into the
 * registry and answers the handle, so a file is never held in memory; multipart walks the stream once,
 * streaming each file part into the registry as it passes and keeping only the text fields.
 */
import { PassThrough, Readable } from 'node:stream';
import type { BlobStore, Codec, Encoded } from '@wilanis/core';
import { conforms, isBlobHandle, readAll, type Type } from '@wilanis/core';

function judge(v: unknown, declared: Type | undefined) {
  if (declared) { const bad = conforms(v, declared); if (bad) throw new Error(`body does not conform: ${bad}`); }
  return v;
}

const coerceFields = (o: Record<string, unknown>, declared: Type | undefined) => {
  if (declared?.kind !== 'object') return o;
  for (const [k, f] of Object.entries(declared.fields)) {
    const v = o[k];
    if (typeof v !== 'string') continue;
    if (f.type.kind === 'number' && v.trim() !== '' && !Number.isNaN(Number(v))) o[k] = Number(v);
    else if (f.type.kind === 'boolean' && (v === 'true' || v === 'false')) o[k] = v === 'true';
  }
  return o;
};

const buffered = (bytes: Buffer, contentType: string): Encoded => ({ body: bytes, contentType, length: bytes.length });
export const mediaType = (ct: string) => ct.split(';')[0].trim().toLowerCase();

export const json: Codec = {
  async decode(body, _ct, declared) {
    const text = (await readAll(body)).toString('utf8');
    if (!text.trim()) return judge(undefined, declared);
    let v: unknown;
    try { v = JSON.parse(text); } catch { throw new Error('body is not JSON'); }
    return judge(v, declared);
  },
  encode(value) { return buffered(Buffer.from(value === undefined ? '' : JSON.stringify(value)), 'application/json'); },
};

export const text: Codec = {
  async decode(body) { return (await readAll(body)).toString('utf8'); },
  encode(value) { return buffered(Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)), 'text/plain; charset=utf-8'); },
};

export const form: Codec = {
  async decode(body, _ct, declared) {
    const o: Record<string, unknown> = {};
    for (const [k, v] of new URLSearchParams((await readAll(body)).toString('utf8'))) o[k] = v;
    return judge(coerceFields(o, declared), declared);
  },
  encode(value) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries((value ?? {}) as Record<string, unknown>)) p.append(k, String(v));
    return buffered(Buffer.from(p.toString()), 'application/x-www-form-urlencoded');
  },
};

/**
 * A whole body as one blob: streamed into the registry, answered as the handle. The content type is the
 * request's; a filename comes from a content-disposition header when the sender gave one. Sending a blob
 * streams it back out with its own content type, its length, and its filename as an attachment.
 */
export const blob: Codec = {
  async decode(body, ct, declared, blobs) {
    const filename = /filename="([^"]*)"/i.exec(String((body as Readable & { headers?: Record<string, string> }).headers?.['content-disposition'] ?? ''))?.[1];
    return judge(await blobs.put(body, { contentType: mediaType(ct) || 'application/octet-stream', filename }), declared);
  },
  encode(value, _declared, blobs) {
    if (!isBlobHandle(value)) throw new Error('the answer is not a blob: a blob codec sends the handle of a stored file');
    return { body: blobs.open(value), contentType: value.contentType, length: value.size, ...(value.filename ? { headers: { 'content-disposition': `attachment; filename="${value.filename.replace(/["\\\r\n]/g, '_')}"` } } : {}) };
  },
};

const CRLF2 = Buffer.from('\r\n\r\n');

/**
 * multipart/form-data, walked once. Text fields become strings. A file part is streamed into the registry
 * as its bytes arrive and becomes a blob handle: the part's filename and content type, the size as counted.
 * Only the window that might straddle a boundary is ever held.
 */
export const multipart: Codec = {
  async decode(body, ct, declared, blobs) {
    const m = /boundary=("?)([^";]+)\1/i.exec(ct);
    if (!m) throw new Error('multipart body without boundary');
    const delimiter = Buffer.from(`\r\n--${m[2]}`);
    const o: Record<string, unknown> = {};
    const pending: Promise<void>[] = [];
    // state: before the first boundary ('preamble'), reading a part's headers, or streaming a part's body
    let state: 'preamble' | 'headers' | 'body' = 'preamble';
    let window: Buffer = Buffer.alloc(0);
    let name: string | undefined, sink: PassThrough | undefined, textChunks: Buffer[] = [];
    const finishPart = () => {
      if (sink) sink.end();
      else if (name !== undefined) o[name] = Buffer.concat(textChunks).toString('utf8');
      sink = undefined; name = undefined; textChunks = [];
    };
    const feed = (chunk: Buffer) => { if (sink) sink.write(chunk); else textChunks.push(chunk); };
    const startPart = (head: string) => {
      name = /name="([^"]+)"/i.exec(head)?.[1];
      const filename = /filename="([^"]*)"/i.exec(head)?.[1];
      const partType = /content-type:\s*([^\r\n]+)/i.exec(head)?.[1]?.trim();
      if (filename !== undefined && name !== undefined) {
        sink = new PassThrough();
        const field = name;
        pending.push(blobs.put(sink, { contentType: partType ?? 'application/octet-stream', filename }).then(h => { o[field] = h; }));
      }
    };
    for await (const c of body) {
      window = window.length ? Buffer.concat([window, c as Buffer]) : (c as Buffer);
      for (;;) {
        if (state === 'preamble') {
          // the first boundary has no leading CRLF; the window starts with "--boundary"
          const first = window.indexOf(delimiter.subarray(2));
          if (first < 0) { window = window.subarray(Math.max(0, window.length - delimiter.length)); break; }
          window = window.subarray(first + delimiter.length - 2);
          state = 'headers';
        }
        if (state === 'headers') {
          if (window.subarray(0, 2).toString() === '--') { window = Buffer.alloc(0); break; } // the closing boundary
          const end = window.indexOf(CRLF2);
          if (end < 0) break;
          startPart(window.subarray(0, end).toString('latin1'));
          window = window.subarray(end + 4);
          state = 'body';
        }
        // body: everything up to the next delimiter belongs to the part; what might be the start of one is kept
        const at = window.indexOf(delimiter);
        if (at < 0) {
          const safe = window.length - (delimiter.length - 1);
          if (safe > 0) { feed(window.subarray(0, safe)); window = window.subarray(safe); }
          break;
        }
        feed(window.subarray(0, at)); finishPart();
        window = window.subarray(at + delimiter.length);
        state = 'headers';
      }
    }
    if (state === 'body') finishPart();
    await Promise.all(pending);
    return judge(coerceFields(o, declared), declared);
  },
  encode() { throw new Error('encoding multipart answers is not supported'); },
};
