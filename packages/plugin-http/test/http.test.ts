import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkTree } from '@wilanis/compiler';
import { loadTree, type ResolvedInclude } from '@wilanis/core';
import auth from '@wilanis/plugin-auth';
import blobs from '@wilanis/plugin-blob';
import reload from '@wilanis/plugin-reload';
import { BUILTIN_PLUGINS, start } from '@wilanis/runtime';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http, { encode } from '../src/index.js';
import { Throttle } from '../src/throttle.js';

const EXAMPLE = fileURLToPath(new URL('../../../example', import.meta.url));
/** The tree the example includes, as the runtime would resolve it from the example's node_modules. */
const INCLUDES: ResolvedInclude[] = [
  {
    from: '@wilanis/access',
    dir: fileURLToPath(new URL('../../../libraries/access', import.meta.url)),
    features: ['access'],
  },
];
const UPSTREAM = 54322;
const SECRET = 'secret-secret-secret-secret-secret-1';

let upstream: Server;
let stop: () => Promise<void>;
let token: string;
let dir: string;
const rows: Record<string, unknown>[] = [
  {
    id: '1',
    url: 'https://a.example/',
    method: 'GET',
    reponseStatus: 204,
    ipv4: '10.0.0.1',
    mac: '00:00:00:00:00:01',
    ua: 'curl/8',
    createdAt: '2026-09-07',
  },
];
const logs: string[] = [];
/** How many DELETEs the upstream is serving right now, and the most it ever served at once. */
const inFlight = { now: 0, peak: 0 };

/**
 * The example, pointed at a fake mockapi on localhost. Its write routes are gated by the access feature's policies,
 * so the tests sign in as bo -- an employee holding the recorder role -- through the example's own route and
 * present our token; nothing about access is edited.
 */
function localCopy(): string {
  const d = mkdtempSync(join(tmpdir(), 'wilanis-http-'));
  cpSync(EXAMPLE, d, { recursive: true, filter: p => !p.includes('node_modules') });
  const edit = (rel: string, f: (doc: any) => void) => {
    const p = join(d, rel);
    const doc = JSON.parse(readFileSync(p, 'utf8'));
    f(doc);
    writeFileSync(p, JSON.stringify(doc));
  };
  edit('connections/monitor-api.connection.json', c => {
    c.settings.baseUrl = `http://localhost:${UPSTREAM}/api/v1`;
  });
  edit('connections/monitor-api.connection.json', c => {
    c.settings.throttle = { concurrency: 2 };
  });
  // a multipart upload beside the raw one: the file is one part of a form, a note another
  const S = 'https://raw.githubusercontent.com/rfontes1987/wilanis-js/schemas-v1/packages/core/schemas/';
  edit('project.json', p => {
    p.plugins.find((x: any) => x.use === '@http').settings.codecs['multipart/form-data'] =
      '@http/codecs/multipart.codec.json';
  });
  writeFileSync(
    join(d, 'features/monitor/edge/UploadForm.shape.json'),
    JSON.stringify({
      $schema: `${S}shape.schema.json`,
      description: 'a form with a file and a note',
      layer: 'edge',
      fields: { file: { type: 'blob' }, note: { type: 'string' } },
    }),
  );
  writeFileSync(
    join(d, 'features/monitor/edge/upload-form.trigger.json'),
    JSON.stringify({
      $schema: `${S}trigger.schema.json`,
      description: 'POST /monitor/upload as a form',
      kind: '@http/http.trigger-kind.json',
      settings: {
        route: '/monitor/upload',
        method: 'POST',
        consumes: 'multipart/form-data',
        produces: 'application/json',
        body: '@features/monitor/edge/UploadForm.shape.json',
        response: { status: { default: 201 }, refusals: { upstream: 502 } },
      },
      in: '@features/monitor/edge/CsvUpload.shape.json',
      out: '@features/monitor/edge/EntryView.shape.json[]',
      fire: { run: '@features/monitor/domain/monitor.port.json#import', in: { file: '{{request.body.file}}' } },
    }),
  );
  return d;
}

