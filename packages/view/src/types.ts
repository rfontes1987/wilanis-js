/**
 * What a page reads: the shapes of the view model. Nothing here computes; these are the types every other module of
 * the view fills in, plus the tree index and the labels a reader sees.
 */
import { checkTree } from '@wilanis/compiler';
import type { Kind, Layer, Loaded, LoadResult, Outcome, Refusal } from '@wilanis/core';
import { SCHEMA_BASE } from '@wilanis/core';

export interface VPort {
  /** The port's name; an attribute port is its path below the parent, joined with dots (body.id). */
  name: string;
  /** How deep an attribute port sits under its parent; absent for a top-level port. */
  depth?: number;
  /** A human label for the port, when a resolver names it. */
  label?: string;
  /** The type, shown; absent when unknown. */
  type?: string;
  required?: boolean;
  /** A static field: a literal, never a read. */
  static?: boolean;
  /** The literal value written for this input, when it is one (JSON). */
  literal?: string;
  /** The document a literal names, canonical, when it is a document path (a type, a connection). */
  ref?: string;
  /** The text written for this input when it interpolates reads into text. */
  text?: string;
  /** The input was not given and the operation does not require it. */
  missing?: boolean;
  /** On a map node: the input is read from each element -- the path below it, or '' for the element whole. */
  bound?: string;
  description?: string;
}

/** Where a node's operation leads, so a click can follow it. */
export interface VTarget {
  op: string;
  /** The operation's short name. */
  opName: string;
  /** The port that declares the contract. */
  port: string;
  portLabel: string;
  native: boolean;
  pure?: boolean;
  effect?: boolean;
  /** The operation ends the graph on purpose; the node's `reason` is what the trigger maps. */
  refuses?: boolean;
  /** For a domain port: every binding that meets it, and what each does for this operation. */
  bindings?: { path: string; label: string; graph?: string; graphLabel?: string; run?: string }[];
  /** Where a click lands: the graph behind the first binding, the binding when it delegates, the port when native. */
  implementation: string;
}

export type VNodeKind = 'in' | 'const' | 'request' | 'run' | 'map' | 'rule' | 'out';

export interface VNode {
  id: string;
  kind: VNodeKind;
  /** The node's label, or its id made readable. */
  label: string;
  /** The operation a run or map node runs. */
  op?: string;
  /** The graph's in or out type, shown. */
  type?: string;
  /** A document this node stands for: the resolvers document behind the request node. */
  opens?: string;
  description?: string;
  inputs: VPort[];
  outputs: VPort[];
  /** The fields of the out type, on the out node. */
  fields?: VPort[];
  target?: VTarget;
  /** On a rule node: the decision it belongs to and its place in it. */
  decision?: VDecision;
  /** On a rule node: its condition said in words, one clause per line. */
  says?: VSaid[];
  onItemFailure?: string;
  bind?: Record<string, string>;
  /** On a node that refuses on purpose: every trigger that can reach it, and how each answers its reason. */
  answeredBy?: VAnsweredBy[];
}

/**
 * A switch is drawn as a ladder: one rule node per rule, in order, each reading only the inputs its condition
 * names. `then` routes to the rule's target; `otherwise` steps to the next rule, and leaves the ladder for the
 * switch's `else` from the last one. So "the first rule that holds wins" is the shape, not a caption.
 */
export interface VDecision {
  /** The switch node's id, shared by every rule of it. */
  id: string;
  label: string;
  description?: string;
  /** The condition as written. */
  when: string;
  /** This rule's place, from 1, and how many there are. */
  rule: number;
  of: number;
  /** The node this rule routes to when it holds. */
  then: string;
  /** Where it goes when it does not: the next rule's id, or the switch's else target from the last rule. */
  otherwise: string;
  /** True on the last rule, whose otherwise leaves the ladder. */
  last: boolean;
}

/**
 * One line of a condition said in words: `if status is 200`, `and body exists`. Its parts are words, values
 * as written, and the inputs the rule reads, so a page can point from a name in the sentence to the port.
 */
export interface VSaid {
  lead: 'if' | 'and' | 'or';
  parts: VSaidPart[];
}
export type VSaidPart = { text: string } | { value: string } | { input: string; text: string };

