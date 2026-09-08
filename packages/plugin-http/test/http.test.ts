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
import { Throttle } from '../src/throttle.js';

const EXAMPLE = fileURLToPath(new URL('../../../example', import.meta.url));
const UPSTREAM = 54322;
const SECRET = 'secret-secret-secret-secret-secret-1';

let upstream: Server; let stop: () => Promise<void>; let token: string; let dir: string;
const rows: Record<string, unknown>[] = [{ id: '1', url: 'https://a.example/', method: 'GET', reponseStatus: 204, ipv4: '10.0.0.1', mac: '00:00:00:00:00:01', ua: 'curl/8', createdAt: '2026-09-07' }];
const logs: string[] = [];
/** How many DELETEs the upstream is serving right now, and the most it ever served at once. */
const inFlight = { now: 0, peak: 0 };

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
  edit('features/monitor/edge/record-entry.trigger.json', t => { t.settings.access = { roles: ['recorder'] }; });
  edit('connections/monitor-api.connection.json', c => { c.settings.throttle = { concurrency: 2 }; });
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
    if (req.method === 'DELETE') {
      // slow enough that concurrent deletes overlap, so the throttle's ceiling is observable
      inFlight.now++; inFlight.peak = Math.max(inFlight.peak, inFlight.now);
      await new Promise(r => setTimeout(r, 40));
      inFlight.now--;
      rows.splice(rows.indexOf(row), 1);
      return json(200, row);
    }
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
  it('deletes a batch of ids: one DELETE each, paced by the connection throttle, answered once all are gone', async () => {
    for (const i of [3, 4, 5, 6, 7]) rows.push({ id: String(i), url: `https://${i}.example/`, method: 'GET', ua: 'curl/8' });
    inFlight.peak = 0;
    const r = await call('DELETE', '/monitor', { ids: ['3', '4', '5', '6', '7'] });
    expect(r.status).toBe(200);
    // the answer is every deleted entry, in the order asked, pruned to the edge shape
    expect(r.body).toEqual([3, 4, 5, 6, 7].map(i => ({ id: String(i), url: `https://${i}.example/`, method: 'GET', ua: 'curl/8' })));
    // and by the time it arrived, the upstream had none of them left
    expect(rows.map(r => r.id)).toEqual(['1', '2']);
    // five requests were issued, never more than two at once
    expect(inFlight.peak).toBe(2);
  });
  it('fails the whole batch when one id does not exist, after every deletion settled', async () => {
    rows.push({ id: '8', url: 'https://8.example/', method: 'GET' });
    const r = await call('DELETE', '/monitor', { ids: ['8', 'nope'] });
    expect(r.status).toBe(500);
    expect(r.body.error).toContain('no entry nope');
    expect(rows.map(r => r.id)).toEqual(['1', '2']);
  });
  it('400 on a batch whose body is not the declared shape', async () => {
    expect((await call('DELETE', '/monitor', { ids: 'nope' })).status).toBe(400);
    expect((await call('DELETE', '/monitor')).status).toBe(400);
  });
});

describe('the throttle', () => {
  it('holds requests to the concurrency ceiling and lets the rest through as slots free up', async () => {
    const t = new Throttle({ concurrency: 3 });
    let now = 0, peak = 0;
    const job = async () => { now++; peak = Math.max(peak, now); await new Promise(r => setTimeout(r, 10)); now--; return 1; };
    const out = await Promise.all(Array.from({ length: 10 }, () => t.run(job)));
    expect(out).toHaveLength(10); expect(peak).toBe(3); expect(now).toBe(0);
  });
  it('starts no more than perSecond requests in any one second', async () => {
    const t = new Throttle({ perSecond: 3 });
    const starts: number[] = [];
    await Promise.all(Array.from({ length: 7 }, () => t.run(async () => { starts.push(Date.now()); })));
    starts.sort((a, b) => a - b);
    for (let i = 0; i + 3 < starts.length; i++) expect(starts[i + 3] - starts[i]).toBeGreaterThanOrEqual(1000);
    expect(starts[6] - starts[0]).toBeLessThan(2500);
  });
  it('frees the slot when the request throws', async () => {
    const t = new Throttle({ concurrency: 1 });
    await expect(t.run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(await t.run(async () => 'next')).toBe('next');
  });
});
