/**
 * The view model: what a page needs to draw one document. For a graph, nodes with typed input and output
 * ports, a data edge for every {{node.field}} read from the field to the input that reads it, one rule node per
 * switch rule with a route from it, the out node's fields, and for each run or map node where its operation leads (a
 * native port, or a binding and the graph behind it). A deep read ({{asked.body.id}}) opens the field it
 * reads as an attribute port under its parent, so the edge leaves the attribute. The request a data graph
 * reads through its resolvers is a node of its own, its ports the paths the resolvers name.
 *
 * For every kind, the references the document makes and the documents that make references to it, so a
 * reader can walk the tree in both directions. Nothing here draws; it answers JSON a page lays out.
 */

import { checkTree } from '@wilanis/compiler';
import type { GraphDoc, Kind, Loaded, LoadResult, PolicyDoc, TriggerDoc } from '@wilanis/core';
import { policyPath, SCHEMA_BASE, Scope, WILANIS } from '@wilanis/core';
import { graphView } from './graphs.js';
import { stemOf, targetOf } from './ports.js';
import { callersOf, type IndexedRef, referenceIndex } from './references.js';
import { answersOf } from './refusals.js';
import type { DocView } from './types.js';
import { labelOf, readable } from './types.js';

export * from './types.js';

// ---- schemas --------------------------------------------------------------------------------------

/** A schema's path inside core's schemas directory: a kind's, or a node type's under node/. */
const SCHEMA_REL = /^(?:node\/)?[a-z-]+\.schema\.json$/;

/**
 * The schema a reference names, relative to core's schemas directory, in either form a document may write
 * it: the alias (@wilanis/node/run.schema.json) or the published URL. Undefined for anything else.
 */
export function schemaRelOf(ref: unknown): string | undefined {
  if (typeof ref !== 'string') return undefined;
  for (const prefix of [`${WILANIS}/`, `${SCHEMA_BASE}/`]) {
    if (ref.startsWith(prefix) && SCHEMA_REL.test(ref.slice(prefix.length))) return ref.slice(prefix.length);
  }
  return undefined;
}

/** One schema as a page: what it judges, where it is published, and the schema itself. */
export interface SchemaView {
  kind: 'schema';
  /** The alias a document writes: @wilanis/graph.schema.json. */
  path: string;
  /** The path inside core's schemas directory: node/run.schema.json. */
  rel: string;
  /** The document kind this schema judges, when it is a kind's schema and not a node type's or a shared one. */
  judges?: Kind;
  label: string;
  description: string;
  /** Where the schema is published. */
  url: string;
  /** The file it was read from, when known. */
  file?: string;
  schema: unknown;
}

/** The view of one schema, read from core's schemas directory. */
export function schemaViewOf(rel: string, schema: unknown, file?: string): SchemaView {
  const doc = (schema ?? {}) as { title?: string; description?: string };
  const kind =
    rel.includes('/') || rel === 'common.schema.json' ? undefined : (rel.replace(/\.schema\.json$/, '') as Kind);
  return {
    kind: 'schema',
    path: `${WILANIS}/${rel}`,
    rel,
    judges: kind,
    label: doc.title ?? rel,
    description: doc.description ?? '',
    url: `${SCHEMA_BASE}/${rel}`,
    file,
    schema,
  };
}

/** What a port's bindings meet it with: the graph or the native operation behind each of its operations. */
function implementationsOf(scope: Scope, path: string) {
  return scope.bindingsFor(path).map(binding => ({
    path: binding.path,
    label: labelOf(binding),
    operations: Object.fromEntries(
      Object.entries(binding.doc.operations).map(([name, operation]) => {
        const graph = operation.graph ? scope.get('graph', operation.graph) : undefined;
        return [name, { graph: graph?.path, graphLabel: graph ? labelOf(graph) : undefined, run: operation.run }];
      }),
    ),
  }));
}

/** The policies a trigger attaches, in order, and what each is given. */
function policiesOf(scope: Scope, trigger: TriggerDoc) {
  return (trigger.policies ?? []).map(use => {
    const ref = policyPath(use);
    const policy = scope.get('policy', ref);
    return {
      path: policy?.path ?? scope.canon(ref),
      label: policy ? labelOf(policy) : readable(stemOf(ref)),
      decide: policy?.doc.decide.run ?? '',
      ...(typeof use !== 'string' && use.in ? { gives: use.in } : {}),
    };
  });
}

/** What a trigger adds to its view: where it fires, what it answers, and the policies that gate it. */
function triggerView(scope: Scope, doc: Loaded, view: DocView) {
  const trigger = doc.doc as TriggerDoc;
  view.fires = targetOf(scope, trigger.fire.run).target;
  view.answers = answersOf(scope, doc as Loaded<TriggerDoc>);
  if (trigger.policies?.length) view.policies = policiesOf(scope, trigger);
}

/** What a policy adds to its view: what decides it, what it can answer, and the triggers it gates. */
function policyView(scope: Scope, doc: Loaded, view: DocView) {
  const policy = doc.doc as PolicyDoc;
  view.decides = targetOf(scope, policy.decide.run).target;
  view.outcomes = policy.outcomes;
  if (policy.proves?.length) view.proves = policy.proves;
  view.gates = scope.registry
    .all('trigger')
    .filter(trigger => (trigger.doc.policies ?? []).some(ref => scope.canon(policyPath(ref)) === doc.path))
    .map(trigger => ({ path: trigger.path, label: labelOf(trigger) }));
}

/** What every kind carries: where it sits, what it says, and the references it makes and receives. */
function baseView(scope: Scope, load: LoadResult, doc: Loaded, index: IndexedRef[]): DocView {
  return {
    path: doc.path,
    kind: doc.kind,
    name: doc.name,
    label: labelOf(doc),
    feature: doc.feature,
    layer: doc.layer,
    native: doc.native,
    included: doc.included,
    from: doc.native ? scope.project?.plugins.find(plugin => plugin.use === doc.native)?.from : undefined,
    file: doc.file,
    description: doc.doc.description,
    doc: doc.doc,
    refs: index
      .filter(reference => reference.from === doc.path)
      .map(reference => ({
        path: reference.to,
        label: labelOf(scope.registry.any(reference.to)),
        kind: reference.kind,
        at: reference.at,
      })),
    callers: callersOf(doc.path, index, scope),
    refusals: checkTree(load).items.filter(refusal => refusal.file === doc.path || `@${refusal.file}` === doc.path),
  };
}

/** The view of one document by path (an alias is accepted); undefined when there is no such document. */
export function viewOf(load: LoadResult, ref: string): DocView | undefined {
  const scope = new Scope(load.registry, load.resolve);
  const doc = scope.any(ref);
  if (!doc) return undefined;
  const view = baseView(scope, load, doc, referenceIndex(load, scope));
  if (doc.kind === 'graph') view.graph = graphView(scope, doc as Loaded<GraphDoc>);
  if (doc.kind === 'port') view.implementations = implementationsOf(scope, doc.path);
  if (doc.kind === 'trigger') triggerView(scope, doc, view);
  if (doc.kind === 'policy') policyView(scope, doc, view);
  return view;
}
