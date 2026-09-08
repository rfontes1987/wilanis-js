/**
 * The gates and the discovery commands. All of them work from a loaded, checked tree.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { LoadResult } from '@wilanis/core';
import { Scope } from '@wilanis/core';
import { Embedder } from './embed.js';
import { runGraph, type EffectInfo } from '@wilanis/compiler';
import type { Handler, Report } from '@wilanis/engine';
import { generate, rng, substitute, hasVars, show, type Type } from '@wilanis/core';
import { schemaUrl, splitOp, type Kind, type Loaded, type ScenarioDoc, type TriggerDoc, type TriggerKindDoc, type PortDoc, type GraphDoc, type AnyDoc } from '@wilanis/core';

// ---- stubbing ---------------------------------------------------------------------------------------

const hash = (s: string) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

/** Every effectful native operation answers a generated value of its declared type, deterministic per seed and node path. */
export function stubEffects(seed: number, record?: Record<string, unknown>) {
  return (info: EffectInfo): Handler => async ({ params, ctx }) => {
    const resolve = ctx.env.resolveType as ((ref: string) => Type) | undefined;
    let t = info.returns;
    if (t && hasVars(t) && resolve) {
      const subst: Record<string, Type> = {};
      for (const [k, f] of Object.entries(info.op.params ?? {})) if (f.binds && typeof params[k] === 'string') { try { subst[f.binds] = resolve(params[k] as string); } catch { /* unknown */ } }
      t = substitute(t, subst);
    }
    const key = ctx.nodePath.join('.');
    const value = t ? generate(t, rng(seed ^ hash(key))) : undefined;
    if (record) record[key] = value;
    return value;
  };
}

export function embedderFor(load: LoadResult, opts: { seed?: number; record?: Record<string, unknown>; profile?: string; env?: NodeJS.ProcessEnv } = {}): Embedder {
  const scope = new Scope(load.registry, load.resolve);
  const env = opts.env ?? (opts.seed !== undefined ? fakeEnv(scope) : process.env);
  return new Embedder(scope, load.plugins, { profile: opts.profile, stubEffects: opts.seed !== undefined ? stubEffects(opts.seed, opts.record) : undefined, env });
}

/** An environment where every declared secret is present, for runs that never leave the process. */
function fakeEnv(scope: Scope): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const v of Object.values(scope.project?.secrets ?? {})) env[v] = `stub-${v.toLowerCase()}`;
  return env;
}

/** A generated request context for a trigger kind, and a generated input for the trigger. */
export function generatedFire(emb: Embedder, t: Loaded<TriggerDoc>, seed: number): { input: unknown; request: Record<string, unknown> } {
  const kind = emb.scope.get('trigger-kind', t.doc.kind)!.doc as TriggerKindDoc;
  const r = rng(seed);
  const request = generate(emb.scope.contextType(kind, t.doc.settings), r) as Record<string, unknown>;
  const types = emb.types(t.doc);
  // the body/input is generated from the trigger's in type so it always conforms; the mapping is then honoured
  if (types.in) {
    if (t.doc.input !== undefined) {
      const built = emb.inputFor(t.doc, request);
      if ('input' in built) return { input: built.input, request };
      return { input: generate(types.in, r), request };
    }
    const input = generate(types.in, r);
    request.body = input;
    return { input, request };
  }
  return { input: undefined, request };
}

/** The innermost failed node of a report, through nested runs. */
export function failedLeaf(report: Report): (Report['nodes'][string] & { id: string }) | undefined {
  for (const [id, n] of Object.entries(report.nodes)) {
    if (n.status !== 'failed') continue;
    if (n.sub) { const deeper = failedLeaf(n.sub); if (deeper) return deeper; }
    return { ...n, id };
  }
  return undefined;
}

export function summarize(report: Report, indent = ''): string {
  const lines = [`${indent}${report.graph}: ${report.status}${report.needs?.length ? ` needs ${report.needs.join(', ')}` : ''}`];
  for (const [id, n] of Object.entries(report.nodes)) {
    lines.push(`${indent}  ${id}: ${n.status}${n.selected ? ` → ${n.selected}` : ''}${n.error ? ` -- ${n.error}` : ''}`);
    if (n.sub) lines.push(summarize(n.sub, indent + '    '));
  }
  return lines.join('\n');
}

