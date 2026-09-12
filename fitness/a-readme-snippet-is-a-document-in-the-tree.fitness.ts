/**
 * Claim: a README snippet is a document in the tree.
 * Why: `CLAUDE.md` asks that a rule live in one place, and a JSON block in the README is a second copy of a
 *   document that lives under `example/` or in a tree it includes. The copy drifts in silence: the graph the
 *   README shows is the one M01 replaces when the monitor's entries move into a store, and nothing in the
 *   suite would have said so. The README is the first thing a reader trusts and the last thing a change
 *   remembers, which makes a stale block there the most expensive kind.
 * Retire when: the README quotes no documents, or its blocks are generated from the files they quote and the
 *   generator holds this claim instead. A block that wants to be a fragment rather than a whole object is a
 *   design signal first: say it in prose, or quote a document that is the shape you mean.
 */
import { readJson, record } from './lib/jsonc.js';
import { entriesUnder, textOf } from './lib/sources.js';

/** The trees the README quotes from: the example, and the tree the example includes. */
const TREES = ['example', 'libraries/access'];

/** The claim this module holds, and the title the runner gives its test. */
export const claim = 'a README snippet is a document in the tree';

/** Every json block of the README, and every object a block could be an excerpt of. */
export const gather = () => ({
  blocks: blocksOf(textOf('README.md')),
  candidates: TREES.flatMap(tree => entriesUnder(tree, ['.json']).flatMap(candidatesOf)),
});

/** Every block that quotes nothing in the tree, one sentence each, naming the block and the fix. */
export const judge = ({ blocks, candidates }: ReturnType<typeof gather>): string[] =>
  blocks.flatMap(block => faultsOf(block, candidates));

/** What one block gets wrong: json that will not parse, or an object no document in the tree writes. */
function faultsOf(block: ReturnType<typeof blocksOf>[number], candidates: Record<string, unknown>[]): string[] {
  if (!block.parses) {
    return [`README.md ${block.at} is not valid JSON on its own; quote a whole object, or say it in prose`];
  }
  return block.objects
    .filter(object => !candidates.some(candidate => excerpts(object, candidate)))
    .map(
      object =>
        `README.md ${block.at} shows ${nameOf(object)}, which no document in the tree writes; re-copy the block from the file it quotes`,
    );
}

/** Whether every key an object writes is written the same way by one document, so the block is an excerpt. */
function excerpts(object: Record<string, unknown>, candidate: Record<string, unknown>): boolean {
  const keys = Object.keys(object);
  return keys.length > 0 && keys.every(key => JSON.stringify(object[key]) === JSON.stringify(candidate[key]));
}

/** How a violation names the object it could not place: its `id`, its `label`, else its first key. */
function nameOf(object: Record<string, unknown>): string {
  const named = object.id ?? object.label;
  return typeof named === 'string' ? `'${named}'` : `an object keyed ${Object.keys(object).join(', ')}`;
}

/** Every ```json block of a page, in the order written, with the objects it holds. */
function blocksOf(text: string) {
  return [...text.matchAll(/```json\n([\s\S]*?)```/g)].map((match, index) => blockOf(match[1] ?? '', index));
}

/** One block read as the objects it writes: a block may write several, as two nodes of a graph do. */
function blockOf(body: string, index: number) {
  const at = `block ${index + 1}`;
  const empty: Record<string, unknown>[] = [];
  try {
    const written: unknown = JSON.parse(`[${body}]`);
    return { at, objects: Array.isArray(written) ? written.map(record).filter(isRecord) : empty, parses: true };
  } catch {
    return { at, objects: empty, parses: false };
  }
}

/** One document and every node inside it, since the README quotes whole files and single nodes alike. */
function candidatesOf(file: string): Record<string, unknown>[] {
  const document = record(readJson(file));
  if (!document) return [];
  const nodes = Array.isArray(document.nodes) ? document.nodes : [];
  return [document, ...nodes.map(record).filter(isRecord)];
}

/** Whether a value survived `record`, so a list of them types as the records they are. */
function isRecord(value: Record<string, unknown> | null): value is Record<string, unknown> {
  return value !== null;
}

/** The proof that the judge bites: a block quoting nothing, and one that is not JSON at all. */
export const sabotage = [
  {
    input: {
      blocks: [{ at: 'block 1', objects: [{ id: 'route', run: '@std/outcome.port.json#invent' }], parses: true }],
      candidates: [{ id: 'route', run: '@std/outcome.port.json#refuse' }],
    },
    violation:
      "README.md block 1 shows 'route', which no document in the tree writes; re-copy the block from the file it quotes",
  },
  {
    input: { blocks: [{ at: 'block 2', objects: [], parses: false }], candidates: [] },
    violation: 'README.md block 2 is not valid JSON on its own; quote a whole object, or say it in prose',
  },
];
