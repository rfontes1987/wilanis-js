/**
 * `wilanis ls`, `wilanis describe` and `wilanis map`: what one tree holds, what one document says, and how the tree hangs
 * together, each answered as lines one terminal prints.
 */
import type { LoadResult } from '@wilanis/core';
import {
  type Kind,
  type Loaded,
  type PolicyDoc,
  type PortDoc,
  policyPath,
  Scope,
  show,
  splitOp,
  type TriggerDoc,
  type TriggerKindDoc,
} from '@wilanis/core';

// ---- discovery --------------------------------------------------------------------------------------

/** Every document one tree holds, one line each, sorted by kind then path, and saying which are not the tree's own. */
export function ls(load: LoadResult, kind?: Kind): string[] {
  return load.registry.files
    .filter(file => !kind || file.kind === kind)
    .sort((one, other) => one.kind.localeCompare(other.kind) || one.path.localeCompare(other.path))
    .map(file => `${file.kind.padEnd(16)} ${file.path}${whereFrom(file)}`);
}

/** Where one document came from, when it is not the tree's own. */
function whereFrom(file: { native?: string; included?: string }): string {
  if (file.native) return '  (native)';
  return file.included ? `  (included from ${file.included})` : '';
}

/** A spec as one reader sees it, or the spec itself when it does not resolve. */
function shower(scope: Scope) {
  return (spec: unknown) => {
    try {
      return show(scope.types.spec(spec as string));
    } catch {
      return JSON.stringify(spec);
    }
  };
}

/** One input one port's operation accepts: one type parameter is shown as `type`, and one static one says so. */
function acceptsLine(
  name: string,
  field: { type: unknown; required?: boolean; enum?: string[]; binds?: string; static?: boolean; description?: string },
  showType: (spec: unknown) => string,
): string {
  const optional = field.required === false ? '?' : '';
  const type = field.type === 'type' ? 'type' : showType(field.type);
  const isStatic = field.static || field.type === 'type' ? '  (static)' : '';
  const binds = field.binds ? ` binds ${field.binds}` : '';
  const allowed = field.enum ? ` ∈ ${field.enum.join('|')}` : '';
  const says = field.description ? `  -- ${field.description}` : '';
  return `    in  ${name}${optional}: ${type}${isStatic}${binds}${allowed}${says}`;
}

/** What an operation says about itself: whether it is pure, may refuse, or holds something until stopped. */
function operationLine(name: string, op: { pure?: boolean; refuses?: unknown; holds?: boolean; description?: string }) {
  const pure = op.pure ? '  (pure)' : '';
  const refuses = op.refuses ? '  (refuses on purpose)' : '';
  const holds = op.holds ? '  (holds until stopped)' : '';
  return `#${name}${pure}${refuses}${holds}: ${op.description}`;
}

/** A port: every operation, what it accepts and what it answers. */
function portLines(doc: Loaded, showType: (spec: unknown) => string): string[] {
  const lines: string[] = [];
  for (const [name, op] of Object.entries((doc.doc as PortDoc).operations)) {
    lines.push(operationLine(name, op));
    for (const [field, accepts] of Object.entries(op.accepts ?? {})) lines.push(acceptsLine(field, accepts, showType));
    if (op.returns) lines.push(`    returns ${showType(op.returns)}`);
  }
  return lines;
}

/** What one field says about itself: optional, its type, the values it allows, what it binds, and its description. */
function fieldLine(
  name: string,
  field: { type: unknown; required?: boolean; enum?: string[]; binds?: string; description?: string },
  showType: (spec: unknown) => string,
): string {
  const optional = field.required === false ? '?' : '';
  const type = typeof field.type === 'string' ? field.type : showType(field.type);
  const allowed = field.enum ? ` ∈ ${field.enum.join('|')}` : '';
  const binds = field.binds ? ` binds ${field.binds}` : '';
  const says = field.description ? `  -- ${field.description}` : '';
  return `    ${name}${optional}: ${type}${allowed}${binds}${says}`;
}

