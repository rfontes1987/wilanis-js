import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkTree } from '@wilanis/compiler';
import { loadTree, type PluginModule, type ResolvedInclude } from '@wilanis/core';
import { refusalOf } from '@wilanis/engine';
import blobs from '@wilanis/plugin-blob';
import http from '@wilanis/plugin-http';
import reload from '@wilanis/plugin-reload';
import { BUILTIN_PLUGINS, runTrigger, start } from '@wilanis/runtime';
import { exportJWK, generateKeyPair, type KeyLike, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import auth, { hashPassword } from '../src/index.js';
import { Store } from '../src/store.js';

const EXAMPLE = fileURLToPath(new URL('../../../example', import.meta.url));
const PLUGINS: Record<string, PluginModule> = {
  ...BUILTIN_PLUGINS,
  '@http': http,
  '@blob': blobs,
  '@reload': reload,
  '@auth': auth,
};
/** The tree the example includes, as the runtime would resolve it from the example's node_modules. */
const INCLUDES: ResolvedInclude[] = [
  {
    from: '@wilanis/access',
    dir: fileURLToPath(new URL('../../../libraries/access', import.meta.url)),
    features: ['access'],
  },
];
const PORT = 8093,
  UPSTREAM = 54325,
  ISSUER = 54326;
const SECRET = 'a-secret-of-thirty-two-bytes-or-more!';
type Edit = (doc: any) => void;

/** The example, its API pointed at a fake upstream, its server on a port of its own, with any further edits. */
function localCopy(edits: Record<string, Edit> = {}): string {
  const d = mkdtempSync(join(tmpdir(), 'wilanis-auth-'));
  cpSync(EXAMPLE, d, { recursive: true, filter: p => !p.includes('node_modules') && !p.includes('.wilanis') });
  const edit = (rel: string, f: Edit) => {
    const p = join(d, rel);
    const doc = JSON.parse(readFileSync(p, 'utf8'));
    f(doc);
    writeFileSync(p, JSON.stringify(doc));
  };
  edit('connections/monitor-api.connection.json', c => {
    c.settings.baseUrl = `http://localhost:${UPSTREAM}/api/v1`;
  });
  edit('project.json', p => {
    p.plugins.find((x: any) => x.use === '@http').settings.port = PORT;
  });
  for (const [rel, f] of Object.entries(edits)) edit(rel, f);
  return d;
}
const codes = (dir: string) => checkTree(loadTree(dir, PLUGINS, INCLUDES)).items.map(r => r.code);
/** Copy the example, apply edits, answer the refusal codes. */
function sabotage(edits: Record<string, Edit>): string[] {
  const d = localCopy(edits);
  try {
    return codes(d);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
}

const json = async (r: Response) => ({
  status: r.status,
  body: (await r.json().catch(() => undefined)) as any,
  headers: r.headers,
});
const call = (path: string, init: RequestInit & { token?: string; cookie?: string } = {}) => {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.cookie) headers.cookie = init.cookie;
  return fetch(`http://localhost:${PORT}${path}`, { ...init, headers }).then(json);
};
const signIn = (route: string, username: string, password: string) =>
  call(`/api/v1/${route}`, { method: 'POST', body: JSON.stringify({ username, password }) });

let upstream: Server;
let issuer: Server;
let stop: () => Promise<void>;
let dir: string;
let key: { privateKey: KeyLike; jwk: Record<string, unknown> };
const rows: Record<string, unknown>[] = [];

beforeAll(async () => {
  process.env.MONITOR_JWT_SECRET = SECRET;
  // a mockapi-shaped upstream for the monitor's writes
  upstream = createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const send = (status: number, v: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(v));
    };
    if (req.method === 'POST') {
      const row = {
        createdAt: 'now',
        ipv4: '127.0.0.1',
        mac: '00',
        reponseStatus: 200,
        ...JSON.parse(body),
        id: String(rows.length + 1),
      };
      rows.push(row);
      return send(201, row);
    }
    return send(200, rows);
  });
  await new Promise<void>(r => upstream.listen(UPSTREAM, r));
  // an OIDC issuer: discovery, a password grant that knows one user, and the keys its identity tokens are signed with
  const pair = await generateKeyPair('RS256');
  key = {
    privateKey: pair.privateKey,
    jwk: { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' },
  };
  const base = `http://localhost:${ISSUER}`;
  issuer = createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const send = (status: number, v: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(v));
    };
    if (req.url === '/.well-known/openid-configuration')
      return send(200, { issuer: base, token_endpoint: `${base}/token`, jwks_uri: `${base}/keys` });
    if (req.url === '/keys') return send(200, { keys: [key.jwk] });
    if (req.url === '/token') {
      const form = new URLSearchParams(body);
      if (form.get('client_id') !== 'monitor' || form.get('client_secret') !== 'shh')
        return send(401, { error: 'invalid_client' });
      if (form.get('username') !== 'dee' || form.get('password') !== 'dee-pass')
        return send(400, { error: 'invalid_grant' });
      const idToken = await new SignJWT({ name: 'Dee', groups: ['customer', 'beta'] })
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setSubject('okta|dee')
        .setIssuer(base)
        .setAudience('monitor')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(key.privateKey);
      return send(200, { id_token: idToken, access_token: 'opaque', token_type: 'Bearer' });
    }
    send(404, {});
  });
  await new Promise<void>(r => issuer.listen(ISSUER, r));
  // the customers are an OIDC issuer here; the employees stay the directory written in the connection
  dir = localCopy({
    'connections/customers.connection.json': c => {
      c.kind = '@auth/oidc.connection-kind.json';
      c.settings = { issuer: base, clientId: 'monitor', clientSecret: 'shh' };
    },
  });
  const load = loadTree(dir, PLUGINS, INCLUDES);
  expect(checkTree(load).items).toEqual([]);
  ({ stop } = await start(load, { log: () => {} }));
});
afterAll(async () => {
  await stop();
  await new Promise<void>(r => upstream.close(() => r()));
  await new Promise<void>(r => issuer.close(() => r()));
  rmSync(dir, { recursive: true, force: true });
});

