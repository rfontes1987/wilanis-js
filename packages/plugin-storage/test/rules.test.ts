/**
 * What only @storage can judge. Each case breaks the small tree one way and expects the code and the place
 * the refusal points at -- a code alone would pass for a refusal about something else entirely.
 *
 * Two rows of RFC 0002's table are not rules, and the last two cases say so by asserting what does answer:
 * the tree already refuses them, and a rule lives in one place.
 */
import { describe, expect, it } from 'vitest';
import { CONNECTION, codes, type Docs, editing, refusals, SHAPE, STORE, tree } from './harness.js';

const edit = (file: string, change: (doc: any) => void) => refusals(editing(file, change));
const store = (change: (doc: any) => void) => edit('features/monitor/data/entries.store.json', change);
const graph = (change: (doc: any) => void) => edit('features/monitor/data/read-entry.graph.json', change);
const at = (found: ReturnType<typeof refusals>, code: string) => found.filter(one => one.code === code);

/** The tree with a second feature keeping the same collection name over the same connection. */
function alsoKeeping(of: string, shape?: Docs): Docs {
  const base = tree();
  // sharing a collection deliberately means the shape is one the other feature may name
  (base['features/monitor/feature.json'] as { exports: string[] }).exports = [SHAPE];
  return {
    ...base,
    ...shape,
    'features/other/feature.json': {
      $schema: '@wilanis/feature.schema.json',
      description: 'another feature that keeps things',
      dependsOn: ['monitor'],
    },
    'features/other/data/entries.store.json': {
      $schema: '@wilanis/store.schema.json',
      description: 'the same collection, over the same connection',
      connection: CONNECTION,
      collections: { entries: { of, key: 'id' } },
    },
  };
}

describe('a tree that keeps what it observes', () => {
  it('stands: a store over a storage connection, and a graph that reads it', () => {
    expect(refusals(tree())).toEqual([]);
  });
});

describe('what a collection may keep, and what identifies one record', () => {
  it("X201 an edge shape: the world's shape is not what a tree keeps", () => {
    const found = at(
      store(doc => {
        doc.collections.entries.of = '@features/monitor/edge/EntryRow.shape.json';
      }),
      'X201',
    );
    expect(found).toHaveLength(1);
    expect(found[0].at).toBe('collections/entries/of');
    expect(found[0].message).toMatch(/is an edge shape/);
  });

  it('X202 a key the shape does not have, with the fields it does', () => {
    const found = at(
      store(doc => {
        doc.collections.entries.key = 'nope';
      }),
      'X202',
    );
    expect(found).toHaveLength(1);
    expect(found[0].at).toBe('collections/entries/key');
    expect(found[0].message).toMatch(/\(fields: id, url, hits, ok, tags, ua\)/);
  });

  it('X202 a key that may be absent, since a key identifies every record', () => {
    const found = at(
      store(doc => {
        doc.collections.entries.key = 'ua';
      }),
      'X202',
    );
    expect(found).toHaveLength(1);
    expect(found[0].message).toMatch(/is optional in .*, and a key identifies every record/);
  });
});

describe('what a store may sit on', () => {
  it('X203 a connection of a kind that reaches no storage engine', () => {
    const found = at(
      edit('connections/records.connection.json', doc => {
        doc.kind = '@fake-upstream/upstream.connection-kind.json';
      }),
      'X203',
    );
    expect(found).toHaveLength(1);
    expect(found[0].at).toBe('connection');
    expect(found[0].message).toMatch(/does not say "storage": true/);
  });

  it('X203 a connection of a kind no loaded plugin grants', () => {
    const broken = editing('connections/records.connection.json', doc => {
      doc.kind = '@nobody/nothing.connection-kind.json';
    });
    const found = at(refusals(broken), 'X203');
    expect(found[0].message).toMatch(/which no loaded plugin grants/);
  });
});

describe('what a call may name', () => {
  it('X204 a store this tree does not hold, pointing at the input that named it', () => {
    const found = at(
      graph(doc => {
        doc.nodes[0].in.store = '@features/monitor/data/nope.store.json';
      }),
      'X204',
    );
    expect(found).toHaveLength(1);
    expect(found[0].at).toBe('nodes/asked/in/store');
  });

  it('X204 a collection the store does not declare, naming the ones it does', () => {
    const found = at(
      graph(doc => {
        doc.nodes[0].in.collection = 'nope';
      }),
      'X204',
    );
    expect(found).toHaveLength(1);
    expect(found[0].at).toBe('nodes/asked/in/collection');
    expect(found[0].message).toMatch(/\(collections: entries\)/);
  });
});

