/**
 * The graph view: nodes with typed input and output ports, a data edge for every {{node.field}} read from the field to
 * the input that reads it, one rule node per switch rule with a route from it, the out node's fields, and for each run
 * or map node where its operation leads. A deep read opens the field it reads as an attribute port under its parent,
 * so the edge leaves the attribute.
 */
import type { GraphDoc, Loaded, Scope, Type } from '@wilanis/core';
import { isMap, isRun, isSwitch, show, splitPath, typeAt } from '@wilanis/core';
import {
  attributePorts,
  fieldPorts,
  inputPorts,
  ordinal,
  outputPorts,
  resultType,
  targetOf,
  WHOLE,
  wire,
  written,
} from './ports.js';
import { answeredBy } from './refusals.js';
import { said } from './said.js';
import type { DocView, VEdge, VNode } from './types.js';
import { labelOf, readable } from './types.js';

/**
 * A graph's view, built up node by node. It holds what every step adds to -- the nodes, the edges between them, each
 * node's result type (for typing the ports a deep read opens) and the resolvers the graph reads -- so each step below
 * says only what one kind of node contributes.
 */
class GraphBuilder {
  private readonly nodes: VNode[] = [];
  private readonly edges: VEdge[] = [];
  /** Each node's result type, for typing the attribute ports deep reads open. */
  private readonly types = new Map<string, Type | undefined>();
  /** The resolvers this graph reads: name -> the segments below request, and the label a reader sees. */
  private readonly resolvers = new Map<string, { path: string[]; label: string; description?: string }>();
  private readonly resolversDoc;
  private readonly doc: GraphDoc;

  constructor(
    private readonly scope: Scope,
    private readonly graph: Loaded<GraphDoc>,
  ) {
    this.doc = graph.doc;
    this.resolversDoc = this.doc.resolvers ? scope.get('resolvers', this.doc.resolvers) : undefined;
  }

  /** The view: every node of the graph, the edges between them, and the role the tree gives it. */
  build(): NonNullable<DocView['graph']> {
    this.readResolvers();
    this.addInput();
    this.addConstants();
    for (const node of this.doc.nodes) this.addNode(node);
    this.addOutput();
    this.addRequest();
    this.openAttributes();
    this.labelRequestPorts();
    return { nodes: this.nodes, edges: this.edges, role: this.scope.roleOf(this.graph.path) };
  }

  /** A spec as a reader sees it, or the spec itself when it does not resolve. */
  private typeOf(spec: unknown): string | undefined {
    try {
      return show(this.scope.types.spec(spec as string));
    } catch {
      return typeof spec === 'string' ? spec : undefined;
    }
  }

  /** A spec resolved, or undefined when it does not. */
  private resolvedType(spec: unknown): Type | undefined {
    try {
      return this.scope.types.spec(spec as string);
    } catch {
      return undefined;
    }
  }

  private readResolvers() {
    if (!this.resolversDoc) return;
    for (const [name, resolver] of Object.entries(this.resolversDoc.doc.resolvers))
      this.resolvers.set(name, {
        path: splitPath(resolver.read).slice(1),
        label: resolver.label ?? readable(name),
        description: resolver.description,
      });
  }

  /** The graph's input: one output port per field of its in type. */
  private addInput() {
    if (!this.doc.in) return;
    const type = this.resolvedType(this.doc.in);
    this.types.set('in', type);
    this.nodes.push({
      id: 'in',
      kind: 'in',
      label: 'Input',
      type: this.typeOf(this.doc.in),
      inputs: [],
      outputs: fieldPorts(type, this.typeOf(this.doc.in)),
    });
  }

  private addConstants() {
    if (!this.doc.constants) return;
    const fields: Record<string, { type: Type; required: boolean }> = {};
    for (const [name, constant] of Object.entries(this.doc.constants)) {
      const type = this.resolvedType(constant.type);
      if (type) fields[name] = { type, required: true };
    }
    this.types.set('const', { kind: 'object', fields, open: false });
    this.nodes.push({
      id: 'const',
      kind: 'const',
      label: 'Constants',
      inputs: [],
      outputs: Object.entries(this.doc.constants).map(([name, constant]) => ({
        name,
        type: this.typeOf(constant.type),
        literal: JSON.stringify(constant.value),
        description: constant.description,
      })),
    });
  }

  /** One node of the graph: a switch becomes a rule node per rule, a run or a map becomes one node. */
  private addNode(node: GraphDoc['nodes'][number]) {
    if (isSwitch(node)) {
      node.rules.forEach((rule, index) => {
        this.addRule(node, rule, index);
      });
      return;
    }
    const target = targetOf(this.scope, node.run);
    const result = resultType(this.scope, target.op, node.in);
    if (isRun(node)) this.addRun(node, target, result);
    else if (isMap(node)) this.addMap(node, target, result);
  }

