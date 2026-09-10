/**
 * Claim: a schema describes every property.
 * Why: `CLAUDE.md` says "every document kind has a schema with descriptions", and the schemas are what an
 *   agent reads to write a document: they are served from `main`, every document's `$schema` points at one,
 *   and the viewer draws them. A property with no description is a field a reader must guess at from its name
 *   and its type. The sentence was stated and never held: 93 of 198 properties said nothing, 12 of them by
 *   pointing at a definition that said nothing either, so three sentences on `common.schema.json`'s `$defs`
 *   cleared twelve violations at once.
 * Retire when: the descriptions are generated from the `*Doc` interfaces in `model.ts`, or a schema is no
 *   longer what a reader consults to write a document, and an RFC says what is. A `$ref` to a described
 *   definition stays a description: repeating what `common.schema.json` says once is not the goal.
 */
import { type Property, propertiesOf } from './lib/schemas.js';

/** The directories holding the schemas core serves, which is every kind a tree may write. */
const SCHEMAS = ['packages/core/schemas', 'packages/core/schemas/node'];

/** The claim this module holds, and the title the runner gives its test. */
export const claim = 'a schema describes every property';

/** Every property and definition of every schema core serves, with whether each says what it is. */
export const gather = (): Property[] => propertiesOf(SCHEMAS);

/** Every property that says nothing about itself, one sentence each, naming the path and the fix. */
export const judge = (properties: Property[]): string[] =>
  properties.filter(property => !property.described).map(sentence);

/** One violation: where the property is, and whether the fix is here or on the definition it points at. */
function sentence(property: Property): string {
  const where = `${property.file}${property.path}`;
  if (property.ref === null) return `${where} has no description; say in one line what a reader should write here`;
  return `${where} points at ${property.ref}, which describes nothing; describe that definition once, or describe this property`;
}

/** The proof that the judge bites: a plain property, one described only by reference, and a definition. */
export const sabotage = [
  {
    input: [{ file: 'packages/core/schemas/graph.schema.json', path: '/properties/out', described: false, ref: null }],
    violation:
      'packages/core/schemas/graph.schema.json/properties/out has no description; say in one line what a reader should write here',
  },
  {
    input: [
      {
        file: 'packages/core/schemas/shape.schema.json',
        path: '/properties/fields',
        described: false,
        ref: 'common.schema.json#/$defs/fields',
      },
    ],
    violation:
      'packages/core/schemas/shape.schema.json/properties/fields points at common.schema.json#/$defs/fields, which describes nothing; describe that definition once, or describe this property',
  },
  {
    input: [{ file: 'packages/core/schemas/common.schema.json', path: '/$defs/values', described: false, ref: null }],
    violation:
      'packages/core/schemas/common.schema.json/$defs/values has no description; say in one line what a reader should write here',
  },
];
