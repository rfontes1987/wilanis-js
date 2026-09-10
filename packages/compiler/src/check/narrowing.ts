/**
 * What a routing switch proves. `has(x)` on a read input, in a rule, proves that path present for the node the
 * rule routes to; a node downstream of a routed one runs only after it did, so it may take the same for
 * granted. Wherever such a node reads a proved path, the read loses its optionality.
 */
import { expr, isSwitch, type Node, type Scope, type SwitchNode, WHOLE_TEMPLATE } from '@wilanis/core';
import { readValuesOf } from './judge.js';
import { atOrBelow } from './typing.js';

/** The paths a rule's `has(...)` conjuncts prove, spelled the way the switch's inputs read them. */
function provedBy(node: SwitchNode, when: string): Set<string> {
  const proved = new Set<string>();
  let parsed: expr.Expr;
  try {
    parsed = expr.parse(when);
  } catch {
    return proved; // refused where the rule is judged (G011)
  }
  const walk = (term: expr.Expr): void => {
    if (term.kind === 'bin' && term.op === '&&') {
      walk(term.left);
      walk(term.right);
      return;
    }
    if (term.kind !== 'has') return;
    const value = node.in[term.path[0]];
    const whole = typeof value === 'string' ? WHOLE_TEMPLATE.exec(value) : null;
    if (whole) proved.add([whole[1], ...term.path.slice(1)].join('.'));
  };
  walk(parsed);
  return proved;
}

/**
 * What a graph's routing proves: for each node, the request paths a switch's `has(...)` rule established
 * before routing to it -- or to anything it reads -- so a read of such a path is no longer optional. It also
 * answers which nodes read which, the dependency table G007 and G010 are judged over.
 */
export class Narrowing {
  /** node id -> the nodes it reads */
  readonly dependencies = new Map<string, Set<string>>();
  /** node id -> the paths the switch routing to it proved present */
  private readonly present = new Map<string, Set<string>>();

  constructor(scope: Scope, nodes: Map<string, Node>) {
    for (const node of nodes.values()) {
      const roots = scope.templateReads(readValuesOf(node)).map(read => read[0]);
      this.dependencies.set(node.id, new Set(roots.filter(root => nodes.has(root))));
      if (isSwitch(node)) this.collectProofs(node);
    }
  }

  private collectProofs(node: SwitchNode): void {
    for (const rule of node.rules) {
      const proved = provedBy(node, rule.when);
      if (!proved.size) continue;
      const known = this.present.get(rule.to) ?? new Set<string>();
      for (const path of proved) known.add(path);
      this.present.set(rule.to, known);
    }
  }

  /** What a node may take as present: what routed it, and what routed anything it reads. */
  provedFor(id: string, seen = new Set<string>()): Set<string> {
    if (seen.has(id)) return new Set();
    seen.add(id);
    const out = new Set(this.present.get(id) ?? []);
    for (const dependency of this.dependencies.get(id) ?? []) {
      for (const path of this.provedFor(dependency, seen)) out.add(path);
    }
    return out;
  }

  /** Is a dotted read proved present where `reading` runs? */
  narrowed(reading: string | undefined, source: string): boolean {
    if (!reading) return false;
    return [...this.provedFor(reading)].some(path => atOrBelow(source, path));
  }
}
