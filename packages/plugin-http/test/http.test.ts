import { rmSync } from 'node:fs';
import type { Readable } from 'node:stream';
import { checkTree } from '@wilanis/compiler';
import type { BlobStore } from '@wilanis/core';
import { loadTree } from '@wilanis/core';
import auth from '@wilanis/plugin-auth';
import blobs from '@wilanis/plugin-blob';
import reload from '@wilanis/plugin-reload';
import storage from '@wilanis/plugin-storage';
import memory from '@wilanis/plugin-storage-memory';
import { BUILTIN_PLUGINS, start } from '@wilanis/runtime';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http, { encode } from '../src/index.js';
import { MultipartParts } from '../src/multipart.js';
import { Throttle } from '../src/throttle.js';
import {
  caller,
  fakeUpstream,
  firstRow,
  INCLUDES,
  type InFlight,
  listening,
  localCopy,
  SECRET,
  signInAsRecorder,
  UPSTREAM,
} from './harness.js';

let stopUpstream: () => Promise<void>;
let stop: () => Promise<void>;
let token = '';
let dir: string;
const rows: Record<string, unknown>[] = [firstRow()];
const logs: string[] = [];
/** How many DELETEs the upstream is serving right now, and the most it ever served at once. */
const inFlight: InFlight = { now: 0, peak: 0 };
const call = caller(() => token);

beforeAll(async () => {
  stopUpstream = await listening(fakeUpstream({ rows, inFlight }), UPSTREAM);
  process.env.MONITOR_JWT_SECRET = SECRET;
  dir = localCopy();
  // a copy outside the workspace cannot resolve plugins[].from through node_modules, so the plugins are handed in
  const load = loadTree(
    dir,
    {
      ...BUILTIN_PLUGINS,
      '@http': http,
      '@blob': blobs,
      '@reload': reload,
      '@auth': auth,
      '@storage': storage,
      '@storage-memory': memory,
    },
    INCLUDES,
  );
  expect(checkTree(load).items).toEqual([]);
  ({ stop } = await start(load, { log: line => logs.push(line), profile: 'live' }));
  token = await signInAsRecorder();
});

afterAll(async () => {
  await stop();
  await stopUpstream();
  rmSync(dir, { recursive: true, force: true });
});

