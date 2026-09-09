import { existsSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { join } from 'node:path';
import { checkTree } from '@wilanis/compiler';
import { loadTree } from '@wilanis/core';
import { refusalOf } from '@wilanis/engine';
import { runTrigger, start } from '@wilanis/runtime';
import { type KeyLike, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/index.js';
import { Store } from '../src/store.js';
import {
  call,
  fakeIssuer,
  fakeUpstream,
  INCLUDES,
  ISSUER,
  issuerKey,
  listening,
  localCopy,
  PLUGINS,
  SECRET,
  sabotage,
  signIn,
  UPSTREAM,
} from './harness.js';

let stopUpstream: () => Promise<void>;
let stopIssuer: () => Promise<void>;
let stop: () => Promise<void>;
let dir: string;
let key: { privateKey: KeyLike; jwk: Record<string, unknown> };
const rows: Record<string, unknown>[] = [];

beforeAll(async () => {
  process.env.MONITOR_JWT_SECRET = SECRET;
  const upstream: Server = fakeUpstream(rows);
  stopUpstream = await listening(upstream, UPSTREAM);
  key = await issuerKey();
  const base = `http://localhost:${ISSUER}`;
  stopIssuer = await listening(fakeIssuer(base, key), ISSUER);
  // the customers are an OIDC issuer here; the employees stay the directory written in the connection
  dir = localCopy({
    'connections/customers.connection.json': connection => {
      connection.kind = '@auth/oidc.connection-kind.json';
      connection.settings = { issuer: base, clientId: 'monitor', clientSecret: 'shh' };
    },
  });
  const load = loadTree(dir, PLUGINS, INCLUDES);
  expect(checkTree(load).items).toEqual([]);
  ({ stop } = await start(load, { log: () => {} }));
});

afterAll(async () => {
  await stop();
  await stopUpstream();
  await stopIssuer();
  rmSync(dir, { recursive: true, force: true });
});

describe('signing in: two directories, one issuer', () => {
  it('an employee signs in against the directory in the connection and gets our token, realm employee, roles from the groups', async () => {
    const answer = await signIn('auth-employees', 'bo', 'bo-pass');
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      tokenType: 'Bearer',
      expiresIn: 900,
    });
    // the token is ours: three parts, and the cookie the route sets carries it too
    expect(answer.body.accessToken.split('.')).toHaveLength(3);
    expect(answer.headers.get('set-cookie')).toMatch(/^session=.+; Path=\/; Max-Age=900; HttpOnly; SameSite=Lax$/);
    const claims = JSON.parse(Buffer.from(answer.body.accessToken.split('.')[1], 'base64url').toString());
    expect(claims).toMatchObject({
      sub: 'bo',
      iss: 'monitor',
      aud: 'monitor-api',
      realm: 'employee',
      roles: ['recorder'],
    });
  });
  it("a customer signs in against the OIDC issuer and gets our token, never the issuer's, realm customer", async () => {
    const answer = await signIn('auth-customers', 'dee', 'dee-pass');
    expect(answer.status).toBe(200);
    const claims = JSON.parse(Buffer.from(answer.body.accessToken.split('.')[1], 'base64url').toString());
    expect(claims).toMatchObject({ sub: 'okta|dee', iss: 'monitor', realm: 'customer', roles: ['customer', 'beta'] });
  });
  it('a wrong password is 401 as bad_credentials, from either directory, and the caller cannot tell them apart', async () => {
    expect(await signIn('auth-employees', 'bo', 'nope').then(answer => [answer.status, answer.body])).toEqual([
      401,
      { reason: 'bad_credentials', message: 'the username or password is wrong' },
    ]);
    expect(await signIn('auth-customers', 'dee', 'nope').then(answer => [answer.status, answer.body])).toEqual([
      401,
      { reason: 'bad_credentials', message: 'the username or password is wrong' },
    ]);
    expect((await signIn('auth-employees', 'nobody', 'x')).status).toBe(401);
  });
  it('a password hash written in a directory verifies, and a plain one does too', () => {
    const hashed = hashPassword('bo-pass');
    expect(hashed).toMatch(/^scrypt:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
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
    expect(await post({}).then(answer => [answer.status, answer.body.reason])).toEqual([401, 'anonymous']);
  });
  it('a token that does not verify: 401 as invalid_credential, refused by the guard before any policy', async () => {
    const answer = await post({ token: 'not.a.token' });
    expect(answer.status).toBe(401);
    expect(answer.body.reason).toBe('invalid_credential');
    expect(answer.body.message).toContain('does not verify');
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
    expect(await post({ token: accessToken }).then(answer => [answer.status, answer.body])).toEqual([
      403,
      { reason: 'forbidden', message: 'this is for employees' },
    ]);
  });
  it('an employee without the recorder role is 403 as forbidden by the second policy', async () => {
    const {
      body: { accessToken },
    } = await signIn('auth-employees', 'cy', 'cy-pass');
    expect(await post({ token: accessToken }).then(answer => [answer.status, answer.body])).toEqual([
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
    expect(await call('/api/v1/me/preferences', { token: first.accessToken }).then(answer => answer.body)).toEqual({
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
    expect(
      await call('/api/v1/me/preferences', { token: second.body.accessToken }).then(answer => answer.body),
    ).toEqual({
      displayName: 'Bo',
      theme: 'dark',
    });
    expect(
      await call('/api/v1/token/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: first.refreshToken }),
      }).then(answer => [answer.status, answer.body.reason]),
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
    expect(await call('/api/v1/me/preferences').then(answer => answer.body.reason)).toBe('anonymous');
  });
  it('the store keeps one file per record, and a spent challenge is gone', () => {
    const store = new Store(join(dir, '.wilanis/auth'));
    expect(store.list<{ subject: string }>('sessions').some(one => one.subject === 'bo')).toBe(true);
    store.put('things', 'a', { n: 1 });
    expect(store.get('things', 'a')).toEqual({ n: 1 });
    store.delete('things', 'a');
    expect(store.get('things', 'a')).toBeUndefined();
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
    const answer = await run('@access/edge/issue-otp.trigger.json', { 'challenge-id': 'NOPE-NOPE' });
    expect(refusalOf(answer.report)).toEqual({
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
  const settings = (project: any) => project.plugins.find((plugin: any) => plugin.use === '@auth').settings;
  it('X101 a session shape that is not a shape', () => {
    expect(
      sabotage({
        'project.json': project => {
          settings(project).session = '@access/domain/Nope.shape.json';
        },
      }),
    ).toContain('X101');
  });
  it('X102 a challenge no attachment of the trigger could answer', () => {
    // the bare attachment also leaves the policy's read of request.challenge unsupplied (A005)
    expect(
      sabotage({
        'features/hello/edge/hello-gated.trigger.json': trigger => {
          trigger.policies = ['@access/edge/otp-verified.policy.json'];
        },
      }),
    ).toEqual(['A005', 'X102']);
  });
  it('the example itself is clean', () => {
    expect(sabotage({})).toEqual([]);
  });
});
