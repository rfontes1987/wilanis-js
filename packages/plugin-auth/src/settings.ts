/**
 * What every part of the @auth plugin reads: the settings a project declares, the records the store keeps, and the
 * small helpers over them -- the store's location, the signing key, the clock, and the session shape's judgement.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { conforms, type Type } from '@wilanis/core';
import { type Store, storeAt } from './store.js';

export type { Store };

export const ROOT = '@auth';
/** A document of this plugin, by its path under the root. */
export const doc = (file: string) => `${ROOT}/${file}`;

export interface Settings {
  tokens?: { issuer?: string; audience?: string; secret?: string; accessTtl?: number; refreshTtl?: number };
  store?: { dir?: string };
  session?: string;
  challenge?: {
    ttl?: number;
    attempts?: number;
    digits?: number;
    methods?: Record<string, { description?: string; obtain?: string }>;
  };
}

export interface SessionRecord {
  id: string;
  subject: string;
  realm: string;
  roles: string[];
  createdAt: string;
  refreshHash?: string;
  refreshExpiresAt?: string;
  attributes: Record<string, unknown>;
}

export interface ChallengeRecord {
  id: string;
  method: string;
  policy: string;
  trigger: string;
  subject?: string;
  createdAt: string;
  expiresAt: string;
  attempts: number;
  codeHash?: string;
  codeExpiresAt?: string;
}

export type Env = Record<string, unknown> & {
  plugins?: Record<string, Settings>;
  root?: string;
  connections?: Record<string, { kind: string; settings: Record<string, unknown> }>;
  canon?: (ref: string) => string;
  resolveType?: (ref: string) => Type;
};

/** This plugin's settings, as the project declared them. */
export const settingsOf = (env: Env): Settings => env.plugins?.[ROOT] ?? {};

/** The store this tree keeps its sessions and challenges in. */
export function storeOf(env: Env): Store {
  const dir = settingsOf(env).store?.dir ?? '.wilanis/auth';
  return storeAt(isAbsolute(dir) ? dir : join(env.root ?? process.cwd(), dir));
}

export const now = () => Date.now();
export const iso = (ms: number) => new Date(ms).toISOString();
export const sha = (text: string) => createHash('sha256').update(text).digest('base64url');

/** Whether two strings are equal, without saying where they first differ. */
export const same = (left: string, right: string) => {
  const one = Buffer.from(left);
  const other = Buffer.from(right);
  return one.length === other.length && timingSafeEqual(one, other);
};

/** The key this tree signs and verifies its own tokens with. */
export const keyOf = (settings: Settings): Uint8Array => {
  const secret = settings.tokens?.secret;
  if (!secret)
    throw new Error(
      `${ROOT}: settings.tokens.secret is empty -- declare the secret under project.json → secrets and set its environment variable`,
    );
  return new TextEncoder().encode(secret);
};

/** The session shape the project named, resolved; undefined when attributes are untyped. */
export const sessionType = (env: Env): Type | undefined => {
  const ref = settingsOf(env).session;
  return ref && env.resolveType ? env.resolveType(ref) : undefined;
};

/** The attributes, once the session shape has accepted them; it throws when they do not fit. */
export function judged(attributes: Record<string, unknown>, env: Env): Record<string, unknown> {
  const type = sessionType(env);
  if (type) {
    const bad = conforms(attributes, type);
    if (bad) throw new Error(`session attributes are not ${settingsOf(env).session}: ${bad}`);
  }
  return attributes;
}
