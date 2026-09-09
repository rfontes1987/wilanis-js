/**
 * The kernel. Stateless, clockless: it takes a spec, handlers and initial values, runs every node the
 * instant its sources have settled (all of them concurrently), routes, cancels, and answers a report at
 * quiescence. It never decides whether to run again -- the embedder reads the report and decides.
 *
 * A graph whose inputs are not supplied is valid: the report says `blocked` and names what it needs.
 * Any node's value may be pre-supplied (`initial[nodeId]`): the node is `seeded`, not executed. That is replay.
 * One element of a map may be pre-supplied the same way (`initial['m.2']`): a failed map reports every element's
 * outcome in `items`, so the embedder can seed the ones that answered and run only the rest.
 */
import { Run } from './run.js';
import type { Handlers, KernelSpec, Report, RunOptions } from './spec.js';

export class Kernel {
  constructor(private readonly handlers: Handlers) {}

  /** Run a spec to quiescence and answer its report. */
  run(spec: KernelSpec, opts: RunOptions = {}): Promise<Report> {
    return new Run(this.handlers, spec, opts).execute();
  }
}

/** The refusal a failed report carries, when the node that failed did so on purpose. */
export interface ReportRefusal {
  reason: string;
  message: string;
  detail?: Record<string, unknown>;
}

/**
 * The refusal a failed report carries: the reason and message of the node that refused on purpose. A nested
 * run's refusal reaches the node that ran it, so the top level answers for the whole run. Absent when the
 * run answered, blocked, or failed on a fault.
 */
export function refusalOf(report: Report): ReportRefusal | undefined {
  if (report.status !== 'failed') return undefined;
  const node = Object.values(report.nodes).find(candidate => candidate.status === 'failed');
  if (node?.reason === undefined) return undefined;
  return { reason: node.reason, message: node.error ?? '', ...(node.detail ? { detail: node.detail } : {}) };
}
