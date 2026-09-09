/**
 * How a report becomes an answer on the wire: the status the trigger's response block chooses, the cookies it takes
 * from the output, and the shape a refusal or a fault is reported in.
 */
import type { TriggerDoc } from '@wilanis/core';
import { type Report, readPath, refusalOf } from '@wilanis/engine';

/** A cookie the answer sets: the field of the answer it takes (`from`), or `clear` for one to drop; `omit` keeps the field out of the body. */
export interface CookieOut {
  from?: string;
  clear?: boolean;
  omit?: boolean;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'strict' | 'lax' | 'none';
  maxAge?: number;
  path?: string;
}

/** What an http trigger declares. */
export interface HttpSettings {
  route: string;
  method: string;
  consumes?: string;
  produces?: string;
  body?: string;
  response?: {
    status?: { from?: string; map?: Record<string, number>; default?: number };
    refusals?: Record<string, number>;
    cookies?: Record<string, CookieOut>;
  };
}

/** The request's cookies, by name, from the one header they travel in. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const split = part.indexOf('=');
    if (split < 0) continue;
    const name = part.slice(0, split).trim();
    if (!name) continue;
    const value = part.slice(split + 1).trim();
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

/** One Set-Cookie line. */
function setCookie(name: string, value: string, cookie: CookieOut): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${cookie.path ?? '/'}`];
  if (cookie.clear) parts.push('Max-Age=0');
  else if (cookie.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(cookie.maxAge)}`);
  if (cookie.httpOnly !== false) parts.push('HttpOnly');
  if (cookie.secure) parts.push('Secure');
  parts.push(`SameSite=${(cookie.sameSite ?? 'lax').replace(/^./, char => char.toUpperCase())}`);
  return parts.join('; ');
}

/** The body with the field a cookie took left out, when the route says to omit it. */
function withoutField(body: unknown, cookie: CookieOut): unknown {
  const single = cookie.from && cookie.from.split('.').length === 1;
  if (!cookie.omit || !single || !body || typeof body !== 'object' || Array.isArray(body)) return body;
  const { [cookie.from as string]: _taken, ...rest } = body as Record<string, unknown>;
  return rest;
}

/**
 * The cookies an answer sets, and the body once the fields those cookies took are omitted where the route says so.
 * A cookie whose field the answer lacks is not set: the route said where the value comes from, and there is none.
 */
export function cookiesOf(settings: HttpSettings, output: unknown): { headers: string[]; body: unknown } {
  const table = settings.response?.cookies;
  if (!table) return { headers: [], body: output };
  const headers: string[] = [];
  let body = output;
  for (const [name, cookie] of Object.entries(table)) {
    if (cookie.clear) {
      headers.push(setCookie(name, '', cookie));
      continue;
    }
    if (!cookie.from) continue;
    const value = readPath(output, cookie.from.split('.'));
    if (value === undefined || value === null) continue;
    headers.push(setCookie(name, String(value), cookie));
    body = withoutField(body, cookie);
  }
  return { headers, body };
}

/** A route's pattern and the names of the parts it captures. */
export function compileRoute(route: string): { re: RegExp; keys: string[] } {
  const keys: string[] = [];
  const re = new RegExp(
    `^${route
      .replace(/\{([A-Za-z0-9_]+)\}/g, (_, key: string) => {
        keys.push(key);
        return '([^/]+)';
      })
      .replace(/\//g, '\\/')}\\/?$`,
  );
  return { re, keys };
}

/** The status a done report is answered with. */
function statusFor(settings: HttpSettings, report: Report): number {
  if (report.status !== 'done') return 500;
  const status = settings.response?.status;
  if (!status) return 200;
  if (status.from) {
    const hit = status.map?.[String(readPath(report.output, status.from.split('.')))];
    if (hit !== undefined) return hit;
  }
  return status.default ?? 200;
}

/**
 * A refusal -- the graph ending on purpose, a policy denying, the guard refusing a credential -- answered as
 * `{ reason, message }` plus whatever detail it carries (a challenge's id and how to answer it), with the status the
 * trigger maps that reason to. T005 has already made sure every reachable reason is mapped, so a reason without one can
 * only mean the tree changed under a running server, and is answered as a fault.
 */
function encodeRefusal(settings: HttpSettings, refused: { reason: string; message: string; detail?: unknown }) {
  const status = settings.response?.refusals?.[refused.reason];
  if (status !== undefined)
    return {
      status,
      body: { reason: refused.reason, message: refused.message, ...((refused.detail as object) ?? {}) },
    };
  return {
    status: 500,
    body: {
      error: `refused with reason '${refused.reason}', which response.refusals does not map: ${refused.message}`,
    },
  };
}

/** What went wrong, for a report that did not finish: a node that broke, or a run that could not start. */
function encodeTrouble(report: Report) {
  if (report.status === 'failed') {
    const failed = Object.entries(report.nodes).find(([, node]) => node.status === 'failed');
    return { status: 500, body: { error: failed ? `${failed[0]}: ${failed[1].error}` : 'failed' } };
  }
  return { status: 500, body: { error: `blocked: needs ${report.needs?.join(', ')}` } };
}

/**
 * How a report is answered on the wire. An answer takes the status the response block chooses from it, and sets
 * the cookies response.cookies takes from it. A fault (a node that broke) and a blocked run are 500 with what
 * went wrong.
 */
export function encode(trigger: TriggerDoc, report: Report): { status: number; body: unknown; cookies?: string[] } {
  const settings = trigger.settings as unknown as HttpSettings;
  const refused = refusalOf(report);
  if (refused) return encodeRefusal(settings, refused);
  if (report.status === 'failed' || report.status === 'blocked') return encodeTrouble(report);
  const { headers, body } = cookiesOf(settings, report.output);
  return { status: statusFor(settings, report), body, ...(headers.length ? { cookies: headers } : {}) };
}