describe('signing in: two directories, one issuer', () => {
  it('an employee signs in against the directory in the connection and gets our token, realm employee, roles from the groups', async () => {
    const r = await signIn('auth-employees', 'bo', 'bo-pass');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      tokenType: 'Bearer',
      expiresIn: 900,
    });
    // the token is ours: three parts, and the cookie the route sets carries it too
    expect(r.body.accessToken.split('.')).toHaveLength(3);
    expect(r.headers.get('set-cookie')).toMatch(/^session=.+; Path=\/; Max-Age=900; HttpOnly; SameSite=Lax$/);
    const claims = JSON.parse(Buffer.from(r.body.accessToken.split('.')[1], 'base64url').toString());
    expect(claims).toMatchObject({
      sub: 'bo',
      iss: 'monitor',
      aud: 'monitor-api',
      realm: 'employee',
      roles: ['recorder'],
    });
  });
  it("a customer signs in against the OIDC issuer and gets our token, never the issuer's, realm customer", async () => {
    const r = await signIn('auth-customers', 'dee', 'dee-pass');
    expect(r.status).toBe(200);
    const claims = JSON.parse(Buffer.from(r.body.accessToken.split('.')[1], 'base64url').toString());
    expect(claims).toMatchObject({ sub: 'okta|dee', iss: 'monitor', realm: 'customer', roles: ['customer', 'beta'] });
  });
  it('a wrong password is 401 as bad_credentials, from either directory, and the caller cannot tell them apart', async () => {
    expect(await signIn('auth-employees', 'bo', 'nope').then(r => [r.status, r.body])).toEqual([
      401,
      { reason: 'bad_credentials', message: 'the username or password is wrong' },
    ]);
    expect(await signIn('auth-customers', 'dee', 'nope').then(r => [r.status, r.body])).toEqual([
      401,
      { reason: 'bad_credentials', message: 'the username or password is wrong' },
    ]);
    expect((await signIn('auth-employees', 'nobody', 'x')).status).toBe(401);
  });
  it('a password hash written in a directory verifies, and a plain one does too', () => {
    const h = hashPassword('bo-pass');
    expect(h).toMatch(/^scrypt:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
    expect(hashPassword('bo-pass', Buffer.from('salt-bo-00000001'))).toBe(
      'scrypt:c2FsdC1iby0wMDAwMDAwMQ:JtqRTYo_UPXAncXpIxTIsOiye-IOkOUeWKeLt81AZTA',
    );
  });
});

