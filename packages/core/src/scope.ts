/**
 * The semantic view over a Registry that the checker and compiler share: resolving paths through project
 * aliases with feature visibility, addressing operations as path#operation, choosing a binding for a port
 * under a profile, classifying graphs as domain or data, and typing values with {{templates}}.
 */
import {
  splitOp, type BindingDoc, type Kind, type Loaded, type Operation, type PluginDoc, type PortDoc, type ProjectDoc,
  type Registry, type TriggerKindDoc, type DocByKind,
} from './model.js';
import { TypeResolver, type Type, UNKNOWN, STRING, typeAt, typeOfValue, substitute, type Read } from './types.js';

/** The {name} placeholders of a templated string setting, such as an http route. */
export const PLACEHOLDER = /\{([A-Za-z0-9_]+)\}/g;

/**
 * A read path: a root, then segments. A segment is `.name` for an identifier, or a quoted key in brackets
 * for a name that is not one: request.headers['user-agent']. Single or double quotes; single needs no
 * escaping inside a JSON string.
 */
const ROOT = String.raw`[a-z][A-Za-z0-9_]*`;
const SEGMENT = String.raw`(?:\.[A-Za-z0-9_]+|\[(?:'[^'\]]*'|"[^"\]]*")\])`;
export const TEMPLATE = new RegExp(String.raw`\{\{\s*(${ROOT}${SEGMENT}*)\s*\}\}`, 'g');
export const WHOLE_TEMPLATE = new RegExp(String.raw`^\{\{\s*(${ROOT}${SEGMENT}*)\s*\}\}$`);
/** A bare read path, the way a resolver writes it. */
export const READ_PATH = new RegExp(String.raw`^${ROOT}${SEGMENT}*$`);
const SEGMENTS = new RegExp(String.raw`^(${ROOT})|\.([A-Za-z0-9_]+)|\[(?:'([^'\]]*)'|"([^"\]]*)")\]`, 'g');
/** The root and segments of a read path, quotes stripped: request.headers['user-agent'] → ['request', 'headers', 'user-agent']. */
export function splitPath(t: string): string[] {
  const out: string[] = [];
  for (const m of t.matchAll(SEGMENTS)) out.push(m[1] ?? m[2] ?? m[3] ?? m[4] ?? '');
  return out;
}
/** Segments written back as a read path: an identifier as .name, anything else quoted in brackets. */
export const joinPath = (segs: string[]) => segs.map((x, i) => (i === 0 ? x : /^[A-Za-z0-9_]+$/.test(x) ? `.${x}` : `['${x}']`)).join('');

export type GraphRole = 'domain' | 'data';

export interface OpHit { path: string; opName: string; op: Operation; port: Loaded<PortDoc> }

export class Scope {
  readonly types: TypeResolver;
  readonly project: ProjectDoc | undefined;

  constructor(readonly registry: Registry, readonly canon: (ref: string) => string) {
    this.types = new TypeResolver(path => registry.get('shape', path)?.doc, canon);
    this.project = registry.project?.doc;
  }

  // ---- lookups -------------------------------------------------------------------------------

  get<K extends Kind>(kind: K, ref: string): Loaded<DocByKind[K]> | undefined { return this.registry.get(kind, this.canon(ref)); }
  any(ref: string): Loaded | undefined { return this.registry.any(this.canon(ref)); }

  /** Can `from` name `target`? Native and project-scope documents are visible everywhere; a feature's are exported or private. */
  visibility(from: Loaded, target: Loaded): string | null {
    if (target.native || !target.feature || target.feature === from.feature) return null;
    const f = this.registry.get('feature', `@features/${from.feature}/feature.json`)?.doc;
    const t = this.registry.get('feature', `@features/${target.feature}/feature.json`)?.doc;
    if (!from.feature || !f?.dependsOn?.includes(target.feature)) return `feature '${from.feature ?? '(root)'}' does not declare dependsOn '${target.feature}'`;
    if (!t?.exports?.map(e => this.canon(e)).includes(target.path)) return `feature '${target.feature}' does not export '${target.path}'`;
    return null;
  }

