/**
 * `wilanis rehearse`: every branch of every decision a trigger can reach, walked until each is answered, and what it
 * took to get there said in words. It runs against stubbed effects, so nothing leaves the process.
 */
import type { BindingDoc, Loaded, LoadResult, TriggerDoc, Type } from '@wilanis/core';
import type { Report } from '@wilanis/engine';
import { refusalOf } from '@wilanis/engine';
import { type Case, casesFor, type FoundSwitch, nonEmpty, type Stubbing, setPath, switchesOf } from './branches.js';
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
  for (let at = 0; at < prefix.length; at++) {
    const node: Report['nodes'][string] | undefined = cur?.nodes?.[prefix[at]];
    if (!node) return undefined;
    if (node.items) {
      cur = node.items[Number(prefix[++at])]?.sub;
      continue;
    }
    cur = node.sub;
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
  const took = local.nodes[sw.at.split('.').pop() ?? '']?.selected;
  const out: Settled = {
    status: local.status === 'blocked' ? 'BLOCKED' : local.status,
    blocked: local.status === 'blocked',
    misrouted: took !== undefined && took !== aim ? took : undefined,
  };
  const failed = Object.entries(local.nodes).find(([, node]) => node.status === 'failed');
  if (local.status !== 'failed' || !failed) return out;
  return { ...out, ...whyFailed(failed[0], failed[1]) };
}

/**
 * Why a run failed, said where the decision was made. A refusal in THIS graph is a declared outcome; a refusal that
 * arrived from a graph this one calls is that graph's declared outcome surfacing here, and naming it as ours would
 * credit the wrong document.
 */
function whyFailed(id: string, node: Report['nodes'][string]): Partial<Settled> {
  const deeper = failedBelow(id, node);
  if (!deeper && node.reason !== undefined) return { declared: { reason: node.reason, message: node.error ?? '' } };
  if (deeper?.reason !== undefined)
    return { propagated: { node: id, reason: deeper.reason, error: deeper.error ?? '' } };
  return { error: `${id}: ${node.error}` };
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
  for (const trigger of [...load.registry.all('trigger'), ...policyRoots(load)]) {
    const found = await rehearseTrigger(load, trigger, { seed, profile: opts.profile }, decisions);
    if (!found) settledGraphs.push(await wholeOf(load, trigger, seed, opts.profile));
  }
  return { ok: format(decisions, settledGraphs, lines, opts.verbose), lines };
}

/** What broke, when a run failed without declaring a refusal. */
const whatBroke = (failed: [string, { error?: string }] | undefined) =>
  failed ? `${failed[0]}: ${failed[1].error}` : 'failed';

/** A trigger with no switch anywhere under it: one run is the whole of it. */
async function wholeOf(load: LoadResult, trigger: Loaded<TriggerDoc>, seed: number, profile?: string) {
  const emb = embedderFor(load, { seed, profile });
  const { input, request } = generatedFire(emb, trigger, seed);
  const report = await emb.fire(trigger.doc, input, request);
  const refused = refusalOf(report);
  const failed = Object.entries(report.nodes).find(([, node]) => node.status === 'failed');
  const broke = report.status === 'failed' && !refused;
  return {
    trigger: trigger.name,
    graph: trigger.doc.fire.run,
    status: report.status === 'blocked' ? 'BLOCKED' : report.status,
    declared: refused ? `${refused.reason}: "${refused.message}"` : undefined,
    error: broke ? whatBroke(failed) : undefined,
  };
}

