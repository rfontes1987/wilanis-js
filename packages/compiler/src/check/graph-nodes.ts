/**
 * The node kinds with rules of their own. A switch's rules are boolean over its inputs (G011) and route to
 * nodes of the graph, each routed once (G009). A map iterates a list that is there (G012, G004) and hands its
 * element to the operation as `item` or through bind, never also in `in` (G006).
 */
import { expr, type MapNode, type Node, type Read, type SwitchNode, show, type Type, typeAt } from '@wilanis/core';
import type { Reader, Refuser } from './judge.js';

/** The graph the node sits in: where to refuse, the node table, and who routes whom (a switch adds itself). */
export interface NodeSite {
  refuse: Refuser;
  nodes: Map<string, Node>;
  routedBy: Map<string, string>;
}

/** Every node a switch can route to. */
export function targetsOf(node: SwitchNode): string[] {
  return [...node.rules.map(rule => rule.to), node.else];
}

/**
 * The refusals for a switch: each rule is a boolean expression over its typed inputs (G011), and every route
 * names a node of this graph other than itself, routed by no one else (G009).
 */
export function checkSwitch(site: NodeSite, node: SwitchNode, read: Reader): void {
  const inputs: Record<string, Read> = {};
  for (const [name, value] of Object.entries(node.in)) {
    const typed = read(value, `nodes/${node.id}/in/${name}`);
    if (typed) inputs[name] = typed;
  }
  for (const index of node.rules.keys()) checkRule(site, node, index, inputs);
  for (const target of targetsOf(node)) checkRoute(site, node, target);
}

function checkRule(site: NodeSite, node: SwitchNode, index: number, inputs: Record<string, Read>): void {
  const when = node.rules[index].when;
  const at = `nodes/${node.id}/rules/${index}/when`;
  try {
    const type = expr.check(expr.parse(when), inputs);
    if (type.kind !== 'boolean')
      site.refuse(
        'G011',
        `rule ${index}: '${when}' is ${show(type)}, not boolean`,
        at,
        'compare the value, as in a.b == 1, so when answers a boolean',
      );
  } catch (error) {
    site.refuse(
      'G011',
      `rule ${index}: ${(error as Error).message}`,
      at,
      "write when as an expression over this node's inputs",
    );
  }
}

function checkRoute(site: NodeSite, node: SwitchNode, target: string): void {
  const at = `nodes/${node.id}`;
  if (!site.nodes.has(target)) {
    site.refuse('G009', `routes to unknown node '${target}'`, at, 'name a node declared under nodes, or add it');
    return;
  }
  if (target === node.id)
    site.refuse('G009', 'switch routes to itself', at, 'route to another node; a graph has no loop');
  const previous = site.routedBy.get(target);
  if (previous && previous !== node.id) {
    site.refuse(
      'G009',
      `node '${target}' is routed by both '${previous}' and '${node.id}'`,
      at,
      'a node has one router',
    );
  }
  site.routedBy.set(target, node.id);
}

/** A map's element arrives as `item`, or through bind: inputs typed from the list, not given in in. */
export function elementInputs(site: NodeSite, node: MapNode, read: Reader): Record<string, Read> {
  const at = `nodes/${node.id}`;
  const over = read(node.over, `${at}/over`);
  if (!over) return {};
  if (over.type.kind !== 'list') {
    site.refuse(
      'G012',
      `over is ${show(over.type)}, not a list`,
      `${at}/over`,
      'map runs over a list; read one, or use a run node',
    );
    return {};
  }
  if (over.optional) {
    site.refuse(
      'G004',
      'over may be missing at run time',
      `${at}/over`,
      'narrow it through a switch first, or read a required value',
    );
    return {};
  }
  if (node.bind) return boundInputs(site, node, over.type.of);
  if ('item' in (node.in ?? {}))
    site.refuse(
      'G006',
      `'item' is the element; do not give it in in`,
      `${at}/in/item`,
      "remove 'item' from in; map hands each element as item",
    );
  return { item: { type: over.type.of, optional: false } };
}

function boundInputs(site: NodeSite, node: MapNode, element: Type): Record<string, Read> {
  const at = `nodes/${node.id}`;
  const extra: Record<string, Read> = {};
  for (const [name, path] of Object.entries(node.bind ?? {})) {
    const read = typeAt(element, path ? path.split('.') : []);
    if (typeof read === 'string') {
      site.refuse('G012', `bind.${name}: ${read}`, `${at}/bind/${name}`, 'bind a path the element actually holds');
      continue;
    }
    if (name in (node.in ?? {}))
      site.refuse(
        'G006',
        `'${name}' is both bound and given in in`,
        `${at}/bind/${name}`,
        `drop '${name}' from in, or bind it under another name`,
      );
    extra[name] = read;
  }
  return extra;
}
