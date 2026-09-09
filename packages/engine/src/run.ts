/**
 * One run of a spec. The scheduler fires every node the instant its sources have settled, all of them
 * concurrently, and answers a report at quiescence. A switch routes and cancels the branches it did not
 * choose; a call runs its handler; a map runs its handler once per element and settles only when every
 * element has, so a failed map still says what each element did.
 */
import { type Plan, planOf, targetsOf } from './plan.js';
import { redactEach, redactValue } from './redact.js';
import { nodeRefs, PSEUDO, readAll, readPath, readSource, rootPaths, sourcesOf } from './sources.js';
import type {
  Handlers,
  KCall,
  KernelSpec,
  KMap,
  KNode,
  KSwitch,
  NodeReport,
  Report,
  RunContext,
  RunOptions,
} from './spec.js';
import { Refusal } from './spec.js';

/** What one element of a map came to: its value, or the error (and the reason, when it refused). */
type ElementResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string; reason?: string; detail?: Record<string, unknown> };

/** A running map: what every element shares. */
interface MapSite {
  id: string;
  node: KMap;
  broadcast: Record<string, unknown>;
  items: NodeReport[];
}

/** A handler that refused on purpose leaves its reason (and detail) on the report; a fault leaves neither. */
function noteRefusal(report: NodeReport, error: unknown): void {
  if (!(error instanceof Refusal)) return;
  report.reason = error.reason;
  if (error.detail) report.detail = error.detail;
}

/** What one element's handler takes: the broadcast inputs, and the element under `item` or through `bind`. */
function elementInputs(node: KMap, broadcast: Record<string, unknown>, item: unknown): Record<string, unknown> {
  const inputs: Record<string, unknown> = { ...broadcast };
  if (!node.bind) {
    inputs.item = item;
    return inputs;
  }
  for (const [key, path] of Object.entries(node.bind)) {
    const value = readPath(item, path);
    if (value !== undefined) inputs[key] = value;
  }
  return inputs;
}

/** A map's answer: every element's outcome when failures are collected; else the values, unless an element failed. */
function collectMap(id: string, node: KMap, results: ElementResult[]): unknown[] {
  if (node.onItemFailure === 'collect') return results;
  const index = results.findIndex(result => !result.ok);
  if (index < 0) return results.map(result => (result as { value: unknown }).value);
  const failed = results[index] as Extract<ElementResult, { ok: false }>;
  // an element that refused refuses the map, with its reason; an element that broke is a fault of the map
  if (failed.reason !== undefined) throw new Refusal(failed.reason, failed.error, failed.detail);
  throw new Error(`map '${id}' element ${index}: ${failed.error}`);
}

export class Run {
  private readonly values = new Map<string, unknown>();
  private readonly reports: Record<string, NodeReport> = {};
  private readonly plan: Plan;
  private readonly root: string[];
  private readonly startedAt = Date.now();
  private failed = false;
  private running = 0;
  private wake: (() => void) | undefined;

  constructor(
    private readonly handlers: Handlers,
    private readonly spec: KernelSpec,
    private readonly opts: RunOptions,
  ) {
    this.plan = planOf(spec);
    this.root = opts.nodePath ?? [];
    for (const [key, value] of Object.entries(opts.initial ?? {})) this.values.set(key, value);
    for (const id of Object.keys(spec.nodes)) this.reports[id] = this.initialReport(id);
  }

  /** Fire everything ready, wait for any settle, repeat until quiescence; then answer. */
  async execute(): Promise<Report> {
    for (;;) {
      const ready = Object.keys(this.spec.nodes).filter(id => this.isReady(id));
      if (ready.length) {
        for (const id of ready) this.start(id);
        continue;
      }
      if (this.running === 0) break;
      await new Promise<void>(resolve => {
        this.wake = resolve;
      });
      this.wake = undefined;
    }
    return this.report();
  }