// ---- rehearse ----------------------------------------------------------------------------------------

/** Run every trigger once with stubbed effects. Every graph must settle (done or failed on purpose); blocked means a wiring hole. */
export async function rehearse(load: LoadResult, opts: { seed?: number; profile?: string; verbose?: boolean } = {}): Promise<{ ok: boolean; lines: string[] }> {
  const seed = opts.seed ?? 1;
  const emb = embedderFor(load, { seed, profile: opts.profile });
  const lines: string[] = [];
  let ok = true;
  for (const t of load.registry.all('trigger')) {
    const { input, request } = generatedFire(emb, t, seed);
    const report = await emb.fire(t.doc, input, request);
    const failedNode = Object.entries(report.nodes).find(([, n]) => n.status === 'failed');
    const leaf = failedLeaf(report);
    const onPurpose = leaf?.handler?.endsWith('#fail');
    const status = report.status === 'blocked' ? 'BLOCKED' : report.status;
    if (report.status === 'blocked') ok = false;
    lines.push(`${t.path} → ${t.doc.graph}: ${status}${failedNode ? ` (${failedNode[0]}: ${failedNode[1].error}${onPurpose ? ', declared' : ''})` : ''} ${report.endedAt - report.startedAt}ms`);
    if (opts.verbose) lines.push(summarize(report, '    '));
  }
  return { ok, lines };
}

// ---- fuzz / regress ----------------------------------------------------------------------------------

function pick(report: Report, prefix = ''): ScenarioDoc['expect']['nodes'] {
  const out: ScenarioDoc['expect']['nodes'] = {};
  for (const [id, n] of Object.entries(report.nodes)) {
    const key = prefix ? `${prefix}.${id}` : id;
    out[key] = { status: n.status, ...(n.selected ? { selected: n.selected } : {}), ...(n.status === 'done' && n.out !== undefined ? { out: n.out } : {}) };
    if (n.sub) Object.assign(out, pick(n.sub, key));
  }
  return out;
}

/** Run each trigger under N seeds with stubbed effects and write one scenario per run. */
export async function fuzz(load: LoadResult, opts: { runs?: number; profile?: string; out?: string } = {}): Promise<string[]> {
  const written: string[] = [];
  const dir = join(load.root, opts.out ?? 'scenarios');
  mkdirSync(dir, { recursive: true });
  for (const t of load.registry.all('trigger')) {
    for (let seed = 1; seed <= (opts.runs ?? 5); seed++) {
      const record: Record<string, unknown> = {};
      const emb = embedderFor(load, { seed, record, profile: opts.profile });
      const { input, request } = generatedFire(emb, t, seed);
      const report = await emb.fire(t.doc, input, request);
      const sc: ScenarioDoc = {
        $schema: schemaUrl('scenario'),
        description: `${t.path} under seed ${seed}: ${report.status}. Generated by wilanis fuzz; edit stubs to pin an edge case.`,
        graph: t.doc.graph, seed, in: input, request, stubs: record,
        expect: { status: report.status, ...(report.status === 'done' ? { output: report.output } : {}), nodes: pick(report) },
      };
      const file = join(dir, `${t.name}.${seed}.scenario.json`);
      writeFileSync(file, JSON.stringify(sc, null, 2) + '\n');
      written.push(file);
    }
  }
  return written;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Replay every scenario with its recorded stubs and diff the report node by node. */
export async function regress(load: LoadResult, opts: { profile?: string } = {}): Promise<{ ok: boolean; lines: string[] }> {
  const lines: string[] = [];
  let ok = true;
  const emb = embedderFor(load, { seed: 0, profile: opts.profile, env: fakeEnvFor(load) });
  for (const sc of load.registry.all('scenario')) {
    const trigger = load.registry.all('trigger').find(t => load.resolve(t.doc.graph) === load.resolve(sc.doc.graph));
    let report: Report;
    if (trigger) report = await emb.fire(trigger.doc, sc.doc.in, sc.doc.request ?? {}, { stubs: sc.doc.stubs });
    else {
      const g = emb.scope.get('graph', sc.doc.graph)!.doc as GraphDoc;
      const initial: Record<string, unknown> = { request: sc.doc.request ?? {} };
      if (g.in) initial.in = sc.doc.in;
      report = await runGraph(emb.graph(sc.doc.graph), { initial, stubs: sc.doc.stubs, env: emb.env });
    }
    const diffs: string[] = [];
    if (report.status !== sc.doc.expect.status) diffs.push(`status ${sc.doc.expect.status} → ${report.status}`);
    if (sc.doc.expect.status === 'done' && !same(report.output, sc.doc.expect.output)) diffs.push('output changed');
    const got = pick(report);
    for (const [id, e] of Object.entries(sc.doc.expect.nodes)) {
      const n = got[id];
      if (!n) { diffs.push(`${id}: gone`); continue; }
      if (n.status !== e.status) diffs.push(`${id}: ${e.status} → ${n.status}`);
      if (e.selected && n.selected !== e.selected) diffs.push(`${id}: routed ${e.selected} → ${n.selected}`);
      if ('out' in e && !same(n.out, e.out)) diffs.push(`${id}: out changed`);
    }
    for (const id of Object.keys(got)) if (!(id in sc.doc.expect.nodes)) diffs.push(`${id}: new`);
    if (diffs.length) ok = false;
    lines.push(`${sc.path}: ${diffs.length ? 'DIFF ' + diffs.join('; ') : 'same'}`);
  }
  return { ok, lines };
}

function fakeEnvFor(load: LoadResult): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const v of Object.values(load.registry.project?.doc.secrets ?? {})) env[v] = `stub-${v.toLowerCase()}`;
  return env;
}

