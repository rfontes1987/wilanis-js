/**
 * identity.port.json: whether a username and password are good, against the directory a connection names -- a list of
 * accounts this tree holds, or an OIDC issuer that answers for them.
 */
import { randomBytes, scryptSync } from 'node:crypto';
import type { Handler } from '@wilanis/engine';
import { createRemoteJWKSet, type JWTPayload, jwtVerify } from 'jose';
import { doc, type Env, same } from './settings.js';

type Account = { username: string; password?: string; passwordHash?: string; name: string; groups: string[] };

/** What an OIDC connection declares. */
interface Oidc {
  issuer: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
  groupsClaim?: string;
  timeoutMs?: number;
}

/** Where the issuer answers: its token endpoint and the keys its tokens are signed with. */
interface Discovery {
  token_endpoint: string;
  jwks_uri: string;
}

/** scrypt:<salt>:<hash>, both base64url. */
export function hashPassword(password: string, salt = randomBytes(16)): string {
  return `scrypt:${salt.toString('base64url')}:${scryptSync(password, salt, 32).toString('base64url')}`;
}

/** Whether the password matches what the account holds, hashed or plain. */
function passwordMatches(account: Account, password: string): boolean {
  if (account.passwordHash) {
    const [, salt, hash] = account.passwordHash.split(':');
    if (!salt || !hash) return false;
    return same(scryptSync(password, Buffer.from(salt, 'base64url'), 32).toString('base64url'), hash);
  }
  return typeof account.password === 'string' && same(account.password, password);
}

/** Fetch, giving up after the connection's timeout. */
async function fetchWithin(settings: Oidc, url: string, init?: RequestInit) {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), settings.timeoutMs ?? 10000);
  try {
    return await fetch(url, { ...init, signal: control.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Where the issuer says it answers, or undefined when it cannot be reached. */
async function discover(settings: Oidc, issuer: string): Promise<Discovery | undefined> {
  try {
    const answer = await fetchWithin(settings, `${issuer}/.well-known/openid-configuration`);
    if (!answer.ok) return undefined;
    return (await answer.json()) as Discovery;
  } catch {
    return undefined;
  }
}

/** The identity token the password grant answers with: a token, 'rejected', or 'unavailable'. */
async function grant(settings: Oidc, where: Discovery, username: string, password: string) {
  const form = new URLSearchParams({
    grant_type: 'password',
    username,
    password,
    scope: settings.scope ?? 'openid profile',
    client_id: settings.clientId,
    client_secret: settings.clientSecret,
  });
  let answer: Response;
  try {
    answer = await fetchWithin(settings, where.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
  } catch {
    return { status: 'unavailable' as const };
  }
  if (answer.status === 400 || answer.status === 401 || answer.status === 403) return { status: 'rejected' as const };
  if (!answer.ok) return { status: 'unavailable' as const };
  const body = (await answer.json()) as { id_token?: string };
  if (!body.id_token) return { status: 'unavailable' as const };
  return { status: 'ok' as const, idToken: body.id_token };
}

/** The identity the claims name, in this tree's terms. */
function identityOf(settings: Oidc, claims: JWTPayload, username: string) {
  const groups = claims[settings.groupsClaim ?? 'groups'];
  return {
    status: 'verified',
    identity: {
      subject: String(claims.sub ?? username),
      name: String(claims.name ?? claims.preferred_username ?? claims.email ?? claims.sub ?? username),
      groups: Array.isArray(groups) ? groups.map(String) : [],
    },
  };
}

/** The password grant against an OIDC issuer, and the identity token it answers verified against the issuer's keys. */
async function oidcVerify(settings: Oidc, username: string, password: string): Promise<unknown> {
  const issuer = settings.issuer.replace(/\/$/, '');
  const where = await discover(settings, issuer);
  if (!where) return { status: 'unavailable' };
  const granted = await grant(settings, where, username, password);
  if (granted.status !== 'ok') return { status: granted.status };
  try {
    const { payload } = await jwtVerify(granted.idToken, createRemoteJWKSet(new URL(where.jwks_uri)), {
      issuer: settings.issuer,
      audience: settings.clientId,
    });
    return identityOf(settings, payload, username);
  } catch {
    return { status: 'rejected' };
  }
}

/** The accounts a directory connection holds, and whether one of them answers to this password. */
function directoryVerify(users: Account[], username: string, password: string) {
  const account = users.find(one => one.username === username);
  if (!account || !passwordMatches(account, password)) return { status: 'rejected' };
  return {
    status: 'verified',
    identity: { subject: account.username, name: account.name, groups: account.groups ?? [] },
  };
}

/** Whether a caller is who they say: the connection they name decides, a directory of accounts or an OIDC issuer. */
export const verify: Handler = async ({ in: input, ctx }) => {
  const env = ctx.env as Env;
  const canon = env.canon ?? ((ref: string) => ref);
  const connection = env.connections?.[canon(String(input.connection))];
  if (!connection) throw new Error(`unknown connection '${input.connection}'`);
  const username = String(input.username);
  const password = String(input.password);
  if (connection.kind === doc('directory.connection-kind.json'))
    return directoryVerify((connection.settings.users ?? []) as Account[], username, password);
  if (connection.kind === doc('oidc.connection-kind.json'))
    return oidcVerify(connection.settings as unknown as Oidc, username, password);
  throw new Error(`connection '${input.connection}' is ${connection.kind}, not a directory`);
};
