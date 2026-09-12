/**
 * What only @storage can judge, before anything runs. A store says which shapes it keeps, under which
 * collection names, over which connection; a call says which store and which collection it means. The
 * compiler has judged both generically by now -- the documents resolve (R001), the constraints name fields
 * the shape has (C003 to C008), the call gives what the contract accepts (G005, G006) -- and what is left is
 * what needs the port to be understood.
 *
 * X201 a collection keeps a core shape, or one a plugin grants: the world's shape is not what a tree keeps.
 * X202 a key identifies, so it is a field of that shape and a required one.
 * X203 a store's connection reaches a storage engine, which its kind says and nothing else can.
 * X204 a call names a store this tree holds, and a collection that store declares.
 * X207 two collections of one connection are one collection, so they may not declare different shapes.
 *
 * Two rows of RFC 0002's table are not here, because the tree already answers them and a rule lives in one
 * place: an input an operation does not accept is G006, which names the inputs it does accept; a collection
 * name that is not an identifier is D001, from `propertyNames` on the store schema.
 */
import {
  assignable,
  type BindingDoc,
  type Collection,
  conforms,
  type GraphDoc,
  isMap,
  isRun,
  type Loaded,
  type ObjField,
  type PluginCheckContext,
  type ResolveRoot,
  type StoreDoc,
  show,
  type Type,
  typeAt,
  type Values,
} from '@wilanis/core';
import { type Test, type Where, WhereError, type WhereFault, whereOf } from './where.js';

type Scope = PluginCheckContext['scope'];
type Refuse = PluginCheckContext['refuse'];

const ROOT = '@storage';
const STORE_PORT = `${ROOT}/store.port.json`;
const ENGINE_PORT = `${ROOT}/storage.port.json`;

/** One collection under judgement: where it is written, and what it says. */
interface Kept {
  store: Loaded<StoreDoc>;
  name: string;
  collection: Collection;
}

/** Every collection of every store, so a rule over one reads the same thing a rule over all of them does. */
function every(scope: Scope): Kept[] {
  return scope.registry
    .all('store')
    .flatMap(store => Object.entries(store.doc.collections).map(([name, collection]) => ({ store, name, collection })));
}

/** X201, X202: what a collection keeps, and what identifies one record of it. */
function checkCollection(kept: Kept, scope: Scope, refuse: Refuse): void {
  const { store, name, collection } = kept;
  const at = `collections/${name}`;
  const shape = scope.get('shape', collection.of);
  if (!shape) return; // R001, where the store is judged
  if (!shape.native && shape.doc.layer !== 'core')
    refuse({
      code: 'X201',
      file: store.path,
      message: `'${collection.of}' is an edge shape, and the world's shape is not what a tree keeps`,
      at: `${at}/of`,
      hint: 'wilanis ls shape',
    });
  const field = shape.doc.fields[collection.key];
  if (!field) {
    const has = Object.keys(shape.doc.fields).join(', ') || 'none';
    refuse({
      code: 'X202',
      file: store.path,
      message: `'${collection.key}' is not a field of ${collection.of} (fields: ${has})`,
      at: `${at}/key`,
      hint: 'name a required field of the shape',
    });
    return;
  }
  if (field.required === false)
    refuse({
      code: 'X202',
      file: store.path,
      message: `'${collection.key}' is optional in ${collection.of}, and a key identifies every record`,
      at: `${at}/key`,
      hint: 'name a required field of the shape',
    });
}

/** X203: the connection a store sits on reaches an engine, which only its kind document says. */
function checkConnection(store: Loaded<StoreDoc>, scope: Scope, refuse: Refuse): void {
  const connection = scope.get('connection', store.doc.connection);
  if (!connection) return; // R001, where the store is judged
  const kind = scope.get('connection-kind', connection.doc.kind);
  const hint = `add the engine's plugin to project.json → plugins; wilanis ls connection`;
  const said = kind
    ? `is of kind '${connection.doc.kind}', which does not say "storage": true, so it reaches no engine`
    : `is of kind '${connection.doc.kind}', which no loaded plugin grants`;
  if (kind?.doc.storage !== true)
    refuse({ code: 'X203', file: store.path, message: `'${store.doc.connection}' ${said}`, at: 'connection', hint });
}

/** X207: a collection is the pair of its connection and its name, so one pair is one shape. */
function checkCollisions(scope: Scope, refuse: Refuse): void {
  const seen = new Map<string, { of: string; store: string }>();
  for (const { store, name, collection } of every(scope)) {
    const where = `${scope.canon(store.doc.connection)}/${name}`;
    const of = scope.canon(collection.of);
    const first = seen.get(where);
    if (!first) {
      seen.set(where, { of, store: store.path });
      continue;
    }
    if (first.of === of) continue;
    refuse({
      code: 'X207',
      file: store.path,
      message: `'${name}' over this connection already keeps ${first.of}, declared by ${first.store}, and here it keeps ${collection.of}`,
      at: `collections/${name}/of`,
      hint: 'rename one, or give both the same shape if the collection is meant to be shared',
    });
  }
}

