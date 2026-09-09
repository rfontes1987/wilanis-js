/** What the scheduler knows before anything runs: who waits for whom, and which switch routes each node. */

import { nodeRefs, PSEUDO } from './sources.js';
import type { KernelSpec, KSwitch } from './spec.js';

export interface Plan {
  /** node id -> the switch that names it; such a node runs only when that switch selects it */
  routedBy: Map<string, string>;
  /** node id -> the nodes it waits for: what it reads, and the switch that routes it */
  dependencies: Map<string, Set<string>>;
  /** node id -> the nodes that wait for it */
  dependents: Map<string, Set<string>>;
}

/** Every node a switch can route to. */
export function targetsOf(node: KSwitch): string[] {
  return [...node.rules.map(rule => rule.to), node.else];
}

/** The routing and dependency tables of a spec. */
export function planOf(spec: KernelSpec): Plan {
  const routedBy = new Map<string, string>();
  for (const [id, node] of Object.entries(spec.nodes)) {
    if (node.kind !== 'switch') continue;
    for (const target of targetsOf(node)) routedBy.set(target, id);
  }
  const dependencies = new Map<string, Set<string>>();
  for (const [id, node] of Object.entries(spec.nodes)) {
    const waitsFor = new Set([...nodeRefs(node)].filter(ref => !PSEUDO.has(ref) && ref in spec.nodes));
    const router = routedBy.get(id);
    if (router) waitsFor.add(router);
    dependencies.set(id, waitsFor);
  }
  return { routedBy, dependencies, dependents: invert(dependencies) };
}

/** The reverse of a dependency table. */
function invert(dependencies: Map<string, Set<string>>): Map<string, Set<string>> {
  const dependents = new Map<string, Set<string>>();
  for (const [id, waitsFor] of dependencies) {
    for (const dependency of waitsFor) {
      const set = dependents.get(dependency) ?? new Set<string>();
      set.add(id);
      dependents.set(dependency, set);
    }
  }
  return dependents;
}
