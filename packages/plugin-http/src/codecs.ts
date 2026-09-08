/**
 * The body codecs @http ships. Which content type each handles is the project's decision, written in the
 * plugin's settings table; the codec only knows how to turn bytes into a value of the declared type and back.
 */
import { schemaRef, type CodecDoc, type ShapeDoc } from '@wilanis/core';
import type { Codec } from '@wilanis/core';
import { conforms, type Type } from '@wilanis/core';

export const jsonCodec: CodecDoc = { $schema: schemaRef('codec'), description: 'JSON: an object, a list, or a scalar, judged against the declared type.', yields: 'declared' };
export const textCodec: CodecDoc = { $schema: schemaRef('codec'), description: 'Raw text (plain text, XML, CSV...): the body is one string.', yields: 'string' };
export const formCodec: CodecDoc = { $schema: schemaRef('codec'), description: 'application/x-www-form-urlencoded: fields as strings, coerced toward the declared shape.', yields: 'declared' };
export const multipartCodec: CodecDoc = { $schema: schemaRef('codec'), description: 'multipart/form-data: text fields as strings, file fields as @http/Part.shape.json (name, contentType, size, content as base64).', yields: 'declared' };

export const partShape: ShapeDoc = {
  $schema: schemaRef('shape'), layer: 'edge',
  description: 'One uploaded file part of a multipart body.',
  fields: { filename: { type: 'string' }, contentType: { type: 'string' }, size: { type: 'number' }, content: { type: 'string', description: 'base64' } },
};

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

export const json: Codec = {
  decode(bytes, _ct, declared) {
    const text = bytes.toString('utf8');
    if (!text.trim()) return judge(undefined, declared);
    let v: unknown;
    try { v = JSON.parse(text); } catch { throw new Error('body is not JSON'); }
    return judge(v, declared);
  },
  encode(value) { return { bytes: Buffer.from(value === undefined ? '' : JSON.stringify(value)), contentType: 'application/json' }; },
};

export const text: Codec = {
  decode(bytes) { return bytes.toString('utf8'); },
  encode(value) { return { bytes: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)), contentType: 'text/plain; charset=utf-8' }; },
};

export const form: Codec = {
  decode(bytes, _ct, declared) {
    const o: Record<string, unknown> = {};
    for (const [k, v] of new URLSearchParams(bytes.toString('utf8'))) o[k] = v;
    return judge(coerceFields(o, declared), declared);
  },
  encode(value) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries((value ?? {}) as Record<string, unknown>)) p.append(k, String(v));
    return { bytes: Buffer.from(p.toString()), contentType: 'application/x-www-form-urlencoded' };
  },
};

export const multipart: Codec = {
  decode(bytes, ct, declared) {
    const m = /boundary=("?)([^";]+)\1/i.exec(ct);
    if (!m) throw new Error('multipart body without boundary');
    const boundary = `--${m[2]}`;
    const o: Record<string, unknown> = {};
    const raw = bytes.toString('latin1');
    for (const chunk of raw.split(boundary).slice(1)) {
      if (chunk.startsWith('--')) break;
      const sep = chunk.indexOf('\r\n\r\n');
      if (sep < 0) continue;
      const head = chunk.slice(0, sep), body = chunk.slice(sep + 4).replace(/\r\n$/, '');
      const name = /name="([^"]+)"/i.exec(head)?.[1]; if (!name) continue;
      const filename = /filename="([^"]*)"/i.exec(head)?.[1];
      const partType = /content-type:\s*([^\r\n]+)/i.exec(head)?.[1]?.trim();
      if (filename !== undefined) { const buf = Buffer.from(body, 'latin1'); o[name] = { filename, contentType: partType ?? 'application/octet-stream', size: buf.length, content: buf.toString('base64') }; }
      else o[name] = Buffer.from(body, 'latin1').toString('utf8');
    }
    return judge(coerceFields(o, declared), declared);
  },
  encode() { throw new Error('encoding multipart answers is not supported'); },
};
