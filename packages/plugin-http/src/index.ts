/**
 * @wilanis/plugin-http, the @http plugin: outbound requests (http.port.json#request), http connections, http triggers, body codecs.
 * Which codec handles which content type is the project's explicit table in this plugin's settings.
 */
import { fileURLToPath } from 'node:url';
import type { PluginModule, TriggerRuntime } from '@wilanis/core';
import { encode } from './answer.js';

export { encode } from './answer.js';

import { doc, ROOT } from './paths.js';
import { CODECS, request } from './request.js';
import { check } from './rules.js';
import { listen } from './serve.js';

/** The documents this plugin ships, as files: docs/ next to dist/ in the package. */
const DOCS = fileURLToPath(new URL('../docs', import.meta.url));

/** The http trigger kind starts nothing: a project's startup list opens the server by naming server.port.json#listen. */
const runtime: TriggerRuntime = {
  encode: (trigger, report) => encode(trigger, report),
  async start() {
    return async () => {};
  },
};

export const http: PluginModule = {
  root: ROOT,
  docs: DOCS,
  handlers: {
    [`${doc('http.port.json')}#request`]: request as unknown as PluginModule['handlers'][string],
    [`${doc('server.port.json')}#listen`]: listen,
  },
  triggers: { [doc('http.trigger-kind.json')]: runtime },
  codecs: CODECS,
  check,
};

export default http;
