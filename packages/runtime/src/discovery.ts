/**
 * `wilanis ls`, `wilanis describe` and `wilanis map`: what a tree holds, what one document says, and how the tree hangs
 * together, each answered as lines a terminal prints.
 */
import type { LoadResult } from '@wilanis/core';
import {
  type Kind,
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
    .map(
      f =>
        `${f.kind.padEnd(16)} ${f.path}${f.native ? '  (native)' : f.included ? `  (included from ${f.included})` : ''}`,
    );
}

export function describe(load: LoadResult, ref: string): string {
  const scope = new Scope(load.registry, load.resolve);
  const { path } = splitOp(ref.includes('#') ? ref : `${ref}#`);
  const doc = scope.any(path || ref);
  if (!doc) return `no document at '${ref}'`;
  // a native document is a plugin's: say which, and the package it came from, so who implements it is not a code detail
  const from = doc.native ? scope.project?.plugins.find(p => p.use === doc.native)?.from : undefined;
  const grantedBy = doc.native
    ? [`granted by  ${doc.native}${from ? `  (${from})` : '  (built into the runtime)'}`]
    : doc.included
      ? [`included from  ${doc.included}`]
      : [];
  const lines = [
    `${doc.kind}  ${doc.path}`,
    ...(doc.file ? [`file  ${doc.file}`] : []),
    ...grantedBy,
    doc.doc.description,
    '',
  ];
  const showType = (t: unknown) => {
    try {
      return show(scope.types.spec(t as string));
    } catch {
      return JSON.stringify(t);
    }
  };
  if (doc.kind === 'port') {
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
  } else if (doc.kind === 'trigger-kind' || doc.kind === 'connection-kind' || doc.kind === 'plugin') {
    const d = doc.doc as TriggerKindDoc;
    if (d.settings) {
      lines.push('settings:');
      for (const [k, f] of Object.entries(d.settings.fields))
        lines.push(
          `    ${k}${f.required === false ? '?' : ''}: ${typeof f.type === 'string' ? f.type : showType(f.type)}${f.enum ? ` ∈ ${f.enum.join('|')}` : ''}${f.binds ? ` binds ${f.binds}` : ''}${f.description ? `  -- ${f.description}` : ''}`,
        );
    }
    if ('context' in d) {
      lines.push('context (request.*):');
      for (const [k, f] of Object.entries(d.context.fields))
        lines.push(
          `    ${k}${f.required === false ? '?' : ''}: ${typeof f.type === 'string' ? f.type : showType(f.type)}${f.description ? `  -- ${f.description}` : ''}`,
        );
    }
    if (d.refusals)
      lines.push(
        `refusals: settings.${d.refusals} maps each reason a trigger can reach to how it is answered (T005, T006)`,
      );
    if ('grants' in (d as unknown as { grants?: unknown }))
      lines.push(`grants: ${JSON.stringify((d as unknown as { grants: unknown }).grants)}`);
    const guard = (
      d as unknown as {
        guard?: {
          context: { fields: Record<string, { type: unknown; required?: boolean; description?: string }> };
          refuses?: Record<string, string>;
          credentials?: Record<string, { type: unknown; yields: string[]; description?: string }>;
        };
      }
    ).guard;
    if (guard) {
      lines.push('guard: identifies callers before any policy runs');
      lines.push('  adds to request.*:');
      for (const [k, f] of Object.entries(guard.context.fields))
        lines.push(
          `    ${k}${f.required === false ? '?' : ''}: ${typeof f.type === 'string' ? f.type : showType(f.type)}${f.description ? `  -- ${f.description}` : ''}`,
        );
      for (const [r, why] of Object.entries(guard.refuses ?? {})) lines.push(`  refuses '${r}': ${why}`);
      lines.push('  takes, where a trigger attaches a policy ("in"):');
      for (const [k, c] of Object.entries(guard.credentials ?? {}))
        lines.push(
          `    ${k}: ${typeof c.type === 'string' ? c.type : showType(c.type)}  yields request.${c.yields.join(', request.')}${c.description ? `  -- ${c.description}` : ''}`,
        );
    }
  } else if (doc.kind === 'shape') {
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
  } else if (doc.kind === 'policy') {
    const d = doc.doc as PolicyDoc;
    lines.push(`decides through  ${d.decide.run}`);
    for (const [k, v] of Object.entries(d.decide.in ?? {}))
      lines.push(`    ${k} ← ${typeof v === 'string' ? v : JSON.stringify(v)}`);
    lines.push('outcomes (allow is the decision answering):');
    for (const [reason, o] of Object.entries(d.outcomes))
      lines.push(
        `    ${reason} → ${o.effect}${o.method ? ` (${o.method})` : ''}${o.description ? `  -- ${o.description}` : ''}`,
      );
    const gated = load.registry
      .all('trigger')
      .filter(t => (t.doc.policies ?? []).some(ref => load.resolve(policyPath(ref)) === doc.path));
    lines.push(
      gated.length
        ? `gates: ${gated.map(t => t.path).join(', ')}`
        : "gates: nothing yet -- name it under a trigger's policies",
    );
  } else if (doc.kind === 'trigger') {
    const d = doc.doc as TriggerDoc;
    lines.push(JSON.stringify(doc.doc, null, 2));
    if (d.policies?.length) lines.push(`policies, in order: ${d.policies.map(policyPath).join(', ')}`);
    for (const u of d.policies ?? [])
      if (typeof u !== 'string' && u.in)
        for (const [k, v] of Object.entries(u.in))
          lines.push(`  gives the guard '${k}' read from ${JSON.stringify(v)}`);
  } else {
    lines.push(JSON.stringify(doc.doc, null, 2));
  }
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
