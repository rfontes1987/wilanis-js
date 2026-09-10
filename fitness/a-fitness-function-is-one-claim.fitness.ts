/**
 * Claim: a fitness function is one claim.
 * Why: a decision record that holds two decisions is two records filed in one place, and a reader who trips
 *   one of them reads the other's reason. `CLAUDE.md` asks the same of a rule family and of an RFC: one file
 *   per thing decided. A fitness file is a module and not a test, so the runner gives it its one test and
 *   `fitness/sabotage.test.ts` may import its judge without registering anything a second time.
 * Retire when: a decision is recorded somewhere other than a module under `fitness/`, and an RFC says where.
 *   Until then a file that needs a second claim is two decisions, and the edit is a second file.
 */
import { fitnessFiles, textOf } from './lib/sources.js';

const HEADER = ['Claim:', 'Why:', 'Retire when:'];
const EXPORTS = ['claim', 'gather', 'judge'];

/** The claim this module holds, and the title the runner gives its test. */
export const claim = 'a fitness function is one claim';

/** Every fitness file in the suite, with its text, so the claim judges the directory it lives in. */
export const gather = () => fitnessFiles().map(file => ({ file, text: textOf(file) }));

/** Every way a fitness file departs from the one-claim shape, one sentence each, naming the file and the fix. */
export const judge = (files: ReturnType<typeof gather>): string[] =>
  files.flatMap(({ file, text }) => [
    ...headerFaults(file, text),
    ...exportFaults(file, text),
    ...testFaults(file, text),
    ...claimFaults(file, text),
  ]);

/** What is missing or out of order in a file's three header lines. */
function headerFaults(file: string, text: string): string[] {
  const header = text.slice(0, text.indexOf('*/'));
  const missing = HEADER.filter(label => !header.includes(label));
  if (missing.length > 0) {
    return [`${file} has no ${missing.join(', ')} in its header; open the file with Claim, Why and Retire when`];
  }
  const written = [...HEADER].sort((one, other) => header.indexOf(one) - header.indexOf(other));
  const ordered = written.every((label, index) => label === HEADER[index]);
  return ordered ? [] : [`${file} orders its header ${written.join(', ')}; write Claim, then Why, then Retire when`];
}

/** Whether a file exports exactly the three names a fitness module owes the runner, and nothing besides. */
function exportFaults(file: string, text: string): string[] {
  const found = exportedNames(text);
  const missing = EXPORTS.filter(name => !found.includes(name));
  const extra = found.filter(name => !EXPORTS.includes(name));
  return [
    ...(missing.length > 0
      ? [`${file} exports no ${missing.join(', ')}; a fitness module exports claim, gather and judge`]
      : []),
    ...(extra.length > 0
      ? [`${file} also exports ${extra.join(', ')}; keep a helper unexported, or move it to fitness/lib/`]
      : []),
  ];
}

/** Every name a file's text exports, whether as a constant, a function, a type or an interface. */
function exportedNames(text: string): string[] {
  const pattern = /^export (?:declare )?(?:const|let|var|function|class|type|interface|enum)\s+(\w+)/gm;
  return [...text.matchAll(pattern)].map(match => match[1] ?? '');
}

/** Whether a file registers a test of its own, which is the runner's job and not a claim's. */
function testFaults(file: string, text: string): string[] {
  const registers = /\b(?:describe|it)\(/.test(text);
  return registers ? [`${file} registers its own test; a fitness module holds no describe and no it`] : [];
}

/** Whether the claim a file exports is the sentence its header states. */
function claimFaults(file: string, text: string): string[] {
  const stated = statedClaim(text);
  const exported = exportedClaim(text);
  if (exported === null || exported === stated) return [];
  return [`${file} exports the claim "${exported}" but its header states "${stated}"; make the two one sentence`];
}

/** The sentence a file's Claim line states, without its label or its full stop. */
function statedClaim(text: string): string {
  const line = text.split('\n').find(each => each.includes('Claim:')) ?? '';
  return line
    .slice(line.indexOf('Claim:') + 'Claim:'.length)
    .trim()
    .replace(/\.$/, '');
}

/** The sentence a file's exported `claim` holds, or null where it exports none. */
function exportedClaim(text: string): string | null {
  return /export const claim = '([^']*)'/.exec(text)?.[1] ?? null;
}
