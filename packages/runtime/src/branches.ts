/**
 * Branch enumeration for the rehearsal: every way a switch can route, solved from its own expressions.
 *
 * Rehearsing with generated stubs takes whichever branch the seed happens to satisfy; to walk them all we read the
 * rules instead of guessing. For each rule we build the values that make it true and every earlier rule false -- that
 * is the case which reaches its target, since the kernel tries rules in order -- and one more case for the else,
 * where every rule is false at once. The solver itself is in domains.ts, and what it writes into a stub in stubs.ts.
 */
import { type Type, typeAt } from '@wilanis/core';
import type { Branch, Domain } from './domains.js';
import { branchesOf } from './solve.js';
import { getPath, PLACEHOLDER, satisfy, setPath } from './stubs.js';

export type { Branch, Demands, Domain } from './domains.js';
export { branchesOf } from './solve.js';
export { getPath, PLACEHOLDER, satisfy, setPath } from './stubs.js';

// ---- enumerating a spec's branches ------------------------------------------------------------------

/** One rehearsal case: a set of stubs by dotted node path, and the branch it is meant to reach. */
export interface Case {
  /** Dotted path of the switch, from the top-level graph. */
  at: string;
  branch: Branch;
  /** Node path -> the whole stubbed output of that node. Empty when nothing needed patching. */
  stubs: Record<string, unknown>;
  /**
   * Demands that land on the graph's own input rather than a node: path within the input -> value.
   * Only meaningful for a switch in the top-level graph, where the input is the trigger's.
   */
  input?: { path: string[]; value: unknown }[];
  /** Demands that could not be routed to anything the rehearsal can set. */
  unreachable?: string[];
}

/** A switch found in a spec, with the position it occupies in the run. */
export interface FoundSwitch {
  /** Dotted node path of the switch itself. */
  at: string;
  /** The prefix under which the switch's sibling nodes are stubbed. */
  prefix: string[];
  /** True while every enclosing frame forwards `in` unchanged, so the trigger's input still steers this switch. */
  fromTriggerIn?: boolean;
  node: KSwitchLike;
  /**
   * The nodes enclosing this switch, outermost first: each is a call whose graph the switch lives in.
   * A switch inside one of them is only reached when every enclosing switch routes towards it, so a
   * case for a nested switch must first satisfy its ancestors.
   */
  via: string[];
  /**
   * The map nodes enclosing this switch, outermost first. A switch inside a mapped operation runs once per
   * element and is rehearsed through the first one, so each enclosing list must hold at least one element.
   */
  lists: FoundList[];
}

/** A map node on the way to a switch: where it sits, what it iterates, and whether the trigger's input still steers that list. */
export interface FoundList {
  /** Dotted node path of the map itself. */
  at: string;
  /** The lowered source of `over`. */
  over: unknown;
  /** True when `over` reading `in` reads the trigger's own input. */
  fromTriggerIn: boolean;
}

/** The shape of a lowered switch this module needs; `label` carries the rule's source text. */
export interface KSwitchLike {
  kind: 'switch';
  in: Record<string, unknown>;
  rules: { to: string; label: string }[];
  else: string;
}

/** Where a switch input reads from: a node in the same spec, and the path within that node's output. */
function sourceOf(s: unknown): { ref: string; path: string[] } | undefined {
  if (!s || typeof s !== 'object') return undefined;
  const o = s as Record<string, unknown>;
  if (typeof o.ref === 'string' && Array.isArray(o.path)) return { ref: o.ref, path: o.path as string[] };
  return undefined; // list/object/value/concat sources are composed, not a single stubbable node
}

/**
 * Every switch reachable from a spec, including those inside graph-bound calls. `nested` resolves a
 * call's handler to the spec it runs, so the walk does not need the compiler's private caches.
 */
export function switchesOf(
  spec: { nodes: Record<string, unknown> },
  nested: (handler: string) => { nodes: Record<string, unknown> } | undefined,
  prefix: string[] = [],
  seen = new Set<string>(),
  via: string[] = [],
  fromTriggerIn = true,
  lists: FoundList[] = [],
): FoundSwitch[] {
  const out: FoundSwitch[] = [];
  for (const [id, raw] of Object.entries(spec.nodes)) {
    const n = raw as Record<string, unknown>;
    if (n.kind === 'switch') {
      out.push({ at: [...prefix, id].join('.'), prefix, node: n as unknown as KSwitchLike, via, fromTriggerIn, lists });
      continue;
    }
    const handler = typeof n.handler === 'string' ? n.handler : undefined;
    if (!handler || seen.has(handler)) continue;
    const sub = nested(handler);
    if (!sub) continue;
    const here = [...prefix, id].join('.');
    // a handler is walked once per branch position; recursion through the same handler would not terminate
    if (n.kind === 'map') {
      // the operation runs once per element, each under the element's index; the first element stands for all,
      // and what it receives is the element, never the trigger's input
      out.push(
        ...switchesOf(sub, nested, [...prefix, id, '0'], new Set([...seen, handler]), [...via, here], false, [
          ...lists,
          { at: here, over: n.over, fromTriggerIn },
        ]),
      );
      continue;
    }
    out.push(
      ...switchesOf(
        sub,
        nested,
        [...prefix, id],
        new Set([...seen, handler]),
        [...via, here],
        fromTriggerIn && forwardsIn(n),
        lists,
      ),
    );
  }
  return out;
}

