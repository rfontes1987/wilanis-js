/**
 * Claim: a fitness function is one claim.
 * Why: a decision record that holds two decisions is two records filed in one place, and a reader who trips
 *   one of them reads the other's reason. `CLAUDE.md` asks the same of a rule family and of an RFC: one file
 *   per thing decided. A fitness file is a module and not a test, so the runner gives it its claim and its
 *   proof, and the decision, how it is read, how it is judged and what breaking it looks like are one file.
 *   The same holds of the readers those modules share: `fitness/lib/` answers questions a claim asks, so a
 *   reader no claim imports is a question nobody asked -- dead code that lints clean, which is how
 *   `statementsOf` and `Manifest` survived until a reader found them by eye.
 * Retire when: a decision is recorded somewhere other than a module under `fitness/`, and an RFC says where.
 *   Until then a file that needs a second claim is two decisions, and the edit is a second file. A reader
 *   kept for a claim not yet written is not an exemption: it lands with the claim that needs it.
 */
import { entriesUnder, fitnessFiles, textOf } from './lib/sources.js';

const HEADER = ['Claim:', 'Why:', 'Retire when:'];
const EXPORTS = ['claim', 'gather', 'judge', 'sabotage'];

/** A file of the suite as this claim reads it: where it lives, and the text a rule is matched against. */
interface Reader {
  file: string;
  text: string;
}

/** The claim this module holds, and the title the runner gives its test. */
export const claim = 'a fitness function is one claim';

/** Every fitness file and every reader in `lib/`, each with its text, so the claim judges its own directory. */
export const gather = () => ({
  files: fitnessFiles().map(file => ({ file, text: textOf(file) })),
  readers: entriesUnder('fitness/lib', ['.ts']).map(file => ({ file, text: textOf(file) })),
});

/** Every way the suite departs from the one-claim shape, one sentence each, naming the file and the fix. */
export const judge = ({ files, readers }: ReturnType<typeof gather>): string[] => [
  ...files.flatMap(({ file, text }) => [
    ...headerFaults(file, text),
    ...exportFaults(file, text),
    ...testFaults(file, text),
    ...claimFaults(file, text),
  ]),
  ...readerFaults(readers, files),
];

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

/** Whether a file exports exactly the four names a fitness module owes the runner, and nothing besides. */
function exportFaults(file: string, text: string): string[] {
  const found = exportedNames(text);
  const missing = EXPORTS.filter(name => !found.includes(name));
  const extra = found.filter(name => !EXPORTS.includes(name));
  const faults = missing.length > 0 ? [`${file} exports no ${missing.join(', ')}; ${OWED}`] : [];
  if (extra.length > 0) {
    faults.push(`${file} also exports ${extra.join(', ')}; keep a helper unexported, or move a reader to fitness/lib/`);
  }
  return [...faults, ...emptySabotage(file, text, missing)];
}

const OWED = 'a fitness module exports claim, gather, judge and sabotage';

/** Whether a file's `sabotage` holds a case, since a claim that has never failed is unproved. */
function emptySabotage(file: string, text: string, missing: string[]): string[] {
  if (missing.includes('sabotage')) return [];
  const empty = /export const sabotage(?::[^=]*)? = \[\s*\]/.test(text);
  return empty ? [`${file} has no sabotage case; give the judge one input that violates the claim`] : [];
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

/** Every reader in `lib/` that no claim asks for, one sentence each, naming the export and the fix. */
function readerFaults(readers: Reader[], files: Reader[]): string[] {
  const asked = files.flatMap(({ text }) => importedNames(text));
  return readers.flatMap(({ file, text }) => {
    const kept = signatureTypes(text);
    return exportedNames(text)
      .filter(name => !asked.includes(name) && !kept.includes(name))
      .map(name => `${file} exports ${name}, which no claim imports; ${MOVE}`);
  });
}

const MOVE = 'a reader lands with the claim that needs it, so delete it or import it';

/** Every name a fitness file imports from `lib/`, so a reader is judged by the questions claims ask. */
function importedNames(text: string): string[] {
  const pattern = /import\s*\{([^}]*)\}\s*from\s*'\.\/lib\//g;
  return [...text.matchAll(pattern)].flatMap(match => (match[1] ?? '').split(',')).map(bareName);
}

/** A named import without its `type` keyword or its `as` alias, which is the name `lib/` exports. */
function bareName(named: string): string {
  return (
    named
      .trim()
      .replace(/^type\s+/, '')
      .split(/\s+as\s+/)[0] ?? ''
  ).trim();
}