/** One call of a storage operation: where it is written, and what it was given. */
interface Call {
  file: string;
  at: string;
  given: Values | undefined;
  /** what `{{in.*}}` reads here resolve against: the graph's in shape, or the operation's accepts */
  reads: Type | undefined;
}

/** X204: the store a call names is one this tree holds, and the collection is one that store declares. */
function checkCall(call: Call, scope: Scope, refuse: Refuse): void {
  const named = call.given?.store;
  if (typeof named !== 'string') return; // P001, where the call site is judged
  const store = scope.get('store', named);
  if (!store) {
    refuse({
      code: 'X204',
      file: call.file,
      message: `'${named}' is not a store of this tree`,
      at: `${call.at}/store`,
      hint: 'wilanis ls store',
    });
    return;
  }
  const collection = call.given?.collection;
  if (typeof collection !== 'string' || store.doc.collections[collection]) return;
  const has = Object.keys(store.doc.collections).join(', ');
  refuse({
    code: 'X204',
    file: call.file,
    message: `'${named}' declares no collection '${collection}' (collections: ${has})`,
    at: `${call.at}/collection`,
    hint: `wilanis describe ${named}`,
  });
}

/** Whether a run names an operation of one of this plugin's ports. */
function isStorageCall(run: string | undefined, scope: Scope): boolean {
  if (!run) return false;
  const port = scope.canon(run.split('#')[0]);
  return port === STORE_PORT || port === ENGINE_PORT;
}

/** The type a graph's `{{in.*}}` reads resolve against, where it declares one that resolves. */
function inOf(graph: Loaded<GraphDoc>, scope: Scope): Type | undefined {
  if (!graph.doc.in) return undefined;
  try {
    return scope.types.spec(graph.doc.in);
  } catch {
    return undefined; // R001, where the graph is judged
  }
}

/** The type a binding operation's `{{in.*}}` reads resolve against: what the port's operation accepts. */
function acceptsOf(binding: Loaded<BindingDoc>, name: string, scope: Scope): Type | undefined {
  const hit = scope.op(`${binding.doc.port}#${name}`);
  if (typeof hit === 'string') return undefined; // R001, where the binding is judged
  try {
    return scope.types.fields(hit.op.accepts);
  } catch {
    return undefined;
  }
}

/** Every storage call a graph's nodes make. */
function graphCalls(scope: Scope): Call[] {
  const out: Call[] = [];
  for (const graph of scope.registry.all('graph'))
    for (const node of graph.doc.nodes)
      if ((isRun(node) || isMap(node)) && isStorageCall(node.run, scope))
        out.push({ file: graph.path, at: `nodes/${node.id}/in`, given: node.in, reads: inOf(graph, scope) });
  return out;
}

/** Every storage call a binding's operations make. */
function bindingCalls(scope: Scope): Call[] {
  const out: Call[] = [];
  for (const binding of scope.registry.all('binding'))
    for (const [name, operation] of Object.entries(binding.doc.operations))
      if (isStorageCall(operation.run, scope))
        out.push({
          file: binding.path,
          at: `operations/${name}/in`,
          given: operation.in,
          reads: acceptsOf(binding, name, scope),
        });
  return out;
}

/** The collection a call names, once X204 has settled that it names one; nothing where it does not. */
function collectionOf(call: Call, scope: Scope): { shape: Type; fields: Record<string, ObjField> } | undefined {
  const named = call.given?.store;
  const collection = call.given?.collection;
  if (typeof named !== 'string' || typeof collection !== 'string') return undefined;
  const declared = scope.get('store', named)?.doc.collections[collection];
  if (!declared) return undefined;
  let shape: Type;
  try {
    shape = scope.types.spec(declared.of);
  } catch {
    return undefined; // R001, where the store is judged
  }
  return { shape, fields: shape.kind === 'object' ? shape.fields : {} };
}

/** Which code each way of being wrong carries, and where it sends the reader for the fix. */
const CODE_OF: Record<WhereFault, string> = { name: 'X208', value: 'X209', grammar: 'X210' };
const HINT_OF: Record<WhereFault, (store: string) => string> = {
  name: store => `wilanis describe ${store}`,
  value: store => `wilanis describe ${store}`,
  grammar: () => 'see The where grammar in @storage/store.port.json',
};

/** X208, X209, X210: the filter a call gives, held to the grammar against the collection's shape. */
function checkWhere(call: Call, shape: Type, site: Site): Where | undefined {
  try {
    // a read is not yet the value it will be, so the grammar judges its shape nowhere but at run time
    return whereOf(call.given?.where, shape, value => !site.scope.literal(value));
  } catch (error) {
    if (!(error instanceof WhereError)) throw error;
    site.refuse({
      code: CODE_OF[error.fault],
      file: call.file,
      message: error.message.replace(/^where: /, ''),
      at: [`${call.at}/where`, ...error.at].join('/'),
      hint: HINT_OF[error.fault](String(call.given?.store)),
    });
    return undefined;
  }
}

