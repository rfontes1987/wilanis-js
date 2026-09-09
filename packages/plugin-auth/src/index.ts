/**
 * @wilanis/plugin-auth, the @auth plugin: the one plugin that identifies callers. It verifies credentials against
 * directories (identity.port.json), issues and verifies our own tokens (token.port.json), keeps sessions with typed
 * attributes (session.port.json) and one-time challenges (challenge.port.json), and guards every trigger that names
 * policy: before any policy runs it verifies the credentials the trigger's policy attachments give it, and hands
 * request.principal, request.session and request.challenge. What a caller may do is never decided
 * here; the policies' graphs do that.
 */
import { fileURLToPath } from 'node:url';
import type { PluginModule } from '@wilanis/core';
import { verify } from './directories.js';
import { challengeIssue, guard } from './guard.js';
import { check } from './rules.js';
import { doc } from './settings.js';
import { issue, refresh, sessionEnd, sessionGet, sessionRemove, sessionSet } from './tokens.js';

export { hashPassword } from './directories.js';

const DOCS = fileURLToPath(new URL('../docs', import.meta.url));

export const auth: PluginModule = {
  root: '@auth',
  docs: DOCS,
  handlers: {
    [`${doc('identity.port.json')}#verify`]: verify,
    [`${doc('token.port.json')}#issue`]: issue,
    [`${doc('token.port.json')}#refresh`]: refresh,
    [`${doc('session.port.json')}#get`]: sessionGet,
    [`${doc('session.port.json')}#set`]: sessionSet,
    [`${doc('session.port.json')}#remove`]: sessionRemove,
    [`${doc('session.port.json')}#end`]: sessionEnd,
    [`${doc('challenge.port.json')}#issue`]: challengeIssue,
  },
  guard,
  check,
};

export default auth;
