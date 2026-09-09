/**
 * @wilanis/plugin-http, the @http plugin: outbound requests (http.port.json#request), http connections, http triggers, body codecs.
 * Which codec handles which content type is the project's explicit table in this plugin's settings.
 */
import { createServer, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import type {
  BlobStore,
  Codecs,
  Hold,
  PluginCheckContext,
  PluginModule,
  Serving,
  TriggerDoc,
  TriggerRuntime,
  Type,
} from '@wilanis/core';
import type { Handler, Report } from '@wilanis/engine';
import { readPath, refusalOf } from '@wilanis/engine';
import { blob, form, json, mediaType, multipart, text } from './codecs.js';
import { type ThrottleSettings, throttleFor } from './throttle.js';

const ROOT = '@http';
const P = (f: string) => `${ROOT}/${f}`;
/** The documents this plugin ships, as files: docs/ next to dist/ in the package. */
const DOCS = fileURLToPath(new URL('../docs', import.meta.url));

// ---- http.port.json#request -------------------------------------------------------------------------

type Conn = {
  kind: string;
  settings: { baseUrl: string; headers?: Record<string, string>; timeoutMs?: number; throttle?: ThrottleSettings };
};

function codecTable(env: Record<string, unknown>): Codecs {
  const table = ((env.plugins as Record<string, Record<string, unknown>>)?.[ROOT]?.codecs ?? {}) as Record<
    string,
    string
  >;
  return Object.fromEntries(
    Object.entries(table)
      .map(([ct, path]) => [ct.toLowerCase(), CODECS[path]])
      .filter(([, c]) => c),
  );
}
const CODECS: Codecs = {
  [P('codecs/json.codec.json')]: json,
  [P('codecs/text.codec.json')]: text,
  [P('codecs/form.codec.json')]: form,
  [P('codecs/multipart.codec.json')]: multipart,
  [P('codecs/blob.codec.json')]: blob,
};

async function request({ in: i, ctx }: { in: Record<string, unknown>; ctx: { env: Record<string, unknown> } }) {
  const canon = (ctx.env.canon as ((r: string) => string) | undefined) ?? ((r: string) => r);
  const conns = (ctx.env.connections ?? {}) as Record<string, Conn>;
  const conn = conns[canon(String(i.connection))];
  if (!conn) throw new Error(`unknown connection '${i.connection}'`);
  if (conn.kind !== P('http.connection-kind.json'))
    throw new Error(`connection '${i.connection}' is ${conn.kind}, not ${P('http.connection-kind.json')}`);
  const codecs = codecTable(ctx.env);
  const blobs = ctx.env.blobs as BlobStore;
  const path = String(i.path);
  const url = new URL(conn.settings.baseUrl.replace(/\/$/, '') + (path.startsWith('/') ? path : `/${path}`));
  const headers: Record<string, string> = {
    ...(conn.settings.headers ?? {}),
    ...((i.headers ?? {}) as Record<string, string>),
  };
  const init: RequestInit = { method: String(i.method), headers };
  if (i.body !== undefined) {
    const consumes = String(i.consumes ?? 'application/json').toLowerCase();
    const codec = codecs[consumes];
    if (!codec) throw new Error(`no codec for '${consumes}' in ${ROOT} settings.codecs`);
    const enc = await codec.encode(i.body, undefined, blobs);
    // a blob body streams from the registry; a value's bytes go as they are
    if (enc.body instanceof Readable) {
      init.body = Readable.toWeb(enc.body) as unknown as BodyInit;
      (init as RequestInit & { duplex: 'half' }).duplex = 'half';
    } else init.body = new Uint8Array(enc.body);
    headers['content-type'] ??= enc.contentType;
    if (enc.length !== undefined) headers['content-length'] ??= String(enc.length);
  }
  if (i.produces) headers.accept ??= String(i.produces);
  // the connection's throttle paces every request made against it; the timeout counts from the moment the request is let through
  const res = await throttleFor(ctx.env, canon(String(i.connection)), conn.settings.throttle).run(async () => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), Number(conn.settings.timeoutMs ?? 30000));
    init.signal = ac.signal;
    try {
      return await fetch(url, init);
    } finally {
      clearTimeout(timer);
    }
  });
  const outHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    outHeaders[k] = v;
  });
  const out: Record<string, unknown> = { status: res.status, headers: outHeaders };
  // the answer is a stream: a blob codec sends it into the registry as it arrives, the others read it whole
  if (res.body && res.headers.get('content-length') !== '0') {
    const ct = String(i.produces ?? res.headers.get('content-type') ?? 'text/plain');
    const codec = codecs[mediaType(ct)] ?? codecs['text/plain'] ?? text;
    const resolve = ctx.env.resolveType as ((ref: string) => Type) | undefined;
    // returns describes a successful answer; an error status carries whatever body the API chose, and judging it would fail the node before a switch on status could decide
    const declared = res.ok && typeof i.returns === 'string' && resolve ? resolve(i.returns) : undefined;
    const decoded = await codec.decode(
      Readable.fromWeb(res.body as import('node:stream/web').ReadableStream),
      ct,
      declared,
      blobs,
    );
    if (decoded !== undefined) out.body = decoded;
  }
  return out;
}