/** A trigger kind, one connection kind or one plugin: its settings, the context it hands, and its guard. */
function kindLines(doc: Loaded, showType: (spec: unknown) => string): string[] {
  const lines: string[] = [];
  const declared = doc.doc as TriggerKindDoc;
  if (declared.settings) {
    lines.push('settings:');
    for (const [name, field] of Object.entries(declared.settings.fields)) lines.push(fieldLine(name, field, showType));
  }
  if ('context' in declared) {
    lines.push('context (request.*):');
    for (const [name, field] of Object.entries(declared.context.fields)) lines.push(fieldLine(name, field, showType));
  }
  if (declared.refusals)
    lines.push(
      `refusals: settings.${declared.refusals} maps each reason one trigger can reach to how it is answered (T005, T006)`,
    );
  if ('grants' in (declared as unknown as { grants?: unknown }))
    lines.push(`grants: ${JSON.stringify((declared as unknown as { grants: unknown }).grants)}`);
  lines.push(...guardLines(declared, showType));
  return lines;
}

/** What one guard declares: the context it adds, the reasons it refuses with, and the credentials it takes. */
function guardLines(declared: TriggerKindDoc, showType: (spec: unknown) => string): string[] {
  const guard = (
    declared as unknown as {
      guard?: {
        context: { fields: Record<string, { type: unknown; required?: boolean; description?: string }> };
        refuses?: Record<string, string>;
        credentials?: Record<string, { type: unknown; yields: string[]; description?: string }>;
      };
    }
  ).guard;
  if (!guard) return [];
  const lines = ['guard: identifies callers before any policy runs', '  adds to request.*:'];
  for (const [name, field] of Object.entries(guard.context.fields)) lines.push(fieldLine(name, field, showType));
  for (const [reason, why] of Object.entries(guard.refuses ?? {})) lines.push(`  refuses '${reason}': ${why}`);
  lines.push('  takes, where one trigger attaches one policy ("in"):');
  for (const [name, credential] of Object.entries(guard.credentials ?? {}))
    lines.push(
      `    ${name}: ${typeof credential.type === 'string' ? credential.type : showType(credential.type)}  yields request.${credential.yields.join(', request.')}${credential.description ? `  -- ${credential.description}` : ''}`,
    );
  return lines;
}

/** A shape: the document, and who makes or writes values of it. */
function shapeLines(doc: Loaded, scope: Scope, load: LoadResult): string[] {
  const lines = [JSON.stringify(doc.doc, null, 2)];
  const writers = [...graphWriters(load, doc.path, scope), ...bindingWriters(load, doc.path, scope)];
  if (writers.length) lines.push('made or written by (the attributes each gives):', ...writers);
  return lines;
}

/** Every node of every graph that makes or writes values of this shape. */
function graphWriters(load: LoadResult, shape: string, scope: Scope): string[] {
  const out: string[] = [];
  for (const graph of load.registry.all('graph'))
    for (const node of graph.doc.nodes) {
      if (!('run' in node)) continue;
      const said = writerLine({ file: graph.path, where: node.id, run: node.run, given: node.in }, shape, scope);
      if (said) out.push(said);
    }
  return out;
}

/** Every binding operation that makes or writes values of this shape. */
function bindingWriters(load: LoadResult, shape: string, scope: Scope): string[] {
  const out: string[] = [];
  for (const binding of load.registry.all('binding'))
    for (const [name, op] of Object.entries(binding.doc.operations)) {
      if (!op.run) continue;
      const said = writerLine({ file: binding.path, where: name, run: op.run, given: op.in }, shape, scope);
      if (said) out.push(said);
    }
  return out;
}

/** The keys one literal value gives, when it is an object. */
const keysOf = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value as Record<string, unknown>) : [];

/** Which of one call's inputs the contract declares as this shape, and the keys each was given. */
function declaredAs(run: string, given: Record<string, unknown> | undefined, shape: string, scope: Scope) {
  const found = scope.op(run);
  if (typeof found === 'string') return [];
  const keys: string[] = [];
  for (const [name, field] of Object.entries(found.op.accepts ?? {}))
    if (typeof field.type === 'string' && scope.canon(field.type) === shape && given?.[name] !== undefined)
      keys.push(...keysOf(given[name]), '');
  return keys;
}

/**
 * Whether one call makes or writes values of this shape, and the keys it gives: one `type` field naming the shape
 * (object#make, session#set), or an input the contract declares as the shape (issue's attributes).
 */
