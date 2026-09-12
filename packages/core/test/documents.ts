/** Documents the validation tests judge: the smallest of each kind, and how a refusal is expected. */
import { expect } from 'vitest';
import { type Kind, NODE_RUN, schemaRef, schemaUrl } from '../src/model.js';
import { validateDocument } from '../src/validate.js';

/**
 * Every deviation from a schema is refused with D001, at the path of the deviation, in words a reader can
 * act on: nothing more (no noise from alternatives the document never chose), nothing less (every
 * deviation, not only the deepest). The smallest conforming document of each kind is the baseline.
 */

export const run = (id: string, extra: Record<string, unknown> = {}) => ({
  type: NODE_RUN,
  id,
  run: '@std/object.port.json#make',
  in: { value: {}, type: 'string' },
  ...extra,
});

export const minimal: Record<Kind, Record<string, unknown>> = {
  project: { name: 'p', plugins: [{ use: '@std' }] },
  plugin: { grants: {} },
  port: { operations: { get: { description: 'one' } } },
  binding: { port: '@features/f/f.port.json', operations: { get: { graph: '@features/f/graphs/g.graph.json' } } },
  graph: { nodes: [run('a')] },
  trigger: { kind: '@cli/cli.trigger-kind.json', settings: {}, fire: { run: '@features/f/domain/f.port.json#get' } },
  policy: { decide: { run: '@features/f/domain/f.port.json#decide' }, outcomes: {} },
  'trigger-kind': { settings: { fields: {} }, context: { fields: {} } },
  'connection-kind': { settings: { fields: {} } },
  connection: { kind: '@http/http.connection-kind.json', settings: {} },
  codec: { yields: 'declared' },
  feature: {},
  shape: { layer: 'core', fields: {} },
  scenario: { trigger: '@features/f/edge/t.trigger.json', seed: 1, expect: { status: 'done', nodes: {} } },
  resolvers: { resolvers: { caller: { read: "request.headers['user-agent']" } } },
  store: {
    connection: '@connections/records.connection.json',
    collections: { entries: { of: '@features/f/domain/Entry.shape.json', key: 'id' } },
  },
};
export const doc = (kind: Kind, body: Record<string, unknown> = {}, schema = schemaRef(kind)) => ({
  $schema: schema,
  description: 'd',
  ...minimal[kind],
  ...body,
});

/** The refusals of a document, as [at, message] pairs; every one is D001 and points at the kind's schema. */
export function refused(document: unknown): [string | undefined, string][] {
  const { kind, refusals } = validateDocument(document, 'f.json');
  for (const refusal of refusals) {
    expect(refusal.code).toBe('D001');
    expect(refusal.file).toBe('f.json');
    if (kind) expect(refusal.hint).toBe(`see ${schemaUrl(kind)}`);
  }
  return refusals.map(refusal => [refusal.at, refusal.message]);
}
export const at = (path: string | undefined, ...words: string[]) => [
  path,
  words.length === 1
    ? expect.stringContaining(words[0])
    : expect.stringMatching(words.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')),
];