describe("policies over the monitor's writes", () => {
  const entry = { url: 'https://gated.example/', method: 'GET' };
  const post = (init: Parameters<typeof call>[1]) =>
    call('/monitor', { method: 'POST', body: JSON.stringify(entry), ...init });
  it('no token: 401 as anonymous', async () => {
    expect(await post({}).then(r => [r.status, r.body.reason])).toEqual([401, 'anonymous']);
  });
  it('a token that does not verify: 401 as invalid_credential, refused by the guard before any policy', async () => {
    const r = await post({ token: 'not.a.token' });
    expect(r.status).toBe(401);
    expect(r.body.reason).toBe('invalid_credential');
    expect(r.body.message).toContain('does not verify');
    const forged = await new SignJWT({ realm: 'employee', roles: ['recorder'], sid: 'x' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('bo')
      .setIssuer('monitor')
      .setAudience('monitor-api')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('another-key-another-key-another-key'));
    expect((await post({ token: forged })).body.reason).toBe('invalid_credential');
  });
  it('a customer holds a valid token and is still 403 as forbidden: employees only', async () => {
    const {
      body: { accessToken },
    } = await signIn('auth-customers', 'dee', 'dee-pass');
    expect(await post({ token: accessToken }).then(r => [r.status, r.body])).toEqual([
      403,
      { reason: 'forbidden', message: 'this is for employees' },
    ]);
  });
  it('an employee without the recorder role is 403 as forbidden by the second policy', async () => {
    const {
      body: { accessToken },
    } = await signIn('auth-employees', 'cy', 'cy-pass');
    expect(await post({ token: accessToken }).then(r => [r.status, r.body])).toEqual([
      403,
      { reason: 'forbidden', message: 'recording entries takes the recorder role' },
    ]);
  });
  it('an employee with the role records, by header or by cookie', async () => {
    const {
      body: { accessToken },
    } = await signIn('auth-employees', 'bo', 'bo-pass');
    expect((await post({ token: accessToken })).status).toBe(201);
    expect((await post({ cookie: `session=${accessToken}` })).status).toBe(201);
  });
  it('public reads stay public', async () => {
    expect((await call('/monitor')).status).toBe(200);
  });
});

describe('sessions: store on one call, read on another, keyed by the token', () => {
  it('keeps a value across calls and across a refresh, and ends with the session', async () => {
    const first = (await signIn('auth-employees', 'bo', 'bo-pass')).body;
    // the sign-in graph wrote the display name and realm into the session
    expect(await call('/api/v1/me/preferences', { token: first.accessToken }).then(r => r.body)).toEqual({
      displayName: 'Bo',
    });
    const put = await call('/api/v1/me/preferences', {
      method: 'PUT',
      token: first.accessToken,
      body: JSON.stringify({ theme: 'dark' }),
    });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ displayName: 'Bo', theme: 'dark' });
    // a value outside the shape's enum is refused at the edge
    expect(
      (
        await call('/api/v1/me/preferences', {
          method: 'PUT',
          token: first.accessToken,
          body: JSON.stringify({ theme: 'sepia' }),
        })
      ).status,
    ).toBe(400);
    // refresh: a new pair, the same session, the old refresh token spent
    const second = await call('/api/v1/token/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: first.refreshToken }),
    });
    expect(second.status).toBe(200);
    expect(second.body.refreshToken).not.toBe(first.refreshToken);
    expect(await call('/api/v1/me/preferences', { token: second.body.accessToken }).then(r => r.body)).toEqual({
      displayName: 'Bo',
      theme: 'dark',
    });
    expect(
      await call('/api/v1/token/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: first.refreshToken }),
      }).then(r => [r.status, r.body.reason]),
    ).toEqual([401, 'invalid_refresh']);
    // sign out: the cookie is cleared, and the token no longer verifies because its session has ended
    const out = await call('/api/v1/sign-out', { method: 'POST', token: second.body.accessToken });
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ ended: true });
    expect(out.headers.get('set-cookie')).toMatch(/^session=; Path=\/; Max-Age=0/);
    const after = await call('/api/v1/me/preferences', { token: second.body.accessToken });
    expect(after.status).toBe(401);
    expect(after.body.reason).toBe('invalid_credential');
    expect(after.body.message).toContain('has ended');
    expect(await call('/api/v1/me/preferences').then(r => r.body.reason)).toBe('anonymous');
  });
  it('the store keeps one file per record, and a spent challenge is gone', () => {
    const s = new Store(join(dir, '.wilanis/auth'));
    expect(s.list<{ subject: string }>('sessions').some(x => x.subject === 'bo')).toBe(true);
    s.put('things', 'a', { n: 1 });
    expect(s.get('things', 'a')).toEqual({ n: 1 });
    s.delete('things', 'a');
    expect(s.get('things', 'a')).toBeUndefined();
    expect(existsSync(join(dir, '.wilanis/auth/sessions'))).toBe(true);
  });
});

