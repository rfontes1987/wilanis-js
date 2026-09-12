/**
 * Shapes, ports and connections. A shape's fields resolve and speak their own layer (R001, L001, L005). A
 * port's operations resolve; a domain operation speaks core shapes and fixes no value itself (L001, L006).
 * A connection names a kind and its settings fit it, reading secrets only (R001, C001, C002). A store's
 * connection and the shape of every collection resolve and are visible to it (R001, L005), and what it holds
 * its records to -- unique, refs and defaults -- names fields that shape has and values it would accept
 * (C003 to C008).
 */
import type {
  Collection,
  ConnectionDoc,
  Loaded,
  ObjField,
  Operation,
  PortDoc,
  ShapeDoc,
  StoreDoc,
  Type,
} from '@wilanis/core';
import { conforms, show } from '@wilanis/core';
import type { Judge, Refuser } from './judge.js';
import { mismatch } from './typing.js';

/** The refusals for a shape: its fields resolve (R001) and name only shapes of its own layer, visibly (L001, L005). */
export function checkShape(judge: Judge, shape: Loaded<ShapeDoc>): void {
  const spec = { fields: shape.doc.fields, open: shape.doc.open };
  judge.type(spec, shape.path, 'fields');
  judge.checkLayer({ spec, from: shape, at: 'fields', layer: shape.doc.layer, what: `shape '${shape.path}'` });
}

/**
 * The refusals for a port: every operation's accepts and returns resolve (R001), and a domain port's speak
 * core shapes it may see (L001, L005) and fix no value of their own (L006).
 */
export function checkPort(judge: Judge, port: Loaded<PortDoc>): void {
  for (const [name, op] of Object.entries(port.doc.operations)) {
    judge.fieldsType(op.accepts, port.path, `operations/${name}/accepts`);
    judge.type(op.returns, port.path, `operations/${name}/returns`);
    if (!port.native) checkDomainOperation(judge, port, name, op);
  }
}

/** A domain operation speaks core shapes (L001) and marks nothing static (L006): a binding fixes values. */
function checkDomainOperation(judge: Judge, port: Loaded<PortDoc>, name: string, op: Operation): void {
  const at = `operations/${name}`;
  const accepts = Object.entries(op.accepts ?? {});
  for (const [key, field] of accepts) {
    judge.checkLayer({
      spec: field.type,
      from: port,
      at: `${at}/accepts/${key}`,
      layer: 'core',
      what: `${name}.accepts.${key}`,
    });
  }
  if (op.returns)
    judge.checkLayer({ spec: op.returns, from: port, at: `${at}/returns`, layer: 'core', what: `${name}.returns` });
  for (const [key, field] of accepts) {
    if (!field.static) continue;
    const message = `domain operation '${name}' marks '${key}' static -- static fields belong to native contracts; a binding fixes values`;
    judge.refuser(port.path)('L006', message, `${at}/accepts/${key}`, 'drop static, or fix the value in the binding');
  }
}

/**
 * The refusals for a connection: the kind it names exists (R001), its settings read secrets only (C001) and
 * fit what that kind declares (C002).
 */
export function checkConnection(judge: Judge, connection: Loaded<ConnectionDoc>): void {
  const refuse = judge.refuser(connection.path);
  const kind = judge.scope.get('connection-kind', connection.doc.kind);
  if (!kind) {
    refuse('R001', `unknown connection kind '${connection.doc.kind}'`, 'kind', 'wilanis ls connection-kind');
    return;
  }
  const declared = judge.type(kind.doc.settings, connection.path, 'settings');
  const read = judge.settingsRead(connection.doc.settings, connection.path, 'settings');
  const bad = mismatch(read?.type, declared);
  if (bad) refuse('C002', `settings: ${bad}`, 'settings', `wilanis describe ${connection.doc.kind}`);
}

/**
 * The refusals for a store: the connection it names and every collection's shape exist (R001) and are
 * visible to it (L005), and what each collection holds its records to is judged against that shape (C003 to
 * C008). Nothing here judges what a store *means* -- that a connection reaches an engine and that a key is a
 * required field of its shape are `@storage`'s (X202, X203), since only the plugin granting the port knows
 * them.
 */
export function checkStore(judge: Judge, store: Loaded<StoreDoc>): void {
  const refuse = judge.refuser(store.path);
  const connection = judge.scope.get('connection', store.doc.connection);
  if (connection) judge.visible(store, connection, 'connection');
  else refuse('R001', `unknown connection '${store.doc.connection}'`, 'connection', 'wilanis ls connection');
  for (const [name, collection] of Object.entries(store.doc.collections)) {
    const at = `collections/${name}/of`;
    const shape = judge.scope.get('shape', collection.of);
    if (!shape) {
      refuse('R001', `unknown shape '${collection.of}'`, at, 'wilanis ls shape');
      continue;
    }
    judge.visible(store, shape, at);
    const type = judge.type(collection.of, store.path, at);
    if (type) checkConstraints({ judge, refuse, store, name, collection, fields: fieldsOf(type) });
  }
}

/** What one collection's constraints are judged against, and where a refusal about them points. */
interface Kept {
  judge: Judge;
  refuse: Refuser;
  store: Loaded<StoreDoc>;
  name: string;
  collection: Collection;
  fields: Record<string, ObjField>;
}

const fieldsOf = (type: Type): Record<string, ObjField> => (type.kind === 'object' ? type.fields : {});

