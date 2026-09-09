import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type DocView, type SchemaView, schemaRelOf, schemaViewOf, serveView } from '../src/index.js';

const EXAMPLE = fileURLToPath(new URL('../../../example', import.meta.url));
const GET_ROW = '@features/monitor/data/get-row.graph.json';

describe('schemas as pages', () => {
  it('recognises a schema reference in either form, and nothing else', () => {
    expect(schemaRelOf('@wilanis/node/run.schema.json')).toBe('node/run.schema.json');
    expect(schemaRelOf('@wilanis/graph.schema.json')).toBe('graph.schema.json');
    expect(
      schemaRelOf(
        'https://raw.githubusercontent.com/rfontes1987/wilanis-js/schemas-v1/packages/core/schemas/trigger.schema.json',
      ),
    ).toBe('trigger.schema.json');
    expect(schemaRelOf('@features/monitor/domain/Entry.shape.json')).toBeUndefined();
    expect(schemaRelOf('@wilanis/../package.json')).toBeUndefined();
    expect(schemaRelOf(42)).toBeUndefined();
  });

  it('views a schema: the kind it judges, its title, where it is published', () => {
    const graph = schemaViewOf('graph.schema.json', { title: 'graph', description: 'A dataflow.' });
    expect(graph).toMatchObject({
      kind: 'schema',
      path: '@wilanis/graph.schema.json',
      judges: 'graph',
      label: 'graph',
      description: 'A dataflow.',
      url: expect.stringMatching(/schemas-v1\/packages\/core\/schemas\/graph\.schema\.json$/),
    });
    expect(schemaViewOf('node/run.schema.json', { title: 'node/run' }).judges).toBeUndefined();
    expect(schemaViewOf('common.schema.json', {}).judges).toBeUndefined();
  });
});

describe('the view server', () => {
  it('serves the page, the index and a document; refuses a missing path', async () => {
    const server = await serveView(EXAMPLE, { port: 0 });
    try {
      const page = await fetch(server.url);
      expect(page.headers.get('content-type')).toContain('text/html');
      expect(await page.text()).toContain('wilanis view');
      const idx = (await (await fetch(`${server.url}api/index`)).json()) as {
        docs: unknown[];
        version: string;
        schemaBase: string;
      };
      expect(idx.docs.length).toBeGreaterThan(40);
      expect(typeof idx.version).toBe('string');
      expect(idx.schemaBase).toMatch(/^https:\/\/.*\/schemas$/);
      const doc = (await (
        await fetch(`${server.url}api/doc?path=${encodeURIComponent('@monitor/data/get-row.graph.json')}`)
      ).json()) as DocView;
      expect(doc.path).toBe(GET_ROW);
      expect(doc.graph?.nodes.length).toBe(8);
      const missing = await fetch(`${server.url}api/doc?path=${encodeURIComponent('@features/nope.json')}`);
      expect(missing.status).toBe(404);
      const none = await fetch(`${server.url}api/doc`);
      expect(none.status).toBe(400);
      // a node type opens as a page: the schema itself, read from the installed core
      const run = (await (
        await fetch(`${server.url}api/schema?path=${encodeURIComponent('node/run.schema.json')}`)
      ).json()) as SchemaView;
      expect(run).toMatchObject({
        kind: 'schema',
        path: '@wilanis/node/run.schema.json',
        label: 'node/run',
        file: expect.stringMatching(/schemas\/node\/run\.schema\.json$/),
      });
      expect((run.schema as { properties: { type: { const: string } } }).properties.type.const).toBe(
        '@wilanis/node/run.schema.json',
      );
      expect((await fetch(`${server.url}api/schema?path=${encodeURIComponent('../package.json')}`)).status).toBe(404);
      expect((await fetch(`${server.url}api/schema?path=nope.schema.json`)).status).toBe(404);
      expect((await fetch(`${server.url}api/schema`)).status).toBe(400);
    } finally {
      await server.close();
    }
  });
});
