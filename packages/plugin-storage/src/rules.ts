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
  type Collection,
  isMap,
  isRun,
  type Loaded,
  type PluginCheckContext,
  type StoreDoc,
  type Values,
} from '@wilanis/core';

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

/** Every storage call a graph's nodes make. */
function graphCalls(scope: Scope): Call[] {
  const out: Call[] = [];
  for (const graph of scope.registry.all('graph'))
    for (const node of graph.doc.nodes)
      if ((isRun(node) || isMap(node)) && isStorageCall(node.run, scope))
        out.push({ file: graph.path, at: `nodes/${node.id}/in`, given: node.in });
  return out;
}

/** Every storage call a binding's operations make. */
function bindingCalls(scope: Scope): Call[] {
  const out: Call[] = [];
  for (const binding of scope.registry.all('binding'))
    for (const [name, operation] of Object.entries(binding.doc.operations))
      if (isStorageCall(operation.run, scope))
        out.push({ file: binding.path, at: `operations/${name}/in`, given: operation.in });
  return out;
}

/** What only @storage can judge: X201, X202, X203, X204 and X207. */
export function check({ scope, refuse }: PluginCheckContext): void {
  for (const kept of every(scope)) checkCollection(kept, scope, refuse);
  for (const store of scope.registry.all('store')) checkConnection(store, scope, refuse);
  checkCollisions(scope, refuse);
  for (const call of [...graphCalls(scope), ...bindingCalls(scope)]) checkCall(call, scope, refuse);
}