/** Whether an engine holds no single value of a field: bytes live in the blob registry, and neither a shape nor a list is one value to index. */
const unholdable = (type: Type): boolean => type.kind === 'blob' || type.kind === 'object' || type.kind === 'list';

/** What every constraint of a collection is held to, each rule reading the shape the collection declares. */
function checkConstraints(kept: Kept): void {
  checkNames(kept);
  checkUnique(kept);
  checkRefs(kept);
  checkDefaults(kept);
}

/** Every field a constraint names, with the constraint it was named by and where that sits in the document. */
function named(kept: Kept): { field: string; at: string; constraint: 'unique' | 'refs' | 'defaults' }[] {
  const { collection, name } = kept;
  const where = `collections/${name}`;
  return [
    ...(collection.unique ?? []).flatMap((one, index) =>
      one.map(field => ({ field, at: `${where}/unique/${index}`, constraint: 'unique' as const })),
    ),
    ...Object.keys(collection.refs ?? {}).map(field => ({
      field,
      at: `${where}/refs/${field}`,
      constraint: 'refs' as const,
    })),
    ...Object.keys(collection.defaults ?? {}).map(field => ({
      field,
      at: `${where}/defaults/${field}`,
      constraint: 'defaults' as const,
    })),
  ];
}

/**
 * C003: a constraint names a field of the shape. C008: and one an engine can hold a value of -- bytes live in
 * the blob registry and a shape or a list is a value an engine indexes nothing of, so neither is constrained.
 */
function checkNames(kept: Kept): void {
  const { fields, refuse, collection } = kept;
  const has = Object.keys(fields).join(', ') || 'none';
  for (const { field, at, constraint } of named(kept)) {
    const declared = fields[field];
    if (!declared) {
      refuse(
        'C003',
        `'${field}' is not a field of ${collection.of} (fields: ${has})`,
        at,
        `wilanis describe ${collection.of}`,
      );
      continue;
    }
    if (constraint === 'defaults') continue;
    if (unholdable(declared.type))
      refuse(
        'C008',
        `'${field}' is ${show(declared.type)}, and a constraint names a value an engine can hold: a string, a number or a boolean`,
        at,
        `wilanis describe ${kept.store.doc.connection}`,
      );
  }
}

/**
 * C007: the key is unique already, so no constraint repeats it. That a constraint names each field once is
 * the schema's, through `uniqueItems` on the list (RFC 0003), and a rule lives in one place.
 */
function checkUnique(kept: Kept): void {
  const { collection, name, refuse } = kept;
  for (const [index, one] of (collection.unique ?? []).entries()) {
    if (!one.includes(collection.key)) continue;
    const at = `collections/${name}/unique/${index}`;
    refuse('C007', `'${collection.key}' keys this collection, so it is unique already`, at, HINT_ONCE);
  }
}

const HINT_ONCE = 'a key is unique already; a constraint names each field once';

/** C005, C006, C007: a reference stays within the store, is not the key, and is of the key's type. */
function checkRefs(kept: Kept): void {
  const { collection, name, refuse, store } = kept;
  for (const [field, ref] of Object.entries(collection.refs ?? {})) {
    const at = `collections/${name}/refs/${field}`;
    if (field === collection.key)
      refuse('C007', `'${field}' keys this collection, so it identifies rather than refers`, at, HINT_ONCE);
    const target = store.doc.collections[ref.collection];
    if (!target) {
      const has = Object.keys(store.doc.collections).join(', ');
      const hint = 'a reference stays within one store; declare the collection here, or read it by a second get';
      refuse('C005', `'${ref.collection}' is not a collection of this store (collections: ${has})`, at, hint);
      continue;
    }
    checkRefType(kept, field, at, target);
  }
}

/**
 * C006: what a reference holds is what the collection it names is keyed by. A field C008 already refused
 * holds no value to compare, and the target's shape is looked up quietly -- an unknown one is refused once,
 * where the collection declaring it is judged.
 */
function checkRefType(kept: Kept, field: string, at: string, target: Collection): void {
  const { judge, refuse, fields } = kept;
  const held = fields[field];
  if (held && unholdable(held.type)) return;
  const targetType = judge.quiet(target.of);
  const key = targetType && fieldsOf(targetType)[target.key];
  if (!held || !key) return;
  if (show(held.type) === show(key.type)) return;
  refuse(
    'C006',
    `'${field}' is ${show(held.type)}, and it refers to records keyed by ${show(key.type)}`,
    at,
    `${field} is ${show(held.type)}; ${target.of} is keyed by ${show(key.type)}`,
  );
}

/** C004: a default is a value the field would accept, and a key is never defaulted. */
function checkDefaults(kept: Kept): void {
  const { collection, name, fields, refuse } = kept;
  for (const [field, value] of Object.entries(collection.defaults ?? {})) {
    const at = `collections/${name}/defaults/${field}`;
    const declared = fields[field];
    if (field === collection.key) {
      refuse('C004', `'${field}' keys this collection, and a key is never defaulted`, at, HINT_DEFAULT(declared));
      continue;
    }
    if (!declared) continue;
    const bad = conforms(value, declared.type, field);
    if (bad) refuse('C004', bad, at, HINT_DEFAULT(declared));
  }
}

const HINT_DEFAULT = (declared: ObjField | undefined) =>
  `write a literal of type ${declared ? show(declared.type) : "the field's"}; a key is never defaulted`;
