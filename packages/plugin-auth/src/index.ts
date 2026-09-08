/**
 * @wilanis/plugin-auth, the @auth plugin: the one plugin that identifies callers. It verifies credentials against
 * directories (identity.port.json), issues and verifies our own tokens (token.port.json), keeps sessions with typed
 * attributes (session.port.json) and one-time challenges (challenge.port.json), and guards every trigger that names
 * policy: before any policy runs it verifies the credentials the trigger's policy attachments give it, and hands
 * request.principal, request.session and request.challenge. What a caller may do is never decided
 * here; the policies' graphs do that.
 */
import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTPayload } from 'jose';
import { conforms, policyPath, splitPath, WHOLE_TEMPLATE, type Guard, type GuardArgs, type PluginCheckContext, type PluginModule, type PolicyDoc, type Type } from '@wilanis/core';
import { isRun, isMap } from '@wilanis/core';
import type { Handler } from '@wilanis/engine';
import { storeAt, type Store } from './store.js';

const ROOT = '@auth';
const P = (f: string) => `${ROOT}/${f}`;
const DOCS = fileURLToPath(new URL('../docs', import.meta.url));

// ---- settings and records --------------------------------------------------------------------------------

interface Settings {
  tokens?: { issuer?: string; audience?: string; secret?: string; accessTtl?: number; refreshTtl?: number };
  store?: { dir?: string };
  session?: string;
  challenge?: { ttl?: number; attempts?: number; digits?: number; methods?: Record<string, { description?: string; obtain?: string }> };
}
interface SessionRecord { id: string; subject: string; realm: string; roles: string[]; createdAt: string; refreshHash?: string; refreshExpiresAt?: string; attributes: Record<string, unknown> }
interface ChallengeRecord { id: string; method: string; policy: string; trigger: string; subject?: string; createdAt: string; expiresAt: string; attempts: number; codeHash?: string; codeExpiresAt?: string }
type Env = Record<string, unknown> & { plugins?: Record<string, Settings>; root?: string; connections?: Record<string, { kind: string; settings: Record<string, unknown> }>; canon?: (r: string) => string; resolveType?: (r: string) => Type };

const settingsOf = (env: Env): Settings => env.plugins?.[ROOT] ?? {};
function storeOf(env: Env): Store {
  const dir = settingsOf(env).store?.dir ?? '.wilanis/auth';
  return storeAt(isAbsolute(dir) ? dir : join(env.root ?? process.cwd(), dir));
}
const now = () => Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const sha = (s: string) => createHash('sha256').update(s).digest('base64url');
const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const keyOf = (s: Settings): Uint8Array => {
  const secret = s.tokens?.secret;
  if (!secret) throw new Error(`${ROOT}: settings.tokens.secret is empty -- declare the secret under project.json → secrets and set its environment variable`);
  return new TextEncoder().encode(secret);
};
/** The session shape the project named, resolved; undefined when attributes are untyped. */
const sessionType = (env: Env): Type | undefined => { const ref = settingsOf(env).session; return ref && env.resolveType ? env.resolveType(ref) : undefined; };
function judged(attributes: Record<string, unknown>, env: Env): Record<string, unknown> {
  const t = sessionType(env);
  if (t) { const bad = conforms(attributes, t); if (bad) throw new Error(`session attributes are not ${settingsOf(env).session}: ${bad}`); }
  return attributes;
}

// ---- tokens --------------------------------------------------------------------------------------------

async function issueTokens(env: Env, session: SessionRecord): Promise<Record<string, unknown>> {
  const s = settingsOf(env), store = storeOf(env);
  const accessTtl = s.tokens?.accessTtl ?? 900, refreshTtl = s.tokens?.refreshTtl ?? 604800;
  const refreshToken = randomBytes(32).toString('base64url');
  session.refreshHash = sha(refreshToken);
  session.refreshExpiresAt = iso(now() + refreshTtl * 1000);
  store.put('sessions', session.id, session);
  const accessToken = await new SignJWT({ realm: session.realm, roles: session.roles, sid: session.id })
    .setProtectedHeader({ alg: 'HS256' }).setSubject(session.subject).setIssuer(String(s.tokens?.issuer ?? '')).setAudience(String(s.tokens?.audience ?? ''))
    .setIssuedAt().setExpirationTime(Math.floor(now() / 1000) + accessTtl).sign(keyOf(s));
  return { accessToken, refreshToken, tokenType: 'Bearer', expiresIn: accessTtl, sessionId: session.id };
}

