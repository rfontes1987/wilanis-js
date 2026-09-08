/**
 * @std: the pure native operations every graph may use in any layer. No effects, no connections.
 * Result types are declared, never inferred: an operation whose result depends on its use takes a `type` param.
 */
import { schemaRef, type AnyDoc, type PluginDoc, type PortDoc } from '../../model.js';
import type { PluginModule } from '../plugin.js';
import { readPath } from '../../kernel/kernel.js';
import { conforms, type Type } from '../../types/type.js';

const OPEN = { fields: {}, open: true } as const;
const TYPE_PARAM = { type: 'type', binds: '$T', description: 'the declared type of the result' } as const;

export const dataPort: PortDoc = {
  $schema: schemaRef('port'),
  description: 'Object composition. Objects are built by structural edges ({field: source}); object gives such an edge a declared type and a node other nodes can read; merge is Object.assign.',
  operations: {
    object: {
      description: 'Answers value unchanged, as the declared type. Wire the object with structural edges: "in": { "value": { "title": "in.title", "status": "const.initial" } }. The checker verifies the wired object is assignable to type.',
      accepts: { value: { type: '$T' } },
      params: { type: TYPE_PARAM },
      returns: '$T', pure: true,
    },
    merge: {
      description: 'over laid on top of base -- every key of over wins -- answered as the declared type. Like Object.assign({}, base, over).',
      accepts: { base: { type: OPEN }, over: { type: OPEN } },
      params: { type: TYPE_PARAM },
      returns: '$T', pure: true,
    },
  },
};

export const textPort: PortDoc = {
  $schema: schemaRef('port'),
  description: 'Strings: templating, splitting, joining, replacing.',
  operations: {
    format: { description: 'Fill a template: {path.to.value} placeholders read into values.', accepts: { values: { type: OPEN } }, params: { template: { type: 'string' } }, returns: 'string', pure: true },
    split: { description: 'Split text on a separator.', accepts: { text: { type: 'string' } }, params: { separator: { type: 'string' } }, returns: 'string[]', pure: true },
    join: { description: 'Join parts with a separator.', accepts: { parts: { type: 'string[]' } }, params: { separator: { type: 'string' } }, returns: 'string', pure: true },
    replace: { description: 'Replace every occurrence of find with with.', accepts: { text: { type: 'string' } }, params: { find: { type: 'string' }, with: { type: 'string' } }, returns: 'string', pure: true },
  },
};

export const listPort: PortDoc = {
  $schema: schemaRef('port'),
  description: 'Lists. Like [].concat: the result type is declared in params.type.',
  operations: {
    concat: { description: 'a followed by b.', accepts: { a: { type: '$T' }, b: { type: '$T' } }, params: { type: { ...TYPE_PARAM, description: 'the list type, e.g. @shapes/Task.shape.json[]' } }, returns: '$T', pure: true },
    first: { description: 'The first element; fails on an empty list (guard with a switch on len(list) > 0).', accepts: { list: { type: '$T[]' } }, params: { type: { ...TYPE_PARAM, description: 'the element type' } }, returns: '$T', pure: true },
    count: { description: 'How many elements.', accepts: { list: { type: 'unknown[]' } }, returns: 'number', pure: true },
    slice: { description: 'Elements from index from (inclusive) to index to (exclusive, default the end).', accepts: { list: { type: '$T' } }, params: { type: { ...TYPE_PARAM, description: 'the list type' }, from: { type: 'number' }, to: { type: 'number', required: false } }, returns: '$T', pure: true },
  },
};

export const flowPort: PortDoc = {
  $schema: schemaRef('port'),
  description: 'Control that dataflow alone cannot say.',
  operations: {
    fail: {
      description: 'Fails the graph with a message (a {placeholder} template over values). It answers nothing, but declares a type so it can stand as an out.from candidate opposite the node that answers.',
      accepts: { values: { type: OPEN, required: false } },
      params: { type: TYPE_PARAM, message: { type: 'string' } },
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
const declared = (v: unknown, params: Record<string, unknown>, env: Record<string, unknown>): unknown => {
  const resolve = env.resolveType as ((ref: string) => Type) | undefined;
  if (resolve && typeof params.type === 'string') { const bad = conforms(v, resolve(params.type)); if (bad) throw new Error(`result is not ${params.type}: ${bad}`); }
  return v;
};

export const std: PluginModule = {
  root: '@std',
  docs: { '@std/plugin.json': manifest, '@std/data.port.json': dataPort, '@std/text.port.json': textPort, '@std/list.port.json': listPort, '@std/flow.port.json': flowPort } as Record<string, AnyDoc>,
  handlers: {
    '@std/data.port.json#object': async ({ in: i, params, ctx }) => declared(i.value, params, ctx.env),
    '@std/data.port.json#merge': async ({ in: i, params, ctx }) => declared({ ...obj(i.base, 'base'), ...obj(i.over, 'over') }, params, ctx.env),
    '@std/flow.port.json#fail': async ({ in: i, params }) => { throw new Error(str(params.message, 'message').replace(/\{([A-Za-z0-9_.]+)\}/g, (_, p: string) => String(readPath(i.values, p.split('.')) ?? ''))); },
    '@std/text.port.json#format': async ({ in: i, params }) => str(params.template, 'template').replace(/\{([A-Za-z0-9_.]+)\}/g, (_, p: string) => { const v = readPath(i.values, p.split('.')); return v === undefined ? '' : String(v); }),
    '@std/text.port.json#split': async ({ in: i, params }) => str(i.text, 'text').split(str(params.separator, 'separator')),
    '@std/text.port.json#join': async ({ in: i, params }) => arr(i.parts, 'parts').map(String).join(str(params.separator, 'separator')),
    '@std/text.port.json#replace': async ({ in: i, params }) => str(i.text, 'text').split(str(params.find, 'find')).join(str(params.with, 'with')),
    '@std/list.port.json#concat': async ({ in: i, params, ctx }) => declared([...arr(i.a, 'a'), ...arr(i.b, 'b')], params, ctx.env),
    '@std/list.port.json#first': async ({ in: i, params, ctx }) => { const l = arr(i.list, 'list'); if (!l.length) throw new Error('first: the list is empty'); return declared(l[0], params, ctx.env); },
    '@std/list.port.json#count': async ({ in: i }) => arr(i.list, 'list').length,
    '@std/list.port.json#slice': async ({ in: i, params, ctx }) => declared(arr(i.list, 'list').slice(Number(params.from), params.to === undefined ? undefined : Number(params.to)), params, ctx.env),
  },
};
