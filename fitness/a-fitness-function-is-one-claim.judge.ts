/**
 * The judge behind `a-fitness-function-is-one-claim`. A judge is a pure function over what a claim gathered,
 * and lives beside its claim rather than inside it: a file holding `describe` and `it` is a test file, and a
 * test file exports nothing (`noExportsInTest`), while `fitness/sabotage.test.ts` needs the judge by name to
 * hand it a violating input. So the claim reads the files and this module decides what is wrong with them.
 */

/** A fitness file as this claim reads it: its path and its text. */
export interface FitnessFile {
  file: string;
  text: string;
}

const HEADER = ['Claim:', 'Why:', 'Retire when:'];

/** Every way a fitness file departs from the one-claim shape, one sentence each, naming the file and the fix. */
export function judge(files: FitnessFile[]): string[] {
  return files.flatMap(({ file, text }) => [...headerFaults(file, text), ...claimFaults(file, text)]);
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

/** Whether a file holds one `it`, and whether that `it`'s title is the claim its name and header spell. */
function claimFaults(file: string, text: string): string[] {
  const titles = [...text.matchAll(/\bit\('([^']*)'/g)].map(match => match[1] ?? '');
  if (titles.length !== 1) {
    return [`${file} holds ${titles.length} it blocks; a fitness function is one claim, so split or join the file`];
  }
  const claimed = claimOf(text);
  const title = titles[0] ?? '';
  if (claimed !== title) {
    return [`${file} titles its it "${title}" but claims "${claimed}"; make the two one sentence`];
  }
  const named = claimFromName(file);
  return named === title ? [] : [`${file} claims "${title}"; name the file after the claim, as ${named} is read`];
}

/** The sentence a file's Claim line states, without its label or its full stop. */
function claimOf(text: string): string {
  const line = text.split('\n').find(each => each.includes('Claim:')) ?? '';
  return line
    .slice(line.indexOf('Claim:') + 'Claim:'.length)
    .trim()
    .replace(/\.$/, '');
}

/** The sentence a file's name spells, with each hyphen read as a space. */
function claimFromName(file: string): string {
  const stem = file.split('/').at(-1)?.replace('.fitness.ts', '') ?? '';
  return stem.split('-').join(' ');
}