beforeAll(async () => {
  // a fake mockapi: GET /monitor answers rows (filtered by ?method=), POST answers the new row with 201, and an unknown id is 404 "Not found"
  upstream = createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const url = new URL(req.url ?? '/', 'http://local');
    const json = (status: number, v: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(v));
    };
    const m = /^\/api\/v1\/monitor(?:\/([^/]+))?$/.exec(url.pathname);
    if (!m) return json(404, 'Not found');
    if (!m[1]) {
      if (req.method === 'POST') {
        const row = {
          createdAt: 'now',
          ipv4: '127.0.0.1',
          mac: '00:00:00:00:00:00',
          reponseStatus: 200,
          ...JSON.parse(body),
          id: String(rows.length + 1),
        };
        rows.push(row);
        return json(201, row);
      }
      const method = url.searchParams.get('method');
      return json(200, method ? rows.filter(r => r.method === method) : rows);
    }
    const row = rows.find(r => r.id === m[1]);
    if (!row) return json(404, 'Not found');
    if (req.method === 'DELETE') {
      // slow enough that concurrent deletes overlap, so the throttle's ceiling is observable
      inFlight.now++;
      inFlight.peak = Math.max(inFlight.peak, inFlight.now);
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
  const load = loadTree(
    dir,
    { ...BUILTIN_PLUGINS, '@http': http, '@blob': blobs, '@reload': reload, '@auth': auth },
    INCLUDES,
  );
  expect(checkTree(load).items).toEqual([]);
  ({ stop } = await start(load, { log: s => logs.push(s) }));
  const signedIn = await fetch('http://localhost:8080/api/v1/auth-employees', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'bo', password: 'bo-pass' }),
  });
  expect(signedIn.status).toBe(200);
  token = ((await signedIn.json()) as { accessToken: string }).accessToken;
});
afterAll(async () => {
  await stop();
  await new Promise<void>(r => upstream.close(() => r()));
  rmSync(dir, { recursive: true, force: true });
});