const issue: Handler = async ({ in: i, ctx }) => {
  const env = ctx.env as Env;
  const attributes = judged((i.attributes ?? {}) as Record<string, unknown>, env);
  const session: SessionRecord = { id: randomBytes(16).toString('base64url'), subject: String(i.subject), realm: String(i.realm), roles: (i.roles as string[] ?? []).map(String), createdAt: iso(now()), attributes };
  return issueTokens(env, session);
};

const refresh: Handler = async ({ in: i, ctx }) => {
  const env = ctx.env as Env, store = storeOf(env);
  const hash = sha(String(i.refreshToken));
  const session = store.list<SessionRecord>('sessions').find(s => s.refreshHash && same(s.refreshHash, hash));
  if (!session) return { refreshed: false };
  // a refresh token is spent the moment it is presented, good or expired
  if (!session.refreshExpiresAt || Date.parse(session.refreshExpiresAt) < now()) { store.delete('sessions', session.id); return { refreshed: false }; }
  return { refreshed: true, tokens: await issueTokens(env, session) };
};

// ---- sessions ------------------------------------------------------------------------------------------

function sessionOf(env: Env, id: unknown): SessionRecord {
  const s = storeOf(env).get<SessionRecord>('sessions', String(id));
  if (!s) throw new Error(`no session '${String(id)}'`);
  return s;
}
const sessionGet: Handler = async ({ in: i, ctx }) => sessionOf(ctx.env as Env, i.session).attributes;
const sessionSet: Handler = async ({ in: i, ctx }) => {
  const env = ctx.env as Env, s = sessionOf(env, i.session);
  const values = i.values;
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('values: expected an object');
  s.attributes = judged({ ...s.attributes, ...(values as Record<string, unknown>) }, env);
  storeOf(env).put('sessions', s.id, s);
  return s.attributes;
};
const sessionRemove: Handler = async ({ in: i, ctx }) => {
  const env = ctx.env as Env, s = sessionOf(env, i.session);
  const keys = Array.isArray(i.keys) ? i.keys.map(String) : [];
  const rest = { ...s.attributes }; for (const k of keys) delete rest[k];
  s.attributes = judged(rest, env);
  storeOf(env).put('sessions', s.id, s);
  return s.attributes;
};
const sessionEnd: Handler = async ({ in: i, ctx }) => {
  const store = storeOf(ctx.env as Env);
  const had = Boolean(store.get('sessions', String(i.session)));
  store.delete('sessions', String(i.session));
  return { ended: had };
};

// ---- challenges ----------------------------------------------------------------------------------------

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const challengeId = () => { const pick = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join(''); return `${pick()}-${pick()}`; };

const challengeIssue: Handler = async ({ in: i, ctx }) => {
  const env = ctx.env as Env, store = storeOf(env), s = settingsOf(env);
  const c = store.get<ChallengeRecord>('challenges', String(i.id));
  if (!c || Date.parse(c.expiresAt) < now()) return { issued: false };
  const digits = s.challenge?.digits ?? 6;
  const code = Array.from({ length: digits }, () => String(randomInt(10))).join('');
  c.codeHash = sha(code); c.codeExpiresAt = c.expiresAt; c.attempts = 0;
  store.put('challenges', c.id, c);
  return { issued: true, id: c.id, code, expiresAt: c.expiresAt };
};

// ---- directories ---------------------------------------------------------------------------------------

type Account = { username: string; password?: string; passwordHash?: string; name: string; groups: string[] };

/** scrypt:<salt>:<hash>, both base64url. */
export function hashPassword(password: string, salt = randomBytes(16)): string {
  return `scrypt:${salt.toString('base64url')}:${scryptSync(password, salt, 32).toString('base64url')}`;
}
function passwordMatches(a: Account, password: string): boolean {
  if (a.passwordHash) {
    const [, salt, hash] = a.passwordHash.split(':');
    if (!salt || !hash) return false;
    return same(scryptSync(password, Buffer.from(salt, 'base64url'), 32).toString('base64url'), hash);
  }
  return typeof a.password === 'string' && same(a.password, password);
}