  /** The operation a path#operation names. */
  op(opRef: string): OpHit | string {
    const { path, op: opName } = splitOp(opRef);
    if (!path || !opName) return `'${opRef}' is not path#operation`;
    const port = this.get('port', path);
    if (!port) return `unknown port '${path}'`;
    const op = port.doc.operations[opName];
    if (!op) return `port '${path}' has no operation '${opName}' (operations: ${Object.keys(port.doc.operations).join(', ')})`;
    return { path: port.path, opName, op, port };
  }

  // ---- bindings and profiles ----------------------------------------------------------------

  bindingsFor(portPath: string): Loaded<BindingDoc>[] {
    return this.registry.all('binding').filter(b => this.canon(b.doc.port) === portPath);
  }

  /** The binding for a domain port under a profile: the profile's choice, else the one and only binding. */
  bindingFor(portPath: string, profile?: string): Loaded<BindingDoc> | string {
    const prof = profile ? this.project?.profiles?.[profile] : undefined;
    const chosen = prof ? Object.entries(prof.bindings).find(([k]) => this.canon(k) === portPath)?.[1] : undefined;
    if (chosen) { const b = this.get('binding', chosen); return b ?? `profile '${profile}' names unknown binding '${chosen}' for '${portPath}'`; }
    const all = this.bindingsFor(portPath);
    if (all.length === 1) return all[0];
    if (all.length === 0) return `no binding implements port '${portPath}'`;
    return `port '${portPath}' has ${all.length} bindings (${all.map(b => b.path).join(', ')}) -- choose one in a project profile`;
  }

  profiles(): string[] { return Object.keys(this.project?.profiles ?? {}); }

  // ---- graph roles --------------------------------------------------------------------------

  /**
   * A graph's role is the layer directory it sits in, not who references it: `domain/` holds business
   * rules, `data/` translates and carries the effects. Declared, so adding a reference can never
   * reclassify a graph underneath the rules that judge it.
   */
  roleOf(graphPath: string): GraphRole {
    return this.get('graph', graphPath)?.layer === 'data' ? 'data' : 'domain';
  }

  // ---- types ---------------------------------------------------------------------------------

  /**
   * A trigger kind's context type for one trigger. A `type` setting binds its variable to the type it names
   * (body: $Body); a string setting binds its {name} placeholders to an object of required strings (route:
   * $Params), so the kind knows what its runtime guarantees. Without the trigger's settings a placeholder
   * object is open, since the names are unknown. The guarding plugin's context (principal, session, challenge)
   * is added to every kind's: it is handed by the guard, not the kind, so a policy reads it under any kind.
   */
  contextType(kind: TriggerKindDoc, settings: Record<string, unknown> = {}): Type {
    const subst: Record<string, Type> = {};
    for (const [k, f] of Object.entries(kind.settings.fields)) {
      if (!f.binds) continue;
      const v = settings[k];
      if (f.type === 'type') { if (typeof v === 'string') { try { subst[f.binds] = this.types.spec(v); } catch { /* R001 reported by the trigger check */ } } continue; }
      if (f.type !== 'string') continue;
      if (typeof v !== 'string') { subst[f.binds] = { kind: 'object', fields: {}, open: STRING }; continue; }
      const fields: Record<string, { type: Type; required: boolean }> = {};
      for (const m of v.matchAll(PLACEHOLDER)) fields[m[1]] = { type: STRING, required: true };
      subst[f.binds] = { kind: 'object', fields, open: false };
    }
    const fields = { ...kind.context.fields };
    const guard = this.guard();
    if (guard) {
      Object.assign(fields, guard.doc.guard!.context.fields);
      // a guard's context may name a variable its plugin's settings bind: session attributes are the shape the project names
      const given = this.project?.plugins.find(x => x.use === guard.native)?.settings ?? {};
      for (const [k, f] of Object.entries(guard.doc.settings?.fields ?? {})) {
        if (!f.binds || f.type !== 'type') continue;
        const v = given[k];
        if (typeof v === 'string') { try { subst[f.binds] = this.types.spec(v); } catch { /* the plugin's check reports it */ } }
        subst[f.binds] ??= { kind: 'object', fields: {}, open: UNKNOWN };
      }
    }
    return substitute(this.types.inline({ fields, open: kind.context.open }), subst);
  }

