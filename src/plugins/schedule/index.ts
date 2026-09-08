/** @schedule: cron-fired triggers. The context is one field, firedAt; the trigger's input mapping may read it. */
import { Cron } from 'croner';
import { schemaRef, type AnyDoc, type PluginDoc, type TriggerKindDoc } from '../../model.js';
import type { PluginModule, TriggerRuntime } from '../plugin.js';

export const scheduleTriggerKind: TriggerKindDoc = {
  $schema: schemaRef('trigger-kind'),
  description: 'Fires on a cron expression. The context hands firedAt; the answer is logged.',
  settings: { fields: { cron: { type: 'string', description: 'five or six field cron expression' }, timezone: { type: 'string', required: false } } },
  context: { fields: { firedAt: { type: 'string', description: 'ISO-8601' } } },
};
export const manifest: PluginDoc = { $schema: schemaRef('plugin'), description: 'Cron triggers.', grants: { triggerKinds: ['@schedule/schedule.trigger-kind.json'] } };

const runtime: TriggerRuntime = {
  async start(triggers, fire, { log, inputFor }) {
    const jobs = triggers.map(t => {
      const s = t.settings as { cron: string; timezone?: string };
      const job = new Cron(s.cron, { timezone: s.timezone }, async () => {
        const request = { firedAt: new Date().toISOString() };
        const built = inputFor(t, request);
        if ('error' in built) { log(`schedule ${t.graph}: input ${built.error}`); return; }
        const report = await fire({ trigger: t, input: built.input, request });
        log(`schedule ${t.graph}: ${report.status}${report.status === 'failed' ? ' ' + JSON.stringify(Object.values(report.nodes).find(n => n.status === 'failed')?.error) : ''}`);
      });
      log(`schedule: '${s.cron}' → ${t.graph} (next ${job.nextRun()?.toISOString() ?? 'never'})`);
      return job;
    });
    return async () => { jobs.forEach(j => j.stop()); };
  },
  encode: (_t, r) => r.output,
};
export const schedule: PluginModule = { root: '@schedule', docs: { '@schedule/plugin.json': manifest, '@schedule/schedule.trigger-kind.json': scheduleTriggerKind } as Record<string, AnyDoc>, handlers: {}, triggers: { '@schedule/schedule.trigger-kind.json': runtime } };
