/** Handlers the kernel tests share: arithmetic, echoes, sleeps, a fault and a refusal. */
import { Refusal } from '../src/index.js';

export const handlers = {
  double: async ({ in: input }: { in: Record<string, unknown> }) => Number(input.x) * 2,
  boom: async () => {
    throw new Error('boom');
  },
  refuse: async ({ in: input }: { in: Record<string, unknown> }) => {
    throw new Refusal(String(input.reason), `no ${input.what}`, input.detail as Record<string, unknown> | undefined);
  },
  echo: async ({ in: input }: { in: Record<string, unknown> }) => input,
  sleepOrBoom: async ({ in: input }: { in: Record<string, unknown> }) => {
    await new Promise(resolve => setTimeout(resolve, Number(input.ms)));
    if (input.tag === 'boom') throw new Error('boom');
    return input.tag;
  },
  sleep: async ({ in: input }: { in: Record<string, unknown> }) => {
    await new Promise(resolve => setTimeout(resolve, Number(input.ms)));
    return input.tag;
  },
};