  /** One rule of a switch: what its condition reads, what it says in words, and where each answer routes. */
  private addRule(
    node: Extract<GraphDoc['nodes'][number], { rules: unknown }>,
    rule: { when: string; to: string; description?: string },
    index: number,
  ) {
    const label = node.label ?? readable(node.id);
    const id = `${node.id}/${index + 1}`;
    const last = index === node.rules.length - 1;
    const otherwise = last ? node.else : `${node.id}/${index + 2}`;
    // a rule reads only what its condition names; a condition that does not parse (a refusal says so) reads everything
    const says = said(rule.when);
    const names = says
      ? new Set(says.flatMap(line => line.parts).flatMap(part => ('input' in part ? [part.input] : [])))
      : undefined;
    const read = Object.fromEntries(Object.entries(node.in).filter(([name]) => !names || names.has(name)));
    const lines = says ?? [{ lead: 'if' as const, parts: [{ text: rule.when }] }];
    const spoken = lines
      .map(line => `${line.lead} ${line.parts.map(part => ('value' in part ? part.value : part.text)).join('')}`)
      .join(' ');
    this.nodes.push({
      id,
      kind: 'rule',
      label: spoken,
      description: rule.description,
      inputs: Object.entries(read).map(([name, value]) => ({ name, ...written(this.scope, value) })),
      outputs: [
        { name: 'then', description: rule.to },
        ...(last ? [{ name: 'otherwise', description: node.else }] : []),
      ],
      says: lines,
      decision: {
        id: node.id,
        label,
        description: node.description,
        when: rule.when,
        rule: index + 1,
        of: node.rules.length,
        then: rule.to,
        otherwise,
        last,
      },
    });
    wire(this.edges, id, read, this.resolvers);
    this.edges.push({ from: id, fromPort: 'then', to: rule.to, toPort: WHOLE, kind: 'route' });
    this.edges.push({ from: id, fromPort: 'otherwise', to: otherwise, toPort: WHOLE, kind: 'route' });
  }

  private addRun(
    node: Extract<GraphDoc['nodes'][number], { run: string }>,
    target: ReturnType<typeof targetOf>,
    result: Type | undefined,
  ) {
    this.types.set(node.id, result);
    this.nodes.push({
      id: node.id,
      kind: 'run',
      label: node.label ?? readable(node.id),
      op: node.run,
      description: node.description,
      inputs: inputPorts(this.scope, target.op, node.in),
      outputs: outputPorts(result, target.op),
      target: target.target,
      ...(target.target.refuses ? { answeredBy: answeredBy(this.scope, this.graph.path, node.id) } : {}),
    });
    wire(this.edges, node.id, node.in, this.resolvers);
  }

  private addMap(
    node: Extract<GraphDoc['nodes'][number], { over: unknown }>,
    target: ReturnType<typeof targetOf>,
    result: Type | undefined,
  ) {
    const list: Type | undefined = result ? { kind: 'list', of: result } : undefined;
    this.types.set(node.id, list);
    this.nodes.push({
      id: node.id,
      kind: 'map',
      label: node.label ?? readable(node.id),
      op: node.run,
      description: node.description,
      inputs: [
        { name: 'over', ...written(this.scope, node.over), description: 'the list mapped over' },
        ...inputPorts(this.scope, target.op, node.in, node.bind),
      ],
      outputs: list ? [{ name: WHOLE, type: show(list) }] : [],
      target: target.target,
      bind: node.bind,
      onItemFailure: node.onItemFailure,
    });
    wire(this.edges, node.id, { over: node.over, ...(node.in ?? {}) }, this.resolvers);
  }

  /**
   * The out node shows what the graph answers: the fields of its type. Candidates arrive at the node, not at a port:
   * with several, the first that settled is the answer, and the edge says which place each one holds.
   */
  private addOutput() {
    if (!this.doc.out) return;
    const from = Array.isArray(this.doc.out.from) ? this.doc.out.from : [this.doc.out.from];
    this.nodes.push({
      id: 'out',
      kind: 'out',
      label: 'Output',
      type: this.typeOf(this.doc.out.type),
      description: this.doc.out.description,
      inputs: [],
      outputs: [],
      fields: fieldPorts(this.resolvedType(this.doc.out.type)),
    });
    for (const [index, candidate] of from.entries())
      this.edges.push({
        from: candidate,
        fromPort: WHOLE,
        to: 'out',
        toPort: WHOLE,
        kind: 'out',
        label: from.length > 1 ? `${ordinal(index + 1)} candidate` : undefined,
      });
  }

  /** The request node: only when a read goes through a resolver. Its ports are the paths the resolvers name. */
  private addRequest() {
    if (!this.resolversDoc || !this.edges.some(edge => edge.from === 'request')) return;
    this.nodes.unshift({
      id: 'request',
      kind: 'request',
      label: 'Request',
      opens: this.resolversDoc.path,
      description: `what the trigger kind hands, read through ${labelOf(this.resolversDoc)}`,
      inputs: [],
      outputs: [],
    });
  }

  /** How a node's field is typed, for the attribute ports a deep read opens under it. */
  private typeAtOf(node: VNode): (path: string[]) => Type | undefined {
    if (node.kind === 'request')
      return path => {
        const read = this.scope.requestRead(path);
        return typeof read === 'string' ? undefined : read.type;
      };
    return path => {
      const type = this.types.get(node.id);
      if (!type) return undefined;
      const at = typeAt(type, path);
      return typeof at === 'string' ? undefined : at.type;
    };
  }

  /** A deep read opens the attribute it reads as a port under its parent, typed from the node's result. */
  private openAttributes() {
    const byId = new Map(this.nodes.map(node => [node.id, node]));
    for (const edge of this.edges) {
      if (edge.kind !== 'data' || edge.fromPort === WHOLE) continue;
      const source = byId.get(edge.from);
      if (source) attributePorts(source, edge.fromPort, this.typeAtOf(source));
    }
  }

  /** The request node's ports carry the labels its resolvers gave them. */
  private labelRequestPorts() {
    const request = this.nodes.find(node => node.id === 'request');
    if (!request) return;
    for (const resolver of this.resolvers.values()) {
      const port = request.outputs.find(one => one.name === resolver.path.join('.'));
      if (port) {
        port.label = resolver.label;
        port.description = resolver.description;
      }
    }
  }
}

/** A graph's view: its nodes, the edges between them, and the role the tree gives it. */
export function graphView(scope: Scope, graph: Loaded<GraphDoc>): NonNullable<DocView['graph']> {
  return new GraphBuilder(scope, graph).build();
}