  // ---- readiness ----------------------------------------------------------------------------------

  /** A node whose value was pre-supplied is seeded, never executed: that is replay. */
  private initialReport(id: string): NodeReport {
    return this.values.has(id) ? { status: 'seeded', out: this.values.get(id) } : { status: 'pending' };
  }

  private status(id: string) {
    return this.reports[id].status;
  }

  private settled(id: string): boolean {
    const status = this.status(id);
    return status === 'done' || status === 'seeded';
  }

  /** A pending node runs once every dependency settled, its router chose it, and every root it reads is supplied. */
  private isReady(id: string): boolean {
    return (
      !this.failed &&
      this.status(id) === 'pending' &&
      this.dependenciesSettled(id) &&
      this.routedTo(id) &&
      this.rootsSupplied(id)
    );
  }

  private dependenciesSettled(id: string): boolean {
    return [...(this.plan.dependencies.get(id) ?? [])].every(dependency => this.settled(dependency));
  }

  /** A routed node waits for its switch to select it. */
  private routedTo(id: string): boolean {
    const router = this.plan.routedBy.get(id);
    return router === undefined || this.reports[router].selected === id;
  }

  private rootsSupplied(id: string): boolean {
    return [...nodeRefs(this.spec.nodes[id])].every(ref => !PSEUDO.has(ref) || this.values.has(ref));
  }

  // ---- running a node -----------------------------------------------------------------------------

  private start(id: string): void {
    const node = this.spec.nodes[id];
    const report = this.reports[id];
    report.status = 'running';
    report.startedAt = Date.now();
    if (node.kind !== 'switch') report.handler = node.handler;
    this.running++;
    this.runNode(id, node, report)
      .catch(error => this.fail(report, error))
      .finally(() => {
        report.endedAt = Date.now();
        this.running--;
        this.wake?.();
      });
  }

  private runNode(id: string, node: KNode, report: NodeReport): Promise<void> {
    if (node.kind === 'switch') return this.runSwitch(id, node, report);
    if (node.kind === 'call') return this.runCall(id, node, report);
    return this.runMap(id, node, report);
  }

  /** The node answered: its value is what others read; the report shows it with secrets removed. */
  private finish(id: string, report: NodeReport, out: unknown, shown: unknown = out): void {
    report.out = shown;
    this.values.set(id, out);
    report.status = 'done';
  }

  /** A node broke or refused: the run is over, and nothing still pending starts. */
  private fail(report: NodeReport, error: unknown): void {
    report.status = 'failed';
    report.error = (error as Error).message;
    noteRefusal(report, error);
    this.failed = true;
    for (const id of Object.keys(this.spec.nodes))
      if (this.status(id) === 'pending') this.reports[id].status = 'cancelled';
  }

  /** Cancel a pending node and, transitively, whatever waits for it. */
  private cancel(id: string): void {
    if (this.status(id) !== 'pending') return;
    this.reports[id].status = 'cancelled';
    for (const dependent of this.plan.dependents.get(id) ?? []) this.cancel(dependent);
  }

  private async runSwitch(id: string, node: KSwitch, report: NodeReport): Promise<void> {
    const inputs = readAll(node.in, this.values);
    report.in = inputs;
    const selected = node.rules.find(rule => rule.when(inputs))?.to ?? node.else;
    report.selected = selected;
    this.finish(id, report, selected);
    for (const target of new Set(targetsOf(node))) if (target !== selected) this.cancel(target);
  }

  private async runCall(id: string, node: KCall, report: NodeReport): Promise<void> {
    const inputs = readAll(node.in, this.values);
    report.in = redactValue(inputs, node.redact?.in) as Record<string, unknown>;
    const out = await this.invoke(node.handler, inputs, this.contextFor([...this.root, id], report));
    this.finish(id, report, out, redactValue(out, node.redact?.out));
  }