const verify: Handler = async ({ in: i, ctx }) => {
  const env = ctx.env as Env;
  const canon = env.canon ?? ((r: string) => r);
  const conn = env.connections?.[canon(String(i.connection))];
  if (!conn) throw new Error(`unknown connection '${i.connection}'`);
  const username = String(i.username), password = String(i.password);
  if (conn.kind === P('directory.connection-kind.json')) {
    const users = (conn.settings.users ?? []) as Account[];
    const a = users.find(u => u.username === username);
    if (!a || !passwordMatches(a, password)) return { status: 'rejected' };
    return { status: 'verified', identity: { subject: a.username, name: a.name, groups: a.groups ?? [] } };
  }
  if (conn.kind === P('oidc.connection-kind.json')) return oidcVerify(conn.settings as { issuer: string; clientId: string; clientSecret: string; scope?: string; groupsClaim?: string; timeoutMs?: number }, username, password);
  throw new Error(`connection '${i.connection}' is ${conn.kind}, not a directory`);
};

/** The password grant against an OIDC issuer, and the identity token it answers verified against the issuer's keys. */
async function oidcVerify(s: { issuer: string; clientId: string; clientSecret: string; scope?: string; groupsClaim?: string; timeoutMs?: number }, username: string, password: string): Promise<unknown> {
  const issuer = s.issuer.replace(/\/$/, '');
  const withTimeout = async (url: string, init?: RequestInit) => {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), s.timeoutMs ?? 10000);
    try { return await fetch(url, { ...init, signal: ac.signal }); } finally { clearTimeout(t); }
  };
  let disco: { token_endpoint: string; jwks_uri: string };
  try {
    const r = await withTimeout(`${issuer}/.well-known/openid-configuration`);
    if (!r.ok) return { status: 'unavailable' };
    disco = await r.json() as typeof disco;
  } catch { return { status: 'unavailable' }; }
  const form = new URLSearchParams({ grant_type: 'password', username, password, scope: s.scope ?? 'openid profile', client_id: s.clientId, client_secret: s.clientSecret });
  let res: Response;
  try { res = await withTimeout(disco.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() }); }
  catch { return { status: 'unavailable' }; }
  if (res.status === 400 || res.status === 401 || res.status === 403) return { status: 'rejected' };
  if (!res.ok) return { status: 'unavailable' };
  const body = await res.json() as { id_token?: string };
  if (!body.id_token) return { status: 'unavailable' };
  let claims: JWTPayload;
  try { claims = (await jwtVerify(body.id_token, createRemoteJWKSet(new URL(disco.jwks_uri)), { issuer: s.issuer, audience: s.clientId })).payload; }
  catch { return { status: 'rejected' }; }
  const groups = claims[s.groupsClaim ?? 'groups'];
  return { status: 'verified', identity: { subject: String(claims.sub ?? username), name: String(claims.name ?? claims.preferred_username ?? claims.email ?? claims.sub ?? username), groups: Array.isArray(groups) ? groups.map(String) : [] } };
}

// ---- the guard -----------------------------------------------------------------------------------------

const refuse = (message: string, detail?: Record<string, unknown>) => ({ refuse: { reason: 'invalid_credential', message, ...(detail ? { detail } : {}) } });

/** Where a caller presents a value, said in the kind's own terms from the read the trigger wrote: a flag, a header, a query key, a cookie. */
function place(read: unknown, value: string): string {
  const whole = typeof read === 'string' ? WHOLE_TEMPLATE.exec(read) : null;
  if (!whole) return `${JSON.stringify(read)} = ${value}`;
  const segs = splitPath(whole[1]);
  switch (segs[1]) {
    case 'flags': return `--${segs[2]}=${value}`;
    case 'headers': return `header ${segs[2]}: ${value}`;
    case 'query': return `?${segs[2]}=${value}`;
    case 'cookies': return `cookie ${segs[2]}=${value}`;
    default: return `${whole[1]} = ${value}`;
  }
}

