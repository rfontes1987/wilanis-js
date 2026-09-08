/**
 * @std: the pure native operations every graph may use in any layer: objects, text, lists, outcomes. No effects, no connections.
 * Result types are declared, never inferred: an operation whose result depends on its use takes a `type` field, a literal where it is called.
 */
import { fileURLToPath } from 'node:url';
import type { PluginModule } from '@wilanis/core';
import { Refusal, readPath } from '@wilanis/engine';
import { conforms, type Type } from '@wilanis/core';

const obj = (v: unknown, what: string): Record<string, unknown> => { if (v === undefined) return {}; if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`${what}: expected an object`); return v as Record<string, unknown>; };
const str = (v: unknown, what: string): string => { if (typeof v !== 'string') throw new Error(`${what}: expected a string`); return v; };
const arr = (v: unknown, what: string): unknown[] => { if (!Array.isArray(v)) throw new Error(`${what}: expected a list`); return v; };
/** Judge a result against the declared type when the embedder can resolve it. */
const declared = (v: unknown, type: unknown, env: Record<string, unknown>): unknown => {
  const resolve = env.resolveType as ((ref: string) => Type) | undefined;
  if (resolve && typeof type === 'string') { const bad = conforms(v, resolve(type)); if (bad) throw new Error(`result is not ${type}: ${bad}`); }
  return v;
};

export const std: PluginModule = {
  root: '@std',
  docs: fileURLToPath(new URL('../../docs/std', import.meta.url)),
  handlers: {
    '@std/object.port.json#make': async ({ in: i, ctx }) => declared(i.value, i.type, ctx.env),
    '@std/object.port.json#merge': async ({ in: i, ctx }) => declared({ ...obj(i.base, 'base'), ...obj(i.over, 'over') }, i.type, ctx.env),
    '@std/outcome.port.json#refuse': async ({ in: i }) => { throw new Refusal(str(i.reason, 'reason'), str(i.message, 'message')); },
    '@std/text.port.json#fill': async ({ in: i }) => str(i.template, 'template').replace(/\{([A-Za-z0-9_.]+)\}/g, (_, p: string) => { const v = readPath(i.values, p.split('.')); return v === undefined ? '' : String(v); }),
    '@std/text.port.json#split': async ({ in: i }) => str(i.text, 'text').split(str(i.separator, 'separator')),
    '@std/text.port.json#join': async ({ in: i }) => arr(i.parts, 'parts').map(String).join(str(i.separator, 'separator')),
    '@std/text.port.json#replace': async ({ in: i }) => str(i.text, 'text').split(str(i.find, 'find')).join(str(i.with, 'with')),
    '@std/list.port.json#concat': async ({ in: i, ctx }) => declared([...arr(i.a, 'a'), ...arr(i.b, 'b')], i.type, ctx.env),
    '@std/list.port.json#first': async ({ in: i, ctx }) => { const l = arr(i.list, 'list'); if (!l.length) throw new Error('first: the list is empty'); return declared(l[0], i.type, ctx.env); },
    '@std/list.port.json#count': async ({ in: i }) => arr(i.list, 'list').length,
    '@std/list.port.json#slice': async ({ in: i, ctx }) => declared(arr(i.list, 'list').slice(Number(i.from), i.to === undefined ? undefined : Number(i.to)), i.type, ctx.env),
  },
};