/** X208: every `order` entry names a field of the collection's shape. */
function checkOrder(call: Call, fields: Record<string, ObjField>, refuse: Refuse): void {
  const order = call.given?.order;
  if (!Array.isArray(order)) return;
  for (const [index, one] of order.entries()) {
    const by = (one as { by?: unknown })?.by;
    if (typeof by !== 'string' || fields[by]) continue;
    refuse({
      code: 'X208',
      file: call.file,
      message: `'${by}' is not a field of the collection's shape (fields: ${Object.keys(fields).join(', ')})`,
      at: `${call.at}/order/${index}/by`,
      hint: `wilanis describe ${call.given?.store}`,
    });
  }
}

/** What one operator compares with: the field's own type, a list of it, a boolean, or text. */
function wanted(test: Test, type: Type): Type {
  if (test.op === 'has') return { kind: 'boolean' };
  if (test.op === 'contains' || test.op === 'startsWith') return { kind: 'string' };
  if (test.op === 'in' || test.op === 'notIn') return { kind: 'list', of: type };
  return type;
}

/**
 * X209: one test's value is one the field would accept -- a literal judged as written, a read judged by the
 * type it reads. A read this plugin cannot see the type of is left unjudged; see the note on `check`.
 */
function checkTest(call: Call, field: string, test: Test, site: Site): void {
  const type = wanted(test, site.fields[field].type);
  const bad = site.scope.literal(test.value) ? conforms(test.value, type, field) : readMismatch(test.value, type, site);
  if (!bad) return;
  site.refuse({
    code: 'X209',
    file: call.file,
    message: bad,
    at: [`${call.at}/where`, ...test.at].join('/'),
    hint: `${field} is ${show(site.fields[field].type)}`,
  });
}

/** What a filter's values are judged against, carried down the tree rather than threaded through four params. */
interface Site {
  scope: Scope;
  refuse: Refuse;
  fields: Record<string, ObjField>;
  /** how a `{{...}}` read is typed here; it answers nothing for a root this plugin cannot see */
  resolve: ResolveRoot;
}

/**
 * What a read is typed as where this plugin can see it. `in` it can: a graph's in shape and an operation's
 * accepts are documents. A node's output it cannot -- that table is the graph checker's, and so is the
 * narrowing a switch does -- so such a read answers nothing and is left unjudged.
 */
function readsOf(reads: Type | undefined): ResolveRoot {
  return (root, path) => {
    if (root !== 'in' || !reads) return undefined;
    const read = typeAt(reads, path);
    return typeof read === 'string' ? undefined : read;
  };
}

/** Why a read does not fit, or nothing -- including where it is a read this plugin cannot type. */
function readMismatch(value: unknown, want: Type, site: Site): string | null {
  const read = site.scope.valueRead(value, site.resolve);
  if (!read || typeof read === 'string') return null;
  return assignable(read.type, want);
}

/** X209: every value the parsed filter tests with, wherever it sits under a combinator. */
function checkValues(call: Call, where: Where, site: Site): void {
  if (where.kind === 'not') {
    checkValues(call, where.of, site);
    return;
  }
  if (where.kind === 'all' || where.kind === 'any') {
    for (const one of where.of) checkValues(call, one, site);
    return;
  }
  if (!site.fields[where.field]) return;
  for (const test of where.tests) checkTest(call, where.field, test, site);
}

/** X208, X209, X210: what a call asks of the records, against the shape the collection declares. */
function checkFilter(call: Call, scope: Scope, refuse: Refuse): void {
  const collection = collectionOf(call, scope);
  if (!collection) return; // X204, or R001 where the store is judged
  const { shape, fields } = collection;
  checkOrder(call, fields, refuse);
  const site: Site = { scope, refuse, fields, resolve: readsOf(call.reads) };
  const where = checkWhere(call, shape, site);
  if (where) checkValues(call, where, site);
}

/**
 * What only @storage can judge: X201, X202, X203, X204, X207 over what a store declares, and X208 to X210
 * over what a call asks of it.
 *
 * X209 judges a literal as written and a read by the type it reads, as far as this plugin can see one: `in`
 * resolves against the graph's in shape or the operation's accepts, both of which are documents. A read of an
 * earlier node's output it cannot type -- that table is the graph checker's, and so is the narrowing a switch
 * does -- so such a read is left unjudged. Closing that needs `PluginCheckContext` to widen, which is its own
 * change; RFC 0003 records it beside X209.
 */
export function check({ scope, refuse }: PluginCheckContext): void {
  for (const kept of every(scope)) checkCollection(kept, scope, refuse);
  for (const store of scope.registry.all('store')) checkConnection(store, scope, refuse);
  checkCollisions(scope, refuse);
  for (const call of [...graphCalls(scope), ...bindingCalls(scope)]) {
    checkCall(call, scope, refuse);
    checkFilter(call, scope, refuse);
  }
}