const guard: Guard = {
  async identify({ credentials, settings, env }: GuardArgs) {
    const s = settings as Settings, store = storeOf(env as Env);
    const context: Record<string, unknown> = {};
    // a token that is there and does not verify is refused; none at all leaves the caller anonymous
    if (credentials.token !== undefined) {
      const token = String(credentials.token).replace(/^Bearer\s+/i, '');
      let claims: JWTPayload;
      try { claims = (await jwtVerify(token, keyOf(s), { issuer: s.tokens?.issuer, audience: s.tokens?.audience })).payload; }
      catch (e) { return refuse(`the token does not verify: ${(e as Error).message}`); }
      const session = typeof claims.sid === 'string' ? store.get<SessionRecord>('sessions', claims.sid) : undefined;
      if (!session) return refuse('the token belongs to a session that has ended');
      const roles = Array.isArray(claims.roles) ? claims.roles.map(String) : [];
      context.principal = { subject: String(claims.sub ?? session.subject), realm: String(claims.realm ?? session.realm), roles, claims };
      context.session = { id: session.id, attributes: session.attributes };
    }
    // a challenge answer: the id names an open challenge, the code must match what was issued, within its attempts
    const answer = credentials.challenge as { id?: unknown; code?: unknown } | undefined;
    if (answer && answer.id !== undefined && answer.id !== '') {
      const id = String(answer.id);
      const record = store.get<ChallengeRecord>('challenges', id);
      if (!record || Date.parse(record.expiresAt) < now()) return refuse(`challenge '${id}' is unknown or has expired`);
      const subject = (context.principal as { subject?: string } | undefined)?.subject;
      if (record.subject && record.subject !== subject) return refuse(`challenge '${record.id}' was opened for another caller`);
      if (!record.codeHash) return refuse(`challenge '${record.id}' has no code yet -- obtain one first`);
      if (answer.code === undefined || answer.code === '') return refuse(`challenge '${record.id}' needs its code`);
      if (record.attempts >= (s.challenge?.attempts ?? 5) || !same(sha(String(answer.code)), record.codeHash)) {
        record.attempts++; store.put('challenges', record.id, record);
        if (record.attempts >= (s.challenge?.attempts ?? 5)) store.delete('challenges', record.id);
        return refuse(`the code for challenge '${record.id}' is wrong`);
      }
      context.challenge = { id: record.id, method: record.method, verified: true };
    }
    return { context };
  },

  async challenge({ request, reads, settings, env, trigger, policy, message, method }) {
    const s = settings as Settings, store = storeOf(env as Env);
    const id = challengeId();
    const expiresAt = iso(now() + (s.challenge?.ttl ?? 300) * 1000);
    const subject = (request.principal as { subject?: string } | undefined)?.subject;
    const record: ChallengeRecord = { id, method: method ?? 'otp', policy, trigger: trigger.fire.run, ...(subject ? { subject } : {}), createdAt: iso(now()), expiresAt, attempts: 0 };
    store.put('challenges', id, record);
    const obtain = (s.challenge?.methods?.[record.method]?.obtain ?? 'obtain a code for challenge {id}').replaceAll('{id}', id);
    // how to answer: where this trigger reads a challenge's id and code, in the kind's own words
    const where = reads.challenge as { id?: unknown; code?: unknown } | undefined;
    const how = `${obtain}; then repeat this call with ${where ? `${place(where.id, id)} ${place(where.code, '<code>')}` : 'the challenge id and code where a policy of this trigger reads them'}`;
    return { message, detail: { challenge: { id, method: record.method, expiresAt }, how } };
  },

  async settle({ request, env, report }) {
    // a challenge is single-use: answered and acted on, it is spent
    const c = request.challenge as { id?: string; verified?: boolean } | undefined;
    if (c?.verified && c.id && report.status === 'done') storeOf(env as Env).delete('challenges', c.id);
  },
};

// ---- rules ---------------------------------------------------------------------------------------------