// ---- discovery --------------------------------------------------------------------------------------

export function ls(load: LoadResult, kind?: Kind): string[] {
  return load.registry.files
    .filter(f => !kind || f.kind === kind)
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.path.localeCompare(b.path))
    .map(f => `${f.kind.padEnd(16)} ${f.path}${f.native ? '  (native)' : ''}`);
}

export function describe(load: LoadResult, ref: string): string {
  const scope = new Scope(load.registry, load.resolve);
  const { path } = splitOp(ref.includes('#') ? ref : `${ref}#`);
  const doc = scope.any(path || ref);
  if (!doc) return `no document at '${ref}'`;
  const lines = [`${doc.kind}  ${doc.path}`, doc.doc.description, ''];
  const showType = (t: unknown) => { try { return show(scope.types.spec(t as string)); } catch { return JSON.stringify(t); } };
  if (doc.kind === 'port') {
    for (const [name, op] of Object.entries((doc.doc as PortDoc).operations)) {
      lines.push(`#${name}${op.pure ? '  (pure)' : ''}: ${op.description}`);
      for (const [k, f] of Object.entries(op.accepts ?? {})) lines.push(`    in  ${k}${f.required === false ? '?' : ''}: ${showType(f.type)}${f.description ? '  -- ' + f.description : ''}`);
      for (const [k, f] of Object.entries(op.params ?? {})) lines.push(`    param ${k}${f.required === false ? '?' : ''}: ${typeof f.type === 'string' ? f.type : showType(f.type)}${f.binds ? ` binds ${f.binds}` : ''}${f.enum ? ` ∈ ${f.enum.join('|')}` : ''}${f.description ? '  -- ' + f.description : ''}`);
      if (op.returns) lines.push(`    returns ${showType(op.returns)}`);
    }
  } else if (doc.kind === 'trigger-kind' || doc.kind === 'connection-kind' || doc.kind === 'plugin') {
    const d = doc.doc as TriggerKindDoc;
    if (d.settings) { lines.push('settings:'); for (const [k, f] of Object.entries(d.settings.fields)) lines.push(`    ${k}${f.required === false ? '?' : ''}: ${typeof f.type === 'string' ? f.type : showType(f.type)}${f.enum ? ` ∈ ${f.enum.join('|')}` : ''}${f.binds ? ` binds ${f.binds}` : ''}${f.description ? '  -- ' + f.description : ''}`); }
    if ('context' in d) { lines.push('context (request.*):'); for (const [k, f] of Object.entries(d.context.fields)) lines.push(`    ${k}${f.required === false ? '?' : ''}: ${typeof f.type === 'string' ? f.type : showType(f.type)}${f.description ? '  -- ' + f.description : ''}`); }
    if ('grants' in (d as unknown as { grants?: unknown })) lines.push(`grants: ${JSON.stringify((d as unknown as { grants: unknown }).grants)}`);
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
    if (!g) { lines.push(`${indent}?? ${ref}`); return; }
    lines.push(`${indent}${g.path}`);
    if (seen.has(g.path)) return; seen.add(g.path);
    for (const n of g.doc.nodes) {
      if (!('run' in n)) { lines.push(`${indent}  ${n.id} [switch → ${[...n.rules.map(r => r.to), n.else].join(' | ')}]`); continue; }
      const o = scope.op(n.run);
      if (typeof o === 'string') { lines.push(`${indent}  ${n.id} ?? ${n.run}`); continue; }
      if (o.port.native) { lines.push(`${indent}  ${n.id} ${n.run}${o.op.pure ? '' : '  (effect)'}`); continue; }
      const b = scope.bindingFor(o.path);
      lines.push(`${indent}  ${n.id} ${n.run}`);
      if (typeof b === 'string') { lines.push(`${indent}    ?? ${b}`); continue; }
      const bop = b.doc.operations[o.opName];
      lines.push(`${indent}    ${b.path}#${o.opName}${bop?.run ? ` → ${bop.run}` : ''}`);
      if (bop?.graph) graph(bop.graph, indent + '      ', seen);
    }
  };
  for (const t of load.registry.all('trigger')) { lines.push(`${t.path}  (${t.doc.kind})`); graph(t.doc.graph, '  ', new Set()); }
  const reached = new Set(lines.filter(l => l.trim().endsWith('.graph.json')).map(l => l.trim()));
  for (const g of load.registry.all('graph')) if (!reached.has(g.path)) lines.push(`orphan  ${g.path}`);
  return lines;
}

