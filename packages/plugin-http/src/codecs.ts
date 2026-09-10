/**
 * The body codecs @http ships. Which content type each handles is the project's decision, written in the
 * plugin's settings table; the codec only knows how to turn a body into a value of the declared type and back.
 *
 * A body arrives as a stream. json, text and form need it whole and read it; blob streams it into the
 * registry and answers the handle, so a file is never held in memory; multipart walks the stream once,
 * streaming each file part into the registry as it passes and keeping only the text fields.
 */
import type { Readable } from 'node:stream';
import type { Codec, Encoded } from '@wilanis/core';
import { conforms, isBlobHandle, readAll, type Type } from '@wilanis/core';
import { MultipartParts } from './multipart.js';

/** The value, once the declared shape has accepted it; it throws when it does not fit. */
function judge(value: unknown, declared: Type | undefined) {
  if (declared) {
    const bad = conforms(value, declared);
    if (bad) throw new Error(`body does not conform: ${bad}`);
  }
  return value;
}

/** A form's text, read as the declared field's kind: a number or a boolean where the text says one. */
const coerced = (text: string, kind: string): unknown => {
  if (kind === 'number' && text.trim() !== '' && !Number.isNaN(Number(text))) return Number(text);
  if (kind === 'boolean' && (text === 'true' || text === 'false')) return text === 'true';
  return text;
};

/** A form's fields, each read as the shape declares it; every value arrives as text. */
const coerceFields = (fields: Record<string, unknown>, declared: Type | undefined) => {
  if (declared?.kind !== 'object') return fields;
  for (const [name, field] of Object.entries(declared.fields)) {
    const value = fields[name];
    if (typeof value === 'string') fields[name] = coerced(value, field.type.kind);
  }
  return fields;
};

const buffered = (bytes: Buffer, contentType: string): Encoded => ({ body: bytes, contentType, length: bytes.length });
/** The type a content-type header names, without its parameters or case, which is what the codec table is keyed by. */
export const mediaType = (ct: string) => ct.split(';')[0].trim().toLowerCase();

export const json: Codec = {
  async decode(body, _ct, declared) {
    const text = (await readAll(body)).toString('utf8');
    if (!text.trim()) return judge(undefined, declared);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('body is not JSON');
    }
    return judge(parsed, declared);
  },
  encode(value) {
    return buffered(Buffer.from(value === undefined ? '' : JSON.stringify(value)), 'application/json');
  },
};

export const text: Codec = {
  async decode(body) {
    return (await readAll(body)).toString('utf8');
  },
  encode(value) {
    return buffered(
      Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)),
      'text/plain; charset=utf-8',
    );
  },
};

export const form: Codec = {
  async decode(body, _ct, declared) {
    const fields: Record<string, unknown> = {};
    for (const [name, value] of new URLSearchParams((await readAll(body)).toString('utf8'))) fields[name] = value;
    return judge(coerceFields(fields, declared), declared);
  },
  encode(value) {
    const params = new URLSearchParams();
    for (const [name, field] of Object.entries((value ?? {}) as Record<string, unknown>))
      params.append(name, String(field));
    return buffered(Buffer.from(params.toString()), 'application/x-www-form-urlencoded');
  },
};

/**
 * A whole body as one blob: streamed into the registry, answered as the handle. The content type is the
 * request's; a filename comes from a content-disposition header when the sender gave one. Sending a blob
 * streams it back out with its own content type, its length, and its filename as an attachment.
 */
export const blob: Codec = {
  async decode(body, ct, declared, blobs) {
    const filename = /filename="([^"]*)"/i.exec(
      String((body as Readable & { headers?: Record<string, string> }).headers?.['content-disposition'] ?? ''),
    )?.[1];
    return judge(
      await blobs.put(body, { contentType: mediaType(ct) || 'application/octet-stream', filename }),
      declared,
    );
  },
  encode(value, _declared, blobs) {
    if (!isBlobHandle(value))
      throw new Error('the answer is not a blob: a blob codec sends the handle of a stored file');
    return {
      body: blobs.open(value),
      contentType: value.contentType,
      length: value.size,
      ...(value.filename
        ? { headers: { 'content-disposition': `attachment; filename="${value.filename.replace(/["\\\r\n]/g, '_')}"` } }
        : {}),
    };
  },
};

const _CRLF2 = Buffer.from('\r\n\r\n');

/**
 * multipart/form-data: the parts are walked once by MultipartParts, which streams a file part into the registry and
 * collects a text part as a string.
 */
export const multipart: Codec = {
  async decode(body, ct, declared, blobs) {
    const found = /boundary=("?)([^";]+)\1/i.exec(ct);
    if (!found) throw new Error('multipart body without boundary');
    const parts = new MultipartParts(found[2], blobs);
    for await (const chunk of body) parts.feed(chunk as Buffer);
    return judge(coerceFields(await parts.end(), declared), declared);
  },
  encode() {
    throw new Error('encoding multipart answers is not supported');
  },
};