function writerLine(
  call: { file: string; where: string; run: string; given: Record<string, unknown> | undefined },
  shape: string,
  scope: Scope,
): string | undefined {
  const byType = typeof call.given?.type === 'string' && scope.canon(call.given.type) === shape;
  const keys = byType ? [...keysOf(call.given?.values), ...keysOf(call.given?.value)] : [];
  const byContract = declaredAs(call.run, call.given, shape, scope);
  if (!byType && !byContract.length) return undefined;
  const named = [...keys, ...byContract].filter(Boolean);
  return `    ${call.file}#${call.where}  via ${call.run}${named.length ? `  (${named.join(', ')})` : ''}`;
}

/** A policy: what decides it, what it can answer, and the triggers it gates. */
function policyLines(doc: Loaded, load: LoadResult): string[] {
  const lines: string[] = [];
  const declared = doc.doc as PolicyDoc;
  lines.push(`decides through  ${declared.decide.run}`);
  for (const [name, read] of Object.entries(declared.decide.in ?? {}))
    lines.push(`    ${name} ← ${typeof read === 'string' ? read : JSON.stringify(read)}`);
  lines.push('outcomes (allow is the decision answering):');
  for (const [reason, outcome] of Object.entries(declared.outcomes))
    lines.push(
      `    ${reason} → ${outcome.effect}${outcome.method ? ` (${outcome.method})` : ''}${outcome.description ? `  -- ${outcome.description}` : ''}`,
    );
  const gated = load.registry
    .all('trigger')
    .filter(trigger => (trigger.doc.policies ?? []).some(ref => load.resolve(policyPath(ref)) === doc.path));
  lines.push(
    gated.length
      ? `gates: ${gated.map(trigger => trigger.path).join(', ')}`
      : "gates: nothing yet -- name it under one trigger's policies",
  );
  return lines;
}

/** A trigger: the document, the policies it attaches, and what each gives the guard. */
function triggerLines(doc: Loaded): string[] {
  const declared = doc.doc as TriggerDoc;
  const lines = [JSON.stringify(doc.doc, null, 2)];
  if (declared.policies?.length) lines.push(`policies, in order: ${declared.policies.map(policyPath).join(', ')}`);
  for (const use of declared.policies ?? [])
    if (typeof use !== 'string' && use.in)
      for (const [name, read] of Object.entries(use.in))
        lines.push(`  gives the guard '${name}' read from ${JSON.stringify(read)}`);
  return lines;
}

/** The lines one document's kind adds, beyond what every kind says. */
function kindBody(doc: Loaded, load: LoadResult, scope: Scope, showType: (spec: unknown) => string): string[] {
  if (doc.kind === 'port') return portLines(doc, showType);
  if (doc.kind === 'trigger-kind' || doc.kind === 'connection-kind' || doc.kind === 'plugin')
    return kindLines(doc, showType);
  if (doc.kind === 'shape') return shapeLines(doc, scope, load);
  if (doc.kind === 'policy') return policyLines(doc, load);
  if (doc.kind === 'trigger') return triggerLines(doc);
  return [JSON.stringify(doc.doc, null, 2)];
}

/** Who granted one document: the plugin that ships it, or the tree it was included from. */
function grantLine(doc: { native?: string; included?: string }, from: string | undefined): string[] {
  if (doc.native) return [`granted by  ${doc.native}${from ? `  (${from})` : '  (built into the runtime)'}`];
  return doc.included ? [`included from  ${doc.included}`] : [];
}

/** One document said in full: where it lives, who granted it, what it describes, and what its kind adds. */
export function describe(load: LoadResult, ref: string): string {
  const scope = new Scope(load.registry, load.resolve);
  const { path } = splitOp(ref.includes('#') ? ref : `${ref}#`);
  const doc = scope.any(path || ref);
  if (!doc) return `no document at '${ref}'`;
  // one native document is one plugin's: say which, and the package it came from, so who implements it is not one code detail
  const from = doc.native ? scope.project?.plugins.find(plugin => plugin.use === doc.native)?.from : undefined;
  const grantedBy = grantLine(doc, from);
  const lines = [
    `${doc.kind}  ${doc.path}`,
    ...(doc.file ? [`file  ${doc.file}`] : []),
    ...grantedBy,
    doc.doc.description,
    '',
  ];
  const showType = shower(scope);
  lines.push(...kindBody(doc, load, scope, showType));
  return lines.join('\n');
}

