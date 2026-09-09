/**
 * @std: the pure native operations every graph may use in any layer: objects, text, lists, outcomes. No effects, no connections.
 * Result types are declared, never inferred: an operation whose result depends on its use takes a `type` field, a literal where it is called.
 */
import { fileURLToPath } from 'node:url';
import type { PluginModule } from '@wilanis/core';
import { conforms, type Type } from '@wilanis/core';
import { Refusal, readPath } from '@wilanis/engine';

const obj = (value: unknown, what: string): Record<string, unknown> => {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error(`${what}: expected an object`);
  return value as Record<string, unknown>;
};
const str = (value: unknown, what: string): string => {
  if (typeof value !== 'string') throw new Error(`${what}: expected a string`);
  return value;
};
const arr = (value: unknown, what: string): unknown[] => {
  if (!Array.isArray(value)) throw new Error(`${what}: expected a list`);
  return value;
};
/** Judge a result against the declared type when the embedder can resolve it. */
const declared = (value: unknown, type: unknown, env: Record<string, unknown>): unknown => {
  const resolve = env.resolveType as ((ref: string) => Type) | undefined;
  if (resolve && typeof type === 'string') {
    const bad = conforms(value, resolve(type));
    if (bad) throw new Error(`result is not ${type}: ${bad}`);
  }
  return value;
};

export const std: PluginModule = {
  root: '@std',
  docs: fileURLToPath(new URL('../../docs/std', import.meta.url)),
  handlers: {
    '@std/object.port.json#make': async ({ in: input, ctx }) => declared(input.value, input.type, ctx.env),
    '@std/object.port.json#merge': async ({ in: input, ctx }) =>
      declared({ ...obj(input.base, 'base'), ...obj(input.over, 'over') }, input.type, ctx.env),
    '@std/outcome.port.json#refuse': async ({ in: input }) => {
      throw new Refusal(str(input.reason, 'reason'), str(input.message, 'message'));
    },
    '@std/text.port.json#fill': async ({ in: input }) =>
      str(input.template, 'template').replace(/\{([A-Za-z0-9_.]+)\}/g, (_, name: string) => {
        const value = readPath(input.values, name.split('.'));
        return value === undefined ? '' : String(value);
      }),
    '@std/text.port.json#split': async ({ in: input }) =>
      str(input.text, 'text').split(str(input.separator, 'separator')),
    '@std/text.port.json#join': async ({ in: input }) =>
      arr(input.parts, 'parts').map(String).join(str(input.separator, 'separator')),
    '@std/text.port.json#replace': async ({ in: input }) =>
      str(input.text, 'text').split(str(input.find, 'find')).join(str(input.with, 'with')),
    '@std/list.port.json#concat': async ({ in: input, ctx }) =>
      declared([...arr(input.a, 'a'), ...arr(input.b, 'b')], input.type, ctx.env),
    '@std/list.port.json#first': async ({ in: input, ctx }) => {
      const list = arr(input.list, 'list');
      if (!list.length) throw new Error('first: the list is empty');
      return declared(list[0], input.type, ctx.env);
    },
    '@std/list.port.json#count': async ({ in: input }) => arr(input.list, 'list').length,
    '@std/list.port.json#slice': async ({ in: input, ctx }) =>
      declared(
        arr(input.list, 'list').slice(Number(input.from), input.to === undefined ? undefined : Number(input.to)),
        input.type,
        ctx.env,
      ),
  },
};