/**
 * What it takes for a mapped operation to run at all: its list holds at least one element. A demand on the
 * trigger's input when the list is read from it, a stub of the node it is read from otherwise; nothing when
 * the list is composed or literal, since a literal list is already what it is.
 */
export function nonEmpty(
  list: FoundList,
  generated: (nodePath: string) => unknown,
  typeOf: (nodePath: string) => Type | undefined,
  seed: number,
  inputSeed?: unknown,
  inType?: Type,
): { stubs: Record<string, unknown>; input: { path: string[]; value: unknown }[] } {
  const src = sourceOf(list.over);
  const want: Domain = { minLen: 1, present: true };
  if (!src) return { stubs: {}, input: [] };
  if (src.ref === 'in') {
    if (!list.fromTriggerIn) return { stubs: {}, input: [] };
    return {
      stubs: {},
      input: [
        { path: src.path, value: satisfy(want, getPath(inputSeed, src.path), typeAtPath(inType, src.path), seed) },
      ],
    };
  }
  if (src.ref === 'request' || src.ref === 'const') return { stubs: {}, input: [] };
  const prefix = list.at.split('.').slice(0, -1);
  const target = [...prefix, src.ref].join('.');
  const base = generated(target);
  return {
    stubs: {
      [target]: setPath(
        base,
        src.path,
        satisfy(want, getPath(base, src.path), typeAtPath(typeOf(target), src.path), seed),
      ),
    },
    input: [],
  };
}

/** Does this call hand its callee the caller's `in` untouched, field for field? Then the trigger's input still reaches inside. */
function forwardsIn(n: Record<string, unknown>): boolean {
  const given = n.in as Record<string, unknown> | undefined;
  if (!given || typeof given !== 'object') return false;
  return Object.entries(given).every(([k, v]) => {
    const src = v as { ref?: string; path?: string[] } | undefined;
    return src?.ref === 'in' && Array.isArray(src.path) && src.path.length === 1 && src.path[0] === k;
  });
}

/**
 * The rehearsal cases for one switch: one per rule plus the else, each with the stubs that steer the run
 * into that branch. `generated` answers what the seed produced for a node path, so a case only overrides
 * the fields its rule reads.
 */
export function casesFor(
  found: FoundSwitch,
  generated: (nodePath: string) => unknown,
  typeOf: (nodePath: string) => Type | undefined = () => undefined,
  seed = 1,
  inputSeed?: unknown,
  inType?: Type,
): Case[] {
  const { node, prefix } = found;
  const steerable = found.fromTriggerIn ?? !prefix.length;
  const branches = branchesOf(
    node.rules.map(r => ({ when: r.label, to: r.to })),
    node.else,
  );
  return branches.map(branch => {
    const stubs: Record<string, unknown> = {};
    const input: { path: string[]; value: unknown }[] = [];
    const unreachable: string[] = [];
    if (!branch.unsolved) {
      for (const [dotted, domain] of Object.entries(branch.demands)) {
        const [inputName, ...within] = dotted.split('.');
        const src = sourceOf(node.in[inputName]);
        if (!src) {
          unreachable.push(dotted);
          continue;
        }
        // a switch in the top-level graph reading `in` is steered by the trigger's input, not a stub
        if (src.ref === 'in' && steerable) {
          const full = [...src.path, ...within];
          input.push({ path: full, value: satisfy(domain, getPath(inputSeed, full), typeAtPath(inType, full), seed) });
          continue;
        }
        if (src.ref === 'in' || src.ref === 'request' || src.ref === 'const') {
          unreachable.push(dotted);
          continue;
        }
        // an operation met by a delegation lowers to a wrapper spec holding one node `op`, so what the seed recorded for it sits one level deeper
        const direct = [...prefix, src.ref].join('.');
        const target =
          generated(direct) === undefined &&
          !typeOf(direct) &&
          (generated(`${direct}.op`) !== undefined || typeOf(`${direct}.op`))
            ? `${direct}.op`
            : direct;
        const full = [...src.path, ...within];
        const base = target in stubs ? stubs[target] : generated(target);
        const want = satisfy(domain, getPath(base, full), typeAtPath(typeOf(target), full), seed);
        stubs[target] = setPath(base, full, want);
      }
    }
    return {
      at: found.at,
      branch,
      stubs,
      ...(input.length ? { input } : {}),
      ...(unreachable.length ? { unreachable } : {}),
    };
  });
}

/** The declared type at a path within a node's output type, as far as the type system can follow it. */
function typeAtPath(t: Type | undefined, path: string[]): Type | undefined {
  if (!t) return undefined;
  // typeAt answers a string when the path cannot be followed into the type
  try {
    const r = typeAt(t, path);
    return typeof r === 'string' ? undefined : r.type;
  } catch {
    return undefined;
  }
}
