/**
 * http.port.json#request: one outbound request. The connection says where it goes and how it is paced, the codec table
 * says how a body is written and read, and a blob body streams through the registry rather than being buffered beside it.
 */
import { Readable } from 'node:stream';
import type { BlobStore, Codecs, Type } from '@wilanis/core';
import { blob, form, json, mediaType, multipart, text } from './codecs.js';
import { doc, ROOT } from './paths.js';
import { type ThrottleSettings, throttleFor } from './throttle.js';

/** An http connection, as the project declared it. */
export type Conn = {
  kind: string;
  settings: { baseUrl: string; headers?: Record<string, string>; timeoutMs?: number; throttle?: ThrottleSettings };
};

/** Every codec this plugin ships, by the path of the document that names it. */
export const CODECS: Codecs = {
  [doc('codecs/json.codec.json')]: json,
  [doc('codecs/text.codec.json')]: text,
  [doc('codecs/form.codec.json')]: form,
  [doc('codecs/multipart.codec.json')]: multipart,
  [doc('codecs/blob.codec.json')]: blob,
};

/** The codecs the project's table names, by the content type each one handles. */
export function codecTable(env: Record<string, unknown>): Codecs {
  const table = ((env.plugins as Record<string, Record<string, unknown>>)?.[ROOT]?.codecs ?? {}) as Record<
    string,
    string
  >;
  return Object.fromEntries(
    Object.entries(table)
      .map(([type, path]) => [type.toLowerCase(), CODECS[path]])
      .filter(([, codec]) => codec),
  );
}

/** The connection this request names; it throws when there is none, or it is not an http one. */
function connectionOf(env: Record<string, unknown>, named: unknown): { conn: Conn; canonical: string } {
  const canon = (env.canon as ((ref: string) => string) | undefined) ?? ((ref: string) => ref);
  const connections = (env.connections ?? {}) as Record<string, Conn>;
  const canonical = canon(String(named));
  const conn = connections[canonical];
  if (!conn) throw new Error(`unknown connection '${named}'`);
  if (conn.kind !== doc('http.connection-kind.json'))
    throw new Error(`connection '${named}' is ${conn.kind}, not ${doc('http.connection-kind.json')}`);
  return { conn, canonical };
}

/** Where the request goes: the connection's base, and the path the caller gave. */
function urlOf(conn: Conn, path: string): URL {
  return new URL(conn.settings.baseUrl.replace(/\/$/, '') + (path.startsWith('/') ? path : `/${path}`));
}

/** What every step of a request reads: the tree's environment, the codec table, and the blob registry. */
interface Wire {
  env: Record<string, unknown>;
  codecs: Codecs;
  blobs: BlobStore;
}

/** The body written by the codec the request's `consumes` names, onto the init and its headers. */
async function writeBody(
  input: Record<string, unknown>,
  init: RequestInit,
  headers: Record<string, string>,
  wire: Wire,
) {
  const consumes = String(input.consumes ?? 'application/json').toLowerCase();
  const codec = wire.codecs[consumes];
  if (!codec) throw new Error(`no codec for '${consumes}' in ${ROOT} settings.codecs`);
  const written = await codec.encode(input.body, undefined, wire.blobs);
  // a blob body streams from the registry; a value's bytes go as they are
  if (written.body instanceof Readable) {
    init.body = Readable.toWeb(written.body) as unknown as BodyInit;
    (init as RequestInit & { duplex: 'half' }).duplex = 'half';
  } else init.body = new Uint8Array(written.body);
  headers['content-type'] ??= written.contentType;
  if (written.length !== undefined) headers['content-length'] ??= String(written.length);
}

/** Where a request is sent, and what paces it. */
interface Sending {
  canonical: string;
  conn: Conn;
  url: URL;
  init: RequestInit;
}

/** Send, paced by the connection's throttle; the timeout counts from the moment the request is let through. */
function send(wire: Wire, { canonical, conn, url, init }: Sending) {
  return throttleFor(wire.env, canonical, conn.settings.throttle).run(async () => {
    const control = new AbortController();
    const timer = setTimeout(() => control.abort(), Number(conn.settings.timeoutMs ?? 30000));
    init.signal = control.signal;
    try {
      return await fetch(url, init);
    } finally {
      clearTimeout(timer);
    }
  });
}

/** The answer's body, decoded by the codec its content type names; a blob codec streams it into the registry. */
async function readBody(answer: Response, input: Record<string, unknown>, wire: Wire) {
  if (!answer.body || answer.headers.get('content-length') === '0') return undefined;
  const contentType = String(input.produces ?? answer.headers.get('content-type') ?? 'text/plain');
  const codec = wire.codecs[mediaType(contentType)] ?? wire.codecs['text/plain'] ?? text;
  const resolve = wire.env.resolveType as ((ref: string) => Type) | undefined;
  // returns describes a successful answer; an error status carries whatever body the API chose, and judging it would
  // fail the node before a switch on status could decide
  const declared = answer.ok && typeof input.returns === 'string' && resolve ? resolve(input.returns) : undefined;
  return codec.decode(
    Readable.fromWeb(answer.body as import('node:stream/web').ReadableStream),
    contentType,
    declared,
    wire.blobs,
  );
}

/** One outbound request, and what the answer said. */
export async function request({
  in: input,
  ctx,
}: {
  in: Record<string, unknown>;
  ctx: { env: Record<string, unknown> };
}) {
  const { conn, canonical } = connectionOf(ctx.env, input.connection);
  const wire: Wire = { env: ctx.env, codecs: codecTable(ctx.env), blobs: ctx.env.blobs as BlobStore };
  const headers: Record<string, string> = {
    ...(conn.settings.headers ?? {}),
    ...((input.headers ?? {}) as Record<string, string>),
  };
  const init: RequestInit = { method: String(input.method), headers };
  if (input.body !== undefined) await writeBody(input, init, headers, wire);
  if (input.produces) headers.accept ??= String(input.produces);
  const answer = await send(wire, { canonical, conn, url: urlOf(conn, String(input.path)), init });
  const answered: Record<string, string> = {};
  answer.headers.forEach((value, name) => {
    answered[name] = value;
  });
  const out: Record<string, unknown> = { status: answer.status, headers: answered };
  const body = await readBody(answer, input, wire);
  if (body !== undefined) out.body = body;
  return out;
}
