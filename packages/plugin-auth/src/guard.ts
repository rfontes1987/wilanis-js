/**
 * The guard: before any policy of a trigger runs, it verifies the credentials that trigger's attachments give it and
 * hands request.principal, request.session and request.challenge. What a caller may do is decided by the policies.
 */
import { randomInt } from 'node:crypto';
import { type Guard, type GuardArgs, splitPath, WHOLE_TEMPLATE } from '@wilanis/core';
import type { Handler } from '@wilanis/engine';
import { type JWTPayload, jwtVerify } from 'jose';
import {
  type ChallengeRecord,
  type Env,
  iso,
  keyOf,
  now,
  type SessionRecord,
  type Settings,
  type Store,
  same,
  settingsOf,
  sha,
  storeOf,
} from './settings.js';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** An id a caller can read back over the telephone. */
const challengeId = () => {
  const pick = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `${pick()}-${pick()}`;
};

/** A code for an open challenge, which the caller answers with. */
export const challengeIssue: Handler = async ({ in: input, ctx }) => {
  const env = ctx.env as Env;
  const store = storeOf(env);
  const settings = settingsOf(env);
  const record = store.get<ChallengeRecord>('challenges', String(input.id));
  if (!record || Date.parse(record.expiresAt) < now()) return { issued: false };
  const digits = settings.challenge?.digits ?? 6;
  const code = Array.from({ length: digits }, () => String(randomInt(10))).join('');
  record.codeHash = sha(code);
  record.codeExpiresAt = record.expiresAt;
  record.attempts = 0;
  store.put('challenges', record.id, record);
  return { issued: true, id: record.id, code, expiresAt: record.expiresAt };
};

const refuse = (message: string, detail?: Record<string, unknown>) => ({
  refuse: { reason: 'invalid_credential', message, ...(detail ? { detail } : {}) },
});

/** Where a caller presents a value, said in the kind's own terms from the read the trigger wrote: a flag, a header, a query key, a cookie. */
function place(read: unknown, value: string): string {
  const whole = typeof read === 'string' ? WHOLE_TEMPLATE.exec(read) : null;
  if (!whole) return `${JSON.stringify(read)} = ${value}`;
  const segments = splitPath(whole[1]);
  switch (segments[1]) {
    case 'flags':
      return `--${segments[2]}=${value}`;
    case 'headers':
      return `header ${segments[2]}: ${value}`;
    case 'query':
      return `?${segments[2]}=${value}`;
    case 'cookies':
      return `cookie ${segments[2]}=${value}`;
    default:
      return `${whole[1]} = ${value}`;
  }
}

/** What a verified token says about its caller, or a refusal; a token that is there and does not verify is refused. */
async function fromToken(token: string, settings: Settings, store: Store) {
  let claims: JWTPayload;
  try {
    claims = (
      await jwtVerify(token.replace(/^Bearer\s+/i, ''), keyOf(settings), {
        issuer: settings.tokens?.issuer,
        audience: settings.tokens?.audience,
      })
    ).payload;
  } catch (error) {
    return refuse(`the token does not verify: ${(error as Error).message}`);
  }
  const session = typeof claims.sid === 'string' ? store.get<SessionRecord>('sessions', claims.sid) : undefined;
  if (!session) return refuse('the token belongs to a session that has ended');
  return {
    context: {
      principal: {
        subject: String(claims.sub ?? session.subject),
        realm: String(claims.realm ?? session.realm),
        roles: Array.isArray(claims.roles) ? claims.roles.map(String) : [],
        claims,
      },
      session: { id: session.id, attributes: session.attributes },
    },
  };
}

/** A challenge open for this caller, with a code issued and an answer to match against it. */
type Answerable = ChallengeRecord & { codeHash: string };