// ---- trigger runtime --------------------------------------------------------------------------------

/** A cookie the answer sets: the field of the answer it takes (`from`), or `clear` for one to drop; `omit` keeps the field out of the body. */
interface CookieOut {
  from?: string;
  clear?: boolean;
  omit?: boolean;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'strict' | 'lax' | 'none';
  maxAge?: number;
  path?: string;
}
interface HttpSettings {
  route: string;
  method: string;
  consumes?: string;
  produces?: string;
  body?: string;
  response?: {
    status?: { from?: string; map?: Record<string, number>; default?: number };
    refusals?: Record<string, number>;
    cookies?: Record<string, CookieOut>;
  };
}

/** The request's cookies, by name, from the one header they travel in. */
function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      out[k] = part.slice(i + 1).trim();
    }
  }
  return out;
}

/** One Set-Cookie line. */
function setCookie(name: string, value: string, c: CookieOut): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${c.path ?? '/'}`];
  if (c.clear) parts.push('Max-Age=0');
  else if (c.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(c.maxAge)}`);
  if (c.httpOnly !== false) parts.push('HttpOnly');
  if (c.secure) parts.push('Secure');
  parts.push(`SameSite=${(c.sameSite ?? 'lax').replace(/^./, ch => ch.toUpperCase())}`);
  return parts.join('; ');
}

/**
 * The cookies an answer sets, and the body once the fields those cookies took are omitted where the route says so.
 * A cookie whose field the answer lacks is not set: the route said where the value comes from, and there is none.
 */
function cookiesOf(settings: HttpSettings, output: unknown): { headers: string[]; body: unknown } {
  const table = settings.response?.cookies;
  if (!table) return { headers: [], body: output };
  const headers: string[] = [];
  let body = output;
  for (const [name, c] of Object.entries(table)) {
    if (c.clear) {
      headers.push(setCookie(name, '', c));
      continue;
    }
    if (!c.from) continue;
    const v = readPath(output, c.from.split('.'));
    if (v === undefined || v === null) continue;
    headers.push(setCookie(name, String(v), c));
    if (c.omit && body && typeof body === 'object' && !Array.isArray(body) && c.from.split('.').length === 1) {
      const { [c.from]: _, ...rest } = body as Record<string, unknown>;
      body = rest;
    }
  }
  return { headers, body };
}