describe('http trigger kind against a mockapi-shaped upstream', () => {
  it('lists everything, pruned to the edge shape', async () => {
    const answer = await call('GET', '/monitor');
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual([{ id: '1', url: 'https://a.example/', method: 'GET', ua: 'curl/8' }]);
  });
  it('narrows by method through the declared statement', async () => {
    const answer = await call('GET', '/monitor?method=POST');
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual([]);
  });
  it('400 on a query value outside the enum', async () => {
    expect((await call('GET', '/monitor?method=bogus')).status).toBe(400);
  });
  it('401 as anonymous without a token on a gated route: the policy refused, and the route maps the reason', async () => {
    const answer = await call('POST', '/monitor', { url: 'https://b.example/', method: 'PUT' });
    expect(answer.status).toBe(401);
    expect(answer.body).toEqual({ reason: 'anonymous', message: 'sign in first: no token was presented' });
  });
  it('records with the recorder the domain chose, answers 201', async () => {
    const answer = await call('POST', '/monitor', { url: 'https://b.example/', method: 'PUT' }, true);
    expect(answer.status).toBe(201);
    expect(answer.body).toEqual({ id: '2', url: 'https://b.example/', method: 'PUT', ua: 'wilanis-example/0.1.0' });
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
    for (const id of [3, 4, 5, 6, 7])
      rows.push({ id: String(id), url: `https://${id}.example/`, method: 'GET', ua: 'curl/8' });
    inFlight.peak = 0;
    const answer = await call('DELETE', '/monitor', { ids: ['3', '4', '5', '6', '7'] }, true);
    expect(answer.status).toBe(200);
    // the answer is every deleted entry, in the order asked, pruned to the edge shape
    expect(answer.body).toEqual(
      [3, 4, 5, 6, 7].map(id => ({ id: String(id), url: `https://${id}.example/`, method: 'GET', ua: 'curl/8' })),
    );
    // and by the time it arrived, the upstream had none of them left
    expect(rows.map(row => row.id)).toEqual(['1', '2']);
    // five requests were issued, never more than two at once
    expect(inFlight.peak).toBe(2);
  });
  it('refuses the whole batch as missing when one id does not exist, after every deletion settled', async () => {
    rows.push({ id: '8', url: 'https://8.example/', method: 'GET' });
    const answer = await call('DELETE', '/monitor', { ids: ['8', 'nope'] }, true);
    // the element's refusal is the map's, and the map's is the route's: the reason travels up as it is
    expect(answer.status).toBe(404);
    expect(answer.body).toEqual({ reason: 'missing', message: 'no entry nope' });
    expect(rows.map(row => row.id)).toEqual(['1', '2']);
  });
  it('answers a declared refusal with the status the route maps its reason to, and the reason and message as the body', async () => {
    const answer = await call('GET', '/monitor/zzz');
    expect(answer.status).toBe(404);
    expect(answer.body).toEqual({ reason: 'missing', message: 'no entry zzz' });
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
    const answer = await fetch('http://localhost:8080/monitor.csv', {
      method: 'POST',
      headers: { 'content-type': 'text/csv', authorization: `Bearer ${token}` },
      body: csv,
    });
    expect(answer.status).toBe(201);
    expect(await answer.json()).toEqual([
      { id: expect.any(String), url: 'https://csv-1.example/', method: 'GET', ua: 'wilanis-example/0.1.0' },
      { id: expect.any(String), url: 'https://csv-2.example/?a=1,2', method: 'POST', ua: 'wilanis-example/0.1.0' },
    ]);
    expect(rows.filter(row => String(row.url).startsWith('https://csv-'))).toHaveLength(2);
  });
  it('downloads every entry as a CSV: streamed from the registry with its content type, length and filename', async () => {
    const answer = await fetch('http://localhost:8080/monitor.csv');
    expect(answer.status).toBe(200);
    expect(answer.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(answer.headers.get('content-disposition')).toBe('attachment; filename="monitor.csv"');
    const body = await answer.text();
    expect(Number(answer.headers.get('content-length'))).toBe(Buffer.byteLength(body));
    const lines = body.split('\r\n').filter(Boolean);
    expect(lines[0]).toBe('id,url,method,ua');
    expect(lines).toHaveLength(rows.length + 1);
    expect(lines.some(line => line.includes('"https://csv-2.example/?a=1,2"'))).toBe(true);
  });
  it('a multipart form: the file part streams into the registry as a blob, the text part arrives as a string', async () => {
    const big = `url,method\n${Array.from({ length: 2000 }, (_, index) => `https://form-${index}.example/,GET`).join('\n')}\n`;
    const form = new FormData();
    form.append('note', 'from a form');
    form.append('file', new Blob([big], { type: 'text/csv' }), 'bulk.csv');
    const before = rows.length;
    const answer = await fetch('http://localhost:8080/monitor/upload', { method: 'POST', body: form });
    expect(answer.status).toBe(201);
    expect(await answer.json()).toHaveLength(2000);
    expect(rows.length).toBe(before + 2000);
  });
  it('a CSV row that is not an entry is a fault of the import, and nothing is recorded', async () => {
    const before = rows.length;
    const answer = await fetch('http://localhost:8080/monitor.csv', {
      method: 'POST',
      headers: { 'content-type': 'text/csv', authorization: `Bearer ${token}` },
      body: 'url,method\nhttps://x.example/,TRACE\n',
    });
    expect(answer.status).toBe(500);
    expect((await answer.json()).error).toContain('row 2.method');
    expect(rows.length).toBe(before);
  });
  it('a body of another content type than the route consumes is a 415, and an upload with no body is a 400', async () => {
    const answer = await fetch('http://localhost:8080/monitor.csv', {
      method: 'POST',
      headers: { 'content-type': 'application/pdf' },
      body: '%PDF',
    });
    expect(answer.status).toBe(415);
    expect((await answer.json()).error).toBe('this route consumes text/csv, not application/pdf');
    expect(
      (await fetch('http://localhost:8080/monitor.csv', { method: 'POST', headers: { 'content-type': 'text/csv' } }))
        .status,
    ).toBe(400);
  });
});

describe('the throttle', () => {
  it('holds requests to the concurrency ceiling and lets the rest through as slots free up', async () => {
    const gate = new Throttle({ concurrency: 3 });
    let now = 0,
      peak = 0;
    const job = async () => {
      now++;
      peak = Math.max(peak, now);
      await new Promise(done => setTimeout(done, 10));
      now--;
      return 1;
    };
    const out = await Promise.all(Array.from({ length: 10 }, () => gate.run(job)));
    expect(out).toHaveLength(10);
    expect(peak).toBe(3);
    expect(now).toBe(0);
  });
  it('starts no more than perSecond requests in any one second', async () => {
    const gate = new Throttle({ perSecond: 3 });
    const starts: number[] = [];
    await Promise.all(
      Array.from({ length: 7 }, () =>
        gate.run(async () => {
          starts.push(Date.now());
        }),
      ),
    );
    starts.sort((one, other) => one - other);
    // the job's clock reads a tick after the gate's, so a millisecond of skew is measurement, not a fourth start in the second
    for (let at = 0; at + 3 < starts.length; at++) expect(starts[at + 3] - starts[at]).toBeGreaterThanOrEqual(999);
    expect(starts[6] - starts[0]).toBeLessThan(2500);
  });
  it('frees the slot when the request throws', async () => {
    const gate = new Throttle({ concurrency: 1 });
    await expect(
      gate.run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await gate.run(async () => 'next')).toBe('next');
  });
});

describe('multipart parts, fed in pieces', () => {
  const Boundary = 'X-BOUND';
  const Body = Buffer.from(
    `--${Boundary}\r\ncontent-disposition: form-data; name="note"\r\n\r\nhello world\r\n` +
      `--${Boundary}\r\ncontent-disposition: form-data; name="file"; filename="a.txt"\r\ncontent-type: text/plain\r\n\r\nFILE-CONTENTS-HERE\r\n` +
      `--${Boundary}--\r\n`,
  );
  /** A registry that keeps what it was streamed, so a test can read the part back. */
  const registry = () =>
    ({
      put: (stream: Readable, meta: Record<string, unknown>) =>
        new Promise(done => {
          const chunks: Buffer[] = [];
          stream.on('data', chunk => chunks.push(chunk as Buffer));
          stream.on('end', () => done({ text: Buffer.concat(chunks).toString('utf8'), ...meta }));
        }),
    }) as unknown as BlobStore;
  const parse = async (pieces: Buffer[]) => {
    const parts = new MultipartParts(Boundary, registry());
    for (const piece of pieces) parts.feed(piece);
    return parts.end();
  };

  it('a text part is a string and a file part is streamed to the registry with its filename and type', async () => {
    expect(await parse([Body])).toEqual({
      note: 'hello world',
      file: { text: 'FILE-CONTENTS-HERE', contentType: 'text/plain', filename: 'a.txt' },
    });
  });

  it('a chunk boundary anywhere -- inside a part, its headers, or the delimiter -- changes nothing', async () => {
    const whole = await parse([Body]);
    for (let at = 1; at < Body.length; at++)
      expect(await parse([Body.subarray(0, at), Body.subarray(at)]), `split at ${at}`).toEqual(whole);
  });
});