describe('two stores over one connection', () => {
  it('X207 one collection name, two shapes: the pair is the collection, so they would be one table', () => {
    const other = {
      'features/other/domain/Thing.shape.json': {
        $schema: '@wilanis/shape.schema.json',
        description: 'something else entirely',
        layer: 'core',
        fields: { id: { type: 'string' }, size: { type: 'number' } },
      },
    };
    const found = at(refusals(alsoKeeping('@features/other/domain/Thing.shape.json', other)), 'X207');
    expect(found).toHaveLength(1);
    expect(found[0].at).toBe('collections/entries/of');
    expect(found[0].message).toMatch(/already keeps .*Entry.shape.json/);
  });

  it('the same name with the same shape is how two features share a collection on purpose', () => {
    expect(codes(alsoKeeping(SHAPE))).toEqual([]);
  });
});

describe('what a call may ask of the records', () => {
  const where = (filter: unknown) =>
    graph(doc => {
      doc.nodes[0].in.where = filter;
    });
  const only = (filter: unknown, code: string) => at(where(filter), code);

  it('X208 a filter naming a field the shape does not have, at any nesting', () => {
    expect(only({ methd: 'GET' }, 'X208')[0].at).toBe('nodes/asked/in/where/methd');
    expect(only({ any: [{ nope: 1 }] }, 'X208')).toHaveLength(1);
  });

  it('X208 an order by a field the shape does not have', () => {
    const found = at(
      graph(doc => {
        doc.nodes[0].in.order = [{ by: 'nope' }];
      }),
      'X208',
    );
    expect(found).toHaveLength(1);
    expect(found[0].at).toBe('nodes/asked/in/order/0/by');
  });

  it('X209 a literal the field would not accept', () => {
    expect(only({ url: 7 }, 'X209')).toHaveLength(1);
    expect(only({ ua: { has: 'yes' } }, 'X209')).toHaveLength(1);
    expect(only({ hits: { in: ['a'] } }, 'X209')).toHaveLength(1);
    expect(only({ hits: 7 }, 'X209')).toEqual([]);
  });

  it('X210 an operator the grammar does not name, or one the field type does not admit', () => {
    expect(only({ url: { like: 'x' } }, 'X210')).toHaveLength(1);
    expect(only({ hits: { contains: '2' } }, 'X210')).toHaveLength(1);
    expect(only({ ok: { gt: false } }, 'X210')).toHaveLength(1);
    expect(only({ tags: { eq: ['a'] } }, 'X210')).toHaveLength(1);
    expect(only({ tags: { has: true } }, 'X210')).toEqual([]);
  });

  it('a read is not judged: its type comes from where it is read, which a plugin cannot see', () => {
    // `hits` is a number and `in.id` a string, so this would be X209 if the plugin could type the read.
    // PluginCheckContext hands scope, settings and refuse, and nothing that types a read at a node.
    expect(only({ hits: '{{in.id}}' }, 'X209')).toEqual([]);
  });
});

describe('what the tree already answers, so @storage does not', () => {
  it('an input the operation does not accept is G006, which names the inputs it does', () => {
    const found = graph(doc => {
      doc.nodes[0].in.key = 'x';
    });
    expect(found.map(one => one.code)).toEqual(['G006']);
    expect(found[0].message).toMatch(/inputs: store, collection, where, order, limit, offset/);
  });

  it('a collection name that is not an identifier is D001, from the store schema', () => {
    // in a store nothing calls, so the case says one thing: a document that fails validation is not
    // registered, and every call naming one would be refused again for having no store to name
    const found = refusals({
      ...tree(),
      'features/monitor/data/other.store.json': {
        $schema: '@wilanis/store.schema.json',
        description: 'a store whose collection is named wrongly',
        connection: CONNECTION,
        collections: { 'Bad Name': { of: SHAPE, key: 'id' } },
      },
    });
    expect(found.some(one => one.code === 'D001' && one.at === 'collections')).toBe(true);
    expect(found.filter(one => one.code.startsWith('X2'))).toEqual([]);
  });
});

describe('the store the tree holds', () => {
  it('is the one the graph names', () => {
    expect(STORE).toBe('@features/monitor/data/entries.store.json');
  });
});
