/**
 * The shared suite, run against an engine. It proves the suite is executable rather than descriptive; the
 * engine here is a test double of this package, and @wilanis/plugin-storage-memory runs the same cases
 * against the real thing.
 */
import { MemoryEngine } from '@wilanis/plugin-storage-memory';
import { describe, it } from 'vitest';
import { cases } from '../src/suite.js';

const subject = {
  engine: new MemoryEngine(),
  connection: {
    connection: '@connections/records.connection.json',
    kind: '@fake/fake.connection-kind.json',
    settings: {},
  },
};

describe('what every engine answers alike', () => {
  for (const one of cases) it(one.name, () => one.run(subject));
});
