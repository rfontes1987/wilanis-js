/**
 * Claim: a fitness function is one claim.
 * Why: a decision record that holds two decisions is two records filed in one place, and a reader who trips
 *   one of them reads the other's reason. `CLAUDE.md` asks the same of a rule family and of an RFC: one file
 *   per thing decided. So every `fitness/*.fitness.ts` opens with Claim, Why and Retire when, in that order,
 *   exports the three names a fitness module exports, and holds no `describe` and no `it` of its own.
 * Retire when: a decision is recorded somewhere other than a module under `fitness/`, and an RFC says where.
 *   Until then a file that needs a second claim is two decisions, and the edit is a second file.
 */
import { fitnessFiles, textOf } from './lib/sources.js';

/** A fitness file as this claim reads it: its path and its text. */
export interface FitnessFile {
  file: string;
  text: string;
}

const HEADER = ['Claim:', 'Why:', 'Retire when:'];
const EXPORTS = ['claim', 'gather', 'judge'];

/** The claim this module holds, and the title the runner gives its `it`. */
export const claim = 'a fitness function is one claim';

/** Every fitness file in the suite, with its text, so the claim judges the directory it lives in. */
export function gather(): FitnessFile[] {
  return fitnessFiles().map(file => ({ file, text: textOf(file) }));
}

/** Every way a fitness file departs from the one-claim shape, one sentence each, naming the file and the fix. */
export function judge(files: FitnessFile[]): string[] {
  return files.flatMap(({ file, text }) => [
    ...headerFaults(file, text),
    ...exportFaults(file, text),
    ...testFaults(file, text),
    ...claimFaults(file, text),
  ]);
}

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

/** Which of the three names a fitness module owes the runner it does not export. */
function exportFaults(file: string, text: string): string[] {
  const missing = EXPORTS.filter(name => !exported(text, name));
  if (missing.length === 0) return [];
  return [`${file} exports no ${missing.join(', ')}; a fitness module exports claim, gather and judge`];
}

/** Whether a file's text exports one name, as a constant or as a function. */
function exported(text: string, name: string): boolean {
  return new RegExp(`export (?:const|function) ${name}\\b`).test(text);
}

/** Whether a file registers a test of its own, which is the runner's job and not a claim's. */
function testFaults(file: string, text: string): string[] {
  const registers = /\b(?:describe|it)\(/.test(text);
  return registers ? [`${file} registers its own test; a fitness module holds no describe and no it`] : [];
}

/** Whether the claim a file states, the claim it exports and the claim its name spells are one sentence. */
function claimFaults(file: string, text: string): string[] {
  const stated = statedClaim(text);
  const exportedClaim = exportedClaimOf(text);
  if (exportedClaim !== null && exportedClaim !== stated) {
    return [
      `${file} exports the claim "${exportedClaim}" but its header states "${stated}"; make the two one sentence`,
    ];
  }
  const named = claimFromName(file);
  return named === stated ? [] : [`${file} states "${stated}"; name the file after the claim, as ${named} is read`];
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
function exportedClaimOf(text: string): string | null {
  return /export const claim = '([^']*)'/.exec(text)?.[1] ?? null;
}

/** The sentence a file's name spells, with each hyphen read as a space. */
function claimFromName(file: string): string {
  const stem = file.split('/').at(-1)?.replace('.fitness.ts', '') ?? '';
  return stem.split('-').join(' ');
}
