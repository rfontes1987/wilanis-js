/**
 * What is judged over a graph as a whole, once every node is: no cycle through data reads and routing (G007),
 * out.from names nodes that answer the out type and are alternatives of one another (G010), and everything
 * declared -- a field of in, a constant, a node -- is read by something (G008).
 */
import { assignable, type GraphDoc, isSwitch, show, type Type } from '@wilanis/core';
import { outputCandidates } from '../documents.js';
import type { GraphReads } from './graph-reads.js';
import type { Refuser } from './judge.js';

/** A graph with every node judged: its document, who routes whom, what was read, and the type it declares to answer. */
export interface WholeGraph {
  refuse: Refuser;
  doc: GraphDoc;
  routedBy: Map<string, string>;
  reads: GraphReads;
  outType: Type | undefined;
}

export function checkWhole(graph: WholeGraph): void {
  const dependencies = graph.reads.narrowing.dependencies;
  // routing edges join the dependency table here, for good: a routed node runs only after its switch
  for (const [target, router] of graph.routedBy) dependencies.get(target)?.add(router);
  checkCycles(graph, dependencies);
  checkOutput(graph, dependencies);
  checkUnusedIn(graph);
  checkUnusedConstants(graph);
  checkUnusedNodes(graph);
}

/** G007. */
function checkCycles(graph: WholeGraph, dependencies: Map<string, Set<string>>): void {
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (id: string, stack: string[]): void => {
    const seen = state.get(id);
    if (seen === 'done') return;
    if (seen === 'visiting') {
      graph.refuse('G007', `cycle: ${[...stack.slice(stack.indexOf(id)), id].join(' → ')}`, `nodes/${id}`);
      return;
    }
    state.set(id, 'visiting');
    for (const dependency of dependencies.get(id) ?? []) visit(dependency, [...stack, id]);
    state.set(id, 'done');
  };
  for (const id of graph.reads.table.nodes.keys()) visit(id, []);
}

/** G010: out.from names nodes that answer the out type; several candidates are alternatives behind switches. */
function checkOutput(graph: WholeGraph, dependencies: Map<string, Set<string>>): void {
  const candidates = outputCandidates(graph.doc) ?? [];
  for (const id of candidates) checkCandidate(graph, id);
  if (candidates.length > 1) checkAlternatives(graph, candidates, dependencies);
  if (graph.doc.out && candidates.length === 0)
    graph.refuse('G010', 'out declares a type but names no node', 'out/from');
}

function checkCandidate(graph: WholeGraph, id: string): void {
  const node = graph.reads.table.nodes.get(id);
  if (!node) {
    graph.refuse('G010', `out.from names unknown node '${id}'`, 'out/from');
    return;
  }
  if (isSwitch(node)) {
    graph.refuse(
      'G010',
      `out.from names switch '${id}' -- a switch routes, it produces nothing`,
      'out/from',
      'name the node it routes to',
    );
    return;
  }
  graph.reads.readNodes.add(id);
  const answers = graph.reads.nodeOut(id);
  if (!answers || !graph.outType) return;
  const bad = assignable(answers, graph.outType);
  if (bad)
    graph.refuse('G010', `'${id}' answers ${show(answers)} but out is ${show(graph.outType)}: ${bad}`, 'out/from');
}

/** Candidates are alternatives: one that no switch routes always settles, so later candidates are dead. */
function checkAlternatives(graph: WholeGraph, candidates: string[], dependencies: Map<string, Set<string>>): void {
  const routed = (id: string, seen = new Set<string>()): boolean => {
    if (seen.has(id)) return false;
    seen.add(id);
    return graph.routedBy.has(id) || [...(dependencies.get(id) ?? [])].some(dependency => routed(dependency, seen));
  };
  for (const id of candidates) {
    if (!graph.reads.table.nodes.has(id) || routed(id)) continue;
    const message = `out.from candidate '${id}' is never routed -- it always settles, so later candidates are dead`;
    graph.refuse('G010', message, 'out/from', 'candidates are alternatives; each one sits behind a switch');
  }
}

/** G008: every field of in is read, unless in is read whole. */
function checkUnusedIn(graph: WholeGraph): void {
  const { inType } = graph.reads.table;
  if (inType?.kind !== 'object' || graph.reads.readsIn.has('*')) return;
  for (const name of Object.keys(inType.fields)) {
    if (!graph.reads.readsIn.has(name))
      graph.refuse('G008', `in.${name} is read by no edge`, 'in', 'wire it, or remove it from the in shape');
  }
}

/** G008: every constant is read. */
function checkUnusedConstants(graph: WholeGraph): void {
  for (const name of Object.keys(graph.reads.table.constTypes)) {
    if (!graph.reads.readsConst.has(name))
      graph.refuse('G008', `constant '${name}' is read by no edge`, `constants/${name}`);
  }
}

/** G008: every node's answer is read by another node or named in out.from. */
function checkUnusedNodes(graph: WholeGraph): void {
  for (const node of graph.reads.table.nodes.values()) {
    if (isSwitch(node) || graph.reads.readNodes.has(node.id)) continue;
    graph.refuse(
      'G008',
      `node '${node.id}' is read by nothing`,
      `nodes/${node.id}`,
      'wire its result into another node, or name it in out.from',
    );
  }
}
