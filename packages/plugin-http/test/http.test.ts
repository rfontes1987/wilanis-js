import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SignJWT } from 'jose';
import { fileURLToPath } from 'node:url';
import { loadTree } from '@wilanis/core';
import { BUILTIN_PLUGINS, serve } from '@wilanis/runtime';
import http from '../src/index.js';

const EXAMPLE = fileURLToPath(new URL('../../../example', import.meta.url));
const UPSTREAM = 54322;
const SECRET = 'secret-secret-secret-secret-secret-1';

let upstream: Server; let stop: () => Promise<void>; let token: string; let dir: string;
const rows: Record<string, unknown>[] = [{ id: '1', url: 'https://a.example/', method: 'GET', reponseStatus: 204, ipv4: '10.0.0.1', mac: '00:00:00:00:00:01', ua: 'curl/8', createdAt: '2026-09-07' }];
const logs: string[] = [];

/**
 * The example, pointed at a fake mockapi on localhost and with one route put behind a token, so the plugin's
 * access check is exercised without the example itself needing a secret.
 */
function localCopy(): string {
  const d = mkdtempSync(join(tmpdir(), 'wilanis-http-'));
  cpSync(EXAMPLE, d, { recursive: true, filter: p => !p.includes('node_modules') });
  const edit = (rel: string, f: (doc: any) => void) => { const p = join(d, rel); const doc = JSON.parse(readFileSync(p, 'utf8')); f(doc); writeFileSync(p, JSON.stringify(doc)); };
  edit('connections/monitor-api.connection.json', c => { c.settings.baseUrl = `http://localhost:${UPSTREAM}/api/v1`; });
  edit('project.json', p => { p.plugins.find((x: any) => x.use === '@http').settings.jwt = { secret: '{{secrets.jwt}}', rolesClaim: 'role' }; p.secrets = { jwt: 'MONITOR_JWT_SECRET' }; });
  edit('features/monitor/triggers/record-entry.trigger.json', t => { t.settings.access = { roles: ['recorder'] }; });
  return d;
}

beforeAll(async () => {
  // a fake mockapi: GET /monitor answers rows (filtered by ?method=), POST answers the new row with 201, and an unknown id is 404 "Not found"
  upstream = createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    const url = new URL(req.url ?? '/', 'http://local');
    const json = (status: number, v: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };
    const m = /^\/api\/v1\/monitor(?:\/([^/]+))?$/.exec(url.pathname);
    if (!m) return json(404, 'Not found');
    if (!m[1]) {
      if (req.method === 'POST') { const row = { createdAt: 'now', ipv4: '127.0.0.1', mac: '00:00:00:00:00:00', reponseStatus: 200, ...JSON.parse(body), id: String(rows.length + 1) }; rows.push(row); return json(201, row); }
      const method = url.searchParams.get('method');
      return json(200, method ? rows.filter(r => r.method === method) : rows);
    }
    const row = rows.find(r => r.id === m[1]);
    if (!row) return json(404, 'Not found');
    return json(200, row);
  });
  await new Promise<void>(r => upstream.listen(UPSTREAM, r));
  process.env.MONITOR_JWT_SECRET = SECRET;
  dir = localCopy();
  // a copy outside the workspace cannot resolve plugins[].from through node_modules, so the plugins are handed in
  stop = await serve(loadTree(dir, { ...BUILTIN_PLUGINS, '@http': http }), { log: s => logs.push(s) });
  token = await new SignJWT({ role: 'recorder' }).setProtectedHeader({ alg: 'HS256' }).setSubject('u1').sign(new TextEncoder().encode(SECRET));
});
afterAll(async () => { await stop(); await new Promise<void>(r => upstream.close(() => r())); rmSync(dir, { recursive: true, force: true }); });

const call = async (method: string, path: string, body?: unknown, auth = false) => {
  const r = await fetch(`http://localhost:8080${path}`, { method, headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => undefined) as any };
};

describe('http trigger kind against a mockapi-shaped upstream', () => {
  it('lists everything, pruned to the edge shape', async () => {
    const r = await call('GET', '/monitor');
    expect(r.status).toBe(200); expect(r.body).toEqual([{ id: '1', url: 'https://a.example/', method: 'GET', ua: 'curl/8' }]);
  });
  it('narrows by method through the declared statement', async () => {
    const r = await call('GET', '/monitor?method=POST');
    expect(r.status).toBe(200); expect(r.body).toEqual([]);
  });
  it('400 on a query value outside the enum', async () => { expect((await call('GET', '/monitor?method=bogus')).status).toBe(400); });
  it('401 without a token on a route that requires one', async () => { expect((await call('POST', '/monitor', { url: 'https://b.example/', method: 'PUT' })).status).toBe(401); });
  it('records with the recorder the domain chose, answers 201', async () => {
    const r = await call('POST', '/monitor', { url: 'https://b.example/', method: 'PUT' }, true);
    expect(r.status).toBe(201); expect(r.body).toEqual({ id: '2', url: 'https://b.example/', method: 'PUT', ua: 'wilanis-example/0.1.0' });
  });
  it('400 on an undeclared body field (closed edge shape)', async () => { expect((await call('POST', '/monitor', { url: 'https://c.example/', method: 'GET', sneaky: 1 }, true)).status).toBe(400); });
  it('404 for a route no trigger declares', async () => { expect((await call('GET', '/nope')).status).toBe(404); });
});
