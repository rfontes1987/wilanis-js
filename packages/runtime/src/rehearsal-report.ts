/**
 * A rehearsal said in words: one line per decision, the branches it took, and what it took to reach each -- so a
 * reader sees which way a tree can go without reading the report's JSON.
 */
import type { Settled } from './rehearse.js';

export interface Decision {
  /** The graph document that declares the switch. */
  graph: string;
  /** The switch's node id within that graph. */
  node: string;
  /** The triggers whose runs reach this switch. */
  triggers: string[];
  branches: { when: string; to: string; settled?: Settled; uncovered?: string }[];
}

/** Merge a switch's result into the decisions already gathered, so a shared graph is reported once. */
export function gather(decisions: Decision[], d: Decision) {
  const hit = decisions.find(x => x.graph === d.graph && x.node === d.node);
  if (!hit) {
    decisions.push(d);
    return;
  }
  for (const trigger of d.triggers) if (!hit.triggers.includes(trigger)) hit.triggers.push(trigger);
  for (const branch of d.branches) mergeBranch(hit.branches, branch);
}

/** The same branch reached from two triggers should settle the same way; keep the worse of the two. */
function mergeBranch(into: Decision['branches'], branch: Decision['branches'][number]) {
  const at = into.find(one => one.when === branch.when && one.to === branch.to);
  if (!at) {
    into.push(branch);
    return;
  }
  if (branch.uncovered && !at.uncovered) {
    at.uncovered = branch.uncovered;
    at.settled = undefined;
  }
  const worse = branch.settled?.error || branch.settled?.blocked || branch.settled?.misrouted;
  if (branch.settled && at.settled && worse) at.settled = branch.settled;
}

/**
 * A switch rule as a condition to read. The expression is the truth, but `else` is not a condition and
 * `status == 200 && has(body)` is not a sentence, so each is put in the words the report needs: what was
 * arranged for this run.
 */
function phrase(when: string): string {
  if (when === 'else') return 'anything else';
  return `when ${when}`;
}

/**
 * The report. Grouped by the graph that makes each decision, because that is the document to open when
 * a branch is wrong -- a switch reached from two triggers is one decision, reported once.
 *
 * Answers whether the rehearsal passed: every branch settled, and none was left unreachable.
 */
/** How a run with no branches ended. */
function verdict(status: string): string {
  if (status === 'done') return 'answers';
  return status === 'BLOCKED' ? 'BLOCKED' : 'fails';
}

/** A graph's path as the report shows it. */
const short = (path: string) => path.replace(/^@/, '').replace(/\.graph\.json$/, '');

/** How one branch settled: the line the report shows, and the problem it names when something is wrong. */
function branchLine(
  branch: Decision['branches'][number],
  at: { graph: string; node: string },
  width: number,
): { line: string; problem?: string } {
  const when = phrase(branch.when).padEnd(width);
  const where = `${at.graph} '${at.node}'`;
  if (branch.uncovered)
    return {
      line: `  ??  ${when}  NEVER RUN -- ${branch.uncovered}`,
      problem: `${where}: the '${branch.when}' branch to ${branch.to} can never run -- ${branch.uncovered}`,
    };
  const settled = branch.settled;
  const answered = { line: `  ok  ${when}  answered from '${branch.to}'` };
  if (!settled) return answered;
  return settledLine(settled, branch, { when, where }) ?? answered;
}

/** How a settled branch reads: wrong, or one of the ways it may rightly end. */
function settledLine(
  settled: NonNullable<Decision['branches'][number]['settled']>,
  branch: Decision['branches'][number],
  said: { when: string; where: string },
): { line: string; problem?: string } | undefined {
  return wrongly(settled, branch, said) ?? rightly(settled, branch, said.when);
}

