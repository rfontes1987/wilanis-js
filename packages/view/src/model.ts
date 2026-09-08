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
import { Scope, expr, show, splitPath, substitute, hasVars, isRun, isSwitch, isMap, typeAt, TEMPLATE, WHOLE_TEMPLATE } from '@wilanis/core';
import type { Kind, Layer, Loaded, LoadResult, GraphDoc, Operation, Refusal, TriggerDoc, Type, Values } from '@wilanis/core';
import { SCHEMA_BASE, WILANIS } from '@wilanis/core';
import { bindings, checkTree, refusalsReachable } from '@wilanis/compiler';

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
export interface VSaid { lead: 'if' | 'and' | 'or'; parts: VSaidPart[] }
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
  implementations?: { path: string; label: string; operations: Record<string, { graph?: string; graphLabel?: string; run?: string }> }[];
  /** On a trigger: the port operation it fires, and where that leads. */
  fires?: VTarget;
  /** On a trigger whose kind maps refusals: every reason it can reach or maps, how it is answered, and the nodes that refuse with it. */
  answers?: VAnswer[];
}

/** One refusal reason at a trigger: how the trigger answers it (absent: not mapped), and where it comes from (empty: nothing reaches it). */
export interface VAnswer { reason: string; answer?: unknown; from: { graph: string; graphLabel: string; node: string; nodeLabel: string }[] }
/** A trigger that reaches a refusing node: how it answers that node's reason. `maps` is false when the kind answers every refusal alike. */
export interface VAnsweredBy { trigger: string; triggerLabel: string; maps: boolean; answer?: unknown }

export interface IndexEntry { path: string; kind: Kind; name: string; label: string; feature?: string; layer?: Layer; native?: string; file?: string; description: string }

/** A document's label, or its file name made readable (get-row → Get row). */
export function labelOf(doc: Loaded | undefined): string { return doc?.doc.label ?? readable(doc?.name ?? ''); }
/** kebab-case, snake_case or camelCase made into words, capitalised once. */
export function readable(id: string): string {
  const words = id.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').trim().toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : id;
}

export interface TreeIndex {
  root: string;
  project?: string;
  /** The project's aliases, so a page can canonicalise a reference written through one. */
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
    .slice().sort((a, b) => a.kind.localeCompare(b.kind) || a.path.localeCompare(b.path))
    .map(f => ({ path: f.path, kind: f.kind, name: f.name, label: labelOf(f), feature: f.feature, layer: f.layer, native: f.native, file: f.file, description: f.doc.description }));
  return { root: load.root, project: load.registry.project?.doc.name, aliases: load.registry.project?.doc.aliases ?? {}, schemaBase: SCHEMA_BASE, docs, refusals };
}

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
  const s = (schema ?? {}) as { title?: string; description?: string };
  const kind = rel.includes('/') || rel === 'common.schema.json' ? undefined : (rel.replace(/\.schema\.json$/, '') as Kind);
  return { kind: 'schema', path: `${WILANIS}/${rel}`, rel, judges: kind, label: s.title ?? rel, description: s.description ?? '', url: `${SCHEMA_BASE}/${rel}`, file, schema };
}

/** The view of one document by path (an alias is accepted); undefined when there is no such document. */
export function viewOf(load: LoadResult, ref: string): DocView | undefined {
  const scope = new Scope(load.registry, load.resolve);
  const doc = scope.any(ref);
  if (!doc) return undefined;
  const index = referenceIndex(load, scope);
  const refusals = checkTree(load).items.filter(r => r.file === doc.path || `@${r.file}` === doc.path);
  const view: DocView = {
    path: doc.path, kind: doc.kind, name: doc.name, label: labelOf(doc), feature: doc.feature, layer: doc.layer, native: doc.native,
    from: doc.native ? scope.project?.plugins.find(p => p.use === doc.native)?.from : undefined, file: doc.file,
    description: doc.doc.description, doc: doc.doc,
    refs: index.filter(r => r.from === doc.path).map(r => ({ path: r.to, label: labelOf(scope.registry.any(r.to)), kind: r.kind, at: r.at })),
    callers: callersOf(doc.path, index, scope),
    refusals,
  };
  if (doc.kind === 'graph') view.graph = graphView(scope, doc as Loaded<GraphDoc>);
  if (doc.kind === 'port') view.implementations = scope.bindingsFor(doc.path).map(b => ({
    path: b.path, label: labelOf(b),
    operations: Object.fromEntries(Object.entries(b.doc.operations).map(([op, bop]) => { const g = bop.graph ? scope.get('graph', bop.graph) : undefined; return [op, { graph: g?.path, graphLabel: g ? labelOf(g) : undefined, run: bop.run }]; })),
  }));
  if (doc.kind === 'trigger') { view.fires = targetOf(scope, (doc.doc as { fire: { run: string } }).fire.run).target; view.answers = answersOf(scope, doc as Loaded<TriggerDoc>); }
  return view;
}

