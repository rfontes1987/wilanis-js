/**
 * @wilanis/plugin-http, the @http plugin: outbound requests (http.port.json#request), http connections, http triggers, body codecs.
 * Which codec handles which content type is the project's explicit table in this plugin's settings.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { fileURLToPath } from 'node:url';
import type { TriggerDoc } from '@wilanis/core';
import type { PluginModule, TriggerRuntime, Codecs } from '@wilanis/core';
import type { Report } from '@wilanis/engine';
import type { Type } from '@wilanis/core';
import { readPath } from '@wilanis/engine';
import type { PluginCheckContext } from '@wilanis/core';
import { form, json, multipart, text } from './codecs.js';
import { throttleFor, type ThrottleSettings } from './throttle.js';

const ROOT = '@http';
const P = (f: string) => `${ROOT}/${f}`;
/** The documents this plugin ships, as files: docs/ next to dist/ in the package. */
const DOCS = fileURLToPath(new URL('../docs', import.meta.url));

// ---- http.port.json#request -------------------------------------------------------------------------

type Conn = { kind: string; settings: { baseUrl: string; headers?: Record<string, string>; timeoutMs?: number; throttle?: ThrottleSettings } };

function codecTable(env: Record<string, unknown>): Codecs {
  const table = ((env.plugins as Record<string, Record<string, unknown>>)?.[ROOT]?.codecs ?? {}) as Record<string, string>;
  const impl: Record<string, typeof json> = { [P('codecs/json.codec.json')]: json, [P('codecs/text.codec.json')]: text, [P('codecs/form.codec.json')]: form, [P('codecs/multipart.codec.json')]: multipart };
  return Object.fromEntries(Object.entries(table).map(([ct, path]) => [ct.toLowerCase(), impl[path]]).filter(([, c]) => c));
}
const mediaType = (ct: string) => ct.split(';')[0].trim().toLowerCase();

async function request({ in: i, ctx }: { in: Record<string, unknown>; ctx: { env: Record<string, unknown> } }) {
  const canon = (ctx.env.canon as ((r: string) => string) | undefined) ?? ((r: string) => r);
  const conns = (ctx.env.connections ?? {}) as Record<string, Conn>;
  const conn = conns[canon(String(i.connection))];
  if (!conn) throw new Error(`unknown connection '${i.connection}'`);
  if (conn.kind !== P('http.connection-kind.json')) throw new Error(`connection '${i.connection}' is ${conn.kind}, not ${P('http.connection-kind.json')}`);
  const codecs = codecTable(ctx.env);
  const path = String(i.path);
  const url = new URL(conn.settings.baseUrl.replace(/\/$/, '') + (path.startsWith('/') ? path : `/${path}`));
  const headers: Record<string, string> = { ...(conn.settings.headers ?? {}), ...((i.headers ?? {}) as Record<string, string>) };
  const init: RequestInit = { method: String(i.method), headers };
  if (i.body !== undefined) {
    const consumes = String(i.consumes ?? 'application/json').toLowerCase();
    const codec = codecs[consumes]; if (!codec) throw new Error(`no codec for '${consumes}' in ${ROOT} settings.codecs`);
    const enc = codec.encode(i.body, undefined);
    init.body = new Uint8Array(enc.bytes); headers['content-type'] ??= enc.contentType;
  }
  if (i.produces) headers.accept ??= String(i.produces);
  // the connection's throttle paces every request made against it; the timeout counts from the moment the request is let through
  const res = await throttleFor(ctx.env, canon(String(i.connection)), conn.settings.throttle).run(async () => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), Number(conn.settings.timeoutMs ?? 30000));
    init.signal = ac.signal;
    try { return await fetch(url, init); } finally { clearTimeout(timer); }
  });
  const bytes = Buffer.from(await res.arrayBuffer());
  const outHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => { outHeaders[k] = v; });
  const out: Record<string, unknown> = { status: res.status, headers: outHeaders };
  if (bytes.length) {
    const ct = String(i.produces ?? res.headers.get('content-type') ?? 'text/plain');
    const codec = codecs[mediaType(ct)] ?? codecs['text/plain'] ?? text;
    const resolve = ctx.env.resolveType as ((ref: string) => Type) | undefined;
    // returns describes a successful answer; an error status carries whatever body the API chose, and judging it would fail the node before a switch on status could decide
    const declared = res.ok && typeof i.returns === 'string' && resolve ? resolve(i.returns) : undefined;
    out.body = codec.decode(bytes, ct, declared);
  }
  return out;
}

// ---- trigger runtime --------------------------------------------------------------------------------

interface HttpSettings {
  route: string; method: string; consumes?: string; produces?: string; body?: string;
  access?: { open?: boolean; roles?: string[] };
  response?: { status?: { from?: string; map?: Record<string, number>; default?: number } };
}

