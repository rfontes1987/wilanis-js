/** Values of a type under a seed, for fuzzing: a deterministic generator, so a seed reproduces a run. */
import { BOOLEAN, NUMBER, type ObjectType, STRING, type Type } from './types.js';

/** Deterministic PRNG (mulberry32) so a seed reproduces a run. */
export function rng(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (low: number, high: number) => low + Math.floor(next() * (high - low + 1)),
    pick: <T>(items: T[]) => items[Math.floor(next() * items.length)],
    bool: (probability = 0.5) => next() < probability,
  };
}
export type Rng = ReturnType<typeof rng>;

const WORDS = [
  'alpha',
  'bravo',
  'charlie',
  'delta',
  'echo',
  'foxtrot',
  'golf',
  'hotel',
  'india',
  'juliet',
  'kilo',
  'lima',
  '',
  'x',
  'Zulu-9',
];
const NUMBERS = [0, 1, -1, 42, 3.5, 200, 200, 201, 404, 500];
const ANY_OF: Type[] = [
  STRING,
  NUMBER,
  BOOLEAN,
  { kind: 'list', of: STRING },
  { kind: 'object', fields: { k: { type: STRING, required: true } }, open: false },
];
const LEAF_DEPTH = 2;
const LIST_DEPTH = 3;

/** Generate a value of a type under a seed: every required field, optional ones half the time, lists of 0..3. */
export function generate(type: Type, random: Rng, depth = 0): unknown {
  switch (type.kind) {
    case 'string':
      return type.enum ? random.pick(type.enum) : generateWord(random);
    case 'number':
      return random.pick([...NUMBERS, random.int(-1000, 1000)]);
    case 'boolean':
      return random.bool();
    case 'blob':
      return generateBlob(random);
    case 'type':
      return 'unknown';
    case 'var':
    case 'unknown':
      return depth > LEAF_DEPTH ? random.pick([null, 0, 'x', true]) : generate(random.pick(ANY_OF), random, depth + 1);
    case 'list':
      return Array.from({ length: depth > LIST_DEPTH ? 0 : random.int(0, 3) }, () =>
        generate(type.of, random, depth + 1),
      );
    case 'object':
      return generateObject(type, random, depth);
  }
}

function generateWord(random: Rng): string {
  return random.pick(WORDS) + (random.bool(0.3) ? String(random.int(0, 999)) : '');
}

function generateBlob(random: Rng): Record<string, unknown> {
  const filename = random.pick(WORDS.filter(Boolean)) + random.pick(['.csv', '.txt', '.bin']);
  return {
    id: `blob-${random.int(1000, 9999)}`,
    contentType: random.pick(['text/csv', 'text/plain', 'application/octet-stream']),
    size: random.int(0, 65536),
    ...(random.bool() ? { filename } : {}),
  };
}

function generateObject(type: ObjectType, random: Rng, depth: number): Record<string, unknown> {
  const object: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(type.fields)) {
    if (field.required || random.bool()) object[name] = generate(field.type, random, depth + 1);
  }
  if (type.open && random.bool(0.3)) object[`extra${random.int(1, 9)}`] = generate(type.open, random, depth + 1);
  return object;
}