function compileRoute(route: string): { re: RegExp; keys: string[] } {
  const keys: string[] = [];
  const re = new RegExp(
    '^' +
      route
        .replace(/\{([A-Za-z0-9_]+)\}/g, (_, k: string) => {
          keys.push(k);
          return '([^/]+)';
        })
        .replace(/\//g, '\\/') +
      '\\/?$',
  );
  return { re, keys };
}

function statusFor(settings: HttpSettings, report: Report): number {
  if (report.status !== 'done') return 500;
  const st = settings.response?.status;
  if (!st) return 200;
  if (st.from) {
    const hit = st.map?.[String(readPath(report.output, st.from.split('.')))];
    if (hit !== undefined) return hit;
  }
  return st.default ?? 200;
}

/**
 * How a report is answered on the wire. An answer takes the status the response block chooses from it, and sets
 * the cookies response.cookies takes from it. A refusal -- the graph ending on purpose, a policy denying, the
 * guard refusing a credential -- is answered as `{ reason, message }` plus whatever detail it carries (a
 * challenge's id and how to answer it), with the status the trigger maps that reason to under response.refusals;
 * T005 has already made sure every reachable reason is mapped, so a reason without one can only mean the tree
 * changed under a running server, and is answered as a fault. A fault (a node that broke) and a blocked run are
 * 500 with what went wrong.
 */
export function encode(trigger: TriggerDoc, report: Report): { status: number; body: unknown; cookies?: string[] } {
  const settings = trigger.settings as unknown as HttpSettings;
  const refused = refusalOf(report);
  if (refused) {
    const status = settings.response?.refusals?.[refused.reason];
    if (status !== undefined)
      return { status, body: { reason: refused.reason, message: refused.message, ...(refused.detail ?? {}) } };
    return {
      status: 500,
      body: {
        error: `refused with reason '${refused.reason}', which response.refusals does not map: ${refused.message}`,
      },
    };
  }
  if (report.status === 'failed') {
    const failed = Object.entries(report.nodes).find(([, n]) => n.status === 'failed');
    return { status: 500, body: { error: failed ? `${failed[0]}: ${failed[1].error}` : 'failed' } };
  }
  if (report.status === 'blocked')
    return { status: 500, body: { error: `blocked: needs ${report.needs?.join(', ')}` } };
  const { headers, body } = cookiesOf(settings, report.output);
  return { status: statusFor(settings, report), body, ...(headers.length ? { cookies: headers } : {}) };
}

/**
 * Open the port and answer this tree's http triggers until the process stops. A project's startup list names
 * it; nothing here starts on its own. The routes are read from `serving` on every request rather than
 * captured once, so a reload can put a new tree behind the socket without closing it.
 */
const listen: Handler = async ({ in: input, ctx }) => {
  const env = ctx.env as { serving?: Serving; hold?: Hold; plugins?: Record<string, Record<string, unknown>> };
  const serving = env.serving;
  if (!serving || !env.hold)
    throw new Error(
      `'${P('server.port.json')}#listen' starts a server, so it runs from a project's startup list -- not from a graph`,
    );
  const { log } = serving;
  const settings = env.plugins?.[ROOT] ?? {};
  const port = Number(input.port ?? settings.port ?? 8080);
  // read afresh per request: a reload swaps the tree under a socket that stays open
  const routesNow = () =>
    serving.triggers(P('http.trigger-kind.json')).map(t => ({
      t,
      s: t.settings as unknown as HttpSettings,
      ...compileRoute((t.settings as unknown as HttpSettings).route),
    }));
  // a blob answer is piped from the registry to the socket; a value is encoded and sent whole
  const send = async (
    res: ServerResponse,
    status: number,
    body: unknown,
    produces = 'application/json',
    scope?: BlobStore,
    cookies?: string[],
  ) => {
    const codec = serving.codecs(ROOT)[produces.toLowerCase()] ?? json;
    const enc =
      body === undefined
        ? { body: Buffer.alloc(0), contentType: produces, length: 0 }
        : await codec.encode(body, undefined, scope ?? serving.blobs);
    const length = enc.length ?? (enc.body instanceof Readable ? undefined : enc.body.length);
    res.writeHead(status, {
      'content-type': enc.contentType,
      ...(length !== undefined ? { 'content-length': length } : {}),
      ...(enc.headers ?? {}),
      ...(cookies?.length ? { 'set-cookie': cookies } : {}),
    });
    if (enc.body instanceof Readable) await pipeline(enc.body, res);
    else res.end(enc.body);
  };

  const server = createServer(async (req, res) => {
    const started = Date.now();
    // one blob scope per request: what the body's codec and the graph store through it is released once answered
    const scope = serving.blobs.scope();
    try {
      const url = new URL(req.url ?? '/', 'http://local');
      const match = routesNow().find(r => r.s.method === req.method && r.re.test(url.pathname));
      if (!match) return send(res, 404, { error: `no trigger for ${req.method} ${url.pathname}` });
      const { t, s, re, keys } = match;
      const produces = s.produces ?? 'application/json';
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k.toLowerCase()] = v;
      const query: Record<string, string> = {};
      url.searchParams.forEach((v, k) => {
        query[k] = v;
      });
      const m = re.exec(url.pathname)!;
      const params: Record<string, string> = {};
      keys.forEach((k, i) => {
        params[k] = decodeURIComponent(m[i + 1]);
      });
      const cookies = parseCookies(headers.cookie);

      let body: unknown;
      const hasBody =
        Number(headers['content-length'] ?? 0) > 0 || (headers['transfer-encoding'] ?? '').includes('chunked');
      if (s.body && !hasBody) return send(res, 400, { error: 'a body is required' }, produces);
      if (hasBody) {
        // a route that declares what it consumes takes nothing else; without a declaration the sender's content type decides
        const sent = headers['content-type'] ? mediaType(headers['content-type']) : undefined;
        if (s.consumes && sent && sent !== mediaType(s.consumes))
          return send(res, 415, { error: `this route consumes ${s.consumes}, not ${sent}` }, produces);
        const ct = s.consumes ?? headers['content-type'] ?? 'application/json';
        const codec = serving.codecs(ROOT)[mediaType(ct)];
        if (!codec) return send(res, 415, { error: `no codec for '${mediaType(ct)}'` }, produces);
        // settings.body names the body's edge shape; without it the body IS the input. Either way the
        // declared shape judges what arrives, so a closed shape still refuses an undeclared field.
        const declared = s.body === t.in || !s.body ? serving.types(t).in : undefined;
        // the request stream itself goes to the codec: a blob body is written to the registry as it arrives
        try {
          body = await codec.decode(req, headers['content-type'] ?? ct, declared, scope);
        } catch (e) {
          return send(res, 400, { error: (e as Error).message }, produces);
        }
      }
      const request: Record<string, unknown> = {
        method: req.method,
        path: url.pathname,
        headers,
        query,
        params,
        cookies,
        ...(body !== undefined ? { body } : {}),
      };
      const built = serving.inputFor(t, request);
      if ('error' in built) return send(res, 400, { error: built.error }, produces);
      // the runtime gates the run: the guard identifies the caller and the trigger's policies decide before the operation fires
      const report = await serving.fire({ trigger: t, input: built.input, request, blobs: scope });
      const { status, body: answer, cookies: set } = encode(t, report);
      log(`${req.method} ${url.pathname} → ${status} (${Date.now() - started}ms, ${t.fire.run} ${report.status})`);
      return await send(res, status, answer, produces, scope, set);
    } catch (e) {
      log(`error: ${(e as Error).message}`);
      if (!res.headersSent) return send(res, 500, { error: (e as Error).message });
      res.destroy();
    } finally {
      await scope.release();
    }
  });
  await new Promise<void>((ok, fail) => {
    server.once('error', fail);
    server.listen(port, () => {
      server.off('error', fail);
      ok();
    });
  });
  const routes = routesNow();
  log(`http: listening on :${port} -- ${routes.map(r => `${r.s.method} ${r.s.route} → ${r.t.fire.run}`).join(', ')}`);
  env.hold({ label: `http :${port}`, stop: () => new Promise<void>(ok => server.close(() => ok())) });
  return { port, routes: routes.length };
};

