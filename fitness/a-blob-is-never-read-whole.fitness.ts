/**
 * Claim: a blob is never read whole.
 * Why: `CLAUDE.md` says "a file's bytes live in the blob registry and nowhere else ... Never buffer a blob
 *   whole beside the store", because a handle is what a graph passes and a codec is what streams. Core's
 *   `readAll` is the one function that reads a stream entire, and nothing said who may call it: its own doc
 *   comment spoke of codecs, while a handler was calling it. The rule is not "no one reads a stream whole" --
 *   some answers are the whole body -- but "the files that do are named here, with the reason each is right".
 * Retire when: a blob's bytes are reached some way other than `readAll` from `@wilanis/core`, or an operation
 *   answers a whole file through a stream the caller drains, and an RFC says which. A new caller is not that:
 *   it belongs in `MAY_READ_WHOLE` with its reason, or it is the violation this claim exists to name.
 */
import { namedImportsOf, packageDirs, sourceFiles, textOf } from './lib/sources.js';

/** The name core exports for reading a stream entire, and the package a claim about it must match. */
const WHOLE = { name: 'readAll', from: '@wilanis/core' };

/** The files that may read a body entire, each with the reason it is right rather than an exemption. */
const MAY_READ_WHOLE: Record<string, string> = {
  'packages/plugin-http/src/codecs.ts': 'the JSON, text and form codecs need the body entire; the blob codec streams',
  'packages/plugin-blob/src/index.ts':
    '@blob/text#read answers the file as a string; the string is the value, so there is no copy beside the store',
};

/** The claim this module holds, and the title the runner gives its test. */
export const claim = 'a blob is never read whole';

/** Every file under a package's `src`, and whether it imports core's `readAll`. */
export const gather = () =>
  packageDirs().flatMap(dir => sourceFiles(`${dir}/src`).map(file => ({ file, readsWhole: readsWhole(textOf(file)) })));

/** Whether a file's text imports the name core exports for reading a stream entire, from core itself. */
function readsWhole(text: string): boolean {
  return namedImportsOf(text).some(each => each.from === WHOLE.from && each.names.includes(WHOLE.name));
}

/** Every file that reads a body entire without a reason on record, one sentence each, naming the fix. */
export const judge = (files: ReturnType<typeof gather>): string[] =>
  files
    .filter(({ file, readsWhole: reads }) => reads && MAY_READ_WHOLE[file] === undefined)
    .map(
      ({ file }) =>
        `${file} imports ${WHOLE.name} from ${WHOLE.from}; stream the blob instead, or name the file in MAY_READ_WHOLE with the reason its answer is the whole body`,
    );

/** The proof that the judge bites: a file the table does not name reading a body entire. */
export const sabotage = [
  {
    input: [{ file: 'packages/plugin-reload/src/index.ts', readsWhole: true }],
    violation:
      'packages/plugin-reload/src/index.ts imports readAll from @wilanis/core; stream the blob instead, or name the file in MAY_READ_WHOLE with the reason its answer is the whole body',
  },
];