/** A branch that ended wrongly: routed elsewhere, blocked, or broken where no failure is declared. */
function wrongly(
  settled: NonNullable<Decision['branches'][number]['settled']>,
  branch: Decision['branches'][number],
  said: { when: string; where: string },
): { line: string; problem: string } | undefined {
  const { when, where } = said;
  if (settled.misrouted)
    return {
      line: `  !!  ${when}  WRONG ROUTE -- should go to '${branch.to}', went to '${settled.misrouted}'`,
      problem: `${where}: '${branch.when}' should route to ${branch.to} but went to ${settled.misrouted}`,
    };
  if (settled.blocked)
    return {
      line: `  !!  ${when}  BLOCKED at '${branch.to}' -- an input it needs is never supplied`,
      problem: `${where}: the branch to ${branch.to} blocks -- an input it needs is never supplied`,
    };
  if (settled.error)
    return {
      line: `  !!  ${when}  BROKE at '${branch.to}' -- ${settled.error}`,
      problem: `${where}: the branch to ${branch.to} fails where the graph declares no failure -- ${settled.error}`,
    };
  return undefined;
}

/** A branch that ended rightly: it refused on purpose, or the node it went to did. */
function rightly(
  settled: NonNullable<Decision['branches'][number]['settled']>,
  branch: Decision['branches'][number],
  when: string,
): { line: string } | undefined {
  if (settled.declared)
    return {
      line: `  ok  ${when}  refused on purpose at '${branch.to}' as ${settled.declared.reason}: "${settled.declared.message}"`,
    };
  if (settled.propagated)
    return {
      line: `  ok  ${when}  went to '${branch.to}', which refused it as ${settled.propagated.reason}: "${settled.propagated.error}"`,
    };
  return undefined;
}

/** What the verdict adds: what the graph declared, or what went wrong. */
function aside(run: { declared?: string; error?: string }): string {
  if (run.declared) return ` as declared: ${run.declared}`;
  return run.error ? `: ${run.error}` : '';
}

export function format(
  decisions: Decision[],
  plain: { trigger: string; graph: string; status: string; declared?: string; error?: string }[],
  lines: string[],
  verbose?: boolean,
): boolean {
  const problems: string[] = [];
  for (const run of plain) problems.push(...plainLines(run, lines));
  for (const decision of decisions) problems.push(...decisionLines(decision, lines, verbose));
  lines.push('');
  return summary(decisions, problems, lines);
}

/** A graph with no branches: what it answered, and the problem it names when it did not. */
function plainLines(
  run: { graph: string; status: string; declared?: string; error?: string },
  lines: string[],
): string[] {
  lines.push(`${short(run.graph)}  (no branches)`);
  lines.push(`  ${verdict(run.status)}${aside(run)}`);
  if (!run.error && run.status !== 'BLOCKED') return [];
  return [`${short(run.graph)}: ${run.error ?? 'blocked -- an input it needs is never supplied'}`];
}

/** One decision: how many branches were covered, and how each settled. */
function decisionLines(decision: Decision, lines: string[], verbose?: boolean): string[] {
  const covered = decision.branches.filter(branch => !branch.uncovered).length;
  const via = verbose ? `  [via ${decision.triggers.join(', ')}]` : '';
  lines.push(
    `${short(decision.graph)}  switch '${decision.node}'  ${covered}/${decision.branches.length} branches${via}`,
  );
  // one width for the whole decision, so the outcomes line up and the odd one out is visible
  const width = Math.max(...decision.branches.map(branch => phrase(branch.when).length));
  const problems: string[] = [];
  for (const branch of decision.branches) {
    const said = branchLine(branch, { graph: short(decision.graph), node: decision.node }, width);
    lines.push(said.line);
    if (said.problem) problems.push(said.problem);
  }
  return problems;
}

/** The last word: every branch settled, or the problems that are left. */
function summary(decisions: Decision[], problems: string[], lines: string[]): boolean {
  if (problems.length) {
    lines.push(`${problems.length} problem(s):`);
    for (const problem of problems) lines.push(`  - ${problem}`);
    return false;
  }
  const branches = decisions.reduce((count, decision) => count + decision.branches.length, 0);
  const graphs = new Set(decisions.map(decision => decision.graph)).size;
  lines.push(`every branch settled -- ${branches} branch(es), ${decisions.length} decision(s), ${graphs} graph(s).`);
  lines.push(
    '"refused on purpose" is a refuse node the graph declares: a designed outcome with a reason the trigger maps, not a fault. Effects are stubbed, so no request left this process.',
  );
  return true;
}

/**
 * Every branch of every switch one trigger reaches, each in its own run. The seed's values are recorded
 * once, then each case patches only the fields its rule reads, so a branch differs from an ordinary run
 * in the routing it forces and nothing else. Answers false when the trigger reaches no switch at all.
 */
