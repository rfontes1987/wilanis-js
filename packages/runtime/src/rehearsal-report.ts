/**
 * A rehearsal said in words: one line per decision, the branches it took, and what it took to reach each -- so a
 * reader sees which way a tree can go without reading the report's JSON.
 */
import type { Report } from '@wilanis/engine';
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
  for (const tr of d.triggers) if (!hit.triggers.includes(tr)) hit.triggers.push(tr);
  // the same switch reached from two triggers should settle the same way; keep the worse of the two
  for (const b of d.branches) {
    const at = hit.branches.find(x => x.when === b.when && x.to === b.to);
    if (!at) {
      hit.branches.push(b);
      continue;
    }
    if (b.uncovered && !at.uncovered) {
      at.uncovered = b.uncovered;
      at.settled = undefined;
    }
    if (b.settled && at.settled && (b.settled.error || b.settled.blocked || b.settled.misrouted))
      at.settled = b.settled;
  }
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
export function format(
  decisions: Decision[],
  plain: { trigger: string; graph: string; status: string; declared?: string; error?: string }[],
  lines: string[],
  verbose?: boolean,
): boolean {
  const problems: string[] = [];
  const short = (g: string) => g.replace(/^@/, '').replace(/\.graph\.json$/, '');
  for (const p of plain) {
    if (p.error || p.status === 'BLOCKED')
      problems.push(`${short(p.graph)}: ${p.error ?? 'blocked -- an input it needs is never supplied'}`);
    lines.push(`${short(p.graph)}  (no branches)`);
    lines.push(
      `  ${p.status === 'done' ? 'answers' : p.status === 'BLOCKED' ? 'BLOCKED' : 'fails'}${p.declared ? ` as declared: ${p.declared}` : p.error ? `: ${p.error}` : ''}`,
    );
  }
  for (const d of decisions) {
    const covered = d.branches.filter(b => !b.uncovered).length;
    lines.push(
      `${short(d.graph)}  switch '${d.node}'  ${covered}/${d.branches.length} branches${verbose ? `  [via ${d.triggers.join(', ')}]` : ''}`,
    );
    // one width for the whole decision, so the outcomes line up and the odd one out is visible
    const w = Math.max(...d.branches.map(b => phrase(b.when).length));
    for (const b of d.branches) {
      const when = phrase(b.when).padEnd(w);
      if (b.uncovered) {
        lines.push(`  ??  ${when}  NEVER RUN -- ${b.uncovered}`);
        problems.push(
          `${short(d.graph)} '${d.node}': the '${b.when}' branch to ${b.to} can never run -- ${b.uncovered}`,
        );
        continue;
      }
      const st = b.settled!;
      if (st.misrouted) {
        lines.push(`  !!  ${when}  WRONG ROUTE -- should go to '${b.to}', went to '${st.misrouted}'`);
        problems.push(`${short(d.graph)} '${d.node}': '${b.when}' should route to ${b.to} but went to ${st.misrouted}`);
        continue;
      }
      if (st.blocked) {
        lines.push(`  !!  ${when}  BLOCKED at '${b.to}' -- an input it needs is never supplied`);
        problems.push(
          `${short(d.graph)} '${d.node}': the branch to ${b.to} blocks -- an input it needs is never supplied`,
        );
        continue;
      }
      if (st.error) {
        lines.push(`  !!  ${when}  BROKE at '${b.to}' -- ${st.error}`);
        problems.push(
          `${short(d.graph)} '${d.node}': the branch to ${b.to} fails where the graph declares no failure -- ${st.error}`,
        );
        continue;
      }
      if (st.declared) {
        lines.push(`  ok  ${when}  refused on purpose at '${b.to}' as ${st.declared.reason}: "${st.declared.message}"`);
        continue;
      }
      if (st.propagated) {
        lines.push(
          `  ok  ${when}  went to '${b.to}', which refused it as ${st.propagated.reason}: "${st.propagated.error}"`,
        );
        continue;
      }
      lines.push(`  ok  ${when}  answered from '${b.to}'`);
    }
  }
  const branches = decisions.reduce((n, d) => n + d.branches.length, 0);
  lines.push('');
  if (!problems.length) {
    lines.push(
      `every branch settled -- ${branches} branch(es), ${decisions.length} decision(s), ${new Set(decisions.map(d => d.graph)).size} graph(s).`,
    );
    lines.push(
      '"refused on purpose" is a refuse node the graph declares: a designed outcome with a reason the trigger maps, not a fault. Effects are stubbed, so no request left this process.',
    );
    return true;
  }
  lines.push(`${problems.length} problem(s):`);
  for (const p of problems) lines.push(`  - ${p}`);
  return false;
}

/**
 * Every branch of every switch one trigger reaches, each in its own run. The seed's values are recorded
 * once, then each case patches only the fields its rule reads, so a branch differs from an ordinary run
 * in the routing it forces and nothing else. Answers false when the trigger reaches no switch at all.
 */