/** Every type a reader's own exported signatures name, so a type a claim reads through one is not orphaned. */
function signatureTypes(text: string): string[] {
  const pattern = /^export (?:declare )?(?:function|const|let|var)\s+\w+([^{]*)/gm;
  return [...text.matchAll(pattern)].flatMap(match => (match[1] ?? '').match(/[A-Z]\w*/g) ?? []);
}

/** What `gather` answers, for a sabotage case that names files, readers, or both. */
function suite(files: Reader[], readers: Reader[] = []): ReturnType<typeof gather> {
  return { files, readers };
}

/** A reader's text: one exported function whose signature names a type, and whatever else a case adds. */
function readerText(body: string): string {
  return `${READS}${body}`;
}

const READS = [
  '/** What a reader answers. */',
  'export interface Answer {',
  '  name: string;',
  '}',
  '',
  '/** The answer a reader gives. */',
  'export function answerOf(text: string): Answer[] {',
  '  return [{ name: text }];',
  '}',
  '',
].join('\n');

/** A fitness module's text, from its header lines and the body that follows, for a sabotage case. */
function moduleText(header: string[], body = OWED_BODY): string {
  return `/**\n${header.map(line => ` * ${line}`).join('\n')}\n */\n${body}`;
}

const OWED_BODY = [
  "export const claim = 'a claim';",
  'export const gather = () => [];',
  'export const judge = () => [];',
  'export const sabotage = [{ input: [], violation: 1 }];',
  '',
].join('\n');

const FILE = 'fitness/a-claim.fitness.ts';
const HEAD = ['Claim: a claim', 'Why: a reason', 'Retire when: a condition'];

// spelled rather than written, so this file does not register a test by quoting one
const REGISTERS = `${'describe'}('fitness', () => {});`;

const READER = 'fitness/lib/reading.ts';

/** A reader's second export, which the module below does not ask for either way. */
const UNUSED = '\n/** A reader nobody asked for. */\nexport function unused(): void {}\n';

// spelled rather than written, so this fixture is a case's text and not this file asking `lib/` for a reader,
// which the rule above would read as a claim importing one and count against the real directory
const FROM = `from '.${'/lib/'}reading.js';`;

/** A module that asks the reader nothing, so both of the reader's exports are unasked. */
const ASKS_NOTHING = `${OWED_BODY}import { textOf } ${FROM}\n`;

/** A module that asks for `answerOf`, whose signature names `Answer`, so only `unused` is left unasked. */
const ASKS_ANSWER = `${OWED_BODY}import { answerOf } ${FROM}\n`;

/** The proof that this judge bites: a minimal violating module, and the violation it must name. */
export const sabotage = [
  {
    input: suite([{ file: FILE, text: moduleText(['Claim: a claim', 'Why: a reason']) }]),
    violation: `${FILE} has no Retire when: in its header; open the file with Claim, Why and Retire when`,
  },
  {
    input: suite([{ file: FILE, text: moduleText(['Why: a reason', 'Claim: a claim', 'Retire when: a condition']) }]),
    violation: `${FILE} orders its header Why:, Claim:, Retire when:; write Claim, then Why, then Retire when`,
  },
  {
    input: suite([{ file: FILE, text: moduleText(HEAD, "export const claim = 'a claim';\n") }]),
    violation: `${FILE} exports no gather, judge, sabotage; ${OWED}`,
  },
  {
    input: suite([
      { file: FILE, text: moduleText(HEAD, `${OWED_BODY}export interface Extra {\n  field: string;\n}\n`) },
    ]),
    violation: `${FILE} also exports Extra; keep a helper unexported, or move a reader to fitness/lib/`,
  },
  {
    input: suite([{ file: FILE, text: moduleText(HEAD, OWED_BODY.replace('[{ input: [], violation: 1 }]', '[]')) }]),
    violation: `${FILE} has no sabotage case; give the judge one input that violates the claim`,
  },
  {
    input: suite([{ file: FILE, text: moduleText(HEAD, `${OWED_BODY}${REGISTERS}\n`) }]),
    violation: `${FILE} registers its own test; a fitness module holds no describe and no it`,
  },
  {
    input: suite([{ file: FILE, text: moduleText(HEAD, OWED_BODY.replace("'a claim'", "'something else'")) }]),
    violation: `${FILE} exports the claim "something else" but its header states "a claim"; make the two one sentence`,
  },
  {
    input: suite([{ file: FILE, text: moduleText(HEAD, ASKS_NOTHING) }], [{ file: READER, text: readerText(UNUSED) }]),
    violation: `${READER} exports answerOf, which no claim imports; ${MOVE}`,
  },
  {
    input: suite([{ file: FILE, text: moduleText(HEAD, ASKS_ANSWER) }], [{ file: READER, text: readerText(UNUSED) }]),
    violation: `${READER} exports unused, which no claim imports; ${MOVE}`,
  },
];