  /** The plugin document that declares a guard, when the project names such a plugin. */
  guard(): Loaded<PluginDoc> | undefined {
    return this.registry.all('plugin').find(p => p.doc.guard && this.project?.plugins.some(x => x.use === p.native));
  }

  /** Every trigger kind's context that has `path`; used to type request.* reads in resolvers (kind unknown there). */
  requestRead(path: string[]): Read | string {
    const hits: Read[] = [];
    for (const k of this.registry.all('trigger-kind')) {
      const r = typeAt(this.contextType(k.doc as TriggerKindDoc), path);
      if (typeof r !== 'string') hits.push(r);
    }
    if (!hits.length) return `no trigger kind hands request.${path.join('.')}`;
    return { type: hits[0].type, optional: hits.some(h => h.optional) };
  }

  /**
   * Type a value: a literal by what it is, a template by `resolve` (root and path in the caller's context).
   * A string answer is the reason it cannot be typed; undefined means the reason was already reported.
   */
  valueRead(value: unknown, resolve: (root: string, path: string[]) => Read | string | undefined): Read | string | undefined {
    if (typeof value === 'string') {
      const whole = WHOLE_TEMPLATE.exec(value);
      if (whole) { const p = splitPath(whole[1]); return resolve(p[0], p.slice(1)); }
      let optional = false;
      for (const m of value.matchAll(TEMPLATE)) {
        const p = splitPath(m[1]);
        const r = resolve(p[0], p.slice(1));
        if (typeof r !== 'object') return r;
        if (!['string', 'number', 'boolean', 'unknown'].includes(r.type.kind)) return `{{${m[1]}}} is ${r.type.kind}; only scalars interpolate into text`;
        optional ||= r.optional;
      }
      return { type: value.includes('{{') ? STRING : typeOfValue(value), optional };
    }
    if (Array.isArray(value)) {
      if (!value.length) return { type: { kind: 'list', of: UNKNOWN }, optional: false };
      const first = this.valueRead(value[0], resolve);
      if (typeof first !== 'object') return first;
      for (const v of value.slice(1)) { const r = this.valueRead(v, resolve); if (typeof r !== 'object') return r; }
      return { type: { kind: 'list', of: first.type }, optional: false };
    }
    if (value && typeof value === 'object') {
      const fields: Record<string, { type: Type; required: boolean }> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const r = this.valueRead(v, resolve);
        if (r === undefined) return undefined;
        if (typeof r === 'string') return `${k}: ${r}`;
        fields[k] = { type: r.type, required: !r.optional };
      }
      return { type: { kind: 'object', fields, open: false }, optional: false };
    }
    return { type: typeOfValue(value), optional: false };
  }

  /** Is the value a literal, free of templates? */
  literal(value: unknown): boolean { return this.templateReads(value).length === 0; }

  /** All template roots+paths a value reads. */
  templateReads(value: unknown, out: string[][] = []): string[][] {
    if (typeof value === 'string') for (const m of value.matchAll(TEMPLATE)) out.push(splitPath(m[1]));
    else if (Array.isArray(value)) value.forEach(v => this.templateReads(v, out));
    else if (value && typeof value === 'object') Object.values(value as Record<string, unknown>).forEach(v => this.templateReads(v, out));
    return out;
  }
}