// ---- scaffolds -------------------------------------------------------------------------------------

export function scaffold(root: string, kind: string, target: string, opts: Record<string, string | undefined>): string[] {
  const files: [string, unknown][] = [];
  const S = (k: Kind) => schemaUrl(k);
  switch (kind) {
    case 'project':
      files.push(['package.json', { name: target, private: true, type: 'module', scripts: { check: 'wilanis check .', rehearse: 'wilanis rehearse .', serve: 'wilanis serve .' }, dependencies: { '@wilanis/plugin-http': '^0.1.0', '@wilanis/runtime': '^0.1.0' } }]);
      files.push(['project.json', { $schema: S('project'), name: target, description: 'TODO', aliases: {}, plugins: [{ use: '@std' }, { use: '@cli' }, { use: '@http', from: '@wilanis/plugin-http', settings: { port: 8080, codecs: { 'application/json': '@http/codecs/json.codec.json' } } }], secrets: {} }]);
      break;
    case 'feature':
      files.push([`features/${target}/feature.json`, { $schema: S('feature'), description: 'TODO', exports: [], effects: [] }]);
      break;
    case 'shape':
      files.push([`${target}.shape.json`, { $schema: S('shape'), layer: opts.layer ?? 'core', description: 'TODO', fields: {} }]);
      break;
    case 'port':
      files.push([`${target}.port.json`, { $schema: S('port'), description: 'TODO', operations: { example: { description: 'TODO', accepts: {}, returns: 'string' } } }]);
      break;
    case 'graph':
      files.push([`${target}.graph.json`, { $schema: S('graph'), description: 'TODO', nodes: [{ type: '@wilanis/node/run.schema.json', id: 'first', run: '@std/text.port.json#format', in: { values: {} }, params: { template: 'hello' } }], out: { type: 'string', from: 'first' } }]);
      break;
    case 'binding':
      files.push([`${target}.binding.json`, { $schema: S('binding'), description: 'TODO', port: opts.port ?? '@features/<feature>/<name>.port.json', operations: {} }]);
      break;
    case 'trigger':
      files.push([`${target}.trigger.json`, { $schema: S('trigger'), description: 'TODO', kind: opts.kind ?? '@http/http.trigger-kind.json', settings: { route: '/todo', method: 'GET', produces: 'application/json' }, graph: opts.graph ?? '@features/<feature>/graphs/<name>.graph.json' }]);
      break;
    default: throw new Error(`unknown kind '${kind}'; one of project, feature, shape, port, graph, binding, trigger`);
  }
  const written: string[] = [];
  for (const [rel, doc] of files) {
    const abs = join(root, rel);
    if (existsSync(abs)) throw new Error(`${rel} exists`);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, JSON.stringify(doc as AnyDoc, null, 2) + '\n');
    written.push(rel);
  }
  return written;
}