/** trigger → graph → ports → bindings → graphs, as one tree. */
/** Where one node of one graph leads: one switch's routes, one native operation, or the binding that meets it. */
function nodeLines(node: Record<string, unknown>, indent: string, scope: Scope): { lines: string[]; into?: string } {
  const id = String(node.id);
  if (!('run' in node)) {
    const rules = node.rules as { to: string }[];
    return { lines: [`${indent}  ${id} [switch → ${[...rules.map(rule => rule.to), node.else].join(' | ')}]`] };
  }
  const run = String(node.run);
  const found = scope.op(run);
  if (typeof found === 'string') return { lines: [`${indent}  ${id} ?? ${run}`] };
  if (found.port.native) return { lines: [`${indent}  ${id} ${run}${found.op.pure ? '' : '  (effect)'}`] };
  const binding = scope.bindingFor(found.path);
  const lines = [`${indent}  ${id} ${run}`];
  if (typeof binding === 'string') return { lines: [...lines, `${indent}    ?? ${binding}`] };
  const op = binding.doc.operations[found.opName];
  lines.push(`${indent}    ${binding.path}#${found.opName}${op?.run ? ` → ${op.run}` : ''}`);
  return { lines, into: op?.graph };
}

/** One graph and everything it reaches, indented; one graph already seen is named but not walked again. */
function graphLines(ref: string, indent: string, seen: Set<string>, scope: Scope): string[] {
  const graph = scope.get('graph', ref);
  if (!graph) return [`${indent}?? ${ref}`];
  const lines = [`${indent}${graph.path}`];
  if (seen.has(graph.path)) return lines;
  seen.add(graph.path);
  for (const node of graph.doc.nodes) {
    const said = nodeLines(node as unknown as Record<string, unknown>, indent, scope);
    lines.push(...said.lines);
    if (said.into) lines.push(...graphLines(said.into, `${indent}      `, seen, scope));
  }
  return lines;
}

/** The policies one trigger is gated by, in order. */
function gateLines(trigger: Loaded<TriggerDoc>, scope: Scope): string[] {
  const lines: string[] = [];
  for (const use of trigger.doc.policies ?? []) {
    const ref = policyPath(use);
    const policy = scope.get('policy', ref);
    const decides = policy ? ` → ${policy.doc.decide.run}` : '';
    const given = typeof use !== 'string' && use.in ? `  given ${Object.keys(use.in).join(', ')}` : '';
    lines.push(`  gated by ${policy?.path ?? `?? ${ref}`}${decides}${given}`);
  }
  return lines;
}

/** What each binding of the port one trigger fires meets it with, and the graph behind it. */
function firesLines(trigger: Loaded<TriggerDoc>, load: LoadResult, scope: Scope): string[] {
  const port = load.registry.get('port', load.resolve(trigger.doc.fire.run.split('#')[0]));
  const opName = trigger.doc.fire.run.split('#')[1];
  const lines = [`  ${trigger.doc.fire.run}`];
  if (!port) return lines;
  for (const binding of load.registry.all('binding').filter(one => load.resolve(one.doc.port) === port.path)) {
    const op = binding.doc.operations[opName];
    if (op?.graph) lines.push(...graphLines(op.graph, '    ', new Set(), scope));
    else if (op?.run) lines.push(`    ${binding.path}#${opName} → ${op.run}`);
  }
  return lines;
}

/** Every trigger of the tree, everything each one reaches, and the graphs nothing reaches. */
export function map(load: LoadResult): string[] {
  const scope = new Scope(load.registry, load.resolve);
  const lines: string[] = [];
  for (const trigger of load.registry.all('trigger')) {
    lines.push(`${trigger.path}  (${trigger.doc.kind})`);
    lines.push(...gateLines(trigger, scope));
    lines.push(...firesLines(trigger, load, scope));
  }
  const reached = new Set(lines.filter(line => line.trim().endsWith('.graph.json')).map(line => line.trim()));
  for (const graph of load.registry.all('graph')) if (!reached.has(graph.path)) lines.push(`orphan  ${graph.path}`);
  return lines;
}
