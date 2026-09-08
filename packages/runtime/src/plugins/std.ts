/**
 * @std: the pure native operations every graph may use in any layer. No effects, no connections.
 * Result types are declared, never inferred: an operation whose result depends on its use takes a `type` field, a literal where it is called.
 */
import { schemaRef, type AnyDoc, type PluginDoc, type PortDoc } from '@wilanis/core';
import type { PluginModule } from '@wilanis/core';
import { readPath } from '@wilanis/engine';
import { conforms, type Type } from '@wilanis/core';

const OPEN = { fields: {}, open: true } as const;
const TYPE = { type: 'type', binds: '$T', description: 'the declared type of the result' } as const;

export const dataPort: PortDoc = {
  $schema: schemaRef('port'),
  description: 'Object composition. Objects are written in place ({field: value}); object gives such a value a declared type and a node other nodes can read; merge is Object.assign.',
  operations: {
    object: {
      description: 'Answers value unchanged, as the declared type. Write the object in place: "in": { "value": { "title": "{{in.title}}", "status": "{{const.initial}}" }, "type": "@shapes/Task.shape.json" }. The checker verifies the object is assignable to type.',
      accepts: { value: { type: '$T' }, type: TYPE },
      returns: '$T', pure: true,
    },
    merge: {
      description: 'over laid on top of base -- every key of over wins -- answered as the declared type. Like Object.assign({}, base, over).',
      accepts: { base: { type: OPEN }, over: { type: OPEN }, type: TYPE },
      returns: '$T', pure: true,
    },
  },
};

export const textPort: PortDoc = {
  $schema: schemaRef('port'),
  description: 'Strings: templating, splitting, joining, replacing.',
  operations: {
    format: { description: 'Fill a template: {path.to.value} placeholders read into values.', accepts: { values: { type: OPEN }, template: { type: 'string' } }, returns: 'string', pure: true },
    split: { description: 'Split text on a separator.', accepts: { text: { type: 'string' }, separator: { type: 'string' } }, returns: 'string[]', pure: true },
    join: { description: 'Join parts with a separator.', accepts: { parts: { type: 'string[]' }, separator: { type: 'string' } }, returns: 'string', pure: true },
    replace: { description: 'Replace every occurrence of find with with.', accepts: { text: { type: 'string' }, find: { type: 'string' }, with: { type: 'string' } }, returns: 'string', pure: true },
  },
};

export const listPort: PortDoc = {
  $schema: schemaRef('port'),
  description: 'Lists. Like [].concat: the result type is declared in type.',
  operations: {
    concat: { description: 'a followed by b.', accepts: { a: { type: '$T' }, b: { type: '$T' }, type: { ...TYPE, description: 'the list type, e.g. @shapes/Task.shape.json[]' } }, returns: '$T', pure: true },
    first: { description: 'The first element; fails on an empty list (guard with a switch on len(list) > 0).', accepts: { list: { type: '$T[]' }, type: { ...TYPE, description: 'the element type' } }, returns: '$T', pure: true },
    count: { description: 'How many elements.', accepts: { list: { type: 'unknown[]' } }, returns: 'number', pure: true },
    slice: { description: 'Elements from index from (inclusive) to index to (exclusive, default the end).', accepts: { list: { type: '$T' }, type: { ...TYPE, description: 'the list type' }, from: { type: 'number' }, to: { type: 'number', required: false } }, returns: '$T', pure: true },
  },
};

export const flowPort: PortDoc = {
  $schema: schemaRef('port'),
  description: 'Control that dataflow alone cannot say.',
  operations: {
    fail: {
      description: 'Fails the graph with a message; {{templates}} in it read what any value may. It answers nothing, but declares a type so it can stand as an out.from candidate opposite the node that answers.',
      accepts: { message: { type: 'string' }, type: TYPE },
      returns: '$T', pure: true,
    },
  },
};

export const manifest: PluginDoc = {
  $schema: schemaRef('plugin'),
  description: 'Pure operations on data, text and lists. Safe in any layer.',
  grants: { ports: ['@std/data.port.json', '@std/text.port.json', '@std/list.port.json', '@std/flow.port.json'] },
};

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
  docs: { '@std/plugin.json': manifest, '@std/data.port.json': dataPort, '@std/text.port.json': textPort, '@std/list.port.json': listPort, '@std/flow.port.json': flowPort } as Record<string, AnyDoc>,
  handlers: {
    '@std/data.port.json#object': async ({ in: i, ctx }) => declared(i.value, i.type, ctx.env),
    '@std/data.port.json#merge': async ({ in: i, ctx }) => declared({ ...obj(i.base, 'base'), ...obj(i.over, 'over') }, i.type, ctx.env),
    '@std/flow.port.json#fail': async ({ in: i }) => { throw new Error(str(i.message, 'message')); },
    '@std/text.port.json#format': async ({ in: i }) => str(i.template, 'template').replace(/\{([A-Za-z0-9_.]+)\}/g, (_, p: string) => { const v = readPath(i.values, p.split('.')); return v === undefined ? '' : String(v); }),
    '@std/text.port.json#split': async ({ in: i }) => str(i.text, 'text').split(str(i.separator, 'separator')),
    '@std/text.port.json#join': async ({ in: i }) => arr(i.parts, 'parts').map(String).join(str(i.separator, 'separator')),
    '@std/text.port.json#replace': async ({ in: i }) => str(i.text, 'text').split(str(i.find, 'find')).join(str(i.with, 'with')),
    '@std/list.port.json#concat': async ({ in: i, ctx }) => declared([...arr(i.a, 'a'), ...arr(i.b, 'b')], i.type, ctx.env),
    '@std/list.port.json#first': async ({ in: i, ctx }) => { const l = arr(i.list, 'list'); if (!l.length) throw new Error('first: the list is empty'); return declared(l[0], i.type, ctx.env); },
    '@std/list.port.json#count': async ({ in: i }) => arr(i.list, 'list').length,
    '@std/list.port.json#slice': async ({ in: i, ctx }) => declared(arr(i.list, 'list').slice(Number(i.from), i.to === undefined ? undefined : Number(i.to)), i.type, ctx.env),
  },
};