const call = async (method: string, path: string, body?: unknown, auth = false) => {
  const r = await fetch(`http://localhost:8080${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: (await r.json().catch(() => undefined)) as any };
};

describe('http trigger kind against a mockapi-shaped upstream', () => {
  it('lists everything, pruned to the edge shape', async () => {
    const r = await call('GET', '/monitor');
    expect(r.status).toBe(200);
    expect(r.body).toEqual([{ id: '1', url: 'https://a.example/', method: 'GET', ua: 'curl/8' }]);
  });
  it('narrows by method through the declared statement', async () => {
    const r = await call('GET', '/monitor?method=POST');
    expect(r.status).toBe(200);
    expect(r.body).toEqual([]);
  });
  it('400 on a query value outside the enum', async () => {
    expect((await call('GET', '/monitor?method=bogus')).status).toBe(400);
  });
  it('401 as anonymous without a token on a gated route: the policy refused, and the route maps the reason', async () => {
    const r = await call('POST', '/monitor', { url: 'https://b.example/', method: 'PUT' });
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ reason: 'anonymous', message: 'sign in first: no token was presented' });
  });
  it('records with the recorder the domain chose, answers 201', async () => {
    const r = await call('POST', '/monitor', { url: 'https://b.example/', method: 'PUT' }, true);
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ id: '2', url: 'https://b.example/', method: 'PUT', ua: 'wilanis-example/0.1.0' });
  });
  it('400 on an undeclared body field (closed edge shape)', async () => {
    expect((await call('POST', '/monitor', { url: 'https://c.example/', method: 'GET', sneaky: 1 }, true)).status).toBe(
      400,
    );
  });
  it('404 for a route no trigger declares', async () => {
    expect((await call('GET', '/nope')).status).toBe(404);
  });
  it('deletes a batch of ids: one DELETE each, paced by the connection throttle, answered once all are gone', async () => {
    for (const i of [3, 4, 5, 6, 7])
      rows.push({ id: String(i), url: `https://${i}.example/`, method: 'GET', ua: 'curl/8' });
    inFlight.peak = 0;
    const r = await call('DELETE', '/monitor', { ids: ['3', '4', '5', '6', '7'] }, true);
    expect(r.status).toBe(200);
    // the answer is every deleted entry, in the order asked, pruned to the edge shape
    expect(r.body).toEqual(
      [3, 4, 5, 6, 7].map(i => ({ id: String(i), url: `https://${i}.example/`, method: 'GET', ua: 'curl/8' })),
    );
    // and by the time it arrived, the upstream had none of them left
    expect(rows.map(r => r.id)).toEqual(['1', '2']);
    // five requests were issued, never more than two at once
    expect(inFlight.peak).toBe(2);
  });
  it('refuses the whole batch as missing when one id does not exist, after every deletion settled', async () => {
    rows.push({ id: '8', url: 'https://8.example/', method: 'GET' });
    const r = await call('DELETE', '/monitor', { ids: ['8', 'nope'] }, true);
    // the element's refusal is the map's, and the map's is the route's: the reason travels up as it is
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ reason: 'missing', message: 'no entry nope' });
    expect(rows.map(r => r.id)).toEqual(['1', '2']);
  });
  it('answers a declared refusal with the status the route maps its reason to, and the reason and message as the body', async () => {
    const r = await call('GET', '/monitor/zzz');
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ reason: 'missing', message: 'no entry zzz' });
  });
  it('a refusal whose reason the route does not map is a fault, not a silent status', () => {
    const trigger = {
      kind: '@http/http.trigger-kind.json',
      settings: { route: '/x', method: 'GET', response: { refusals: { missing: 404 } } },
      fire: { run: 'p#op' },
    } as any;
    const refused = {
      graph: 'g',
      status: 'failed' as const,
      nodes: { n: { status: 'failed' as const, error: 'nope', reason: 'conflict' } },
      startedAt: 0,
      endedAt: 0,
    };
    expect(encode(trigger, refused)).toEqual({
      status: 500,
      body: { error: "refused with reason 'conflict', which response.refusals does not map: nope" },
    });
    expect(encode(trigger, { ...refused, nodes: { n: { ...refused.nodes.n, reason: 'missing' } } })).toEqual({
      status: 404,
      body: { reason: 'missing', message: 'nope' },
    });
    // a fault stays a 500 that says where it broke
    expect(encode(trigger, { ...refused, nodes: { n: { status: 'failed' as const, error: 'boom' } } })).toEqual({
      status: 500,
      body: { error: 'n: boom' },
    });
  });
  it('400 on a batch whose body is not the declared shape', async () => {
    expect((await call('DELETE', '/monitor', { ids: 'nope' }, true)).status).toBe(400);
    expect((await call('DELETE', '/monitor', undefined, true)).status).toBe(400);
  });
});

