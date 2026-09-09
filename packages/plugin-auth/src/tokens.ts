/**
 * token.port.json and session.port.json: this tree's own tokens, and the sessions they name. A session holds the
 * attributes a caller carries between calls; the session shape judges every write to them.
 */
import { randomBytes } from 'node:crypto';
import type { Handler } from '@wilanis/engine';
import { SignJWT } from 'jose';
import { type Env, iso, judged, keyOf, now, type SessionRecord, same, settingsOf, sha, storeOf } from './settings.js';

/** A fresh pair of tokens for a session, the refresh token recorded against it. */
export async function issueTokens(env: Env, session: SessionRecord): Promise<Record<string, unknown>> {
  const settings = settingsOf(env);
  const store = storeOf(env);
  const accessTtl = settings.tokens?.accessTtl ?? 900;
  const refreshTtl = settings.tokens?.refreshTtl ?? 604800;
  const refreshToken = randomBytes(32).toString('base64url');
  session.refreshHash = sha(refreshToken);
  session.refreshExpiresAt = iso(now() + refreshTtl * 1000);
  store.put('sessions', session.id, session);
  const accessToken = await new SignJWT({ realm: session.realm, roles: session.roles, sid: session.id })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(session.subject)
    .setIssuer(String(settings.tokens?.issuer ?? ''))
    .setAudience(String(settings.tokens?.audience ?? ''))
    .setIssuedAt()
    .setExpirationTime(Math.floor(now() / 1000) + accessTtl)
    .sign(keyOf(settings));
  return { accessToken, refreshToken, tokenType: 'Bearer', expiresIn: accessTtl, sessionId: session.id };
}

/** A new session for a verified caller, and the tokens that name it. */
export const issue: Handler = async ({ in: input, ctx }) => {
  const env = ctx.env as Env;
  const attributes = judged((input.attributes ?? {}) as Record<string, unknown>, env);
  const session: SessionRecord = {
    id: randomBytes(16).toString('base64url'),
    subject: String(input.subject),
    realm: String(input.realm),
    roles: ((input.roles as string[]) ?? []).map(String),
    createdAt: iso(now()),
    attributes,
  };
  return issueTokens(env, session);
};

/** A fresh pair against a refresh token, which is spent the moment it is presented, good or expired. */
export const refresh: Handler = async ({ in: input, ctx }) => {
  const env = ctx.env as Env;
  const store = storeOf(env);
  const hash = sha(String(input.refreshToken));
  const session = store
    .list<SessionRecord>('sessions')
    .find(record => record.refreshHash && same(record.refreshHash, hash));
  if (!session) return { refreshed: false };
  if (!session.refreshExpiresAt || Date.parse(session.refreshExpiresAt) < now()) {
    store.delete('sessions', session.id);
    return { refreshed: false };
  }
  return { refreshed: true, tokens: await issueTokens(env, session) };
};

/** The session by that id; it throws when there is none. */
function sessionOf(env: Env, id: unknown): SessionRecord {
  const session = storeOf(env).get<SessionRecord>('sessions', String(id));
  if (!session) throw new Error(`no session '${String(id)}'`);
  return session;
}

export const sessionGet: Handler = async ({ in: input, ctx }) => sessionOf(ctx.env as Env, input.session).attributes;

export const sessionSet: Handler = async ({ in: input, ctx }) => {
  const env = ctx.env as Env;
  const session = sessionOf(env, input.session);
  const values = input.values;
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('values: expected an object');
  session.attributes = judged({ ...session.attributes, ...(values as Record<string, unknown>) }, env);
  storeOf(env).put('sessions', session.id, session);
  return session.attributes;
};

export const sessionRemove: Handler = async ({ in: input, ctx }) => {
  const env = ctx.env as Env;
  const session = sessionOf(env, input.session);
  const keys = Array.isArray(input.keys) ? input.keys.map(String) : [];
  const rest = { ...session.attributes };
  for (const key of keys) delete rest[key];
  session.attributes = judged(rest, env);
  storeOf(env).put('sessions', session.id, session);
  return session.attributes;
};

export const sessionEnd: Handler = async ({ in: input, ctx }) => {
  const store = storeOf(ctx.env as Env);
  const had = Boolean(store.get('sessions', String(input.session)));
  store.delete('sessions', String(input.session));
  return { ended: had };
};