function compileRoute(route: string): { re: RegExp; keys: string[] } {
  const keys: string[] = [];
  const re = new RegExp('^' + route.replace(/\{([A-Za-z0-9_]+)\}/g, (_, k: string) => { keys.push(k); return '([^/]+)'; }).replace(/\//g, '\\/') + '\\/?$');
  return { re, keys };
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

function statusFor(settings: HttpSettings, report: Report): number {
  if (report.status !== 'done') return 500;
  const st = settings.response?.status;
  if (!st) return 200;
  if (st.from) { const hit = st.map?.[String(readPath(report.output, st.from.split('.')))]; if (hit !== undefined) return hit; }
  return st.default ?? 200;
}

export function encode(trigger: TriggerDoc, report: Report): { status: number; body: unknown } {
  const settings = trigger.settings as unknown as HttpSettings;
  if (report.status === 'failed') {
    const failed = Object.entries(report.nodes).find(([, n]) => n.status === 'failed');
    return { status: 500, body: { error: failed ? `${failed[0]}: ${failed[1].error}` : 'failed' } };
  }
  if (report.status === 'blocked') return { status: 500, body: { error: `blocked: needs ${report.needs?.join(', ')}` } };
  return { status: statusFor(settings, report), body: report.output };
}

const runtime: TriggerRuntime = {
  encode: (t, r) => encode(t, r),
  async start(triggers, fire, { settings, log, types, inputFor, codecs }) {
    const port = Number(settings.port ?? 8080);
    const jwt = (settings.jwt ?? {}) as { jwksUrl?: string; secret?: string; issuer?: string; audience?: string; rolesClaim?: string };
    const jwks = jwt.jwksUrl ? createRemoteJWKSet(new URL(jwt.jwksUrl)) : undefined;
    const key = jwt.secret ? new TextEncoder().encode(jwt.secret) : undefined;
    const routes = triggers.map(t => ({ t, s: t.settings as unknown as HttpSettings, ...compileRoute((t.settings as unknown as HttpSettings).route) }));
    const verify = async (token: string): Promise<JWTPayload> => {
      const opts = { issuer: jwt.issuer, audience: jwt.audience };
      if (jwks) return (await jwtVerify(token, jwks, opts)).payload;
      if (key) return (await jwtVerify(token, key, opts)).payload;
      throw new Error(`no jwt settings: set ${ROOT} settings.jwt.secret or jwksUrl`);
    };
    const send = (res: ServerResponse, status: number, body: unknown, produces = 'application/json') => {
      const codec = codecs[produces.toLowerCase()] ?? json;
      const enc = body === undefined ? { bytes: Buffer.alloc(0), contentType: produces } : codec.encode(body, undefined);
      res.writeHead(status, { 'content-type': enc.contentType, 'content-length': enc.bytes.length });
      res.end(enc.bytes);
    };

    const server = createServer(async (req, res) => {
      const started = Date.now();
      try {
        const url = new URL(req.url ?? '/', 'http://local');
        const match = routes.find(r => r.s.method === req.method && r.re.test(url.pathname));
        if (!match) return send(res, 404, { error: `no trigger for ${req.method} ${url.pathname}` });
        const { t, s, re, keys } = match;
        const produces = s.produces ?? 'application/json';
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k.toLowerCase()] = v;
        const query: Record<string, string> = {}; url.searchParams.forEach((v, k) => { query[k] = v; });
        const m = re.exec(url.pathname)!; const params: Record<string, string> = {}; keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });

        let principal: Record<string, unknown> | undefined;
        if (!s.access?.open) {
          const token = (headers.authorization ?? '').replace(/^Bearer\s+/i, '');
          if (!token) return send(res, 401, { error: 'a bearer token is required' }, produces);
          let claims: JWTPayload;
          try { claims = await verify(token); } catch (e) { return send(res, 401, { error: `invalid token: ${(e as Error).message}` }, produces); }
          const raw = claims[jwt.rolesClaim ?? 'role'] ?? (claims as Record<string, unknown>).roles;
          const roles = Array.isArray(raw) ? raw.map(String) : raw ? [String(raw)] : [];
          principal = { subject: String(claims.sub ?? ''), roles, claims, token };
          if (s.access?.roles?.length && !roles.some(r => s.access!.roles!.includes(r))) return send(res, 403, { error: `requires one of ${s.access.roles.join(', ')}` }, produces);
        }

        const bytes = await readBody(req);
        let body: unknown;
        if (s.body && !bytes.length) return send(res, 400, { error: 'a body is required' }, produces);
        if (bytes.length) {
          const ct = s.consumes ?? headers['content-type'] ?? 'application/json';
          const codec = codecs[mediaType(ct)];
          if (!codec) return send(res, 415, { error: `no codec for '${mediaType(ct)}'` }, produces);
          // settings.body names the body's edge shape; without it the body IS the input. Either way the
          // declared shape judges what arrives, so a closed shape still refuses an undeclared field.
          const declared = s.body === t.in || !s.body ? types(t).in : undefined;
          try { body = codec.decode(bytes, headers['content-type'] ?? ct, declared); }
          catch (e) { return send(res, 400, { error: (e as Error).message }, produces); }
        }
        const request: Record<string, unknown> = { method: req.method, path: url.pathname, headers, query, params, ...(body !== undefined ? { body } : {}), ...(principal ? { principal } : {}) };
        const built = inputFor(t, request);
        if ('error' in built) return send(res, 400, { error: built.error }, produces);
        const report = await fire({ trigger: t, input: built.input, request });
        const { status, body: answer } = encode(t, report);
        log(`${req.method} ${url.pathname} → ${status} (${Date.now() - started}ms, ${t.fire.run} ${report.status})`);
        return send(res, status, answer, produces);
      } catch (e) {
        log(`error: ${(e as Error).message}`);
        return send(res, 500, { error: (e as Error).message });
      }
    });
    await new Promise<void>((ok, fail) => { server.once('error', fail); server.listen(port, () => { server.off('error', fail); ok(); }); });
    log(`http: listening on :${port} -- ${routes.map(r => `${r.s.method} ${r.s.route} → ${r.t.fire.run}`).join(', ')}`);
    return () => new Promise<void>(ok => server.close(() => ok()));
  },
};

