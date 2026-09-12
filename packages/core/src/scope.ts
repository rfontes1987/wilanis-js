/**
 * The semantic view over a Registry that the checker and compiler share: resolving paths through project
 * aliases with feature visibility, addressing operations as path#operation, choosing a binding for a port
 * under a profile, classifying graphs as domain or data, and typing values with {{templates}}.
 */

import { substitute } from './assign.js';
import type {
  BindingDoc,
  DocByKind,
  Field,
  Kind,
  Operation,
  PluginDoc,
  PortDoc,
  ProjectDoc,
  TriggerKindDoc,
} from './model.js';
import { type Loaded, type Registry, splitOp } from './registry.js';
import type { Resolves } from './resolves.js';
import { PLACEHOLDER, splitPath, TEMPLATE, WHOLE_TEMPLATE } from './templates.js';
import { type Read, STRING, type Type, TypeResolver, UNKNOWN } from './types.js';
import { typeAt, typeOfValue } from './values.js';

export type GraphRole = 'domain' | 'data';

/** An operation as addressed by path#operation: the canonical path, the name, the contract, and the port. */
export interface OpHit {
  path: string;
  opName: string;
  op: Operation;
  port: Loaded<PortDoc>;
}

/**
 * Types the root of a template read in the caller's context. A string answer is the reason it cannot be read;
 * undefined means the reason was already reported.
 */
export type ResolveRoot = (root: string, path: string[]) => Read | string | undefined;

const SCALARS = new Set(['string', 'number', 'boolean', 'unknown']);
const OPEN_STRINGS: Type = { kind: 'object', fields: {}, open: STRING };
const OPEN_UNKNOWN: Type = { kind: 'object', fields: {}, open: UNKNOWN };

/** The object of required strings a templated string setting binds: one field per {name} placeholder. */
function placeholderObject(value: string): Type {
  const fields: Record<string, { type: Type; required: boolean }> = {};
  for (const match of value.matchAll(PLACEHOLDER)) fields[match[1]] = { type: STRING, required: true };
  return { kind: 'object', fields, open: false };
}

/**
 * What a reader of the tree may ask of it: a reference resolved through the project's aliases, an operation
 * addressed by path#operation, the binding a port is met by, the layer a graph belongs to, and the type of
 * any value a document writes. The checker and the compiler share one, so both read the tree the same way.
 */
export class Scope {
  readonly types: TypeResolver;
  readonly project: ProjectDoc | undefined;

  constructor(
    readonly registry: Registry,
    readonly canon: (ref: string) => string,
  ) {
    this.types = new TypeResolver(path => registry.get('shape', path)?.doc, canon);
    this.project = registry.project?.doc;
  }

  // ---- lookups -------------------------------------------------------------------------------

  /** The document a reference names, as written by a reader: an alias resolved first, and the kind insisted on. */
  get<K extends Kind>(kind: K, ref: string): Loaded<DocByKind[K]> | undefined {
    return this.registry.get(kind, this.canon(ref));
  }

  /** The document a reference names whatever its kind, so a rule can say what was found where it wanted another. */
  any(ref: string): Loaded | undefined {
    return this.registry.any(this.canon(ref));
  }

  /** Can `from` name `target`? Native and project-scope documents are visible everywhere; a feature's are exported or private. */
  visibility(from: Loaded, target: Loaded): string | null {
    if (target.native || !target.feature || target.feature === from.feature) return null;
    const ours = this.registry.get('feature', `@features/${from.feature}/feature.json`)?.doc;
    const theirs = this.registry.get('feature', `@features/${target.feature}/feature.json`)?.doc;
    if (!from.feature || !ours?.dependsOn?.includes(target.feature)) {
      return `feature '${from.feature ?? '(root)'}' does not declare dependsOn '${target.feature}'`;
    }
    const exported = theirs?.exports?.map(ref => this.canon(ref)).includes(target.path);
    return exported ? null : `feature '${target.feature}' does not export '${target.path}'`;
  }

  /** The operation a path#operation names. */
  op(opRef: string): OpHit | string {
    const { path, op: opName } = splitOp(opRef);
    if (!path || !opName) return `'${opRef}' is not path#operation`;
    const port = this.get('port', path);
    if (!port) return `unknown port '${path}'`;
    const op = port.doc.operations[opName];
    if (!op)
      return `port '${path}' has no operation '${opName}' (operations: ${Object.keys(port.doc.operations).join(', ')})`;
    return { path: port.path, opName, op, port };
  }

