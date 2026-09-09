/**
 * What a trigger answers: the refusal reasons its kind and its policies can reach, the status each maps to, and which
 * outcome of which policy answers a graph's refusal.
 */
import { refusalsOfTrigger } from '@wilanis/compiler';
import type { Loaded, Scope, TriggerDoc } from '@wilanis/core';
import type { VAnswer, VAnsweredBy } from './types.js';
import { labelOf, readable } from './types.js';

// ---- refusals -------------------------------------------------------------------------------------

/** The profiles a walk from a trigger is made under: each declared one, or the one unnamed default. */
const profilesOf = (scope: Scope): (string | undefined)[] => (scope.profiles().length ? scope.profiles() : [undefined]);

/** The map a trigger's kind declares for refusal reasons, read from its settings; undefined when the kind maps none. */
export function refusalMapOf(
  scope: Scope,
  trigger: Loaded<TriggerDoc>,
): { at: string; map: Record<string, unknown> } | undefined {
  const kind = scope.get('trigger-kind', trigger.doc.kind);
  const at = kind?.doc.refusals;
  if (!at) return undefined;
  const table = at
    .split('.')
    .reduce<unknown>(
      (into, key) => (into && typeof into === 'object' ? (into as Record<string, unknown>)[key] : undefined),
      trigger.doc.settings,
    );
  return {
    at,
    map: table && typeof table === 'object' && !Array.isArray(table) ? (table as Record<string, unknown>) : {},
  };
}

/** Every reason a trigger can reach under any profile, with the nodes that refuse with it; plus each reason it maps, reached or not. */
export function answersOf(scope: Scope, trigger: Loaded<TriggerDoc>): VAnswer[] | undefined {
  const declared = refusalMapOf(scope, trigger);
  if (!declared) return undefined;
  const byReason = new Map<string, VAnswer>();
  const answer = (reason: string) => {
    let found = byReason.get(reason);
    if (!found) {
      found = { reason, answer: declared.map[reason], from: [] };
      byReason.set(reason, found);
    }
    return found;
  };
  // what the trigger fires, what its policies decide through, and the guard's own reasons (a plugin.json, node 'identify': no graph node to point at)
  for (const profile of profilesOf(scope))
    for (const refusal of refusalsOfTrigger(scope, trigger.doc, profile)) {
      const reached = answer(refusal.reason);
      if (reached.from.some(one => one.graph === refusal.file && one.node === refusal.node)) continue;
      const graph = scope.registry.get('graph', refusal.file);
      const node = graph?.doc.nodes.find(one => one.id === refusal.node);
      reached.from.push({
        graph: refusal.file,
        graphLabel: labelOf(scope.registry.any(refusal.file)),
        node: refusal.node,
        nodeLabel: node?.label ?? readable(refusal.node),
      });
    }
  for (const reason of Object.keys(declared.map)) answer(reason);
  return [...byReason.values()];
}

/** Every trigger whose run can reach the refusing node `node` of graph `graphPath`, and how each answers its reason. */
export function answeredBy(scope: Scope, graphPath: string, node: string): VAnsweredBy[] {
  const out: VAnsweredBy[] = [];
  for (const trigger of scope.registry.all('trigger')) {
    const hit = profilesOf(scope)
      .flatMap(profile => refusalsOfTrigger(scope, trigger.doc, profile))
      .find(refusal => refusal.file === graphPath && refusal.node === node);
    if (!hit) continue;
    const declared = refusalMapOf(scope, trigger);
    out.push({
      trigger: trigger.path,
      triggerLabel: labelOf(trigger),
      maps: Boolean(declared),
      ...(declared ? { answer: declared.map[hit.reason] } : {}),
    });
  }
  return out;
}
