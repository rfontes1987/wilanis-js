/** @cli: triggers fired by `wilanis run <trigger>`. The context hands the parsed flags and positional args. */
import { fileURLToPath } from 'node:url';
import type { PluginModule, TriggerRuntime } from '@wilanis/core';

const runtime: TriggerRuntime = {
  async start(triggers, _fire, { log }) { if (triggers.length) log(`cli: ${triggers.length} trigger(s) -- fire with wilanis run <trigger path>`); return async () => {}; },
  encode: (_t, r) => r.output,
};
export const cli: PluginModule = { root: '@cli', docs: fileURLToPath(new URL('../../docs/cli', import.meta.url)), handlers: {}, triggers: { '@cli/cli.trigger-kind.json': runtime } };
