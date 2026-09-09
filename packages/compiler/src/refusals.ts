/**
 * Every reason a run can refuse with, found statically. A refusing operation's `reason` is a literal at its
 * call site, so walking from a trigger through its binding, into the graph it runs or the operation it
 * delegates to, and on through every domain call, finds what a run can say. The checker holds triggers and
 * policies to it (T005, T006, A002, A003); the viewer shows it.
 */
import { isSwitch, policyPath, type Scope, type TriggerDoc, type Values } from '@wilanis/core';

/** One refusal a port operation can end in: the literal reason, the graph (or binding) that calls refuse, and the node (or binding operation) that does. */
export interface ReachableRefusal {
  reason: string;
  file: string;
  node: string;
}

/** One call of an operation: what it names, what it gives, and where it is. */
interface Call {
  run: string;
  given: Values | undefined;
  file: string;
  node: string;
}

/**
 * Every reason a run of `opRef` can refuse with under a profile: the walk goes through the binding that meets
 * the operation, into the graph it runs or the operation it delegates to, and on through every domain call.
 */
export function refusalsReachable(
  scope: Scope,
  opRef: string,
  profile?: string,
  seen = new Set<string>(),
): ReachableRefusal[] {
  const hit = scope.op(opRef);
  if (typeof hit === 'string' || hit.port.native) return [];
  const binding = scope.bindingFor(hit.path, profile);
  if (typeof binding === 'string') return [];
  const bound = binding.doc.operations[hit.opName];
  if (!bound) return [];
  if (bound.graph) return graphRefusals(scope, scope.canon(bound.graph), profile, seen);
  if (!bound.run) return [];
  return callRefusals(scope, { run: bound.run, given: bound.in, file: binding.path, node: hit.opName }, profile, seen);
}

/**
 * Every reason a trigger can be answered with: what it fires, what each of its policies decides through,
 * and -- when an attachment gives the guard a credential -- the guard's own reasons, a credential that does not
 * verify among them.
 */
export function refusalsOfTrigger(scope: Scope, trigger: TriggerDoc, profile?: string): ReachableRefusal[] {
  const out = refusalsReachable(scope, trigger.fire.run, profile);
  for (const ref of trigger.policies ?? []) {
    const policy = scope.get('policy', policyPath(ref));
    if (policy) out.push(...refusalsReachable(scope, policy.doc.decide.run, profile));
  }
  const guard = scope.guard();
  const gives = (trigger.policies ?? []).some(use => typeof use !== 'string' && Object.keys(use.in ?? {}).length);
  if (gives && guard) {
    for (const reason of Object.keys(guard.doc.guard?.refuses ?? {}))
      out.push({ reason, file: guard.path, node: 'identify' });
  }
  return out;
}

/** One call site: the literal reason when the operation refuses, else whatever the operation reaches. */
function callRefusals(scope: Scope, call: Call, profile: string | undefined, seen: Set<string>): ReachableRefusal[] {
  const hit = scope.op(call.run);
  if (typeof hit === 'string') return [];
  if (hit.op.refuses) {
    const reason = call.given?.reason;
    return typeof reason === 'string' && scope.literal(reason) ? [{ reason, file: call.file, node: call.node }] : [];
  }
  return hit.port.native ? [] : refusalsReachable(scope, call.run, profile, seen);
}

function graphRefusals(
  scope: Scope,
  graphPath: string,
  profile: string | undefined,
  seen: Set<string>,
): ReachableRefusal[] {
  if (seen.has(graphPath)) return [];
  seen.add(graphPath);
  const graph = scope.registry.get('graph', graphPath);
  if (!graph) return [];
  const out: ReachableRefusal[] = [];
  for (const node of graph.doc.nodes) {
    if (isSwitch(node)) continue;
    out.push(...callRefusals(scope, { run: node.run, given: node.in, file: graph.path, node: node.id }, profile, seen));
  }
  return out;
}