/** One switch, its branches, and what each settled to. Named by the graph that declares it. */
async function rehearseTrigger(
  load: LoadResult,
  trigger: Loaded<TriggerDoc>,
  how: { seed: number; profile?: string },
  decisions: Decision[],
): Promise<boolean> {
  const { seed, profile } = how;
  const opts = { profile };
  // a first run records what the seed generated for every effectful node, the base each case patches,
  // and the type each node declared, so a case can generate a type-correct value for a field the seed
  // left out. Nodes on a branch this run did not take are absent from the recording; those cases start
  // from nothing and generate what they need from the declared type instead.
  const record: Record<string, unknown> = {};
  const types: Record<string, Type> = {};
  const probe = embedderFor(load, { seed, record, types, profile: opts.profile });
  const { input, request } = generatedFire(probe, trigger, seed);
  await probe.fire(trigger.doc, input, request);

  const spec = probe.operation(trigger.doc.fire.run).spec;
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

  const inType = probe.types(trigger.doc).in;
  const stubbing = {
    generated: (path: string) => record[path],
    typeOf: (path: string) => types[path],
    seed,
    inputSeed: input,
    inType,
  };
  const walk: Walk = { load, trigger, seed, profile, found, stubbing, input, request, probe };

  // The probe took one path, so nodes behind every branch it did not take are absent from the recording
  // and their declared types are unknown -- a case built from nothing cannot generate a typed value. One
  // run per switch, steered to reach it, fills the recording before any case is built from it.
  for (const sw of found) if (sw.via.length) await warmUp(walk, sw, record, types);
  for (const sw of found) gather(decisions, await decisionFor(walk, sw));
  return true;
}

/** What rehearsing one trigger's switches reads: the tree, the trigger, the switches found, and what to stub with. */
interface Walk {
  load: LoadResult;
  trigger: Loaded<TriggerDoc>;
  seed: number;
  profile?: string;
  found: FoundSwitch[];
  stubbing: Stubbing;
  input: unknown;
  request: Record<string, unknown>;
  probe: Embedder;
}

/**
 * The stubs and input that route every switch enclosing `sw` towards the node that contains it. A nested switch is
 * otherwise cancelled before it runs, and its own case would land on a dead path.
 */
function reach(
  walk: Walk,
  sw: FoundSwitch,
): { stubs: Record<string, unknown>; input: { path: string[]; value: unknown }[] } {
  const stubs: Record<string, unknown> = {};
  const patches: { path: string[]; value: unknown }[] = [];
  // a switch inside a mapped operation runs only when the list it maps over has an element to run for
  for (const list of sw.lists) {
    const need = nonEmpty(list, walk.stubbing);
    Object.assign(stubs, need.stubs);
    patches.push(...need.input);
  }
  for (const ancestorAt of sw.via) {
    const want = governingCase(walk, ancestorAt);
    if (!want) continue;
    Object.assign(stubs, want.stubs);
    patches.push(...(want.input ?? []));
  }
  return { stubs, input: patches };
}

/** The case of the switch that governs an enclosing call, which routes into it. */
function governingCase(walk: Walk, ancestorAt: string) {
  // the enclosing call is `<...>.<node>`; the switch governing it is a sibling in the same spec
  const segments = ancestorAt.split('.');
  const nodeId = segments[segments.length - 1];
  const governing = walk.found.find(
    one =>
      one.prefix.join('.') === segments.slice(0, -1).join('.') &&
      [...one.node.rules.map(rule => rule.to), one.node.else].includes(nodeId),
  );
  if (!governing) return undefined;
  return casesFor(governing, walk.stubbing).find(
    one => one.branch.to === nodeId && !one.branch.unsolved && !one.unreachable?.length,
  );
}

/** One run steered to reach a switch, so what it records is there before any case is built from it. */
async function warmUp(walk: Walk, sw: FoundSwitch, record: Record<string, unknown>, types: Record<string, Type>) {
  const pre = reach(walk, sw);
  let warm = walk.input;
  for (const patch of pre.input) warm = setPath(warm, patch.path, patch.value);
  const emb = embedderFor(walk.load, { seed: walk.seed, record, types, profile: walk.profile });
  await emb.fire(walk.trigger.doc, warm, walk.request, { stubs: pre.stubs });
}

