import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type DocView, type SchemaView, siteOf, type TreeIndex, writeSite } from '../src/index.js';

const EXAMPLE = fileURLToPath(new URL('../../../example', import.meta.url));
const REPO = fileURLToPath(new URL('../../..', import.meta.url));
const GET_ROW = '@features/monitor/data/get-row.graph.json';

describe('a tree written out as a site', () => {
  it('answers the index, a view for every document, and the schemas', async () => {
    const files = await siteOf(EXAMPLE);
    const index = files['index.json'] as TreeIndex;
    expect(index.docs.length).toBeGreaterThan(40);
    // every document the index lists has a file behind it: a view that cannot be drawn fails the site, not a click
    for (const doc of index.docs) expect(files[`docs/${doc.path.slice(1)}`]).toBeDefined();
    const row = files[`docs/${GET_ROW.slice(1)}`] as DocView;
    expect(row.path).toBe(GET_ROW);
    expect(row.graph?.nodes.length).toBe(8);
    const run = files['schemas/node/run.schema.json'] as SchemaView;
    expect(run.path).toBe('@wilanis/node/run.schema.json');
    expect(files['schemas/graph.schema.json']).toBeDefined();
  });

  it('names no path outside the tree, so a published site says nothing about the disk it was written on', async () => {
    const files = await siteOf(EXAMPLE);
    expect(JSON.stringify(files)).not.toContain(REPO);
    expect((files['index.json'] as TreeIndex).root).toBe('example');
    // a document of an included tree keeps its place in the repository, relative to the tree's parent
    const included = (files['index.json'] as TreeIndex).docs.find(doc => doc.path.startsWith('@features/access/'));
    expect(included?.file).toMatch(/^libraries\/access\/features\//);
  });

  it('writes the page and every answer behind it, so the same page needs no server', async () => {
    const out = await mkdtemp(join(tmpdir(), 'wilanis-site-'));
    try {
      const written = await writeSite(EXAMPLE, out);
      expect(written).toContain('index.html');
      expect(written).toContain('index.json');
      const page = await readFile(join(out, 'index.html'), 'utf8');
      expect(page).toContain('wilanis view');
      const index = JSON.parse(await readFile(join(out, 'index.json'), 'utf8')) as TreeIndex;
      expect(index.docs.length).toBe(written.filter(file => file.startsWith('docs/')).length);
      const row = JSON.parse(await readFile(join(out, 'docs', GET_ROW.slice(1)), 'utf8')) as DocView;
      expect(row.path).toBe(GET_ROW);
    } finally {
      await rm(out, { recursive: true, force: true });
    }
  });
});