// ---- refusals -------------------------------------------------------------------------------------

/** The profiles a walk from a trigger is made under: each declared one, or the one unnamed default. */
const profilesOf = (scope: Scope): (string | undefined)[] => (scope.profiles().length ? scope.profiles() : [undefined]);

/** The map a trigger's kind declares for refusal reasons, read from its settings; undefined when the kind maps none. */
function refusalMapOf(scope: Scope, t: Loaded<TriggerDoc>): { at: string; map: Record<string, unknown> } | undefined {
  const kind = scope.get('trigger-kind', t.doc.kind);
  const at = kind?.doc.refusals;
  if (!at) return undefined;
  const table = at.split('.').reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined), t.doc.settings);
  return { at, map: table && typeof table === 'object' && !Array.isArray(table) ? (table as Record<string, unknown>) : {} };
}

/** Every reason a trigger can reach under any profile, with the nodes that refuse with it; plus each reason it maps, reached or not. */
function answersOf(scope: Scope, t: Loaded<TriggerDoc>): VAnswer[] | undefined {
  const declared = refusalMapOf(scope, t);
  if (!declared) return undefined;
  const byReason = new Map<string, VAnswer>();
  const answer = (reason: string) => { let a = byReason.get(reason); if (!a) { a = { reason, answer: declared.map[reason], from: [] }; byReason.set(reason, a); } return a; };
  for (const prof of profilesOf(scope)) {
    for (const r of refusalsReachable(scope, t.doc.fire.run, prof)) {
      const a = answer(r.reason);
      if (a.from.some(f => f.graph === r.file && f.node === r.node)) continue;
      const g = scope.registry.get('graph', r.file);
      const n = g?.doc.nodes.find(x => x.id === r.node);
      a.from.push({ graph: r.file, graphLabel: labelOf(scope.registry.any(r.file)), node: r.node, nodeLabel: n?.label ?? readable(r.node) });
    }
  }
  for (const reason of Object.keys(declared.map)) answer(reason);
  return [...byReason.values()];
}

/** Every trigger whose run can reach the refusing node `node` of graph `graphPath`, and how each answers its reason. */
function answeredBy(scope: Scope, graphPath: string, node: string): VAnsweredBy[] {
  const out: VAnsweredBy[] = [];
  for (const t of scope.registry.all('trigger')) {
    const hit = profilesOf(scope).flatMap(p => refusalsReachable(scope, t.doc.fire.run, p)).find(r => r.file === graphPath && r.node === node);
    if (!hit) continue;
    const declared = refusalMapOf(scope, t);
    out.push({ trigger: t.path, triggerLabel: labelOf(t), maps: Boolean(declared), ...(declared ? { answer: declared.map[hit.reason] } : {}) });
  }
  return out;
}

// ---- references -----------------------------------------------------------------------------------

interface IndexedRef { from: string; to: string; kind: Kind; at: string; opName?: string }

