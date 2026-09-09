/** @cli: triggers fired by `wilanis run <trigger>`. The context hands the parsed flags and positional args. */
import { fileURLToPath } from 'node:url';
import type { PluginModule, TriggerRuntime } from '@wilanis/core';
import { refusalOf } from '@wilanis/engine';

const runtime: TriggerRuntime = {
  async start(triggers, _fire, { log }) {
    if (triggers.length) log(`cli: ${triggers.length} trigger(s) -- fire with wilanis run <trigger path>`);
    return async () => {};
  },
  // an answer prints as it is; a refusal prints as { reason, message } plus whatever it carries (a challenge's id and how to answer it), and `wilanis run` exits 1
  encode: (_t, r) => {
    const refused = refusalOf(r);
    return refused ? { reason: refused.reason, message: refused.message, ...(refused.detail ?? {}) } : r.output;
  },
};
export const cli: PluginModule = {
  root: '@cli',
  docs: fileURLToPath(new URL('../../docs/cli', import.meta.url)),
  handlers: {},
  triggers: { '@cli/cli.trigger-kind.json': runtime },
};
