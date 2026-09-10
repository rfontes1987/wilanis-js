/**
 * Claim: a kind is declared once and mirrored.
 * Why: `CLAUDE.md` lists what adding a document kind touches -- a schema under `packages/core/schemas/`, the
 *   `Kind` entry in `model.ts`, a row in `packages/runtime/templates/CLAUDE.md`, a home in `placement.ts`,
 *   and a page in the viewer, "since the viewer never shows raw JSON by default". `KINDS` is the one
 *   declaration and the rest mirror it; a kind added to the list and forgotten in one of them is a kind a
 *   reader cannot validate, cannot place, cannot read about, or meets as raw JSON. Nothing joined the five,
 *   so each was kept in step by hand.
 * Retire when: the mirrors are generated from `KINDS`, and an RFC says by what. A kind that is genuinely
 *   exempt from one mirror belongs in this file's data with its reason, as the plugin-shipped kinds are.
 */
import { entriesOf, textOf } from './lib/sources.js';

/** Kinds a plugin ships, so a consumer tree's template says nothing of them and placement never asks. */
const SHIPPED_BY_PLUGINS = ['plugin', 'trigger-kind', 'connection-kind', 'codec'];

/** Kinds that sit at a tree's root rather than in a layer, so `HOME` has nothing to say about them. */
const TOP_LEVEL = ['project', 'feature'];

/** A kind the viewer gives a page of its own rather than a `renderDocPage` case, and the function that draws it. */
const RENDERED_BY: Record<string, string> = { graph: 'drawGraph' };

/** The five places a kind is declared or mirrored, as this claim reads them. */
interface Mirrors {
  kinds: string[];
  schemas: string[];
  cases: string[];
  rendered: string[];
  rows: string[];
  homes: string[];
}

/** The claim this module holds, and the title the runner gives its test. */
export const claim = 'a kind is declared once and mirrored';

/** Every kind `KINDS` declares, and what each of the four mirrors says about it. */
export const gather = (): Mirrors => {
  const client = textOf('packages/view/client/index.html');
  const page = client.slice(client.indexOf('function renderDocPage'));
  return {
    kinds: listed(textOf('packages/core/src/model.ts'), /export const KINDS: Kind\[\] = \[([^\]]*)\]/),
    schemas: schemaKinds(),
    cases: [...page.slice(0, page.indexOf('\n  function ')).matchAll(/case '([a-z-]+)'/g)].map(one => one[1] ?? ''),
    rendered: Object.entries(RENDERED_BY)
      .filter(([, fn]) => client.includes(`function ${fn}(`))
      .map(([kind]) => kind),
    rows: [...textOf('packages/runtime/templates/CLAUDE.md').matchAll(/^\| `([a-z-]+)` \|/gm)].map(one => one[1] ?? ''),
    homes: keyed(textOf('packages/core/src/placement.ts'), /export const HOME[^=]*= \{([\s\S]*?)\n\};/),
  };
};

/** Every mirror a kind is missing from, one sentence each, naming the kind and the file to edit. */
export const judge = (mirrors: Mirrors): string[] => mirrors.kinds.flatMap(kind => missing(kind, mirrors));

/** Whichever of the four mirrors says nothing about one kind. */
function missing(kind: string, mirrors: Mirrors): string[] {
  const shipped = SHIPPED_BY_PLUGINS.includes(kind);
  const drawn = mirrors.cases.includes(kind) || mirrors.rendered.includes(kind);
  return [
    ...(mirrors.schemas.includes(kind) ? [] : [say(kind, `no schema; add packages/core/schemas/${kind}.schema.json`)]),
    ...(drawn
      ? []
      : [say(kind, 'no page in the viewer; add a case to renderDocPage, or name its function in RENDERED_BY')]),
    ...(shipped || mirrors.rows.includes(kind) ? [] : [say(kind, 'no row in packages/runtime/templates/CLAUDE.md')]),
    ...(shipped || homed(kind, mirrors)
      ? []
      : [say(kind, 'no home; add it to HOME in packages/core/src/placement.ts')]),
  ];
}

/** Whether placement has something to say about a kind, whether a layer or a top-level directory. */
function homed(kind: string, mirrors: Mirrors): boolean {
  return mirrors.homes.includes(kind) || TOP_LEVEL.includes(kind);
}

/** One violation, as a sentence naming the kind that is declared and the mirror that forgot it. */
function say(kind: string, fault: string): string {
  return `KINDS declares ${kind} but it has ${fault}`;
}

/** Every kind a schema file is there for, read off the directory rather than a second list of kinds. */
function schemaKinds(): string[] {
  return entriesOf('packages/core/schemas')
    .filter(name => name.endsWith('.schema.json'))
    .map(name => name.replace('.schema.json', ''));
}

/** The quoted names a declaration lists, in source order. */
function listed(text: string, pattern: RegExp): string[] {
  const body = pattern.exec(text)?.[1] ?? '';
  return [...body.matchAll(/'([a-z-]+)'/g)].map(one => one[1] ?? '');
}

/** The keys a record declaration maps, in source order: the kinds `HOME` has something to say about. */
function keyed(text: string, pattern: RegExp): string[] {
  const body = pattern.exec(text)?.[1] ?? '';
  return [...body.matchAll(/^ {2}'?([a-z-]+)'?:/gm)].map(one => one[1] ?? '');
}

/** The proof that the judge bites: a kind declared and then forgotten by each mirror in turn. */
export const sabotage = [
  {
    input: { kinds: ['widget'], schemas: [], cases: ['widget'], rendered: [], rows: ['widget'], homes: ['widget'] },
    violation: 'KINDS declares widget but it has no schema; add packages/core/schemas/widget.schema.json',
  },
  {
    input: { kinds: ['widget'], schemas: ['widget'], cases: [], rendered: [], rows: ['widget'], homes: ['widget'] },
    violation:
      'KINDS declares widget but it has no page in the viewer; add a case to renderDocPage, or name its function in RENDERED_BY',
  },
  {
    input: { kinds: ['widget'], schemas: ['widget'], cases: ['widget'], rendered: [], rows: [], homes: ['widget'] },
    violation: 'KINDS declares widget but it has no row in packages/runtime/templates/CLAUDE.md',
  },
  {
    input: { kinds: ['widget'], schemas: ['widget'], cases: ['widget'], rendered: [], rows: ['widget'], homes: [] },
    violation: 'KINDS declares widget but it has no home; add it to HOME in packages/core/src/placement.ts',
  },
];