  // ---- bindings and profiles ----------------------------------------------------------------

  /** Every binding that says how a port is met -- none, one, or the several a profile must then choose between. */
  bindingsFor(portPath: string): Loaded<BindingDoc>[] {
    return this.registry.all('binding').filter(binding => this.canon(binding.doc.port) === portPath);
  }

  /** The binding for a domain port under a profile: the profile's choice, else the one and only binding. */
  bindingFor(portPath: string, profile?: string): Loaded<BindingDoc> | string {
    const declared = profile ? this.project?.profiles?.[profile] : undefined;
    const chosen = declared
      ? Object.entries(declared.bindings).find(([ref]) => this.canon(ref) === portPath)?.[1]
      : undefined;
    if (chosen)
      return this.get('binding', chosen) ?? `profile '${profile}' names unknown binding '${chosen}' for '${portPath}'`;
    const all = this.bindingsFor(portPath);
    if (all.length === 1) return all[0];
    if (all.length === 0) return `no binding implements port '${portPath}'`;
    return `port '${portPath}' has ${all.length} bindings (${all.map(binding => binding.path).join(', ')}) -- choose one in a project profile`;
  }

  /** The names of the profiles the project declares: the sets of choices a tree may be checked or run under. */
  profiles(): string[] {
    return Object.keys(this.project?.profiles ?? {});
  }

  // ---- graph roles --------------------------------------------------------------------------

  /**
   * A graph's role is the layer directory it sits in, not who references it: `domain/` holds business
   * rules, `data/` translates and carries the effects. Declared, so adding a reference can never
   * reclassify a graph underneath the rules that judge it.
   */
  roleOf(graphPath: string): GraphRole {
    return this.get('graph', graphPath)?.layer === 'data' ? 'data' : 'domain';
  }

  // ---- the request's type -------------------------------------------------------------------

  /**
   * A trigger kind's context type for one trigger. A `type` setting binds its variable to the type it names
   * (body: $Body); a string setting binds its {name} placeholders to an object of required strings (route:
   * $Params), so the kind knows what its runtime guarantees. Without the trigger's settings a placeholder
   * object is open, since the names are unknown. The guarding plugin's context (principal, session, challenge)
   * is added to every kind's: it is handed by the guard, not the kind, so a policy reads it under any kind.
   */
  contextType(kind: TriggerKindDoc, settings: Record<string, unknown> = {}): Type {
    const subst: Record<string, Type> = {};
    for (const [name, field] of Object.entries(kind.settings.fields)) {
      const bound = this.settingBinds(field, settings[name]);
      if (bound && field.binds) subst[field.binds] = bound;
    }
    const fields = { ...kind.context.fields };
    const guard = this.guard();
    if (guard) {
      Object.assign(fields, guard.doc.guard?.context.fields);
      this.guardBinds(guard, subst);
    }
    return substitute(this.types.inline({ fields, open: kind.context.open }), subst);
  }

  /** What one setting binds its variable to, given the trigger's value for it; nothing when the field binds nothing. */
  private settingBinds(field: Field, value: unknown): Type | undefined {
    if (!field.binds) return undefined;
    if (field.type === 'type') return typeof value === 'string' ? this.quietType(value) : undefined;
    if (field.type !== 'string') return undefined;
    return typeof value === 'string' ? placeholderObject(value) : OPEN_STRINGS;
  }

  /**
   * A guard's context may name a variable its plugin's settings bind: session attributes are the shape the
   * project names. A binding the settings do not make stays what the kind bound, else an open object.
   */
  private guardBinds(guard: Loaded<PluginDoc>, subst: Record<string, Type>): void {
    const given = this.project?.plugins.find(use => use.use === guard.native)?.settings ?? {};
    for (const [name, field] of Object.entries(guard.doc.settings?.fields ?? {})) {
      if (!field.binds || field.type !== 'type') continue;
      const value = given[name];
      const named = typeof value === 'string' ? this.quietType(value) : undefined;
      subst[field.binds] = named ?? subst[field.binds] ?? OPEN_UNKNOWN;
    }
  }

  /** The type a reference names, or nothing: the refusal is made where the reference is judged (R001, or the plugin's check). */
  private quietType(ref: string): Type | undefined {
    try {
      return this.types.spec(ref);
    } catch {
      return undefined;
    }
  }

