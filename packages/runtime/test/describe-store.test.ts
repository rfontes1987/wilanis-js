/**
 * What `wilanis describe` says about a store, and about a shape a store keeps. A store is where a feature
 * writes down what it persists and what it holds those records to; a reader who cannot see the marks has to
 * open the JSON, which is the one thing the viewer and `describe` exist to avoid.
 *
 * The example keeps nothing yet (RFC 0002 step 8), so the store is planted.
 */
import { rmSync } from 'node:fs';
import { schemaUrl } from '@wilanis/core';
import { afterAll, describe, expect, it } from 'vitest';
import { describe as describeDoc } from '../src/index.js';
import { loadedWith } from './example-harness.js';

const shape = (label: string, fields: Record<string, unknown>) => ({
  $schema: schemaUrl('shape'),
  label,
  layer: 'core',
  description: `A ${label} as the domain knows it.`,
  fields,
});

const STORE = '@features/monitor/data/entries.store.json';
const { load, dir } = loadedWith({
  'features/monitor/domain/Note.shape.json': shape('Note', {
    id: { type: 'string' },
    entryId: { type: 'string' },
    text: { type: 'string' },
  }),
  'features/monitor/data/entries.store.json': {
    $schema: schemaUrl('store'),
    label: 'Entries',
    description: 'The entries recorded so far, and the notes hung off them.',
    connection: '@connections/customers.connection.json',
    collections: {
      entries: {
        of: '@monitor/domain/Entry.shape.json',
        key: 'id',
        unique: [['url', 'method'], ['ua']],
        defaults: { ua: 'unknown' },
        description: 'one row per observed call',
      },
      notes: {
        of: '@monitor/domain/Note.shape.json',
        key: 'id',
        refs: { entryId: { collection: 'entries', onRemove: 'refuse' } },
      },
    },
  },
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('describe: a store', () => {
  const said = () => describeDoc(load, STORE);

  it('says the connection its records live behind, and every collection with the shape it holds', () => {
    expect(said()).toContain('connection  @connections/customers.connection.json');
    expect(said()).toContain('  collection entries: @monitor/domain/Entry.shape.json');
    expect(said()).toContain('  collection notes: @monitor/domain/Note.shape.json');
  });

  it('gives each mark family one line, with its constraints in the order they were declared', () => {
    expect(said()).toContain('    key         id');
    expect(said()).toContain('    unique      [url, method], [ua]');
    expect(said()).toContain('    default     ua = "unknown"');
    expect(said()).toContain('    refs        entryId → entries.id (refuse on remove)');
    expect(said()).toContain('    holds       one row per observed call');
  });

  it('prints no line for a family with nothing to say, so a collection that declares nothing reads as one', () => {
    const notes = said().slice(said().indexOf('  collection notes:'));
    expect(notes).toContain('    refs');
    expect(notes).not.toContain('    unique');
    expect(notes).not.toContain('    default');
    expect(notes).not.toContain('    holds');
  });
});

describe('describe: a shape a store keeps', () => {
  it('says which collection holds it, beside who writes it', () => {
    expect(describeDoc(load, '@monitor/domain/Entry.shape.json')).toContain(`held by  ${STORE}#entries`);
    expect(describeDoc(load, '@monitor/domain/Note.shape.json')).toContain(`held by  ${STORE}#notes`);
  });

  it('says nothing of the sort about a shape no store keeps', () => {
    expect(describeDoc(load, '@monitor/domain/Digest.shape.json')).not.toContain('held by');
  });
});
