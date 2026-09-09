/**
 * What the @http tests run against: a copy of the example pointed at a fake mockapi, the fake itself, and the calls a
 * test makes over the tree's own server. The tests own the lifecycle; this module says how each piece is built.
 */
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ResolvedInclude } from '@wilanis/core';

export const EXAMPLE = fileURLToPath(new URL('../../../example', import.meta.url));

/** The tree the example includes, as the runtime would resolve it from the example's node_modules. */
export const INCLUDES: ResolvedInclude[] = [
  {
    from: '@wilanis/access',
    dir: fileURLToPath(new URL('../../../libraries/access', import.meta.url)),
    features: ['access'],
  },
];

export const UPSTREAM = 54322;
export const SECRET = 'secret-secret-secret-secret-secret-1';
const SCHEMAS = 'https://raw.githubusercontent.com/wilanis/wilanis-js/schemas-v1/packages/core/schemas/';

/** The row the fake upstream starts with. */
export const firstRow = (): Record<string, unknown> => ({
  id: '1',
  url: 'https://a.example/',
  method: 'GET',
  reponseStatus: 204,
  ipv4: '10.0.0.1',
  mac: '00:00:00:00:00:01',
  ua: 'curl/8',
  createdAt: '2026-09-07',
});

/** A multipart upload beside the raw one: the file is one part of a form, a note another. */
function writeUploadForm(dir: string) {
  writeFileSync(
    join(dir, 'features/monitor/edge/UploadForm.shape.json'),
    JSON.stringify({
      $schema: `${SCHEMAS}shape.schema.json`,
      description: 'a form with a file and a note',
      layer: 'edge',
      fields: { file: { type: 'blob' }, note: { type: 'string' } },
    }),
  );
  writeFileSync(
    join(dir, 'features/monitor/edge/upload-form.trigger.json'),
    JSON.stringify({
      $schema: `${SCHEMAS}trigger.schema.json`,
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
}

/**
 * The example, pointed at a fake mockapi on localhost. Its write routes are gated by the access feature's policies,
 * so the tests sign in as bo -- an employee holding the recorder role -- through the example's own route and
 * present our token; nothing about access is edited.
 */
export function localCopy(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wilanis-http-'));
  cpSync(EXAMPLE, dir, { recursive: true, filter: path => !path.includes('node_modules') });
  const edit = (relative: string, change: (doc: any) => void) => {
    const path = join(dir, relative);
    const doc = JSON.parse(readFileSync(path, 'utf8'));
    change(doc);
    writeFileSync(path, JSON.stringify(doc));
  };
  edit('connections/monitor-api.connection.json', connection => {
    connection.settings.baseUrl = `http://localhost:${UPSTREAM}/api/v1`;
    connection.settings.throttle = { concurrency: 2 };
  });
  edit('project.json', project => {
    project.plugins.find((plugin: any) => plugin.use === '@http').settings.codecs['multipart/form-data'] =
      '@http/codecs/multipart.codec.json';
  });
  writeUploadForm(dir);
  return dir;
}

/** How many DELETEs the upstream is serving right now, and the most it ever served at once. */
export interface InFlight {
  now: number;
  peak: number;
}

/** The rows a POST adds, with the fields the upstream fills in. */
function newRow(body: string, rows: Record<string, unknown>[]) {
  return {
    createdAt: 'now',
    ipv4: '127.0.0.1',
    mac: '00:00:00:00:00:00',
    reponseStatus: 200,
    ...JSON.parse(body),
    id: String(rows.length + 1),
  };
}

/** The collection: POST adds a row, GET answers them all, filtered by ?method= when asked. */
function collection(
  request: IncomingMessage,
  url: URL,
  body: string,
  rows: Record<string, unknown>[],
): { status: number; value: unknown } {
  if (request.method === 'POST') {
    const row = newRow(body, rows);
    rows.push(row);
    return { status: 201, value: row };
  }
  const method = url.searchParams.get('method');
  return { status: 200, value: method ? rows.filter(row => row.method === method) : rows };
}

/** One row: a DELETE removes it, slowly enough that concurrent deletes overlap so a throttle's ceiling shows. */
async function one(
  request: IncomingMessage,
  id: string,
  rows: Record<string, unknown>[],
  inFlight: InFlight,
): Promise<{ status: number; value: unknown }> {
  const row = rows.find(each => each.id === id);
  if (!row) return { status: 404, value: 'Not found' };
  if (request.method !== 'DELETE') return { status: 200, value: row };
  inFlight.now++;
  inFlight.peak = Math.max(inFlight.peak, inFlight.now);
  await new Promise(done => setTimeout(done, 40));
  inFlight.now--;
  rows.splice(rows.indexOf(row), 1);
  return { status: 200, value: row };
}

/** What the fake upstream holds: the rows it serves, and how many deletes are in flight. */
export interface Upstream {
  rows: Record<string, unknown>[];
  inFlight: InFlight;
}

/** What the fake answers: the collection, one row, or nothing it knows. */
async function answerFor(
  incoming: { request: IncomingMessage; url: URL; body: string; route: RegExpExecArray | null },
  upstream: Upstream,
): Promise<{ status: number; value: unknown }> {
  const { request, url, body, route } = incoming;
  if (!route) return { status: 404, value: 'Not found' };
  if (route[1]) return one(request, route[1], upstream.rows, upstream.inFlight);
  return collection(request, url, body, upstream.rows);
}

/** A fake mockapi: rows under /api/v1/monitor, and "Not found" for anything else. */
export function fakeUpstream(upstream: Upstream): Server {
  return createServer(async (request: IncomingMessage, response: ServerResponse) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const url = new URL(request.url ?? '/', 'http://local');
    const route = /^\/api\/v1\/monitor(?:\/([^/]+))?$/.exec(url.pathname);
    const answer = await answerFor({ request, url, body, route }, upstream);
    response.writeHead(answer.status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(answer.value));
  });
}

/** Listen, and answer how to stop. */
export const listening = async (server: Server, port: number) => {
  await new Promise<void>(done => server.listen(port, done));
  return () => new Promise<void>(done => server.close(() => done()));
};

/** Sign in as bo, an employee holding the recorder role, and answer the token. */
export async function signInAsRecorder(): Promise<string> {
  const answer = await fetch('http://localhost:8080/api/v1/auth-employees', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'bo', password: 'bo-pass' }),
  });
  if (answer.status !== 200) throw new Error(`signing in answered ${answer.status}`);
  return ((await answer.json()) as { accessToken: string }).accessToken;
}

/** A call to the tree's own server, with the token when the test presents one. */
export const caller =
  (token: () => string) =>
  async (method: string, path: string, body?: unknown, authorized = false) => {
    const answer = await fetch(`http://localhost:8080${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(authorized ? { authorization: `Bearer ${token()}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: answer.status, body: (await answer.json().catch(() => undefined)) as any };
  };