describe('a one-time code on the command line', () => {
  const run = async (ref: string, flags: Record<string, string> = {}) => {
    const load = loadTree(dir, PLUGINS, INCLUDES);
    const { report, answer } = await runTrigger(load, ref, flags, [], { log: () => {} });
    return { report, answer: answer as any };
  };
  it('challenges, issues, unlocks, and spends the challenge', async () => {
    // bare: the policy refuses otp, the guard opens a challenge, and the caller is told how to unlock it
    const first = await run('@hello/edge/hello-gated.trigger.json');
    expect(first.report.status).toBe('failed');
    expect(first.answer).toEqual({
      reason: 'otp',
      message: 'this command needs a one-time code',
      challenge: {
        id: expect.stringMatching(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/),
        method: 'otp',
        expiresAt: expect.any(String),
      },
      how: expect.stringContaining('--challenge-id='),
    });
    const id = first.answer.challenge.id as string;
    expect(first.answer.how).toBe(
      `wilanis run @access/edge/issue-otp.trigger.json --challenge-id=${id}; then repeat this call with --challenge-id=${id} --code=<code>`,
    );
    // the id without a code is refused by the guard, before the policy
    expect(
      refusalOf((await run('@hello/edge/hello-gated.trigger.json', { 'challenge-id': id })).report)?.message,
    ).toContain('has no code yet');
    // issue-otp gives it a code (printed here; delivered in a real tree)
    const issued = await run('@access/edge/issue-otp.trigger.json', { 'challenge-id': id });
    expect(issued.report.status).toBe('done');
    expect(issued.answer).toEqual({ id, code: expect.stringMatching(/^\d{6}$/), expiresAt: expect.any(String) });
    // a wrong code is refused and counted
    const wrong = await run('@hello/edge/hello-gated.trigger.json', { 'challenge-id': id, code: '000000' });
    expect(refusalOf(wrong.report)).toMatchObject({
      reason: 'invalid_credential',
      message: `the code for challenge '${id}' is wrong`,
    });
    // the right code unlocks the command
    const unlocked = await run('@hello/edge/hello-gated.trigger.json', {
      'challenge-id': id,
      code: issued.answer.code,
    });
    expect(unlocked.report.status).toBe('done');
    expect(unlocked.answer).toEqual({ greeting: 'hello, gated' });
    // once: the challenge was spent by the run it unlocked
    const again = await run('@hello/edge/hello-gated.trigger.json', { 'challenge-id': id, code: issued.answer.code });
    expect(refusalOf(again.report)?.message).toContain('unknown or has expired');
  });
  it('issue-otp refuses an unknown challenge, and needs its flag', async () => {
    const r = await run('@access/edge/issue-otp.trigger.json', { 'challenge-id': 'NOPE-NOPE' });
    expect(refusalOf(r.report)).toEqual({
      reason: 'unknown_challenge',
      message: 'challenge NOPE-NOPE is unknown or has expired',
    });
    await expect(run('@access/edge/issue-otp.trigger.json')).rejects.toThrow(/input: .*id/);
  });
  it('a stubbed run is never gated: wilanis run --seed rehearses the command without a code', async () => {
    const load = loadTree(dir, PLUGINS, INCLUDES);
    const { report } = await runTrigger(load, '@hello/edge/hello-gated.trigger.json', {}, [], { seed: 3 });
    expect(report.status).toBe('done');
  });
});

describe("the plugin's own rules", () => {
  const settings = (p: any) => p.plugins.find((x: any) => x.use === '@auth').settings;
  it('X101 a session shape that is not a shape', () => {
    expect(
      sabotage({
        'project.json': p => {
          settings(p).session = '@access/domain/Nope.shape.json';
        },
      }),
    ).toContain('X101');
  });
  it('X102 a challenge no attachment of the trigger could answer', () => {
    // the bare attachment also leaves the policy's read of request.challenge unsupplied (A005)
    expect(
      sabotage({
        'features/hello/edge/hello-gated.trigger.json': t => {
          t.policies = ['@access/edge/otp-verified.policy.json'];
        },
      }),
    ).toEqual(['A005', 'X102']);
  });
  it('the example itself is clean', () => {
    expect(sabotage({})).toEqual([]);
  });
});