/**
 * A branch of this switch is about where it routes. What the graph it routes into then decides is that graph's own
 * business, reported under its own decision -- so steer those to the branch that answers, and this decision reports
 * its routing rather than an incidental downstream refusal.
 */
function downstreamOf(walk: Walk, sw: FoundSwitch): Record<string, unknown> {
  const downstream: Record<string, unknown> = {};
  const here = sw.prefix.join('.');
  for (const other of walk.found) {
    if (other === sw) continue;
    // strictly inside a node this switch routes to: its prefix extends this switch's own
    const there = other.prefix.join('.');
    if (there === here || !(here === '' || there.startsWith(`${here}.`))) continue;
    const answering = casesFor(other, walk.stubbing).find(
      one => one.branch.rule >= 0 && !one.branch.unsolved && !one.unreachable?.length,
    );
    if (answering) Object.assign(downstream, answering.stubs);
  }
  return downstream;
}

/** One switch as a decision: every branch, and what each settled to. */
async function decisionFor(walk: Walk, sw: FoundSwitch): Promise<Decision> {
  const pre = reach(walk, sw);
  const downstream = downstreamOf(walk, sw);
  const decision: Decision = {
    graph: graphOf(walk.probe, walk.trigger, sw),
    node: sw.at.split('.').pop() ?? '',
    triggers: [walk.trigger.name],
    branches: [],
  };
  for (const one of casesFor(sw, walk.stubbing))
    decision.branches.push(await branchOf(walk, sw, one, { pre, downstream }));
  return decision;
}

/** One case of a switch: the branch it reaches, or why nothing can reach it. */
async function branchOf(
  walk: Walk,
  sw: FoundSwitch,
  one: Case,
  steer: {
    pre: { stubs: Record<string, unknown>; input: { path: string[]; value: unknown }[] };
    downstream: Record<string, unknown>;
  },
): Promise<Decision['branches'][number]> {
  const at = { when: one.branch.when, to: one.branch.to };
  if (one.branch.unsolved) return { ...at, uncovered: one.branch.unsolved };
  if (one.unreachable?.length)
    return {
      ...at,
      uncovered: `${one.unreachable.join(', ')} is the trigger's own input and the rehearsal cannot vary it`,
    };
  const emb = embedderFor(walk.load, { seed: walk.seed, profile: walk.profile });
  // a demand on the graph's own input is met by firing with a patched input, not by a stub
  let fired = walk.input;
  for (const patch of [...steer.pre.input, ...(one.input ?? [])]) fired = setPath(fired, patch.path, patch.value);
  const report = await emb.fire(walk.trigger.doc, fired, walk.request, {
    stubs: { ...steer.downstream, ...steer.pre.stubs, ...one.stubs },
  });
  return { ...at, settled: settle(report, sw, one.branch.to) };
}

/** The graph one node of a spec runs, named directly or through the binding that meets it. */
function graphAt(emb: Embedder, spec: { nodes: Record<string, unknown> }, segment: string): string | undefined {
  const node = spec.nodes?.[segment] as Record<string, unknown> | undefined;
  const handler = typeof node?.handler === 'string' ? node.handler : undefined;
  if (!handler) return undefined;
  return handler.startsWith('graph:') ? handler.slice('graph:'.length) : bindingGraph(emb, handler);
}

/** The graph document a switch belongs to: the trigger's own graph, or the one its enclosing call runs. */
function graphOf(emb: Embedder, trigger: Loaded<TriggerDoc>, sw: FoundSwitch): string {
  let spec = emb.operation(trigger.doc.fire.run).spec as { nodes: Record<string, unknown> };
  let graph =
    bindingGraph(emb, `${emb.scope.canon(trigger.doc.fire.run.split('#')[0])}#${trigger.doc.fire.run.split('#')[1]}`) ??
    trigger.doc.fire.run;
  graph = emb.scope.canon(graph);
  for (const segment of sw.prefix) {
    const ref = graphAt(emb, spec, segment);
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
