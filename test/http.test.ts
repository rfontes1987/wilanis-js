import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { SignJWT } from 'jose';
import { join } from 'node:path';
import { loadTree } from '../src/loader/load.js';
import { BUILTIN_PLUGINS } from '../src/plugins/index.js';
import { serve } from '../src/serve.js';

const SECRET = 'secret-secret-secret-secret-secret-1';
let upstream: Server; let stop: () => Promise<void>; let token: string;
const rows: Record<string, unknown>[] = [{ id: 't1', title: 'Ship it', status: 'todo', created_at: '2026-09-07' }];
const logs: string[] = [];

beforeAll(async () => {
  // a fake PostgREST: GET /tasks answers rows (filtered by status=eq.x), POST /tasks answers [row] with 201
  upstream = createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    if (!req.headers.apikey) { res.writeHead(401); return res.end('{}'); }
    if (req.method === 'POST') { const t = JSON.parse(body); const row = { id: `t${rows.length + 1}`, ...t, created_at: 'now' }; rows.push(row); res.writeHead(201, { 'content-type': 'application/json' }); return res.end(JSON.stringify([row])); }
    const m = /status=eq\.([a-z]+)/.exec(req.url ?? '');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(m ? rows.filter(r => r.status === m[1]) : rows));
  });
  await new Promise<void>(r => upstream.listen(54321, r));
  process.env.BOARD_DB_KEY = 'k'; process.env.BOARD_JWT_SECRET = SECRET;
  stop = await serve(loadTree(join(process.cwd(), 'example'), BUILTIN_PLUGINS), { log: s => logs.push(s) });
  token = await new SignJWT({ role: 'authenticated' }).setProtectedHeader({ alg: 'HS256' }).setSubject('u1').sign(new TextEncoder().encode(SECRET));
});
afterAll(async () => { await stop(); await new Promise<void>(r => upstream.close(() => r())); });

const call = async (method: string, path: string, body?: unknown, auth = true) => {
  const r = await fetch(`http://localhost:8080${path}`, { method, headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => undefined) as any };
};

describe('http trigger kind against a PostgREST-shaped upstream', () => {
  it('401 without a token', async () => { expect((await call('GET', '/tasks', undefined, false)).status).toBe(401); });
  it('lists everything, pruned to the edge shape', async () => {
    const r = await call('GET', '/tasks');
    expect(r.status).toBe(200); expect(r.body).toEqual([{ id: 't1', title: 'Ship it', status: 'todo' }]);
  });
  it('filters by status through the declared statement and forwards the caller token', async () => {
    const r = await call('GET', '/tasks?status=done');
    expect(r.status).toBe(200); expect(r.body).toEqual([]);
  });
  it('400 on a query value outside the enum', async () => { expect((await call('GET', '/tasks?status=bogus')).status).toBe(400); });
  it('creates with the status the domain chose, answers 201', async () => {
    const r = await call('POST', '/tasks', { title: 'Write README' });
    expect(r.status).toBe(201); expect(r.body).toEqual({ id: 't2', title: 'Write README', status: 'todo' });
  });
  it('400 on an undeclared body field (closed edge shape)', async () => { expect((await call('POST', '/tasks', { title: 'X', sneaky: 1 })).status).toBe(400); });
  it('404 for a route no trigger declares', async () => { expect((await call('GET', '/nope')).status).toBe(404); });
});
