/**
 * What the kernel executes. Nothing here knows about files, refs, shapes, ports, layers or triggers:
 * nodes, sources, handlers, and pre-supplied values. The compiler lowers a graph document to this.
 */

/** Where a node's value comes from at run time. `ref` may be a node id or a pseudo-node ('in', 'const', 'request'). */
export type KSource =
  | { ref: string; path: string[] }
  | { list: KSource[] }
  | { object: Record<string, KSource> }
  | { value: unknown }
  /** Text with scalar sources interpolated into it, in order. */
  | { concat: (string | KSource)[] };

/** Paths (relative to the node's in / out) whose values are secret and never appear in a report. */
export interface Redact { in?: string[][]; out?: string[][] }

export interface KCall {
  kind: 'call';
  handler: string;
  /** Every value the handler takes, literal or read; the compiler lowers a node's `in` to this. */
  in: Record<string, KSource>;
  redact?: Redact;
}
export interface KSwitch {
  kind: 'switch';
  in: Record<string, KSource>;
  rules: { when: (values: Record<string, unknown>) => boolean; to: string; label: string }[];
  else: string;
}
export interface KMap {
  kind: 'map';
  handler: string;
  over: KSource;
  in: Record<string, KSource>;
  /** input name -> path within the element ([] = the whole element). Absent: the element arrives as `item`. */
  bind?: Record<string, string[]>;
  onItemFailure: 'fail' | 'collect';
  redact?: Redact;
}
export type KNode = KCall | KSwitch | KMap;

export interface KernelSpec {
  name: string;
  nodes: Record<string, KNode>;
  /** Ordered output candidates; the first that settled answers. Absent: the graph answers nothing. */
  output?: string[];
}

export type NodeStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled' | 'seeded';

export interface NodeReport {
  status: NodeStatus;
  /** call/map: the handler that ran (path#operation, or a binding operation). */
  handler?: string;
  in?: Record<string, unknown>;
  out?: unknown;
  error?: string;
  /** switch: the node it routed to. */
  selected?: string;
  /** call bound to a graph: the nested run. */
  sub?: Report;
  /** map: one nested report per element when the handler produced one. */
  items?: (Report | undefined)[];
  startedAt?: number;
  endedAt?: number;
}

export interface Report {
  graph: string;
  status: 'done' | 'failed' | 'blocked';
  output?: unknown;
  /** blocked: the root paths that were read but never supplied. */
  needs?: string[];
  nodes: Record<string, NodeReport>;
  startedAt: number;
  endedAt: number;
}

export interface RunContext {
  /** Dotted position of the running node, for nested stubs and reports. */
  nodePath: string[];
  /** Attach the nested report of a graph-bound operation to the calling node. */
  attach: (sub: Report) => void;
  /** Pre-recorded results by dotted node path; when present the handler is not called. */
  stubs?: Record<string, unknown>;
  /** The trigger context (`request`) of this run, forwarded to nested graphs. */
  request?: unknown;
  signal?: AbortSignal;
  /** Anything the embedder wants handlers to see (connections, secrets, ...). Opaque to the kernel. */
  env: Record<string, unknown>;
}

export interface HandlerArgs { in: Record<string, unknown>; ctx: RunContext }
export type Handler = (args: HandlerArgs) => Promise<unknown>;
export type Handlers = Record<string, Handler>;

export interface RunOptions {
  /** Pre-supplied values: pseudo-nodes (`in`, `request`) and any node id (replay: seeded, not executed). */
  initial?: Record<string, unknown>;
  stubs?: Record<string, unknown>;
  signal?: AbortSignal;
  env?: Record<string, unknown>;
  nodePath?: string[];
}