/** Plugin-specific rules: content types are in the table, the table names real codecs, a throttle can let something through. */
function check({ scope, settings, refuse }: PluginCheckContext) {
  for (const c of scope.registry.all('connection')) {
    if (scope.canon(c.doc.kind) !== P('http.connection-kind.json')) continue;
    const th = (c.doc.settings as { throttle?: Record<string, unknown> }).throttle;
    if (!th) continue;
    if ('concurrency' in th && !(Number.isInteger(th.concurrency) && (th.concurrency as number) >= 1)) refuse('X003', c.path, `throttle.concurrency is ${JSON.stringify(th.concurrency)}; it is the number of requests in flight at once, a whole number of 1 or more`, 'settings/throttle/concurrency', 'set it to 1 or more, or drop it for no limit');
    if ('perSecond' in th && !(typeof th.perSecond === 'number' && th.perSecond > 0)) refuse('X003', c.path, `throttle.perSecond is ${JSON.stringify(th.perSecond)}; it is the number of requests started per second, above 0`, 'settings/throttle/perSecond', 'set it above 0, or drop it for no limit');
  }
  const table = (settings.codecs ?? {}) as Record<string, string>;
  for (const [ct, path] of Object.entries(table)) if (!scope.get('codec', path)) refuse('X001', '@project.json', `codecs["${ct}"] names '${path}', which is not a codec`, `plugins/${ROOT}/settings/codecs`, 'wilanis ls codec');
  const known = new Set(Object.keys(table).map(k => k.toLowerCase()));
  const need = (file: string, at: string, ct: unknown) => { if (typeof ct === 'string' && !known.has(ct.toLowerCase())) refuse('X002', file, `content type '${ct}' has no codec in ${ROOT} settings.codecs`, at, `add "${ct}": "@http/codecs/<codec>.codec.json" to project.json`); };
  for (const t of scope.registry.all('trigger')) if (scope.canon(t.doc.kind) === P('http.trigger-kind.json')) { need(t.path, 'settings/consumes', t.doc.settings.consumes); need(t.path, 'settings/produces', t.doc.settings.produces); }
  const opIn = (values: Record<string, unknown> | undefined, file: string, at: string) => { need(file, `${at}/consumes`, values?.consumes); need(file, `${at}/produces`, values?.produces); };
  for (const b of scope.registry.all('binding')) for (const [name, op] of Object.entries(b.doc.operations)) if (op.run && scope.canon(op.run.split('#')[0]) === P('http.port.json')) opIn(op.in, b.path, `operations/${name}/in`);
  for (const g of scope.registry.all('graph')) for (const n of g.doc.nodes) if ('run' in n && scope.canon(n.run.split('#')[0]) === P('http.port.json')) opIn(n.in, g.path, `nodes/${n.id}/in`);
}

export const http: PluginModule = {
  root: ROOT,
  docs: DOCS,
  handlers: { [`${P('http.port.json')}#request`]: request as unknown as PluginModule['handlers'][string] },
  triggers: { [P('http.trigger-kind.json')]: runtime },
  codecs: { [P('codecs/json.codec.json')]: json, [P('codecs/text.codec.json')]: text, [P('codecs/form.codec.json')]: form, [P('codecs/multipart.codec.json')]: multipart },
  check,
};

export default http;
