/**
 * `wilanis rehearse`: every branch of every decision a trigger can reach, walked until each is answered, and what it
 * took to get there said in words. It runs against stubbed effects, so nothing leaves the process.
 */
import type { BindingDoc, Loaded, LoadResult, TriggerDoc, Type } from '@wilanis/core';
import type { Report } from '@wilanis/engine';
import { refusalOf } from '@wilanis/engine';
import { casesFor, type FoundSwitch, nonEmpty, setPath, switchesOf } from './branches.js';
import type { Embedder } from './embed.js';
import { type Decision, format, gather } from './rehearsal-report.js';
import { embedderFor, failedBelow, generatedFire, policyRoots } from './stubbing.js';

// ---- rehearse ----------------------------------------------------------------------------------------

/** One line per outcome, and whether the whole rehearsal is acceptable. */
export interface Rehearsal {
  ok: boolean;
  lines: string[];
}

/** What one run of one branch settled to, judged at the graph that owns the decision. */
export interface Settled {
  /** done, failed, or BLOCKED. */
  status: string;
  /** The declared failure, when the graph refused on purpose: its reason and message. */
  declared?: { reason: string; message: string };
  /** A failure the graph did not declare: a bug, not a designed outcome. */
  error?: string;
  /** A declared failure that came from a graph this one calls, and the node it came through. */
  propagated?: { node: string; reason: string; error: string };
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
    if (n.items) {
      cur = n.items[Number(prefix[++i])]?.sub;
      continue;
    }
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
  // a refusal in THIS graph is a declared outcome; a refusal that arrived from a graph this one calls is that
  // graph's declared outcome surfacing here, and naming it as ours would credit the wrong document
  const deeper = failedBelow(id, n);
  if (!deeper && n.reason !== undefined) {
    out.declared = { reason: n.reason, message: n.error ?? '' };
    return out;
  }
  if (deeper?.reason !== undefined) {
    out.propagated = { node: id, reason: deeper.reason, error: deeper.error ?? '' };
    return out;
  }
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
export async function rehearse(
  load: LoadResult,
  opts: { seed?: number; profile?: string; verbose?: boolean } = {},
): Promise<Rehearsal> {
  const seed = opts.seed ?? 1;
  const lines: string[] = [];
  const decisions: Decision[] = [];
  const settledGraphs: { trigger: string; graph: string; status: string; declared?: string; error?: string }[] = [];
  // every trigger, and every policy as a trigger of each kind that attaches it: a decision is walked like any other graph
  for (const t of [...load.registry.all('trigger'), ...policyRoots(load)]) {
    const found = await rehearseTrigger(load, t, seed, opts, decisions);
    if (!found) {
      // no switch anywhere under this trigger: one run is the whole of it
      const emb = embedderFor(load, { seed, profile: opts.profile });
      const { input, request } = generatedFire(emb, t, seed);
      const report = await emb.fire(t.doc, input, request);
      const refused = refusalOf(report);
      const failed = Object.entries(report.nodes).find(([, n]) => n.status === 'failed');
      settledGraphs.push({
        trigger: t.name,
        graph: t.doc.fire.run,
        status: report.status === 'blocked' ? 'BLOCKED' : report.status,
        declared: refused ? `${refused.reason}: "${refused.message}"` : undefined,
        error:
          report.status === 'failed' && !refused ? (failed ? `${failed[0]}: ${failed[1].error}` : 'failed') : undefined,
      });
    }
  }
  return { ok: format(decisions, settledGraphs, lines, opts.verbose), lines };
}

/** One switch, its branches, and what each settled to. Named by the graph that declares it. */
async function rehearseTrigger(
  load: LoadResult,
  t: Loaded<TriggerDoc>,
  seed: number,
  opts: { profile?: string },
  decisions: Decision[],
): Promise<boolean> {
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
      try {
        return probe.graph(handler.slice('graph:'.length)).spec;
      } catch {
        return undefined;
      }
    }
    const ref = bindingGraph(probe, handler);
    if (!ref) return undefined;
    return { nodes: { op: { kind: 'call', handler: `graph:${ref}` } } };
  };
  const found = switchesOf(spec, nested);
  if (!found.length) return false;

  const inType = probe.types(t.doc).in;
  const cases = (f: FoundSwitch) =>
    casesFor(
      f,
      path => record[path],
      path => types[path],
      seed,
      input,
      inType,
    );
  /**
   * The stubs and input that route every switch enclosing `sw` towards the node that contains it. A
   * nested switch is otherwise cancelled before it runs, and its own case would land on a dead path.
   */
  const reach = (sw: FoundSwitch): { stubs: Record<string, unknown>; input: { path: string[]; value: unknown }[] } => {
    const stubs: Record<string, unknown> = {};
    const patches: { path: string[]; value: unknown }[] = [];
    // a switch inside a mapped operation runs only when the list it maps over has an element to run for
    for (const list of sw.lists) {
      const need = nonEmpty(
        list,
        path => record[path],
        path => types[path],
        seed,
        input,
        inType,
      );
      Object.assign(stubs, need.stubs);
      patches.push(...need.input);
    }
    for (const ancestorAt of sw.via) {
      // the enclosing call is `<...>.<node>`; the switch governing it is a sibling in the same spec
      const segs = ancestorAt.split('.');
      const nodeId = segs[segs.length - 1];
      const governing = found.find(
        f =>
          f.prefix.join('.') === segs.slice(0, -1).join('.') &&
          [...f.node.rules.map(r => r.to), f.node.else].includes(nodeId),
      );
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
    const d: Decision = {
      graph: graphOf(probe, t, sw),
      node: sw.at.split('.').pop()!,
      triggers: [t.name],
      branches: [],
    };
    for (const c of cases(sw)) {
      const at = { when: c.branch.when, to: c.branch.to };
      if (c.branch.unsolved) {
        d.branches.push({ ...at, uncovered: c.branch.unsolved });
        continue;
      }
      if (c.unreachable?.length) {
        d.branches.push({
          ...at,
          uncovered: `${c.unreachable.join(', ')} is the trigger's own input and the rehearsal cannot vary it`,
        });
        continue;
      }
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
  let graph =
    bindingGraph(emb, `${emb.scope.canon(t.doc.fire.run.split('#')[0])}#${t.doc.fire.run.split('#')[1]}`) ??
    t.doc.fire.run;
  graph = emb.scope.canon(graph);
  for (const seg of sw.prefix) {
    const n = spec.nodes?.[seg] as Record<string, unknown> | undefined;
    const handler = typeof n?.handler === 'string' ? n.handler : undefined;
    if (!handler) continue;
    const ref = handler.startsWith('graph:') ? handler.slice('graph:'.length) : bindingGraph(emb, handler);
    if (!ref) continue;
    graph = emb.scope.canon(ref);
    try {
      spec = emb.graph(ref).spec;
    } catch {
      /* keep what we have */
    }
  }
  return graph;
}

/** The graph a binding operation runs, when its handler names one. */
function bindingGraph(emb: Embedder, handler: string): string | undefined {
  const hash = handler.lastIndexOf('#');
  if (hash < 0) return undefined;
  const [path, opName] = [handler.slice(0, hash), handler.slice(hash + 1)];
  try {
    return (emb.scope.get('binding', path)?.doc as BindingDoc | undefined)?.operations?.[opName]?.graph;
  } catch {
    return undefined;
  }
}