/**
 * The plugin's own rules. X101: settings.session names no shape. X102: a challenge outcome names a method the settings
 * do not declare, or gates a trigger no attachment of which gives a challenge answer, so it could never be met. X103: a
 * session write names another type than the session shape, or keys the shape does not declare.
 */
function check({ scope, settings, refuse }: PluginCheckContext) {
  const s = settings as Settings;
  const at = (k: string) => `plugins/${ROOT}/settings/${k}`;
  const shape = s.session ? scope.get('shape', s.session) : undefined;
  if (s.session && !shape) refuse('X101', '@project.json', `settings.session names '${s.session}', which is not a shape`, at('session'), 'wilanis ls shape');
  const methods = s.challenge?.methods ?? {};
  for (const p of scope.registry.all('policy')) for (const [reason, o] of Object.entries((p.doc as PolicyDoc).outcomes)) {
    if (o.effect === 'challenge' && o.method && !methods[o.method]) refuse('X102', p.path, `outcome '${reason}' challenges by method '${o.method}', which ${ROOT} settings.challenge.methods does not declare`, `outcomes/${reason}/method`, `declare it under project.json → plugins → ${ROOT} → settings.challenge.methods, with how a caller obtains a code`);
  }
  for (const t of scope.registry.all('trigger')) {
    const uses = t.doc.policies ?? [];
    const challenges = uses.some(u => Object.values(scope.get('policy', policyPath(u))?.doc.outcomes ?? {}).some(o => o.effect === 'challenge'));
    if (challenges && !uses.some(u => typeof u !== 'string' && u.in?.challenge !== undefined)) refuse('X102', t.path, `a policy of this trigger may challenge the caller, but no attachment gives the guard a challenge answer, so the challenge could never be met`, 'policies', 'give it: "in": { "challenge": { "id": "{{request.flags[\'challenge-id\']}}", "code": "{{request.flags.code}}" } }');
  }
  if (shape) {
    const fields = new Set(Object.keys(shape.doc.fields));
    const judge = (file: string, where: string, run: string, given: Record<string, unknown> | undefined) => {
      const op = run.split('#')[1];
      if (scope.canon(run.split('#')[0]) !== P('session.port.json') || !['get', 'set', 'remove'].includes(op)) return;
      const type = given?.type;
      if (typeof type === 'string' && scope.canon(type) !== shape.path) refuse('X103', file, `${op} names type '${type}', but the session shape is '${s.session}'`, `${where}/type`, `write "type": "${s.session}"`);
      const values = given?.values;
      if (op === 'set' && values && typeof values === 'object' && !Array.isArray(values)) for (const k of Object.keys(values)) if (!fields.has(k) && !shape.doc.open) refuse('X103', file, `set writes '${k}', which ${s.session} does not declare`, `${where}/values/${k}`, `declare the attribute in the session shape, or drop it`);
      const keys = given?.keys;
      if (op === 'remove' && Array.isArray(keys)) for (const k of keys) if (typeof k === 'string' && !fields.has(k) && !shape.doc.open) refuse('X103', file, `remove drops '${k}', which ${s.session} does not declare`, `${where}/keys`, 'name attributes of the session shape');
    };
    for (const g of scope.registry.all('graph')) for (const n of g.doc.nodes) if (isRun(n) || isMap(n)) judge(g.path, `nodes/${n.id}/in`, n.run, n.in);
    for (const b of scope.registry.all('binding')) for (const [name, op] of Object.entries(b.doc.operations)) if (op.run) judge(b.path, `operations/${name}/in`, op.run, op.in);
  }
}

export const auth: PluginModule = {
  root: ROOT,
  docs: DOCS,
  handlers: {
    [`${P('identity.port.json')}#verify`]: verify,
    [`${P('token.port.json')}#issue`]: issue,
    [`${P('token.port.json')}#refresh`]: refresh,
    [`${P('session.port.json')}#get`]: sessionGet,
    [`${P('session.port.json')}#set`]: sessionSet,
    [`${P('session.port.json')}#remove`]: sessionRemove,
    [`${P('session.port.json')}#end`]: sessionEnd,
    [`${P('challenge.port.json')}#issue`]: challengeIssue,
  },
  guard,
  check,
};

export default auth;
