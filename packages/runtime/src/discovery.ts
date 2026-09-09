/**
 * `wilanis ls`, `wilanis describe` and `wilanis map`: what a tree holds, what one document says, and how the tree hangs
 * together, each answered as lines a terminal prints.
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

export function ls(load: LoadResult, kind?: Kind): string[] {
  return load.registry.files
    .filter(f => !kind || f.kind === kind)
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.path.localeCompare(b.path))
    .map(file => `${file.kind.padEnd(16)} ${file.path}${whereFrom(file)}`);
}

/** Where a document came from, when it is not the tree's own. */
function whereFrom(file: { native?: string; included?: string }): string {
  if (file.native) return '  (native)';
  return file.included ? `  (included from ${file.included})` : '';
}

/** A spec as a reader sees it, or the spec itself when it does not resolve. */
function shower(scope: Scope) {
  return (spec: unknown) => {
    try {
      return show(scope.types.spec(spec as string));
    } catch {
      return JSON.stringify(spec);
    }
  };
}

/** A port: every operation, what it accepts and what it answers. */
function portLines(doc: Loaded, showType: (spec: unknown) => string): string[] {
  const lines: string[] = [];
  for (const [name, op] of Object.entries((doc.doc as PortDoc).operations)) {
    lines.push(
      `#${name}${op.pure ? '  (pure)' : ''}${op.refuses ? '  (refuses on purpose)' : ''}${op.holds ? '  (holds until stopped)' : ''}: ${op.description}`,
    );
    for (const [k, f] of Object.entries(op.accepts ?? {}))
      lines.push(
        `    in  ${k}${f.required === false ? '?' : ''}: ${f.type === 'type' ? 'type' : showType(f.type)}${f.static || f.type === 'type' ? '  (static)' : ''}${f.binds ? ` binds ${f.binds}` : ''}${f.enum ? ` ∈ ${f.enum.join('|')}` : ''}${f.description ? `  -- ${f.description}` : ''}`,
      );
    if (op.returns) lines.push(`    returns ${showType(op.returns)}`);
  }
  return lines;
}

/** What a field says about itself: optional, its type, the values it allows, what it binds, and its description. */
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

/** A trigger kind, a connection kind or a plugin: its settings, the context it hands, and its guard. */
function kindLines(doc: Loaded, showType: (spec: unknown) => string): string[] {
  const lines: string[] = [];
  const d = doc.doc as TriggerKindDoc;
  if (d.settings) {
    lines.push('settings:');
    for (const [name, field] of Object.entries(d.settings.fields)) lines.push(fieldLine(name, field, showType));
  }
  if ('context' in d) {
    lines.push('context (request.*):');
    for (const [name, field] of Object.entries(d.context.fields)) lines.push(fieldLine(name, field, showType));
  }
  if (d.refusals)
    lines.push(
      `refusals: settings.${d.refusals} maps each reason a trigger can reach to how it is answered (T005, T006)`,
    );
  if ('grants' in (d as unknown as { grants?: unknown }))
    lines.push(`grants: ${JSON.stringify((d as unknown as { grants: unknown }).grants)}`);
  lines.push(...guardLines(d, showType));
  return lines;
}

