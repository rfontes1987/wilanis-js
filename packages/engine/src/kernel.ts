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
import type { Handlers, KernelSpec, KNode, KSource, NodeReport, Report, RunContext, RunOptions } from './spec.js';

export const PSEUDO = new Set(['in', 'const', 'request']);

/** Every node id (or pseudo-node) a source reads. */
export function refsOf(src: KSource, out = new Set<string>()): Set<string> {
  if ('ref' in src) out.add(src.ref);
  else if ('list' in src) src.list.forEach(s => refsOf(s, out));
  else if ('object' in src) Object.values(src.object).forEach(s => refsOf(s, out));
  else if ('concat' in src) src.concat.forEach(s => { if (typeof s !== 'string') refsOf(s, out); });
  return out;
}

export function nodeRefs(n: KNode): Set<string> {
  const out = new Set<string>();
  for (const s of Object.values(n.in)) refsOf(s, out);
  if (n.kind === 'map') refsOf(n.over, out);
  return out;
}

export function readPath(v: unknown, path: string[]): unknown {
  let cur: unknown = v;
  for (const seg of path) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) { cur = cur[Number(seg)]; continue; }
    if (typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function readSource(src: KSource, values: Map<string, unknown>): unknown {
  if ('value' in src) return src.value;
  if ('ref' in src) return readPath(values.get(src.ref), src.path);
  if ('list' in src) return src.list.map(s => readSource(s, values)).filter(x => x !== undefined);
  if ('concat' in src) return src.concat.map(s => typeof s === 'string' ? s : String(readSource(s, values) ?? '')).join('');
  const o: Record<string, unknown> = {};
  for (const [k, s] of Object.entries(src.object)) { const v = readSource(s, values); if (v !== undefined) o[k] = v; }
  return o;
}

function readAll(srcs: Record<string, KSource>, values: Map<string, unknown>): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, s] of Object.entries(srcs)) { const v = readSource(s, values); if (v !== undefined) o[k] = v; }
  return o;
}

/** A dotted list of every root path a source reads, for `needs`. */
function rootPaths(src: KSource, out: string[] = []): string[] {
  if ('ref' in src) out.push([src.ref, ...src.path].join('.'));
  else if ('list' in src) src.list.forEach(s => rootPaths(s, out));
  else if ('object' in src) Object.values(src.object).forEach(s => rootPaths(s, out));
  else if ('concat' in src) src.concat.forEach(s => { if (typeof s !== 'string') rootPaths(s, out); });
  return out;
}

const SECRET = '«secret»';
/** A copy of `v` with every listed path replaced. */
export function redactValue(v: unknown, paths: string[][] | undefined): unknown {
  if (!paths?.length || v === undefined) return v;
  const copy: unknown = JSON.parse(JSON.stringify(v));
  for (const p of paths) {
    if (!p.length) return SECRET;
    let cur = copy as Record<string, unknown> | undefined;
    for (const seg of p.slice(0, -1)) { if (!cur || typeof cur !== 'object') { cur = undefined; break; } cur = (cur as Record<string, unknown>)[seg] as Record<string, unknown>; }
    if (cur && typeof cur === 'object' && p[p.length - 1] in cur) (cur as Record<string, unknown>)[p[p.length - 1]] = SECRET;
  }
  return copy;
}

export class Kernel {
  constructor(private handlers: Handlers) {}