describe('files through the blob registry', () => {
  it('uploads a CSV as a blob: the body streams into the registry, the graph gets a handle, every row is recorded', async () => {
    const csv = 'url,method\nhttps://csv-1.example/,GET\n"https://csv-2.example/?a=1,2",POST\n';
    const r = await fetch('http://localhost:8080/monitor.csv', {
      method: 'POST',
      headers: { 'content-type': 'text/csv', authorization: `Bearer ${token}` },
      body: csv,
    });
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual([
      { id: expect.any(String), url: 'https://csv-1.example/', method: 'GET', ua: 'wilanis-example/0.1.0' },
      { id: expect.any(String), url: 'https://csv-2.example/?a=1,2', method: 'POST', ua: 'wilanis-example/0.1.0' },
    ]);
    expect(rows.filter(x => String(x.url).startsWith('https://csv-'))).toHaveLength(2);
  });
  it('downloads every entry as a CSV: streamed from the registry with its content type, length and filename', async () => {
    const r = await fetch('http://localhost:8080/monitor.csv');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(r.headers.get('content-disposition')).toBe('attachment; filename="monitor.csv"');
    const body = await r.text();
    expect(Number(r.headers.get('content-length'))).toBe(Buffer.byteLength(body));
    const lines = body.split('\r\n').filter(Boolean);
    expect(lines[0]).toBe('id,url,method,ua');
    expect(lines).toHaveLength(rows.length + 1);
    expect(lines.some(l => l.includes('"https://csv-2.example/?a=1,2"'))).toBe(true);
  });
  it('a multipart form: the file part streams into the registry as a blob, the text part arrives as a string', async () => {
    const big = `url,method\n${Array.from({ length: 2000 }, (_, i) => `https://form-${i}.example/,GET`).join('\n')}\n`;
    const form = new FormData();
    form.append('note', 'from a form');
    form.append('file', new Blob([big], { type: 'text/csv' }), 'bulk.csv');
    const before = rows.length;
    const r = await fetch('http://localhost:8080/monitor/upload', { method: 'POST', body: form });
    expect(r.status).toBe(201);
    expect(await r.json()).toHaveLength(2000);
    expect(rows.length).toBe(before + 2000);
  });
  it('a CSV row that is not an entry is a fault of the import, and nothing is recorded', async () => {
    const before = rows.length;
    const r = await fetch('http://localhost:8080/monitor.csv', {
      method: 'POST',
      headers: { 'content-type': 'text/csv', authorization: `Bearer ${token}` },
      body: 'url,method\nhttps://x.example/,TRACE\n',
    });
    expect(r.status).toBe(500);
    expect((await r.json()).error).toContain('row 2.method');
    expect(rows.length).toBe(before);
  });
  it('a body of another content type than the route consumes is a 415, and an upload with no body is a 400', async () => {
    const r = await fetch('http://localhost:8080/monitor.csv', {
      method: 'POST',
      headers: { 'content-type': 'application/pdf' },
      body: '%PDF',
    });
    expect(r.status).toBe(415);
    expect((await r.json()).error).toBe('this route consumes text/csv, not application/pdf');
    expect(
      (await fetch('http://localhost:8080/monitor.csv', { method: 'POST', headers: { 'content-type': 'text/csv' } }))
        .status,
    ).toBe(400);
  });
});

describe('the throttle', () => {
  it('holds requests to the concurrency ceiling and lets the rest through as slots free up', async () => {
    const t = new Throttle({ concurrency: 3 });
    let now = 0,
      peak = 0;
    const job = async () => {
      now++;
      peak = Math.max(peak, now);
      await new Promise(r => setTimeout(r, 10));
      now--;
      return 1;
    };
    const out = await Promise.all(Array.from({ length: 10 }, () => t.run(job)));
    expect(out).toHaveLength(10);
    expect(peak).toBe(3);
    expect(now).toBe(0);
  });
  it('starts no more than perSecond requests in any one second', async () => {
    const t = new Throttle({ perSecond: 3 });
    const starts: number[] = [];
    await Promise.all(
      Array.from({ length: 7 }, () =>
        t.run(async () => {
          starts.push(Date.now());
        }),
      ),
    );
    starts.sort((a, b) => a - b);
    // the job's clock reads a tick after the gate's, so a millisecond of skew is measurement, not a fourth start in the second
    for (let i = 0; i + 3 < starts.length; i++) expect(starts[i + 3] - starts[i]).toBeGreaterThanOrEqual(999);
    expect(starts[6] - starts[0]).toBeLessThan(2500);
  });
  it('frees the slot when the request throws', async () => {
    const t = new Throttle({ concurrency: 1 });
    await expect(
      t.run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await t.run(async () => 'next')).toBe('next');
  });
});
