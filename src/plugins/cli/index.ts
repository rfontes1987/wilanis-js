/** @cli: triggers fired by `wilanis run <trigger>`. The context hands the parsed flags and positional args. */
import { schemaRef, type AnyDoc, type PluginDoc, type TriggerKindDoc } from '../../model.js';
import type { PluginModule, TriggerRuntime } from '../plugin.js';

export const cliTriggerKind: TriggerKindDoc = {
  $schema: schemaRef('trigger-kind'),
  description: 'Fired from the command line: wilanis run <trigger path> [--flag=value ...] [args...]. The context hands flags (as strings), args and cwd; the trigger\'s input mapping picks what the graph gets. The answer is printed as JSON.',
  settings: { fields: { command: { type: 'string', required: false, description: 'a memorable alias for the trigger' } } },
  context: { fields: { flags: { type: { fields: {}, open: 'string' } }, args: { type: 'string[]' }, cwd: { type: 'string' } } },
};
export const manifest: PluginDoc = { $schema: schemaRef('plugin'), description: 'Command-line triggers.', grants: { triggerKinds: ['@cli/cli.trigger-kind.json'] } };

const runtime: TriggerRuntime = {
  async start(triggers, _fire, { log }) { if (triggers.length) log(`cli: ${triggers.length} trigger(s) -- fire with wilanis run <trigger path>`); return async () => {}; },
  encode: (_t, r) => r.output,
};
export const cli: PluginModule = { root: '@cli', docs: { '@cli/plugin.json': manifest, '@cli/cli.trigger-kind.json': cliTriggerKind } as Record<string, AnyDoc>, handlers: {}, triggers: { '@cli/cli.trigger-kind.json': runtime } };