/** The http trigger kind starts nothing: a project's startup list opens the server by naming server.port.json#listen. */
const runtime: TriggerRuntime = {
  encode: (t, r) => encode(t, r),
  async start() {
    return async () => {};
  },
};

/** Plugin-specific rules: content types are in the table, the table names real codecs, a throttle can let something through. */
function check({ scope, settings, refuse }: PluginCheckContext) {
  for (const c of scope.registry.all('connection')) {
    if (scope.canon(c.doc.kind) !== P('http.connection-kind.json')) continue;
    const th = (c.doc.settings as { throttle?: Record<string, unknown> }).throttle;
    if (!th) continue;
    if ('concurrency' in th && !(Number.isInteger(th.concurrency) && (th.concurrency as number) >= 1))
      refuse({
        code: 'X003',
        file: c.path,
        message: `throttle.concurrency is ${JSON.stringify(th.concurrency)}; it is the number of requests in flight at once, a whole number of 1 or more`,
        at: 'settings/throttle/concurrency',
        hint: 'set it to 1 or more, or drop it for no limit',
      });
    if ('perSecond' in th && !(typeof th.perSecond === 'number' && th.perSecond > 0))
      refuse({
        code: 'X003',
        file: c.path,
        message: `throttle.perSecond is ${JSON.stringify(th.perSecond)}; it is the number of requests started per second, above 0`,
        at: 'settings/throttle/perSecond',
        hint: 'set it above 0, or drop it for no limit',
      });
  }
  const table = (settings.codecs ?? {}) as Record<string, string>;
  for (const [ct, path] of Object.entries(table))
    if (!scope.get('codec', path))
      refuse({
        code: 'X001',
        file: '@project.json',
        message: `codecs["${ct}"] names '${path}', which is not a codec`,
        at: `plugins/${ROOT}/settings/codecs`,
        hint: 'wilanis ls codec',
      });
  const known = new Set(Object.keys(table).map(k => k.toLowerCase()));
  const need = (file: string, at: string, ct: unknown) => {
    if (typeof ct === 'string' && !known.has(ct.toLowerCase()))
      refuse({
        code: 'X002',
        file,
        message: `content type '${ct}' has no codec in ${ROOT} settings.codecs`,
        at,
        hint: `add "${ct}": "@http/codecs/<codec>.codec.json" to project.json`,
      });
  };
  for (const t of scope.registry.all('trigger'))
    if (scope.canon(t.doc.kind) === P('http.trigger-kind.json')) {
      need(t.path, 'settings/consumes', t.doc.settings.consumes);
      need(t.path, 'settings/produces', t.doc.settings.produces);
    }
  const opIn = (values: Record<string, unknown> | undefined, file: string, at: string) => {
    need(file, `${at}/consumes`, values?.consumes);
    need(file, `${at}/produces`, values?.produces);
  };
  for (const b of scope.registry.all('binding'))
    for (const [name, op] of Object.entries(b.doc.operations))
      if (op.run && scope.canon(op.run.split('#')[0]) === P('http.port.json'))
        opIn(op.in, b.path, `operations/${name}/in`);
  for (const g of scope.registry.all('graph'))
    for (const n of g.doc.nodes)
      if ('run' in n && scope.canon(n.run.split('#')[0]) === P('http.port.json'))
        opIn(n.in, g.path, `nodes/${n.id}/in`);
}

export const http: PluginModule = {
  root: ROOT,
  docs: DOCS,
  handlers: {
    [`${P('http.port.json')}#request`]: request as unknown as PluginModule['handlers'][string],
    [`${P('server.port.json')}#listen`]: listen,
  },
  triggers: { [P('http.trigger-kind.json')]: runtime },
  codecs: CODECS,
  check,
};

export default http;