/** Every string in every document that names another document, with the JSON pointer it sits at. */
function referenceIndex(load: LoadResult, scope: Scope): IndexedRef[] {
  const out: IndexedRef[] = [];
  const walk = (from: Loaded, v: unknown, at: string) => {
    if (typeof v === 'string') {
      if (!v.startsWith('@') || v.startsWith('@wilanis/')) return;
      const i = v.lastIndexOf('#');
      const path = i < 0 ? v : v.slice(0, i), op = i < 0 ? undefined : v.slice(i + 1);
      const target = scope.any(path.replace(/(\[\])+$/, ''));
      if (target && target.path !== from.path) out.push({ from: from.path, to: target.path, kind: target.kind, at, opName: op });
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(from, x, `${at}/${i}`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) { if (k !== '$schema') walk(from, x, `${at}/${k}`); }
  };
  for (const f of load.registry.files) walk(f, f.doc, '');
  return out;
}

/**
 * Who names this document. A graph behind a binding operation is also reached by every node and every
 * trigger that runs the port operation the binding meets, so those are added with `via` naming the operation.
 */
function callersOf(path: string, index: IndexedRef[], scope: Scope): VRef[] {
  const direct = index.filter(r => r.to === path);
  const label = (p: string) => labelOf(scope.registry.any(p));
  const out: VRef[] = direct.map(r => ({ path: r.from, label: label(r.from), kind: r.kind, at: r.at }));
  for (const r of direct) {
    const b = scope.registry.get('binding', r.from);
    const m = /^\/operations\/([^/]+)\//.exec(r.at);
    if (!b || !m) continue;
    const port = scope.canon(b.doc.port);
    for (const c of index) {
      if (c.opName !== m[1] || c.to !== port) continue;
      if (!out.some(o => o.path === c.from && o.at === c.at)) out.push({ path: c.from, label: label(c.from), kind: c.kind, at: c.at, via: `${port}#${m[1]}` });
    }
  }
  // the index carries the target's kind; a caller's is its own
  return out.map(c => ({ ...c, kind: scope.registry.any(c.path)?.kind ?? c.kind }));
}

// ---- graphs ---------------------------------------------------------------------------------------

const WHOLE = '';

function graphView(scope: Scope, g: Loaded<GraphDoc>): NonNullable<DocView['graph']> {
  const doc = g.doc;
  const nodes: VNode[] = [];
  const edges: VEdge[] = [];
  /** Each node's result type, for typing the attribute ports deep reads open. */
  const types = new Map<string, Type | undefined>();
  const typeOf = (spec: unknown): string | undefined => { try { return show(scope.types.spec(spec as string)); } catch { return typeof spec === 'string' ? spec : undefined; } };
  const resolvedType = (spec: unknown): Type | undefined => { try { return scope.types.spec(spec as string); } catch { return undefined; } };

  // the graph's input: one output port per field of its in type
  if (doc.in) { const t = resolvedType(doc.in); types.set('in', t); nodes.push({ id: 'in', kind: 'in', label: 'Input', type: typeOf(doc.in), inputs: [], outputs: fieldPorts(t, typeOf(doc.in)) }); }
  if (doc.constants) {
    const fields: Record<string, { type: Type; required: boolean }> = {};
    for (const [k, c] of Object.entries(doc.constants)) { const t = resolvedType(c.type); if (t) fields[k] = { type: t, required: true }; }
    types.set('const', { kind: 'object', fields, open: false });
    nodes.push({ id: 'const', kind: 'const', label: 'Constants', inputs: [], outputs: Object.entries(doc.constants).map(([k, c]) => ({ name: k, type: typeOf(c.type), literal: JSON.stringify(c.value), description: c.description })) });
  }

  // the resolvers this graph reads: name -> the segments below request, and the label a reader sees
  const resolvers = new Map<string, { path: string[]; label: string; description?: string }>();
  const rdoc = doc.resolvers ? scope.get('resolvers', doc.resolvers) : undefined;
  if (rdoc) for (const [name, r] of Object.entries(rdoc.doc.resolvers)) resolvers.set(name, { path: splitPath(r.read).slice(1), label: r.label ?? readable(name), description: r.description });

  for (const n of doc.nodes) {
    if (isSwitch(n)) {
      const label = n.label ?? readable(n.id);
      n.rules.forEach((r, i) => {
        const id = `${n.id}/${i + 1}`, last = i === n.rules.length - 1;
        const otherwise = last ? n.else : `${n.id}/${i + 2}`;
        // a rule reads only what its condition names; a condition that does not parse (a refusal says so) reads everything
        const says = said(r.when);
        const names = says ? new Set(says.flatMap(l => l.parts).flatMap(p => 'input' in p ? [p.input] : [])) : undefined;
        const read = Object.fromEntries(Object.entries(n.in).filter(([k]) => !names || names.has(k)));
        const inputs: VPort[] = Object.entries(read).map(([k, v]) => ({ name: k, ...written(scope, v) }));
        const outputs: VPort[] = [{ name: 'then', description: r.to }, ...(last ? [{ name: 'otherwise', description: n.else }] : [])];
        const lines = says ?? [{ lead: 'if' as const, parts: [{ text: r.when }] }];
        const spoken = lines.map(l => l.lead + ' ' + l.parts.map(p => 'value' in p ? p.value : p.text).join('')).join(' ');
        nodes.push({ id, kind: 'rule', label: spoken, description: r.description, inputs, outputs, says: lines, decision: { id: n.id, label, description: n.description, when: r.when, rule: i + 1, of: n.rules.length, then: r.to, otherwise, last } });
        wire(edges, id, read, resolvers);
        edges.push({ from: id, fromPort: 'then', to: r.to, toPort: WHOLE, kind: 'route' });
        edges.push({ from: id, fromPort: 'otherwise', to: otherwise, toPort: WHOLE, kind: 'route' });
      });
      continue;
    }
    const t = targetOf(scope, n.run);
    const op = t.op;
    const result = resultType(scope, op, n.in);
    if (isRun(n)) {
      types.set(n.id, result);
      nodes.push({ id: n.id, kind: 'run', label: n.label ?? readable(n.id), op: n.run, description: n.description, inputs: inputPorts(scope, op, n.in), outputs: outputPorts(result, op), target: t.target, ...(t.target.refuses ? { answeredBy: answeredBy(scope, g.path, n.id) } : {}) });
      wire(edges, n.id, n.in, resolvers);
    } else if (isMap(n)) {
      const list: Type | undefined = result ? { kind: 'list', of: result } : undefined;
      types.set(n.id, list);
      const inputs: VPort[] = [{ name: 'over', ...written(scope, n.over), description: 'the list mapped over' }, ...inputPorts(scope, op, n.in, n.bind)];
      nodes.push({ id: n.id, kind: 'map', label: n.label ?? readable(n.id), op: n.run, description: n.description, inputs, outputs: list ? [{ name: WHOLE, type: show(list) }] : [], target: t.target, bind: n.bind, onItemFailure: n.onItemFailure });
      wire(edges, n.id, { over: n.over, ...(n.in ?? {}) }, resolvers);
    }
  }

  if (doc.out) {
    const from = Array.isArray(doc.out.from) ? doc.out.from : [doc.out.from];
    // the out node shows what the graph answers: the fields of its type. Candidates arrive at the node, not at a port:
    // with several, the first that settled is the answer, and the edge says which place each one holds
    nodes.push({ id: 'out', kind: 'out', label: 'Output', type: typeOf(doc.out.type), description: doc.out.description, inputs: [], outputs: [], fields: fieldPorts(resolvedType(doc.out.type)) });
    from.forEach((f, i) => edges.push({ from: f, fromPort: WHOLE, to: 'out', toPort: WHOLE, kind: 'out', label: from.length > 1 ? `${ordinal(i + 1)} candidate` : undefined }));
  }

  // the request node: only when a read goes through a resolver. Its ports are the paths the resolvers name.
  if (rdoc && edges.some(e => e.from === 'request')) {
    nodes.unshift({ id: 'request', kind: 'request', label: 'Request', opens: rdoc.path, description: `what the trigger kind hands, read through ${labelOf(rdoc)}`, inputs: [], outputs: [] });
  }

  // a deep read opens the attribute it reads as a port under its parent, typed from the node's result
  const byId = new Map(nodes.map(n => [n.id, n]));
  for (const e of edges) {
    if (e.kind !== 'data' || e.fromPort === WHOLE) continue;
    const src = byId.get(e.from);
    if (!src) continue;
    attributePorts(src, e.fromPort, src.kind === 'request' ? (p => { const r = scope.requestRead(p); return typeof r === 'string' ? undefined : r.type; }) : (p => { const t = types.get(src.id); if (!t) return undefined; const r = typeAt(t, p); return typeof r === 'string' ? undefined : r.type; }));
  }
  const request = byId.get('request');
  if (request) for (const r of resolvers.values()) { const p = request.outputs.find(o => o.name === r.path.join('.')); if (p) { p.label = r.label; p.description = r.description; } }
  return { nodes, edges, role: scope.roleOf(g.path) };
}

/**
 * A switch condition said in words, one line per clause of its top-level `&&` (or `||`) chain:
 * `status == 200 && has(body)` → `if status is 200` / `and body exists`. Undefined when it does not parse.
 */
function said(when: string): VSaid[] | undefined {
  let e: expr.Expr;
  try { e = expr.parse(when); } catch { return undefined; }
  const top = e.t === 'bin' && (e.op === '&&' || e.op === '||') ? e.op : '&&';
  const chain = (x: expr.Expr): expr.Expr[] => x.t === 'bin' && x.op === top ? [...chain(x.l), ...chain(x.r)] : [x];
  return chain(e).map((x, i) => ({ lead: i === 0 ? 'if' : top === '&&' ? 'and' : 'or', parts: clause(x, false) }));
}

const VERB: Record<string, [string, string]> = { '==': ['is', 'is not'], '!=': ['is not', 'is'], '<': ['is below', 'is at least'], '<=': ['is at most', 'is above'], '>': ['is above', 'is at most'], '>=': ['is at least', 'is below'] };

/** One clause in words; `negate` says the clause sits under a `!`, which is folded into the verb. */
function clause(e: expr.Expr, negate: boolean): VSaidPart[] {
  const path = (p: string[]): VSaidPart => ({ input: p[0], text: p.join(' › ') });
  switch (e.t) {
    case 'lit': return [{ value: JSON.stringify(negate ? !e.v : e.v) }];
    case 'path': return negate ? [{ text: 'not ' }, path(e.p)] : [path(e.p)];
    case 'has': return [path(e.p), { text: negate ? ' is missing' : ' exists' }];
    case 'not': return clause(e.e, !negate);
    case 'len': return [{ text: 'the size of ' }, ...clause(e.e, false)];
    case 'bin': {
      if (e.op === '&&' || e.op === '||') {
        // a nested group reads inline; under a `!` it flips (De Morgan) so the verbs stay positive
        const both = (e.op === '&&') !== negate;
        return [{ text: both ? 'both ' : 'either ' }, ...clause(e.l, negate), { text: both ? ' and ' : ' or ' }, ...clause(e.r, negate)];
      }
      return [...clause(e.l, false), { text: ` ${VERB[e.op][negate ? 1 : 0]} ` }, ...clause(e.r, false)];
    }
  }
}

const ordinal = (n: number) => `${n}${['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : Math.min(n % 10, 4) % 4] ?? 'th'}`;

/**
 * Make sure a node offers the port a read names, opening every level of a deep path as an attribute under
 * its parent: `body.id` sits under `body`. A parent that is not there yet (a key of an open object) is added too.
 */
function attributePorts(node: VNode, name: string, typeAtPath: (path: string[]) => Type | undefined) {
  if (node.outputs.some(p => p.name === name)) return;
  const segs = name.split('.');
  for (let i = 1; i <= segs.length; i++) {
    const path = segs.slice(0, i), pname = path.join('.');
    if (node.outputs.some(p => p.name === pname)) continue;
    const t = typeAtPath(path);
    const port: VPort = { name: pname, type: t ? show(t) : undefined, ...(i > 1 ? { depth: i - 1 } : {}) };
    const parentAt = i > 1 ? node.outputs.findIndex(p => p.name === segs.slice(0, i - 1).join('.')) : -1;
    if (parentAt < 0) { node.outputs.push(port); continue; }
    // after the parent and after every attribute already under it
    let at = parentAt + 1;
    while (at < node.outputs.length && node.outputs[at].name.startsWith(segs.slice(0, i - 1).join('.') + '.')) at++;
    node.outputs.splice(at, 0, port);
  }
}

/** The operation a node runs and where it leads. An unknown operation still answers a target the page can name. */
function targetOf(scope: Scope, opRef: string): { op?: Operation; target: VTarget } {
  const hit = scope.op(opRef);
  const i = opRef.lastIndexOf('#');
  const path = i < 0 ? opRef : opRef.slice(0, i), opName = i < 0 ? '' : opRef.slice(i + 1);
  const portPath = scope.canon(path);
  if (typeof hit === 'string') return { target: { op: opRef, opName, port: portPath, portLabel: labelOf(scope.registry.any(portPath)) || readable(stemOf(portPath)), native: false, implementation: portPath } };
  const target: VTarget = { op: `${hit.path}#${hit.opName}`, opName: hit.opName, port: hit.path, portLabel: labelOf(hit.port), native: Boolean(hit.port.native), implementation: hit.path };
  if (hit.port.native) { target.pure = hit.op.pure === true; target.effect = hit.op.pure !== true; if (hit.op.refuses) target.refuses = true; }
  else {
    target.bindings = scope.bindingsFor(hit.path).map(b => {
      const bop = b.doc.operations[hit.opName];
      const graph = bop?.graph ? scope.get('graph', bop.graph) : undefined;
      return { path: b.path, label: labelOf(b), graph: graph?.path, graphLabel: graph ? labelOf(graph) : undefined, run: bop?.run };
    });
    const first = target.bindings[0];
    if (first) target.implementation = first.graph ?? first.path;
  }
  return { op: hit.op, target };
}

const stemOf = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(/\.json$/, '').replace(/\.[a-z-]+$/, '');

/** How one input value was written: a literal, text with reads, or a whole read (no annotation). */
function written(scope: Scope, v: unknown): Pick<VPort, 'literal' | 'text' | 'ref'> {
  if (v === undefined) return {};
  if (typeof v === 'string') {
    if (WHOLE_TEMPLATE.test(v)) return {};
    if (v.includes('{{')) return { text: v };
    const target = v.startsWith('@') ? scope.any(v.replace(/(\[\])+$/, '')) : undefined;
    return target ? { literal: JSON.stringify(v), ref: target.path } : { literal: JSON.stringify(v) };
  }
  if (scope.literal(v)) return { literal: JSON.stringify(v) };
  return { text: JSON.stringify(v) };
}

/** The input ports of an operation call: every declared field, marked when not given, plus any given field the contract does not declare. */
/** The input ports of a call: each field the operation accepts, typed with the variables this call binds, and how it is given -- written, bound from each element of a map, or not at all. */
function inputPorts(scope: Scope, op: Operation | undefined, given: Values | undefined, bind?: Record<string, string>): VPort[] {
  const ports: VPort[] = [];
  const subst = op ? bindings(scope, op, given) : {};
  const typeOf = (f: { type: unknown; enum?: string[] }): string | undefined => {
    if (f.type === 'type') return 'type';
    if (f.enum) return f.enum.map(e => JSON.stringify(e)).join(' | ');
    try { let t = scope.types.spec(f.type as never); if (hasVars(t)) t = substitute(t, subst); return show(t); } catch { return typeof f.type === 'string' ? f.type : undefined; }
  };
  for (const [k, f] of Object.entries(op?.accepts ?? {})) {
    const v = given?.[k];
    const how = v !== undefined ? written(scope, v) : bind && k in bind ? { bound: bind[k] } : { missing: true };
    ports.push({ name: k, type: typeOf(f), required: f.required !== false, static: f.static || f.type === 'type' || undefined, description: f.description, ...how });
  }
  for (const [k, v] of Object.entries(given ?? {})) if (!op?.accepts?.[k]) ports.push({ name: k, ...written(scope, v) });
  return ports;
}

/** What an operation answers at one call site: its return type with the variables its `type` fields bind. */
function resultType(scope: Scope, op: Operation | undefined, given: Values | undefined): Type | undefined {
  if (!op?.returns) return undefined;
  try { let t = scope.types.spec(op.returns); if (hasVars(t)) t = substitute(t, bindings(scope, op, given)); return t; } catch { return undefined; }
}

/** The output ports: the whole value first, then the fields of the result when it is an object. */
function outputPorts(t: Type | undefined, op: Operation | undefined): VPort[] {
  if (!op?.returns) return [];
  return [{ name: WHOLE, type: t ? show(t) : (typeof op.returns === 'string' ? op.returns : undefined) }, ...fieldPorts(t)];
}

/** One port per top-level field of an object type. */
function fieldPorts(t: Type | undefined, wholeLabel?: string): VPort[] {
  const out: VPort[] = wholeLabel !== undefined ? [{ name: WHOLE, type: wholeLabel }] : [];
  if (t?.kind === 'object') for (const [k, f] of Object.entries(t.fields)) out.push({ name: k, type: show(f.type), required: f.required });
  return out;
}

/**
 * Data edges: every {{root.path}} read in a node's inputs becomes an edge from the root's port to the input.
 * A read through a resolver leaves the request node at the path the resolver names.
 */
function wire(edges: VEdge[], to: string, values: Values | undefined, resolvers: Map<string, { path: string[] }>) {
  for (const [toPort, v] of Object.entries(values ?? {})) {
    const reads = new Set<string>();
    const collect = (x: unknown) => {
      if (typeof x === 'string') for (const m of x.matchAll(TEMPLATE)) reads.add(m[1]);
      else if (Array.isArray(x)) x.forEach(collect);
      else if (x && typeof x === 'object') Object.values(x as Record<string, unknown>).forEach(collect);
    };
    collect(v);
    for (const read of reads) {
      const [root, ...path] = splitPath(read);
      if (root === 'secrets') continue;
      const r = resolvers.get(root);
      const from = r ? 'request' : root;
      const segs = r ? [...r.path, ...path] : path;
      edges.push({ from, fromPort: segs.join('.'), to, toPort, kind: 'data' });
    }
  }
}