  private async runMap(id: string, node: KMap, report: NodeReport): Promise<void> {
    const over = readSource(node.over, this.values);
    if (!Array.isArray(over)) throw new Error(`map '${id}': over is not a list`);
    const broadcast = readAll(node.in, this.values);
    report.in = { ...broadcast, over };
    // one report per element; an element supplied in initial as '<id>.<index>' is seeded and never runs
    const items = over.map((_, index) => this.initialReport(`${id}.${index}`));
    report.items = items;
    const site: MapSite = { id, node, broadcast, items };
    // every element settles before the node does, whatever happened to the others
    const results = await Promise.all(over.map((item, index) => this.runElement(site, index, item)));
    const out = collectMap(id, node, results);
    this.finish(id, report, out, redactEach(out, node.redact?.out));
  }

  /** One element of a map: a seeded element answers at once; the rest run the handler with the element bound in. */
  private async runElement(site: MapSite, index: number, item: unknown): Promise<ElementResult> {
    const element = site.items[index];
    if (element.status === 'seeded') return { ok: true, value: element.out };
    const inputs = elementInputs(site.node, site.broadcast, item);
    element.status = 'running';
    element.startedAt = Date.now();
    element.handler = site.node.handler;
    element.in = redactValue(inputs, site.node.redact?.in) as Record<string, unknown>;
    const ctx = this.contextFor([...this.root, site.id, String(index)], element);
    try {
      const value = await this.invoke(site.node.handler, inputs, ctx);
      element.out = redactValue(value, site.node.redact?.out);
      element.status = 'done';
      return { ok: true, value };
    } catch (error) {
      element.status = 'failed';
      element.error = (error as Error).message;
      noteRefusal(element, error);
      return { ok: false, error: element.error, reason: element.reason, detail: element.detail };
    } finally {
      element.endedAt = Date.now();
    }
  }

  /** What a handler sees: where it runs, the request, the embedder's env, and where to hang a nested report. */
  private contextFor(nodePath: string[], report: NodeReport): RunContext {
    return {
      nodePath,
      attach: sub => {
        report.sub = sub;
      },
      stubs: this.opts.stubs,
      request: this.values.get('request'),
      signal: this.opts.signal,
      env: this.opts.env ?? {},
    };
  }

  /** Call a handler, unless a result is pre-recorded for this node path. */
  private async invoke(handler: string, inputs: Record<string, unknown>, ctx: RunContext): Promise<unknown> {
    const key = ctx.nodePath.join('.');
    if (this.opts.stubs && key in this.opts.stubs) return this.opts.stubs[key];
    const fn = this.handlers[handler];
    if (!fn) throw new Error(`no handler '${handler}'`);
    return fn({ in: inputs, ctx });
  }

  // ---- the report ---------------------------------------------------------------------------------

  /** At quiescence: failed; or done with the first settled output candidate; or blocked on what was never supplied. */
  private report(): Report {
    const base = { graph: this.spec.name, nodes: this.reports, startedAt: this.startedAt, endedAt: Date.now() };
    if (this.failed) return { ...base, status: 'failed' };
    if (!this.spec.output) return { ...base, status: 'done' };
    const answer = this.spec.output.find(id => this.settled(id));
    if (answer !== undefined) return { ...base, status: 'done', output: this.reports[answer].out };
    return { ...base, status: 'blocked', needs: this.needs() };
  }

  /** The root paths pending nodes read that were never supplied, sorted. */
  private needs(): string[] {
    const pending = Object.keys(this.spec.nodes).filter(id => this.status(id) === 'pending');
    const paths = pending.flatMap(id => sourcesOf(this.spec.nodes[id]).flatMap(source => rootPaths(source)));
    return [...new Set(paths.filter(path => this.unsupplied(path)))].sort();
  }

  private unsupplied(path: string): boolean {
    const root = path.split('.')[0];
    return PSEUDO.has(root) && !this.values.has(root);
  }
}
