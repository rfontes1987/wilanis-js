/**
 * @wilanis/plugin-http, the @http plugin: outbound requests (http.port.json#request), http connections, http triggers, body codecs.
 * Which codec handles which content type is the project's explicit table in this plugin's settings.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { schemaRef, type AnyDoc, type ConnectionKindDoc, type PluginDoc, type PortDoc, type TriggerDoc, type TriggerKindDoc } from '@wilanis/core';
import type { PluginModule, TriggerRuntime, Codecs } from '@wilanis/core';
import type { Report } from '@wilanis/engine';
import type { Type } from '@wilanis/core';
import { readPath } from '@wilanis/engine';
import type { PluginCheckContext } from '@wilanis/core';
import { form, formCodec, json, jsonCodec, multipart, multipartCodec, partShape, text, textCodec } from './codecs.js';

const OPEN_STRING = { fields: {}, open: 'string' } as const;
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const ROOT = '@http';
const P = (f: string) => `${ROOT}/${f}`;

export const httpPort: PortDoc = {
  $schema: schemaRef('port'),
  description: 'Outbound HTTP. request knows what HTTP knows: method, path, headers, body in; status, headers, body out. It executes and reports -- whether 404 is a failure is the caller\'s business, decided by a switch on status. It fails only on the unexpected: network, timeout, a body the codec cannot decode, or a 2xx body that does not conform to the declared type.',
  operations: {
    request: {
      description: 'Send one request against a connection. The connection, method, content types and result type are static, declared where the statement is written; path, headers and body may read what any value may.',
      accepts: {
        connection: { type: 'string', static: true, description: 'an http connection document path' },
        method: { type: 'string', enum: METHODS, static: true },
        path: { type: 'string', description: 'path under the connection\'s baseUrl, query string included; e.g. "/tasks/{{in.id}}"' },
        headers: { type: OPEN_STRING, required: false, description: 'added to the connection\'s' },
        body: { type: 'unknown', required: false, description: 'the request body, encoded by the consumes codec' },
        consumes: { type: 'string', required: false, static: true, description: 'content type of the body sent; must be in the plugin\'s codecs table. Default application/json' },
        produces: { type: 'string', required: false, static: true, description: 'content type expected back; must be in the codecs table. Absent: the answer\'s own content-type decides' },
        returns: { type: 'type', binds: '$Body', required: false, description: 'the type the decoded body must have when the status is 2xx. Any other status forwards the body as the codec decoded it, so a switch on status can still route it. Absent: unknown, forward it whole' },
      },
      returns: { fields: { status: { type: 'number' }, headers: { type: OPEN_STRING }, body: { type: '$Body', required: false } } },
    },
  },
};

export const httpConnectionKind: ConnectionKindDoc = {
  $schema: schemaRef('connection-kind'),
  description: 'An HTTP base URL with headers every request carries. A PostgREST or Supabase REST endpoint is one: baseUrl to /rest/v1, apikey reading {{secrets.*}}.',
  settings: { fields: { baseUrl: { type: 'string' }, headers: { type: OPEN_STRING, required: false }, timeoutMs: { type: 'number', required: false } } },
};

export const httpTriggerKind: TriggerKindDoc = {
  $schema: schemaRef('trigger-kind'),
  description: 'A route. The body is decoded by the consumes codec into request.body (typed by settings.body); query, route placeholders (request.params, each one required), headers and the principal are in the context too. The trigger\'s input mapping picks what the graph gets; access is checked before the graph runs; the answer is encoded by the produces codec with the status the response block chooses.',
  settings: {
    fields: {
      route: { type: 'string', binds: '$Params', description: 'e.g. /tasks or /tasks/{id}; each {name} is a required request.params.name' },
      method: { type: 'string', enum: METHODS },
      consumes: { type: 'string', required: false, description: 'the body\'s content type; must be in the plugin\'s codecs table' },
      produces: { type: 'string', required: false, description: 'the answer\'s content type; must be in the codecs table. Default application/json' },
      body: { type: 'type', binds: '$Body', required: false, description: 'the edge type of the decoded body (request.body); declaring it means a body is expected, so a request without one is a 400. Absent: the body is the trigger\'s in' },
      access: { type: { fields: { open: { type: 'boolean', required: false, description: 'true: no token needed' }, roles: { type: 'string[]', required: false, description: 'the principal must hold one of these' } } }, required: false, description: 'absent: a valid token is required, any role' },
      response: { type: { fields: { status: { type: { fields: { from: { type: 'string', required: false, description: 'a path into the answer whose value picks the status' }, map: { type: { fields: {}, open: 'number' }, required: false }, default: { type: 'number', required: false } } }, required: false } } }, required: false },
    },
  },
  context: {
    fields: {
      method: { type: 'string' },
      path: { type: 'string' },
      headers: { type: OPEN_STRING, description: 'lower-cased names' },
      query: { type: OPEN_STRING },
      params: { type: '$Params', description: 'the route\'s placeholders, each a string the route guarantees' },
      body: { type: '$Body', description: 'present whenever settings.body is declared' },
      principal: { type: { fields: { subject: { type: 'string' }, roles: { type: 'string[]' }, claims: { type: { fields: {}, open: true } }, token: { type: 'string', secret: true } } }, required: false },
    },
  },
};

export const manifest: PluginDoc = {
  $schema: schemaRef('plugin'),
  description: 'HTTP out, HTTP connections, HTTP triggers, body codecs. Settings say which codec handles which content type.',
  settings: {
    fields: {
      port: { type: 'number', required: false, description: 'listen port, default 8080' },
      codecs: { type: { fields: {}, open: 'string' }, description: 'content type -> codec document path, e.g. "application/json": "@http/codecs/json.codec.json"' },
      jwt: { type: { fields: { jwksUrl: { type: 'string', required: false }, secret: { type: 'string', required: false, secret: true }, issuer: { type: 'string', required: false }, audience: { type: 'string', required: false }, rolesClaim: { type: 'string', required: false, description: 'claim holding the role(s); default role' } } }, required: false },
    },
  },
  grants: { ports: [P('http.port.json')], triggerKinds: [P('http.trigger-kind.json')], connectionKinds: [P('http.connection-kind.json')], codecs: [P('codecs/json.codec.json'), P('codecs/text.codec.json'), P('codecs/form.codec.json'), P('codecs/multipart.codec.json')] },
};

// ---- http.port.json#request -------------------------------------------------------------------------

type Conn = { kind: string; settings: { baseUrl: string; headers?: Record<string, string>; timeoutMs?: number } };

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
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), Number(conn.settings.timeoutMs ?? 30000));
  init.signal = ac.signal;
  let res: Response;
  try { res = await fetch(url, init); } finally { clearTimeout(timer); }
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
          const declared = s.body ? undefined : types(t).in; // settings.body typed the context; else the body IS the input, judged by inputFor
          try { body = codec.decode(bytes, headers['content-type'] ?? ct, declared && t.input === undefined ? undefined : declared); }
          catch (e) { return send(res, 400, { error: (e as Error).message }, produces); }
        }
        const request: Record<string, unknown> = { method: req.method, path: url.pathname, headers, query, params, ...(body !== undefined ? { body } : {}), ...(principal ? { principal } : {}) };
        const built = inputFor(t, request);
        if ('error' in built) return send(res, 400, { error: built.error }, produces);
        const report = await fire({ trigger: t, input: built.input, request });
        const { status, body: answer } = encode(t, report);
        log(`${req.method} ${url.pathname} → ${status} (${Date.now() - started}ms, ${t.graph} ${report.status})`);
        return send(res, status, answer, produces);
      } catch (e) {
        log(`error: ${(e as Error).message}`);
        return send(res, 500, { error: (e as Error).message });
      }
    });
    await new Promise<void>((ok, fail) => { server.once('error', fail); server.listen(port, () => { server.off('error', fail); ok(); }); });
    log(`http: listening on :${port} -- ${routes.map(r => `${r.s.method} ${r.s.route} → ${r.t.graph}`).join(', ')}`);
    return () => new Promise<void>(ok => server.close(() => ok()));
  },
};

/** Plugin-specific rules: content types are in the table, the table names real codecs. */
function check({ scope, settings, refuse }: PluginCheckContext) {
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
  docs: {
    [P('plugin.json')]: manifest, [P('http.port.json')]: httpPort, [P('http.connection-kind.json')]: httpConnectionKind, [P('http.trigger-kind.json')]: httpTriggerKind,
    [P('codecs/json.codec.json')]: jsonCodec, [P('codecs/text.codec.json')]: textCodec, [P('codecs/form.codec.json')]: formCodec, [P('codecs/multipart.codec.json')]: multipartCodec,
    [P('Part.shape.json')]: partShape,
  } as Record<string, AnyDoc>,
  handlers: { [`${P('http.port.json')}#request`]: request as unknown as PluginModule['handlers'][string] },
  triggers: { [P('http.trigger-kind.json')]: runtime },
  codecs: { [P('codecs/json.codec.json')]: json, [P('codecs/text.codec.json')]: text, [P('codecs/form.codec.json')]: form, [P('codecs/multipart.codec.json')]: multipart },
  check,
};

export default http;
