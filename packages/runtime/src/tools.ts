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
import { schemaUrl, splitOp, type Kind, type Loaded, type ScenarioDoc, type TriggerDoc, type TriggerKindDoc, type PortDoc, type GraphDoc, type BindingDoc, type AnyDoc } from '@wilanis/core';
import { casesFor, nonEmpty, setPath, switchesOf, type FoundSwitch } from './branches.js';

// ---- stubbing ---------------------------------------------------------------------------------------

const hash = (s: string) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

/** Every effectful native operation answers a generated value of its declared type, deterministic per seed and node path. */
export function stubEffects(seed: number, record?: Record<string, unknown>, types?: Record<string, Type>) {
  return (info: EffectInfo): Handler => async ({ in: i, ctx }) => {
    const resolve = ctx.env.resolveType as ((ref: string) => Type) | undefined;
    let t = info.returns;
    if (t && hasVars(t) && resolve) {
      const subst: Record<string, Type> = {};
      for (const [k, f] of Object.entries(info.op.accepts ?? {})) if (f.binds && f.type === 'type' && typeof i[k] === 'string') { try { subst[f.binds] = resolve(i[k] as string); } catch { /* unknown */ } }
      t = substitute(t, subst);
    }
    const key = ctx.nodePath.join('.');
    const value = t ? generate(t, rng(seed ^ hash(key))) : undefined;
    if (record) record[key] = value;
    if (types && t) types[key] = t;
    return value;
  };
}