export interface VEdge {
  from: string;
  /** The output port, or attribute port; '' for the node's whole value. */
  fromPort: string;
  to: string;
  /** The input port; '' for the node itself (a route, or the out node). */
  toPort: string;
  kind: 'data' | 'route' | 'out';
  /** A rule's `when` on a route; the candidate's place on an out edge. */
  label?: string;
}

/** One reference from one document to another: the JSON pointer it sits at, and the document it names. */
export interface VRef {
  path: string;
  label: string;
  kind: Kind;
  at: string;
  /** For a caller reached through a binding: the port operation the binding meets. */
  via?: string;
}

export interface DocView {
  path: string;
  kind: Kind;
  name: string;
  label: string;
  feature?: string;
  layer?: Layer;
  native?: string;
  /** The package this document was included from, when it is another tree's. */
  included?: string;
  /** On a native document: the npm package that ships the plugin, absent for the runtime's builtins. */
  from?: string;
  file?: string;
  description: string;
  doc: unknown;
  /** Documents this one names, with where. */
  refs: VRef[];
  /** Documents that name this one, with where. */
  callers: VRef[];
  refusals: Refusal[];
  graph?: { nodes: VNode[]; edges: VEdge[]; role: 'domain' | 'data' };
  /** On a port: every binding that meets it, and what each does per operation. */
  implementations?: {
    path: string;
    label: string;
    operations: Record<string, { graph?: string; graphLabel?: string; run?: string }>;
  }[];
  /** On a trigger: the port operation it fires, and where that leads. */
  fires?: VTarget;
  /** On a trigger whose kind maps refusals: every reason it can reach or maps, how it is answered, and the nodes that refuse with it. */
  answers?: VAnswer[];
  /** On a trigger: the policies that gate it, in order, the operation each decides through, and the credentials the attachment gives the guard. */
  policies?: { path: string; label: string; decide: string; gives?: Record<string, unknown> }[];
  /** On a policy: the port operation it decides through, and where that leads. */
  decides?: VTarget;
  /** On a policy: what each reason its decision can refuse with means. */
  outcomes?: Record<string, Outcome>;
  /** On a policy: the request.* paths present once it allows. */
  proves?: string[];
  /** On a policy: every trigger that names it. */
  gates?: { path: string; label: string }[];
}

/** One refusal reason at a trigger: how the trigger answers it (absent: not mapped), and where it comes from (empty: nothing reaches it). */
export interface VAnswer {
  reason: string;
  answer?: unknown;
  from: { graph: string; graphLabel: string; node: string; nodeLabel: string }[];
}
/** A trigger that reaches a refusing node: how it answers that node's reason. `maps` is false when the kind answers every refusal alike. */
export interface VAnsweredBy {
  trigger: string;
  triggerLabel: string;
  maps: boolean;
  answer?: unknown;
}

export interface IndexEntry {
  path: string;
  kind: Kind;
  name: string;
  label: string;
  feature?: string;
  layer?: Layer;
  native?: string;
  included?: string;
  file?: string;
  description: string;
}

/** A document's label, or its file name made readable (get-row → Get row). */
export function labelOf(doc: Loaded | undefined): string {
  return doc?.doc.label ?? readable(doc?.name ?? '');
}
/** kebab-case, snake_case or camelCase made into words, capitalised once. */
export function readable(id: string): string {
  const words = id
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim()
    .toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : id;
}

export interface TreeIndex {
  root: string;
  project?: string;
  /** Every alias in force -- the project's and the includes' -- so a page can canonicalise a reference written through one. */
  aliases: Record<string, string>;
  /** Where the schemas are published, so a page can recognise a $schema written as a URL. */
  schemaBase: string;
  docs: IndexEntry[];
  refusals: Refusal[];
}

/** Every document of the tree and every refusal, for the document list. */
export function indexOf(load: LoadResult): TreeIndex {
  const refusals = checkTree(load).items;
  const docs = load.registry.files
    .slice()
    .sort((one, other) => one.kind.localeCompare(other.kind) || one.path.localeCompare(other.path))
    .map(file => ({
      path: file.path,
      kind: file.kind,
      name: file.name,
      label: labelOf(file),
      feature: file.feature,
      layer: file.layer,
      native: file.native,
      file: file.file,
      description: file.doc.description,
    }));
  return {
    root: load.root,
    project: load.registry.project?.doc.name,
    aliases: load.aliases,
    schemaBase: SCHEMA_BASE,
    docs,
    refusals,
  };
}