/** The challenge this answer can be matched against, or why it cannot be. */
function answerable(
  record: ChallengeRecord | undefined,
  id: string,
  answer: { id?: unknown; code?: unknown },
  subject: string | undefined,
): { open: Answerable } | { why: string } {
  if (!record || Date.parse(record.expiresAt) < now()) return { why: `challenge '${id}' is unknown or has expired` };
  if (record.subject && record.subject !== subject)
    return { why: `challenge '${record.id}' was opened for another caller` };
  if (!record.codeHash) return { why: `challenge '${record.id}' has no code yet -- obtain one first` };
  if (answer.code === undefined || answer.code === '') return { why: `challenge '${record.id}' needs its code` };
  return { open: record as Answerable };
}

/** A wrong code costs an attempt, and the last one spends the challenge. */
function spendAttempt(record: ChallengeRecord, allowed: number, store: Store) {
  record.attempts++;
  store.put('challenges', record.id, record);
  if (record.attempts >= allowed) store.delete('challenges', record.id);
}

/** A challenge answer: the id names an open challenge, the code must match what was issued, within its attempts. */
function fromChallenge(
  answer: { id?: unknown; code?: unknown },
  subject: string | undefined,
  settings: Settings,
  store: Store,
) {
  const id = String(answer.id);
  const found = answerable(store.get<ChallengeRecord>('challenges', id), id, answer, subject);
  if ('why' in found) return refuse(found.why);
  const record = found.open;
  const allowed = settings.challenge?.attempts ?? 5;
  if (record.attempts >= allowed || !same(sha(String(answer.code)), record.codeHash)) {
    spendAttempt(record, allowed, store);
    return refuse(`the code for challenge '${record.id}' is wrong`);
  }
  return { context: { challenge: { id: record.id, method: record.method, verified: true } } };
}

/** Whether what a step answered is a refusal rather than context. */
const refused = (answer: unknown): answer is { refuse: Record<string, unknown> } =>
  Boolean(answer && typeof answer === 'object' && 'refuse' in answer);

export const guard: Guard = {
  async identify({ credentials, settings, env }: GuardArgs) {
    const declared = settings as Settings;
    const store = storeOf(env as Env);
    const context: Record<string, unknown> = {};
    if (credentials.token !== undefined) {
      const answer = await fromToken(String(credentials.token), declared, store);
      if (refused(answer)) return answer;
      Object.assign(context, answer.context);
    }
    const answer = credentials.challenge as { id?: unknown; code?: unknown } | undefined;
    if (answer && answer.id !== undefined && answer.id !== '') {
      const subject = (context.principal as { subject?: string } | undefined)?.subject;
      const settled = fromChallenge(answer, subject, declared, store);
      if (refused(settled)) return settled;
      Object.assign(context, settled.context);
    }
    return { context };
  },

  async challenge({ request, reads, settings, env, trigger, policy, message, method }) {
    const declared = settings as Settings;
    const store = storeOf(env as Env);
    const id = challengeId();
    const expiresAt = iso(now() + (declared.challenge?.ttl ?? 300) * 1000);
    const subject = (request.principal as { subject?: string } | undefined)?.subject;
    const record: ChallengeRecord = {
      id,
      method: method ?? 'otp',
      policy,
      trigger: trigger.fire.run,
      ...(subject ? { subject } : {}),
      createdAt: iso(now()),
      expiresAt,
      attempts: 0,
    };
    store.put('challenges', id, record);
    const obtain = (
      declared.challenge?.methods?.[record.method]?.obtain ?? 'obtain a code for challenge {id}'
    ).replaceAll('{id}', id);
    // how to answer: where this trigger reads a challenge's id and code, in the kind's own words
    const where = reads.challenge as { id?: unknown; code?: unknown } | undefined;
    const answerWith = where
      ? `${place(where.id, id)} ${place(where.code, '<code>')}`
      : 'the challenge id and code where a policy of this trigger reads them';
    return {
      message,
      detail: {
        challenge: { id, method: record.method, expiresAt },
        how: `${obtain}; then repeat this call with ${answerWith}`,
      },
    };
  },

  async settle({ request, env, report }) {
    // a challenge is single-use: answered and acted on, it is spent
    const answered = request.challenge as { id?: string; verified?: boolean } | undefined;
    if (answered?.verified && answered.id && report.status === 'done')
      storeOf(env as Env).delete('challenges', answered.id);
  },
};