/** What a guard declares: the context it adds, the reasons it refuses with, and the credentials it takes. */
function guardLines(d: TriggerKindDoc, showType: (spec: unknown) => string): string[] {
  const guard = (
    d as unknown as {
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
  lines.push('  takes, where a trigger attaches a policy ("in"):');
  for (const [name, credential] of Object.entries(guard.credentials ?? {}))
    lines.push(
      `    ${name}: ${typeof credential.type === 'string' ? credential.type : showType(credential.type)}  yields request.${credential.yields.join(', request.')}${credential.description ? `  -- ${credential.description}` : ''}`,
    );
  return lines;
}

/** A shape: the document, and who makes or writes values of it. */
function shapeLines(doc: Loaded, scope: Scope, load: LoadResult): string[] {
  const lines: string[] = [];
  lines.push(JSON.stringify(doc.doc, null, 2));
  // who makes or writes values of this shape: every node or delegation whose static `type` names it, with the keys it gives --
  // for a session shape, the link from each attribute to the operation that fills it
  const writers: string[] = [];
  const literal = (v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v as Record<string, unknown>) : [];
  const note = (file: string, where: string, run: string, given: Record<string, unknown> | undefined) => {
    // a `type` field naming the shape (object#make, session#set), or an input the contract declares as the shape (issue's attributes)
    const keys: string[] = [];
    let hit = typeof given?.type === 'string' && scope.canon(given.type) === doc.path;
    if (hit) keys.push(...literal(given?.values), ...literal(given?.value));
    const o = scope.op(run);
    if (typeof o !== 'string')
      for (const [k, f] of Object.entries(o.op.accepts ?? {}))
        if (typeof f.type === 'string' && scope.canon(f.type) === doc.path && given?.[k] !== undefined) {
          hit = true;
          keys.push(...literal(given[k]));
        }
    if (hit) writers.push(`    ${file}#${where}  via ${run}${keys.length ? `  (${keys.join(', ')})` : ''}`);
  };
  for (const g of load.registry.all('graph'))
    for (const n of g.doc.nodes) if ('run' in n) note(g.path, n.id, n.run, n.in);
  for (const b of load.registry.all('binding'))
    for (const [name, op] of Object.entries(b.doc.operations)) if (op.run) note(b.path, name, op.run, op.in);
  if (writers.length) lines.push('made or written by (the attributes each gives):', ...writers);
  return lines;
}

/** A policy: what decides it, what it can answer, and the triggers it gates. */
function policyLines(doc: Loaded, load: LoadResult): string[] {
  const lines: string[] = [];
  const d = doc.doc as PolicyDoc;
  lines.push(`decides through  ${d.decide.run}`);
  for (const [name, read] of Object.entries(d.decide.in ?? {}))
    lines.push(`    ${name} ← ${typeof read === 'string' ? read : JSON.stringify(read)}`);
  lines.push('outcomes (allow is the decision answering):');
  for (const [reason, outcome] of Object.entries(d.outcomes))
    lines.push(
      `    ${reason} → ${outcome.effect}${outcome.method ? ` (${outcome.method})` : ''}${outcome.description ? `  -- ${outcome.description}` : ''}`,
    );
  const gated = load.registry
    .all('trigger')
    .filter(trigger => (trigger.doc.policies ?? []).some(ref => load.resolve(policyPath(ref)) === doc.path));
  lines.push(
    gated.length
      ? `gates: ${gated.map(trigger => trigger.path).join(', ')}`
      : "gates: nothing yet -- name it under a trigger's policies",
  );
  return lines;
}

/** A trigger: the document, the policies it attaches, and what each gives the guard. */
function triggerLines(doc: Loaded): string[] {
  const d = doc.doc as TriggerDoc;
  const lines = [JSON.stringify(doc.doc, null, 2)];
  if (d.policies?.length) lines.push(`policies, in order: ${d.policies.map(policyPath).join(', ')}`);
  for (const use of d.policies ?? [])
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

/** Who granted a document: the plugin that ships it, or the tree it was included from. */
function grantLine(doc: { native?: string; included?: string }, from: string | undefined): string[] {
  if (doc.native) return [`granted by  ${doc.native}${from ? `  (${from})` : '  (built into the runtime)'}`];
  return doc.included ? [`included from  ${doc.included}`] : [];
}

export function describe(load: LoadResult, ref: string): string {
  const scope = new Scope(load.registry, load.resolve);
  const { path } = splitOp(ref.includes('#') ? ref : `${ref}#`);
  const doc = scope.any(path || ref);
  if (!doc) return `no document at '${ref}'`;
  // a native document is a plugin's: say which, and the package it came from, so who implements it is not a code detail
  const from = doc.native ? scope.project?.plugins.find(p => p.use === doc.native)?.from : undefined;
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

/** trigger → graph → ports → bindings → graphs, as a tree. */
export function map(load: LoadResult): string[] {
  const scope = new Scope(load.registry, load.resolve);
  const lines: string[] = [];
  const graph = (ref: string, indent: string, seen: Set<string>) => {
    const g = scope.get('graph', ref);
    if (!g) {
      lines.push(`${indent}?? ${ref}`);
      return;
    }
    lines.push(`${indent}${g.path}`);
    if (seen.has(g.path)) return;
    seen.add(g.path);
    for (const n of g.doc.nodes) {
      if (!('run' in n)) {
        lines.push(`${indent}  ${n.id} [switch → ${[...n.rules.map(r => r.to), n.else].join(' | ')}]`);
        continue;
      }
      const o = scope.op(n.run);
      if (typeof o === 'string') {
        lines.push(`${indent}  ${n.id} ?? ${n.run}`);
        continue;
      }
      if (o.port.native) {
        lines.push(`${indent}  ${n.id} ${n.run}${o.op.pure ? '' : '  (effect)'}`);
        continue;
      }
      const b = scope.bindingFor(o.path);
      lines.push(`${indent}  ${n.id} ${n.run}`);
      if (typeof b === 'string') {
        lines.push(`${indent}    ?? ${b}`);
        continue;
      }
      const bop = b.doc.operations[o.opName];
      lines.push(`${indent}    ${b.path}#${o.opName}${bop?.run ? ` → ${bop.run}` : ''}`);
      if (bop?.graph) graph(bop.graph, `${indent}      `, seen);
    }
  };
  for (const t of load.registry.all('trigger')) {
    lines.push(`${t.path}  (${t.doc.kind})`);
    for (const use of t.doc.policies ?? []) {
      const ref = policyPath(use);
      const p = scope.get('policy', ref);
      lines.push(
        `  gated by ${p?.path ?? `?? ${ref}`}${p ? ` → ${p.doc.decide.run}` : ''}${typeof use !== 'string' && use.in ? `  given ${Object.keys(use.in).join(', ')}` : ''}`,
      );
    }
    const o = load.registry.get('port', load.resolve(t.doc.fire.run.split('#')[0]));
    const opName = t.doc.fire.run.split('#')[1];
    lines.push(`  ${t.doc.fire.run}`);
    if (o)
      for (const b of load.registry.all('binding').filter(b => load.resolve(b.doc.port) === o.path)) {
        const bop = b.doc.operations[opName];
        if (bop?.graph) graph(bop.graph, '    ', new Set());
        else if (bop?.run) lines.push(`    ${b.path}#${opName} → ${bop.run}`);
      }
  }
  const reached = new Set(lines.filter(l => l.trim().endsWith('.graph.json')).map(l => l.trim()));
  for (const g of load.registry.all('graph')) if (!reached.has(g.path)) lines.push(`orphan  ${g.path}`);
  return lines;
}
