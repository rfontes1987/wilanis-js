/**
 * Typing what a graph's nodes read: the input, a constant, a resolver, or another node's answer. A node's
 * output type comes from its operation, with the variables its type fields bind substituted; a read the
 * routing switch proved present loses its optionality. Every read is remembered, for G008.
 */
import {
  EMPTY_OBJECT,
  hasVars,
  isMap,
  isSwitch,
  type Node,
  type OpHit,
  type Read,
  STRING,
  substitute,
  type Type,
  typeAt,
  WHOLE_TEMPLATE,
} from '@wilanis/core';
import { bindings } from '../documents.js';
import type { Judge, JudgedResolver, Reader, Refuser } from './judge.js';
import { Narrowing } from './narrowing.js';
import { readAt } from './typing.js';

/** The graph as tabled: its nodes, the operations they run, and the roots its values may read. */
export interface GraphTable {
  file: string;
  nodes: Map<string, Node>;
  ops: Map<string, OpHit>;
  resolvers: Record<string, JudgedResolver>;
  inType: Type | undefined;
  constTypes: Record<string, Type>;
}

/**
 * What a graph's values may read, typed: in, a constant, a resolver, or another node's answer (G003), with a
 * path the routing switch proved present losing its optionality. It remembers every read, for G008 to judge.
 */
export class GraphReads {
  readonly readsIn = new Set<string>();
  readonly readsConst = new Set<string>();
  readonly readNodes = new Set<string>();
  readonly narrowing: Narrowing;
  private readonly outTypes = new Map<string, Type | undefined>();
  private readonly computing = new Set<string>();
  private readonly refuse: Refuser;
  /** the node whose reads are being typed: what its router proved is in force */
  private reading: string | undefined;

  constructor(
    private readonly judge: Judge,
    readonly table: GraphTable,
  ) {
    this.refuse = judge.refuser(table.file);
    this.narrowing = new Narrowing(judge.scope, table.nodes);
  }

  /** A reader with the narrowing of node `id` in force. */
  readFor(id: string): Reader {
    return (value, at) => {
      const previous = this.reading;
      this.reading = id;
      try {
        return this.valueRead(value, at);
      } finally {
        this.reading = previous;
      }
    };
  }

  /** The type a node answers: a switch the id it chose, a call its operation's returns, a map a list of them. */
  nodeOut(id: string): Type | undefined {
    if (this.outTypes.has(id)) return this.outTypes.get(id);
    if (this.computing.has(id)) return undefined;
    this.computing.add(id);
    const type = this.computeOut(id);
    this.computing.delete(id);
    this.outTypes.set(id, type);
    return type;
  }

  private computeOut(id: string): Type | undefined {
    const node = this.table.nodes.get(id);
    if (!node) return undefined;
    if (isSwitch(node)) return STRING;
    const hit = this.table.ops.get(id);
    if (!hit) return undefined; // its operation was refused already
    let returns = this.judge.quiet(hit.op.returns) ?? EMPTY_OBJECT;
    if (hasVars(returns)) returns = substitute(returns, bindings(this.judge.scope, hit.op, node.in));
    return isMap(node) ? { kind: 'list', of: returns } : returns;
  }

  /** Type one value; a whole template the routing switch proved present loses its optionality. */
  private valueRead(value: unknown, at: string): Read | undefined {
    const read = this.judge.scope.valueRead(value, (root, path) => this.rootRead(root, path));
    if (typeof read === 'string') {
      this.refuse('G003', read, at, 'read in, const, request or a node that runs before this one');
      return undefined;
    }
    if (read?.optional && this.narrowedWhole(value)) return { type: read.type, optional: false };
    return read;
  }

  private narrowedWhole(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    const whole = WHOLE_TEMPLATE.exec(value);
    return whole !== null && this.narrowing.narrowed(this.reading, whole[1]);
  }

  /** Type one root a value reads; a path proved present loses its optionality wherever the node reads it. */
  private rootRead(root: string, path: string[]): Read | string | undefined {
    const read = this.rootReadRaw(root, path);
    if (typeof read !== 'object' || !read.optional) return read;
    return this.narrowing.narrowed(this.reading, [root, ...path].join('.'))
      ? { type: read.type, optional: false }
      : read;
  }

  private rootReadRaw(root: string, path: string[]): Read | string | undefined {
    if (root === 'in') return this.readIn(path);
    if (root === 'const') return this.readConst(path);
    if (root === 'request')
      return 'graphs do not read request.* -- a resolvers document does; name it in resolvers and read {{name}}';
    if (root in this.table.resolvers) return readAt(this.table.resolvers[root].read, path);
    return this.readNode(root, path);
  }

  private readIn(path: string[]): Read | string {
    if (!this.table.inType) return `reads in.${path.join('.')} but the graph declares no in`;
    this.readsIn.add(path[0] ?? '*');
    return typeAt(this.table.inType, path);
  }

  private readConst(path: string[]): Read | string {
    const name = path[0];
    const type = name ? this.table.constTypes[name] : undefined;
    if (!type)
      return `unknown constant 'const.${path.join('.')}' (constants: ${Object.keys(this.table.constTypes).join(', ') || 'none'})`;
    this.readsConst.add(name);
    return typeAt(type, path.slice(1));
  }

  private readNode(root: string, path: string[]): Read | string | undefined {
    if (!this.table.nodes.has(root))
      return `unknown node '${root}' (nodes: ${[...this.table.nodes.keys()].join(', ')})`;
    this.readNodes.add(root);
    const base = this.nodeOut(root);
    return base ? typeAt(base, path) : undefined; // its operation was refused already
  }
}