  /** The plugin document that declares a guard, when the project names such a plugin. */
  guard(): Loaded<PluginDoc> | undefined {
    return this.registry
      .all('plugin')
      .find(plugin => plugin.doc.guard && this.project?.plugins.some(use => use.use === plugin.native));
  }

  /** Every trigger kind's context that has `path`; used to type request.* reads in resolvers (kind unknown there). */
  requestRead(path: string[]): Read | string {
    const hits: Read[] = [];
    for (const kind of this.registry.all('trigger-kind')) {
      const read = typeAt(this.contextType(kind.doc as TriggerKindDoc), path);
      if (typeof read !== 'string') hits.push(read);
    }
    if (!hits.length) return `no trigger kind hands request.${path.join('.')}`;
    return { type: hits[0].type, optional: hits.some(hit => hit.optional) };
  }

  // ---- values --------------------------------------------------------------------------------

  /**
   * Type a value: a literal by what it is, a template by `resolve` (root and path in the caller's context).
   * A string answer is the reason it cannot be typed; undefined means the reason was already reported.
   */
  valueRead(value: unknown, resolve: ResolveRoot): Read | string | undefined {
    if (typeof value === 'string') return this.stringRead(value, resolve);
    if (Array.isArray(value)) return this.listRead(value, resolve);
    if (value && typeof value === 'object') return this.objectRead(value as Record<string, unknown>, resolve);
    return { type: typeOfValue(value), optional: false };
  }

  /** A whole template takes the type of what it reads; text with templates is a string, optional when any read is. */
  private stringRead(value: string, resolve: ResolveRoot): Read | string | undefined {
    const whole = WHOLE_TEMPLATE.exec(value);
    if (whole) {
      const [root, ...path] = splitPath(whole[1]);
      return resolve(root, path);
    }
    let optional = false;
    for (const match of value.matchAll(TEMPLATE)) {
      const [root, ...path] = splitPath(match[1]);
      const read = resolve(root, path);
      if (typeof read !== 'object') return read;
      if (!SCALARS.has(read.type.kind))
        return `{{${match[1]}}} is ${read.type.kind}; only scalars interpolate into text`;
      optional ||= read.optional;
    }
    return { type: value.includes('{{') ? STRING : typeOfValue(value), optional };
  }

  /** A list types as a list of its first member; every member must type. */
  private listRead(value: unknown[], resolve: ResolveRoot): Read | string | undefined {
    if (!value.length) return { type: { kind: 'list', of: UNKNOWN }, optional: false };
    const first = this.valueRead(value[0], resolve);
    if (typeof first !== 'object') return first;
    for (const item of value.slice(1)) {
      const read = this.valueRead(item, resolve);
      if (typeof read !== 'object') return read;
    }
    return { type: { kind: 'list', of: first.type }, optional: false };
  }

  /** An object types field by field; a member that may be missing is an optional field. */
  private objectRead(value: Record<string, unknown>, resolve: ResolveRoot): Read | string | undefined {
    const fields: Record<string, { type: Type; required: boolean }> = {};
    for (const [name, item] of Object.entries(value)) {
      const read = this.valueRead(item, resolve);
      if (read === undefined) return undefined;
      if (typeof read === 'string') return `${name}: ${read}`;
      fields[name] = { type: read.type, required: !read.optional };
    }
    return { type: { kind: 'object', fields, open: false }, optional: false };
  }

  /**
   * What a `resolves` channel reads of this tree: the document a reference names, whatever its kind, and the
   * type a reference names. Every site that binds a variable through `resolves` -- the checker, the compiler
   * and the gate's stub -- asks the same one, so none can differ about what a call site binds.
   */
  resolving(): Resolves {
    return {
      document: ref => this.any(ref)?.doc,
      type: ref => this.types.spec(ref),
    };
  }

  /** Is the value a literal, free of templates? */
  literal(value: unknown): boolean {
    return this.templateReads(value).length === 0;
  }

  /** All template roots+paths a value reads. */
  templateReads(value: unknown, out: string[][] = []): string[][] {
    if (typeof value === 'string') for (const match of value.matchAll(TEMPLATE)) out.push(splitPath(match[1]));
    else if (Array.isArray(value)) for (const item of value) this.templateReads(item, out);
    else if (value && typeof value === 'object') {
      for (const item of Object.values(value as Record<string, unknown>)) this.templateReads(item, out);
    }
    return out;
  }
}