export function embedderFor(load: LoadResult, opts: { seed?: number; record?: Record<string, unknown>; types?: Record<string, Type>; profile?: string; env?: NodeJS.ProcessEnv } = {}): Embedder {
  const scope = new Scope(load.registry, load.resolve);
  const env = opts.env ?? (opts.seed !== undefined ? fakeEnv(scope) : process.env);
  return new Embedder(scope, load.plugins, { profile: opts.profile, stubEffects: opts.seed !== undefined ? stubEffects(opts.seed, opts.record, opts.types) : undefined, env });
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
    if (t.doc.fire.in !== undefined) {
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

type FailedNode = Report['nodes'][string] & { id: string };

/** The innermost failed node of a report, through nested runs and through the elements of a map. */
export function failedLeaf(report: Report): FailedNode | undefined {
  for (const [id, n] of Object.entries(report.nodes)) {
    if (n.status !== 'failed') continue;
    return failedBelow(id, n) ?? { ...n, id };
  }
  return undefined;
}

/** The failure strictly inside a failed node: in the graph it ran, or in the element of a map that failed. */
export function failedBelow(id: string, n: Report['nodes'][string]): FailedNode | undefined {
  if (n.sub) return failedLeaf(n.sub);
  const i = n.items?.findIndex(e => e.status === 'failed') ?? -1;
  if (i < 0) return undefined;
  const e = n.items![i];
  return (e.sub && failedLeaf(e.sub)) || { ...e, id: `${id}.${i}` };
}

export function summarize(report: Report, indent = ''): string {
  const lines = [`${indent}${report.graph}: ${report.status}${report.needs?.length ? ` needs ${report.needs.join(', ')}` : ''}`];
  const node = (id: string, n: Report['nodes'][string], depth: string) => {
    lines.push(`${depth}${id}: ${n.status}${n.selected ? ` → ${n.selected}` : ''}${n.error ? ` -- ${n.error}` : ''}`);
    if (n.sub) lines.push(summarize(n.sub, depth + '  '));
    n.items?.forEach((e, i) => node(`${id}.${i}`, e, depth + '  '));
  };
  for (const [id, n] of Object.entries(report.nodes)) node(id, n, indent + '  ');
  return lines.join('\n');
}

// ---- rehearse ----------------------------------------------------------------------------------------

/** One line per outcome, and whether the whole rehearsal is acceptable. */
export interface Rehearsal { ok: boolean; lines: string[] }

/** What one run of one branch settled to, judged at the graph that owns the decision. */
interface Settled {
  /** done, failed, or BLOCKED. */
  status: string;
  /** The declared failure, when the graph failed on purpose at a #refuse node. */
  declared?: string;
  /** A failure the graph did not declare: a bug, not a designed outcome. */
  error?: string;
  /** A declared failure that came from a graph this one calls, and the node it came through. */
  propagated?: { node: string; error: string };
  blocked: boolean;
  /** The node the switch actually routed to, when it is not the one the branch aimed at. */
  misrouted?: string;
}

/** The report of the graph at a dotted node path, or the whole report at the top. A map node is followed by the index of the element to read. */
function reportAt(report: Report, prefix: string[]): Report | undefined {
  let cur: Report | undefined = report;
  for (let i = 0; i < prefix.length; i++) {
    const n: Report['nodes'][string] | undefined = cur?.nodes?.[prefix[i]];
    if (!n) return undefined;
    if (n.items) { cur = n.items[Number(prefix[++i])]?.sub; continue; }
    cur = n.sub;
  }
  return cur;
}

/**
 * Judge one run at the graph that owns the switch. A branch that routes correctly into a nested graph
 * which then declares a failure is a success of the routing, so the outcome is read where the decision
 * was made rather than at the trigger, where every nested failure looks alike.
 */
function settle(report: Report, sw: FoundSwitch, aim: string): Settled {
  const local = reportAt(report, sw.prefix) ?? report;
  const node = local.nodes[sw.at.split('.').pop()!];
  const took = node?.selected;
  const misrouted = took !== undefined && took !== aim ? took : undefined;
  const failed = Object.entries(local.nodes).find(([, n]) => n.status === 'failed');
  const out: Settled = {
    status: local.status === 'blocked' ? 'BLOCKED' : local.status,
    blocked: local.status === 'blocked',
    misrouted,
  };
  if (local.status !== 'failed' || !failed) return out;
  const [id, n] = failed;
  // a fail node in THIS graph is a declared outcome; a failure that arrived from a graph this one calls
  // is that graph's declared outcome surfacing here, and naming it as ours would credit the wrong document
  if (n.handler?.endsWith('#refuse')) { out.declared = n.error ?? ''; return out; }
  const deeper = failedBelow(id, n);
  if (deeper?.handler?.endsWith('#refuse')) { out.propagated = { node: id, error: deeper.error ?? '' }; return out; }
  out.error = `${id}: ${n.error}`;
  return out;
}

/**
 * Run every trigger with stubbed effects, and every branch of every switch those triggers reach.
 *
 * A rehearsal answers one question: is every path through this project wired up? Effects are stubbed, so
 * nothing leaves the process; what is being judged is the routing, not the data. Each switch is solved
 * from its own rules -- the inputs that make one rule true while the rules before it are false -- so a
 * branch is exercised whether or not a generated value would have happened to reach it.
 *
 * A branch is acceptable when it settles: the graph answers, or it fails at a #refuse node it declared.
 * It is a problem when the graph blocks (an input nothing supplies), fails somewhere it did not declare,
 * routes somewhere other than where its rule points, or when no inputs can reach the branch at all.
 */
export async function rehearse(load: LoadResult, opts: { seed?: number; profile?: string; verbose?: boolean } = {}): Promise<Rehearsal> {
  const seed = opts.seed ?? 1;
  const lines: string[] = [];
  const decisions: Decision[] = [];
  const settledGraphs: { trigger: string; graph: string; status: string; declared?: string; error?: string }[] = [];
  for (const t of load.registry.all('trigger')) {
    const found = await rehearseTrigger(load, t, seed, opts, decisions);
    if (!found) {
      // no switch anywhere under this trigger: one run is the whole of it
      const emb = embedderFor(load, { seed, profile: opts.profile });
      const { input, request } = generatedFire(emb, t, seed);
      const report = await emb.fire(t.doc, input, request);
      const leaf = failedLeaf(report);
      const onPurpose = leaf?.handler?.endsWith('#refuse');
      const failed = Object.entries(report.nodes).find(([, n]) => n.status === 'failed');
      settledGraphs.push({
        trigger: t.name, graph: t.doc.fire.run,
        status: report.status === 'blocked' ? 'BLOCKED' : report.status,
        declared: report.status === 'failed' && onPurpose ? leaf?.error : undefined,
        error: report.status === 'failed' && !onPurpose ? (failed ? `${failed[0]}: ${failed[1].error}` : 'failed') : undefined,
      });
    }
  }
  return { ok: format(decisions, settledGraphs, lines, opts.verbose), lines };
}

/** One switch, its branches, and what each settled to. Named by the graph that declares it. */
interface Decision {
  /** The graph document that declares the switch. */
  graph: string;
  /** The switch's node id within that graph. */
  node: string;
  /** The triggers whose runs reach this switch. */
  triggers: string[];
  branches: { when: string; to: string; settled?: Settled; uncovered?: string }[];
}

/** Merge a switch's result into the decisions already gathered, so a shared graph is reported once. */
function gather(decisions: Decision[], d: Decision) {
  const hit = decisions.find(x => x.graph === d.graph && x.node === d.node);
  if (!hit) { decisions.push(d); return; }
  for (const tr of d.triggers) if (!hit.triggers.includes(tr)) hit.triggers.push(tr);
  // the same switch reached from two triggers should settle the same way; keep the worse of the two
  for (const b of d.branches) {
    const at = hit.branches.find(x => x.when === b.when && x.to === b.to);
    if (!at) { hit.branches.push(b); continue; }
    if (b.uncovered && !at.uncovered) { at.uncovered = b.uncovered; at.settled = undefined; }
    if (b.settled && at.settled && (b.settled.error || b.settled.blocked || b.settled.misrouted)) at.settled = b.settled;
  }
}

/**
 * A switch rule as a condition to read. The expression is the truth, but `else` is not a condition and
 * `status == 200 && has(body)` is not a sentence, so each is put in the words the report needs: what was
 * arranged for this run.
 */
function phrase(when: string): string {
  if (when === 'else') return 'anything else';
  return `when ${when}`;
}

/**
 * The report. Grouped by the graph that makes each decision, because that is the document to open when
 * a branch is wrong -- a switch reached from two triggers is one decision, reported once.
 *
 * Answers whether the rehearsal passed: every branch settled, and none was left unreachable.
 */
function format(
  decisions: Decision[],
  plain: { trigger: string; graph: string; status: string; declared?: string; error?: string }[],
  lines: string[],
  verbose?: boolean,
): boolean {
  const problems: string[] = [];
  const short = (g: string) => g.replace(/^@/, '').replace(/\.graph\.json$/, '');
  for (const p of plain) {
    if (p.error || p.status === 'BLOCKED') problems.push(`${short(p.graph)}: ${p.error ?? 'blocked -- an input it needs is never supplied'}`);
    lines.push(`${short(p.graph)}  (no branches)`);
    lines.push(`  ${p.status === 'done' ? 'answers' : p.status === 'BLOCKED' ? 'BLOCKED' : 'fails'}${p.declared ? ` as declared: ${p.declared}` : p.error ? `: ${p.error}` : ''}`);
  }
  for (const d of decisions) {
    const covered = d.branches.filter(b => !b.uncovered).length;
    lines.push(`${short(d.graph)}  switch '${d.node}'  ${covered}/${d.branches.length} branches${verbose ? `  [via ${d.triggers.join(', ')}]` : ''}`);
    // one width for the whole decision, so the outcomes line up and the odd one out is visible
    const w = Math.max(...d.branches.map(b => phrase(b.when).length));
    for (const b of d.branches) {
      const when = phrase(b.when).padEnd(w);
      if (b.uncovered) {
        lines.push(`  ??  ${when}  NEVER RUN -- ${b.uncovered}`);
        problems.push(`${short(d.graph)} '${d.node}': the '${b.when}' branch to ${b.to} can never run -- ${b.uncovered}`);
        continue;
      }
      const st = b.settled!;
      if (st.misrouted) {
        lines.push(`  !!  ${when}  WRONG ROUTE -- should go to '${b.to}', went to '${st.misrouted}'`);
        problems.push(`${short(d.graph)} '${d.node}': '${b.when}' should route to ${b.to} but went to ${st.misrouted}`);
        continue;
      }
      if (st.blocked) {
        lines.push(`  !!  ${when}  BLOCKED at '${b.to}' -- an input it needs is never supplied`);
        problems.push(`${short(d.graph)} '${d.node}': the branch to ${b.to} blocks -- an input it needs is never supplied`);
        continue;
      }
      if (st.error) {
        lines.push(`  !!  ${when}  BROKE at '${b.to}' -- ${st.error}`);
        problems.push(`${short(d.graph)} '${d.node}': the branch to ${b.to} fails where the graph declares no failure -- ${st.error}`);
        continue;
      }
      if (st.declared !== undefined) { lines.push(`  ok  ${when}  refused on purpose at '${b.to}': "${st.declared}"`); continue; }
      if (st.propagated) { lines.push(`  ok  ${when}  went to '${b.to}', which refused it: "${st.propagated.error}"`); continue; }
      lines.push(`  ok  ${when}  answered from '${b.to}'`);
    }
  }
  const branches = decisions.reduce((n, d) => n + d.branches.length, 0);
  lines.push('');
  if (!problems.length) {
    lines.push(`every branch settled -- ${branches} branch(es), ${decisions.length} decision(s), ${new Set(decisions.map(d => d.graph)).size} graph(s).`);
    lines.push('"refused on purpose" is a fail node the graph declares: a designed outcome, not a fault. Effects are stubbed, so no request left this process.');
    return true;
  }
  lines.push(`${problems.length} problem(s):`);
  for (const p of problems) lines.push(`  - ${p}`);
  return false;
}

/**
 * Every branch of every switch one trigger reaches, each in its own run. The seed's values are recorded
 * once, then each case patches only the fields its rule reads, so a branch differs from an ordinary run
 * in the routing it forces and nothing else. Answers false when the trigger reaches no switch at all.
 */
async function rehearseTrigger(load: LoadResult, t: Loaded<TriggerDoc>, seed: number, opts: { profile?: string }, decisions: Decision[]): Promise<boolean> {
  // a first run records what the seed generated for every effectful node, the base each case patches,
  // and the type each node declared, so a case can generate a type-correct value for a field the seed
  // left out. Nodes on a branch this run did not take are absent from the recording; those cases start
  // from nothing and generate what they need from the declared type instead.
  const record: Record<string, unknown> = {};
  const types: Record<string, Type> = {};
  const probe = embedderFor(load, { seed, record, types, profile: opts.profile });
  const { input, request } = generatedFire(probe, t, seed);
  await probe.fire(t.doc, input, request);

  const spec = probe.operation(t.doc.fire.run).spec;
  // A binding operation lowers to a wrapper spec holding a single node `op`, so a graph reached through
  // a binding sits one level deeper than the document suggests: the kernel stubs it at `<node>.op.<id>`.
  const nested = (handler: string): { nodes: Record<string, unknown> } | undefined => {
    if (handler.startsWith('graph:')) {
      try { return probe.graph(handler.slice('graph:'.length)).spec; } catch { return undefined; }
    }
    const ref = bindingGraph(probe, handler);
    if (!ref) return undefined;
    return { nodes: { op: { kind: 'call', handler: `graph:${ref}` } } };
  };
  const found = switchesOf(spec, nested);
  if (!found.length) return false;

  const inType = probe.types(t.doc).in;
  const cases = (f: FoundSwitch) => casesFor(f, path => record[path], path => types[path], seed, input, inType);
  /**
   * The stubs and input that route every switch enclosing `sw` towards the node that contains it. A
   * nested switch is otherwise cancelled before it runs, and its own case would land on a dead path.
   */
  const reach = (sw: FoundSwitch): { stubs: Record<string, unknown>; input: { path: string[]; value: unknown }[] } => {
    const stubs: Record<string, unknown> = {};
    const patches: { path: string[]; value: unknown }[] = [];
    // a switch inside a mapped operation runs only when the list it maps over has an element to run for
    for (const list of sw.lists) {
      const need = nonEmpty(list, path => record[path], path => types[path], seed, input, inType);
      Object.assign(stubs, need.stubs);
      patches.push(...need.input);
    }
    for (const ancestorAt of sw.via) {
      // the enclosing call is `<...>.<node>`; the switch governing it is a sibling in the same spec
      const segs = ancestorAt.split('.');
      const nodeId = segs[segs.length - 1];
      const governing = found.find(f => f.prefix.join('.') === segs.slice(0, -1).join('.') && [...f.node.rules.map(r => r.to), f.node.else].includes(nodeId));
      if (!governing) continue;
      const want = cases(governing).find(c => c.branch.to === nodeId && !c.branch.unsolved && !c.unreachable?.length);
      if (!want) continue;
      Object.assign(stubs, want.stubs);
      patches.push(...(want.input ?? []));
    }
    return { stubs, input: patches };
  };

  // The probe took one path, so nodes behind every branch it did not take are absent from the recording
  // and their declared types are unknown -- a case built from nothing cannot generate a typed value. One
  // run per switch, steered to reach it, fills the recording before any case is built from it.
  for (const sw of found) {
    if (!sw.via.length) continue;
    const pre = reach(sw);
    let warm = input;
    for (const p of pre.input) warm = setPath(warm, p.path, p.value);
    const w = embedderFor(load, { seed, record, types, profile: opts.profile });
    await w.fire(t.doc, warm, request, { stubs: pre.stubs });
  }

  for (const sw of found) {
    const pre = reach(sw);
    // A branch of this switch is about where it routes. What the graph it routes into then decides is
    // that graph's own business, reported under its own decision -- so steer those to the branch that
    // answers, and this decision reports its routing rather than an incidental downstream refusal.
    const downstream: Record<string, unknown> = {};
    for (const other of found) {
      if (other === sw) continue;
      // strictly inside a node this switch routes to: its prefix extends this switch's own
      const here = sw.prefix.join('.');
      const there = other.prefix.join('.');
      if (there === here || !(here === '' || there.startsWith(`${here}.`))) continue;
      const answering = cases(other).find(c => c.branch.rule >= 0 && !c.branch.unsolved && !c.unreachable?.length);
      if (answering) Object.assign(downstream, answering.stubs);
    }
    const d: Decision = { graph: graphOf(probe, t, sw), node: sw.at.split('.').pop()!, triggers: [t.name], branches: [] };
    for (const c of cases(sw)) {
      const at = { when: c.branch.when, to: c.branch.to };
      if (c.branch.unsolved) { d.branches.push({ ...at, uncovered: c.branch.unsolved }); continue; }
      if (c.unreachable?.length) { d.branches.push({ ...at, uncovered: `${c.unreachable.join(', ')} is the trigger's own input and the rehearsal cannot vary it` }); continue; }
      const emb = embedderFor(load, { seed, profile: opts.profile });
      // a demand on the graph's own input is met by firing with a patched input, not by a stub
      let fired = input;
      for (const p of [...pre.input, ...(c.input ?? [])]) fired = setPath(fired, p.path, p.value);
      const report = await emb.fire(t.doc, fired, request, { stubs: { ...downstream, ...pre.stubs, ...c.stubs } });
      d.branches.push({ ...at, settled: settle(report, sw, c.branch.to) });
    }
    gather(decisions, d);
  }
  return true;
}

/** The graph document a switch belongs to: the trigger's own graph, or the one its enclosing call runs. */
function graphOf(emb: Embedder, t: Loaded<TriggerDoc>, sw: FoundSwitch): string {
  let spec = emb.operation(t.doc.fire.run).spec as { nodes: Record<string, unknown> };
  let graph = bindingGraph(emb, `${emb.scope.canon(t.doc.fire.run.split('#')[0])}#${t.doc.fire.run.split('#')[1]}`) ?? t.doc.fire.run;
  graph = emb.scope.canon(graph);
  for (const seg of sw.prefix) {
    const n = spec.nodes?.[seg] as Record<string, unknown> | undefined;
    const handler = typeof n?.handler === 'string' ? n.handler : undefined;
    if (!handler) continue;
    const ref = handler.startsWith('graph:') ? handler.slice('graph:'.length) : bindingGraph(emb, handler);
    if (!ref) continue;
    graph = emb.scope.canon(ref);
    try { spec = emb.graph(ref).spec; } catch { /* keep what we have */ }
  }
  return graph;
}

/** The graph a binding operation runs, when its handler names one. */
function bindingGraph(emb: Embedder, handler: string): string | undefined {
  const hash = handler.lastIndexOf('#');
  if (hash < 0) return undefined;
  const [path, opName] = [handler.slice(0, hash), handler.slice(hash + 1)];
  try { return (emb.scope.get('binding', path)?.doc as BindingDoc | undefined)?.operations?.[opName]?.graph; }
  catch { return undefined; }
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
        trigger: t.path, seed, in: input, request, stubs: record,
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
    const trigger = load.registry.all('trigger').find(t => t.path === load.resolve(sc.doc.trigger));
    // S001 has already refused a scenario whose trigger is gone; skip rather than replay nothing.
    if (!trigger) { ok = false; lines.push(`${sc.path}: names unknown trigger '${sc.doc.trigger}'`); continue; }
    const report: Report = await emb.fire(trigger.doc, sc.doc.in, sc.doc.request ?? {}, { stubs: sc.doc.stubs });
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
  const lines = [`${doc.kind}  ${doc.path}`, ...(doc.file ? [`file  ${doc.file}`] : []), doc.doc.description, ''];
  const showType = (t: unknown) => { try { return show(scope.types.spec(t as string)); } catch { return JSON.stringify(t); } };
  if (doc.kind === 'port') {
    for (const [name, op] of Object.entries((doc.doc as PortDoc).operations)) {
      lines.push(`#${name}${op.pure ? '  (pure)' : ''}: ${op.description}`);
      for (const [k, f] of Object.entries(op.accepts ?? {})) lines.push(`    in  ${k}${f.required === false ? '?' : ''}: ${f.type === 'type' ? 'type' : showType(f.type)}${f.static || f.type === 'type' ? '  (static)' : ''}${f.binds ? ` binds ${f.binds}` : ''}${f.enum ? ` ∈ ${f.enum.join('|')}` : ''}${f.description ? '  -- ' + f.description : ''}`);
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
  for (const t of load.registry.all('trigger')) {
    lines.push(`${t.path}  (${t.doc.kind})`);
    const o = load.registry.get('port', load.resolve(t.doc.fire.run.split('#')[0]));
    const opName = t.doc.fire.run.split('#')[1];
    lines.push(`  ${t.doc.fire.run}`);
    if (o) for (const b of load.registry.all('binding').filter(b => load.resolve(b.doc.port) === o.path)) {
      const bop = b.doc.operations[opName];
      if (bop?.graph) graph(bop.graph, '    ', new Set());
      else if (bop?.run) lines.push(`    ${b.path}#${opName} → ${bop.run}`);
    }
  }
  const reached = new Set(lines.filter(l => l.trim().endsWith('.graph.json')).map(l => l.trim()));
  for (const g of load.registry.all('graph')) if (!reached.has(g.path)) lines.push(`orphan  ${g.path}`);
  return lines;
}

// ---- scaffolds -------------------------------------------------------------------------------------

/**
 * Where a scaffolded document goes: inside a feature, in the layer its kind lives in. `target` may already
 * name a path (features/x/domain/y); a bare name is placed under the layer of the feature it belongs to.
 */
function into(target: string, layer: 'edge' | 'domain' | 'data', kind: string): string {
  const suffix = `.${kind}.json`;
  if (target.includes('/')) {
    const parts = target.split('/');
    // features/<name>/<rest> -- insert the layer when the author did not
    if (parts[0] === 'features' && parts.length > 2 && !['edge', 'domain', 'data'].includes(parts[2])) {
      return [...parts.slice(0, 2), layer, ...parts.slice(2)].join('/') + suffix;
    }
    return target + suffix;
  }
  return `${layer}/${target}${suffix}`;
}

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
    case 'shape': {
      // a shape is the world's (edge) or ours (domain); `layer: core` is the domain's word for it
      const layer = opts.layer === 'edge' ? 'edge' : 'core';
      files.push([into(target, layer === 'edge' ? 'edge' : 'domain', 'shape'), { $schema: S('shape'), layer, description: 'TODO', fields: {} }]);
      break;
    }
    case 'port':
      files.push([into(target, 'domain', 'port'), { $schema: S('port'), description: 'TODO', operations: { example: { description: 'TODO', accepts: {}, returns: 'string' } } }]);
      break;
    case 'graph':
      files.push([into(target, opts.layer === 'data' ? 'data' : 'domain', 'graph'), { $schema: S('graph'), description: 'TODO', nodes: [{ type: '@wilanis/node/run.schema.json', id: 'first', run: '@std/text.port.json#fill', in: { values: {}, template: 'hello' } }], out: { type: 'string', from: 'first' } }]);
      break;
    case 'binding':
      files.push([into(target, 'data', 'binding'), { $schema: S('binding'), description: 'TODO', port: opts.port ?? '@features/TODO/domain/TODO.port.json', operations: {} }]);
      break;
    case 'resolvers':
      files.push([into(target, 'edge', 'resolvers'), { $schema: S('resolvers'), description: 'TODO', resolvers: { caller: { read: "request.headers['user-agent']", description: 'TODO' } } }]);
      break;
    case 'trigger':
      files.push([into(target, 'edge', 'trigger'), { $schema: S('trigger'), description: 'TODO', kind: opts.kind ?? '@http/http.trigger-kind.json', settings: { route: '/todo', method: 'GET', produces: 'application/json' }, fire: { run: opts.run ?? '@features/TODO/domain/TODO.port.json#todo' } }]);
      break;
    default: throw new Error(`unknown kind '${kind}'; one of project, feature, shape, port, graph, binding, trigger, resolvers`);
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
