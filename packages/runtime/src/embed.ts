/**
 * The embedder: what every trigger kind calls to fire a graph. Compiles once per graph, supplies `in`
 * and `request`, runs the kernel, then judges the answer against the trigger's out type and prunes keys
 * a closed shape does not declare -- the trigger is where the domain's value becomes the edge's.
 */
import { Compiler, buildEnv, runGraph, type CompileOptions, type Compiled } from '@wilanis/compiler';
import type { Report } from '@wilanis/engine';
import type { TriggerDoc } from '@wilanis/core';
import type { PluginModule, Codecs } from '@wilanis/core';
import type { Scope } from '@wilanis/core';
import { conforms, type Type } from '@wilanis/core';
import { TEMPLATE, WHOLE_TEMPLATE } from '@wilanis/core';
import { readPath } from '@wilanis/engine';

/** Fill a templated literal from roots (request, ...). Whole templates take the value; embedded ones interpolate. */
export function fillTemplates(value: unknown, roots: Record<string, unknown>): unknown {
  const read = (t: string) => { const [root, ...path] = t.split('.'); return readPath(roots[root], path); };
  if (typeof value === 'string') {
    const whole = WHOLE_TEMPLATE.exec(value);
    if (whole) return read(whole[1]);
    return value.replace(TEMPLATE, (_, t: string) => { const v = read(t); return v === undefined ? '' : String(v); });
  }
  if (Array.isArray(value)) return value.map(v => fillTemplates(v, roots));
  if (value && typeof value === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) { const x = fillTemplates(v, roots); if (x !== undefined) o[k] = x; }
    return o;
  }
  return value;
}

export interface FireOptions { stubs?: Record<string, unknown>; signal?: AbortSignal }

export class Embedder {
  private compiler: Compiler;
  private compiled = new Map<string, Compiled>();
  readonly env: Record<string, unknown>;
  readonly missingSecrets: string[];

  constructor(readonly scope: Scope, readonly plugins: PluginModule[], opts: CompileOptions & { env?: NodeJS.ProcessEnv } = {}) {
    this.compiler = new Compiler(scope, plugins, opts);
    const built = buildEnv(scope, opts.env ?? process.env);
    this.env = built.env;
    this.missingSecrets = built.missing;
  }

  graph(ref: string): Compiled {
    const path = this.scope.canon(ref);
    let c = this.compiled.get(path);
    if (!c) { c = this.compiler.graph(path); this.compiled.set(path, c); }
    return c;
  }

  types(trigger: TriggerDoc): { in?: Type; out?: Type } {
    return { in: trigger.in ? this.scope.types.ref(trigger.in) : undefined, out: trigger.out ? this.scope.types.ref(trigger.out) : undefined };
  }

  /** The codec table of a plugin's settings, resolved to implementations: content type -> codec. */
  codecsOf(root: string): Codecs {
    const settings = (this.env.plugins as Record<string, Record<string, unknown>>)[root] ?? {};
    const table = (settings.codecs ?? {}) as Record<string, string>;
    const out: Codecs = {};
    for (const [ct, path] of Object.entries(table)) {
      for (const p of this.plugins) { const c = p.codecs?.[path]; if (c) out[ct.toLowerCase()] = c; }
    }
    return out;
  }

  /**
   * Build the trigger's input from its context: the `input` mapping when declared, else the decoded body.
   * Answers the input, or the reason it does not conform to the trigger's in type.
   */
  inputFor(trigger: TriggerDoc, request: Record<string, unknown>): { input: unknown } | { error: string } {
    const t = this.types(trigger).in;
    if (!t) return { input: undefined };
    const raw = trigger.input !== undefined ? fillTemplates(trigger.input, { request }) : request.body;
    const input = t.kind === 'object' && raw && typeof raw === 'object' && !Array.isArray(raw)
      ? Object.fromEntries(Object.entries(raw as Record<string, unknown>).map(([k, v]) => [k, t.fields[k] ? coerceWire(v, t.fields[k].type) : v]))
      : raw;
    const bad = conforms(input, t);
    return bad ? { error: bad } : { input };
  }

  async fire(trigger: TriggerDoc, input: unknown, request: Record<string, unknown>, opts: FireOptions = {}): Promise<Report> {
    const g = this.scope.get('graph', trigger.graph)!.doc;
    const compiled = this.graph(trigger.graph);
    const initial: Record<string, unknown> = { request };
    if (g.in) initial.in = input;
    const report = await runGraph(compiled, { initial, stubs: opts.stubs, signal: opts.signal, env: this.env });
    if (report.status === 'done' && trigger.out) {
      const t = this.types(trigger).out!;
      const output = prune(report.output, t); // a closed out shape keeps only what it declares
      const bad = conforms(output, t);
      if (bad) return { ...report, status: 'failed', nodes: { ...report.nodes, out: { status: 'failed', error: `the answer does not conform to ${trigger.out}: ${bad}` } } };
      return { ...report, output };
    }
    return report;
  }
}

/** Drop keys a closed object type does not declare, recursively. Open objects and unknown pass through. */
export function prune(v: unknown, t: Type): unknown {
  if (t.kind === 'list' && Array.isArray(v)) return v.map(x => prune(x, t.of));
  if (t.kind === 'object' && v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(o)) {
      const f = t.fields[k];
      if (f) out[k] = prune(x, f.type);
      else if (t.open) out[k] = x;
    }
    return out;
  }
  return v;
}

/** Coerce wire strings (query, path, headers, form fields) toward the declared field types. */
export function coerceWire(v: unknown, t: Type): unknown {
  if (typeof v !== 'string') return v;
  if (t.kind === 'number' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  if (t.kind === 'boolean' && (v === 'true' || v === 'false')) return v === 'true';
  return v;
}