  async run(spec: KernelSpec, opts: RunOptions = {}): Promise<Report> {
    const startedAt = Date.now();
    const values = new Map<string, unknown>();
    const nodes: Record<string, NodeReport> = {};
    const status = (id: string) => nodes[id].status;
    const nodePath = opts.nodePath ?? [];

    for (const [k, v] of Object.entries(opts.initial ?? {})) values.set(k, v);
    for (const id of Object.keys(spec.nodes)) {
      nodes[id] = values.has(id) ? { status: 'seeded', out: values.get(id) } : { status: 'pending' };
    }

    // Routing: a node named by a switch runs only when that switch selects it.
    const routedBy = new Map<string, string>();
    for (const [id, n] of Object.entries(spec.nodes)) {
      if (n.kind !== 'switch') continue;
      for (const t of [...n.rules.map(r => r.to), n.else]) routedBy.set(t, id);
    }
    const deps = new Map<string, Set<string>>();
    for (const [id, n] of Object.entries(spec.nodes)) {
      const d = new Set([...nodeRefs(n)].filter(r => !PSEUDO.has(r) && r in spec.nodes));
      const sw = routedBy.get(id); if (sw) d.add(sw);
      deps.set(id, d);
    }
    const dependents = new Map<string, Set<string>>();
    for (const [id, d] of deps) for (const x of d) { if (!dependents.has(x)) dependents.set(x, new Set()); dependents.get(x)!.add(id); }

    let failed = false;
    let running = 0;
    let wake: (() => void) | undefined;
    const settled = () => { wake?.(); };

    const cancel = (id: string) => {
      if (status(id) !== 'pending') return;
      nodes[id].status = 'cancelled';
      for (const x of dependents.get(id) ?? []) cancel(x);
    };

    const isReady = (id: string): boolean => {
      if (status(id) !== 'pending' || failed) return false;
      for (const d of deps.get(id)!) {
        const s = status(d);
        if (s !== 'done' && s !== 'seeded') return false;
      }
      const sw = routedBy.get(id);
      if (sw && nodes[sw].selected !== id) return false;
      // every pseudo-root it reads must have been supplied
      for (const r of nodeRefs(spec.nodes[id])) if (PSEUDO.has(r) && !values.has(r)) return false;
      return true;
    };

    const ctxFor = (id: string): RunContext => ({
      nodePath: [...nodePath, id],
      attach: sub => { nodes[id].sub = sub; },
      stubs: opts.stubs,
      request: values.get('request'),
      signal: opts.signal,
      env: opts.env ?? {},
    });

    const stubFor = (path: string[]): { hit: boolean; value?: unknown } => {
      const key = path.join('.');
      if (opts.stubs && key in opts.stubs) return { hit: true, value: opts.stubs[key] };
      return { hit: false };
    };

    const invoke = async (handler: string, args: { in: Record<string, unknown> }, ctx: RunContext) => {
      const stub = stubFor(ctx.nodePath);
      if (stub.hit) return stub.value;
      const h = this.handlers[handler];
      if (!h) throw new Error(`no handler '${handler}'`);
      return h({ ...args, ctx });
    };

    const start = (id: string) => {
      const n = spec.nodes[id];
      const rep = nodes[id];
      rep.status = 'running'; rep.startedAt = Date.now();
      if (n.kind !== 'switch') rep.handler = n.handler;
      running++;
      (async () => {
        try {
          if (n.kind === 'switch') {
            const inv = readAll(n.in, values);
            rep.in = inv;
            let selected = n.else;
            for (const r of n.rules) { if (r.when(inv)) { selected = r.to; break; } }
            rep.selected = selected;
            rep.out = selected;
            values.set(id, selected);
            rep.status = 'done';
            for (const t of new Set([...n.rules.map(r => r.to), n.else])) if (t !== selected) cancel(t);
          } else if (n.kind === 'call') {
            const inv = readAll(n.in, values);
            rep.in = redactValue(inv, n.redact?.in) as Record<string, unknown>;
            const out = await invoke(n.handler, { in: inv }, ctxFor(id));
            rep.out = redactValue(out, n.redact?.out); values.set(id, out); rep.status = 'done';
          } else {
            const over = readSource(n.over, values);
            if (!Array.isArray(over)) throw new Error(`map '${id}': over is not a list`);
            const broadcast = readAll(n.in, values);
            rep.in = { ...broadcast, over };
            // one report per element; an element supplied in initial as '<id>.<index>' is seeded and never runs
            const items: NodeReport[] = over.map((_, i) => values.has(`${id}.${i}`) ? { status: 'seeded', out: values.get(`${id}.${i}`) } : { status: 'pending' });
            rep.items = items;
            // every element settles before the node does, whatever happened to the others: the map answers
            // (or fails) only once all of its work is over, and the report then holds every element's fate
            const results = await Promise.all(over.map(async (item, i) => {
              const el = items[i];
              if (el.status === 'seeded') return { ok: true as const, value: el.out };
              const inv: Record<string, unknown> = { ...broadcast };
              if (n.bind) for (const [k, p] of Object.entries(n.bind)) { const v = readPath(item, p); if (v !== undefined) inv[k] = v; }
              else inv.item = item;
              el.status = 'running'; el.startedAt = Date.now(); el.handler = n.handler;
              el.in = redactValue(inv, n.redact?.in) as Record<string, unknown>;
              const ctx = ctxFor(id); ctx.nodePath = [...nodePath, id, String(i)];
              ctx.attach = sub => { el.sub = sub; };
              try {
                const value = await invoke(n.handler, { in: inv }, ctx);
                el.out = redactValue(value, n.redact?.out); el.status = 'done';
                return { ok: true as const, value };
              } catch (e) {
                el.error = (e as Error).message; el.status = 'failed';
                return { ok: false as const, error: el.error };
              } finally { el.endedAt = Date.now(); }
            }));
            if (n.onItemFailure !== 'collect') {
              const i = results.findIndex(r => !r.ok);
              if (i >= 0) throw new Error(`map '${id}' element ${i}: ${(results[i] as { error: string }).error}`);
            }
            const out = n.onItemFailure === 'collect' ? results : results.map(r => (r as { value: unknown }).value);
            rep.out = n.redact?.out?.length ? (out as unknown[]).map(x => redactValue(x, n.redact!.out)) : out; values.set(id, out); rep.status = 'done';
          }
        } catch (e) {
          rep.status = 'failed';
          rep.error = (e as Error).message;
          failed = true;
          for (const x of Object.keys(spec.nodes)) if (status(x) === 'pending') nodes[x].status = 'cancelled';
        } finally {
          rep.endedAt = Date.now();
          running--;
          settled();
        }
      })();
    };

    // Scheduler: fire everything ready, wait for any settle, repeat until quiescence.
    for (;;) {
      const ready = Object.keys(spec.nodes).filter(isReady);
      if (ready.length) { ready.forEach(start); continue; }
      if (running === 0) break;
      await new Promise<void>(res => { wake = res; });
      wake = undefined;
    }

    const endedAt = Date.now();
    let output: unknown;
    let answered = false;
    for (const c of spec.output ?? []) {
      const s = status(c);
      if (s === 'done' || s === 'seeded') { output = nodes[c].out; answered = true; break; }
    }
    if (failed) return { graph: spec.name, status: 'failed', nodes, startedAt, endedAt };
    const pending = Object.keys(spec.nodes).filter(id => status(id) === 'pending');
    if (pending.length && !(answered || !spec.output)) {
      const needs = new Set<string>();
      for (const id of pending) {
        const n = spec.nodes[id];
        const srcs = [...Object.values(n.in), ...(n.kind === 'map' ? [n.over] : [])];
        for (const s of srcs) for (const p of rootPaths(s)) if (PSEUDO.has(p.split('.')[0]) && !values.has(p.split('.')[0])) needs.add(p);
      }
      return { graph: spec.name, status: 'blocked', needs: [...needs].sort(), nodes, startedAt, endedAt };
    }
    if (spec.output && !answered) {
      return { graph: spec.name, status: 'blocked', needs: [], nodes, startedAt, endedAt };
    }
    return { graph: spec.name, status: 'done', output, nodes, startedAt, endedAt };
  }
}
