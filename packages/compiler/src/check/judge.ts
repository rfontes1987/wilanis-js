/**
 * What every rule family shares: the scope, the refusal list, the project, the resolver table, and the small
 * judgements that recur -- typing a spec (R001), visibility (L005), the shapes a type may name (L001), an
 * operation reference (R001, L005), settings where only secrets may appear (C001), the profiles to judge
 * under, and the reasons an operation can refuse with.
 */
import {
  type Fields,
  isMap,
  type Loaded,
  type Node,
  type Operation,
  type OpHit,
  type ProjectDoc,
  type Read,
  type RefusalList,
  type Scope,
  STRING,
  splitOp,
  type Type,
  TypeError_,
  type TypeSpec,
} from '@wilanis/core';
import type { ReachableRefusal } from '../refusals.js';

/** A refusal recorded against one file: the rule, what is wrong, where in the document, and the fix. */
export type Refuser = (code: string, message: string, at?: string, hint?: string) => void;

/**
 * Types the root of a template read in the caller's context. A string answer is the reason it cannot be read;
 * undefined means the reason was already reported.
 */
export type Resolve = (root: string, path: string[]) => Read | string | undefined;

/** Types a whole value at a call site; undefined when the reason it cannot be typed was already reported. */
export type Reader = (value: unknown, at: string) => Read | undefined;

/** A resolver as judged: the segments below request, the read's type and optionality, and whether the document declared it required. */
export interface JudgedResolver {
  path: string[];
  read: Read;
  required?: boolean;
}

/** The shapes a type written in a document may name: edge or core only, or -- at the data layer -- either. */
export type ShapeLayer = 'edge' | 'core' | null;

/** A type written in a document, judged for the layer it speaks. */
export interface LayerSite {
  spec: TypeSpec;
  from: Loaded;
  at: string;
  layer: ShapeLayer;
  /** what the type belongs to, for messages */
  what: string;
}

/** The effectful operations a feature allows, canonical, and where the list is, for hints. */
export interface Effects {
  allowed: Set<string>;
  at: string;
}

/** Names no resolver, node or constant may take: they are the roots a template reads. */
export const RESERVED = new Set(['in', 'const', 'request', 'secrets']);

const LAYER_HINTS: Record<'edge' | 'core', string> = {
  core: 'core speaks core shapes; a trigger or binding translates edge to core',
  edge: 'edge shapes compose edge shapes only',
};

/** Everything a node reads: its inputs, and for a map the list it iterates. */
export function readValuesOf(node: Node): unknown {
  return isMap(node) ? [node.in ?? {}, node.over] : (node.in ?? {});
}

/** How a message says which profile a judgement was made under, when one was. */
export function underProfile(profile: string | undefined): string {
  return profile ? ` (profile '${profile}')` : '';
}

/** Every type reference in a spec, with where it sits. */
function* typeRefs(spec: TypeSpec, at: string): Generator<[string, string]> {
  if (typeof spec === 'string') {
    yield [spec, at];
    return;
  }
  for (const [name, field] of Object.entries(spec.fields)) yield* typeRefs(field.type, `${at}/${name}`);
  if (typeof spec.open === 'string') yield [spec.open, `${at}/open`];
}

/**
 * What every rule family judges through: the scope, the project and the refusal list, plus the judgements
 * that recur -- typing a spec (R001), visibility (L005), the layer a type may name (L001), an operation
 * reference (R001, L005), settings reading secrets only (C001), the profiles, and reachable reasons.
 */
export class Judge {
  /** Every resolvers document as judged, by path: what `resolversFor` hands to the graphs and bindings that name it. */
  readonly resolverReads = new Map<string, Record<string, JudgedResolver>>();

  constructor(
    readonly scope: Scope,
    readonly project: Loaded<ProjectDoc>,
    private readonly refusals: RefusalList,
  ) {}

  /** Refusals against one file. */
  refuser(file: string): Refuser {
    return (code, message, at, hint) => {
      this.refusals.add({ code, file, message, at, hint });
    };
  }

  // ---- types --------------------------------------------------------------------------------------

  /** The type a spec names; R001 when it cannot be resolved. */
  type(spec: TypeSpec | undefined, file: string, at: string): Type | undefined {
    if (spec === undefined) return undefined;
    return this.resolving(() => this.scope.types.spec(spec), file, at, 'wilanis ls shape');
  }

  /** The type of a fields block; R001 when a field's type cannot be resolved. */
  fieldsType(fields: Fields | undefined, file: string, at: string): Type | undefined {
    return this.resolving(() => this.scope.types.fields(fields), file, at);
  }

  private resolving(resolve: () => Type, file: string, at: string, hint?: string): Type | undefined {
    try {
      return resolve();
    } catch (error) {
      if (!(error instanceof TypeError_)) throw error;
      this.refuser(file)('R001', error.message, at, hint);
      return undefined;
    }
  }

  /** The type a spec names, or nothing: the refusal is made where the spec itself is judged. */
  quiet(spec: TypeSpec | undefined): Type | undefined {
    if (spec === undefined) return undefined;
    try {
      return this.scope.types.spec(spec);
    } catch {
      return undefined;
    }
  }

  /** What an operation takes, as one type, quietly; nothing when it accepts nothing. */
  acceptsType(op: Operation): Type | undefined {
    const accepts = op.accepts ?? {};
    return Object.keys(accepts).length ? this.quiet({ fields: accepts }) : undefined;
  }

  // ---- documents ----------------------------------------------------------------------------------

  /** The profiles to judge under: each declared one, or the one unnamed profile. */
  profiles(): (string | undefined)[] {
    const declared = this.scope.profiles();
    return declared.length ? declared : [undefined];
  }

  /** L005 when `from` may not name `target`. */
  visible(from: Loaded, target: Loaded, at: string): void {
    const reason = this.scope.visibility(from, target);
    if (reason) this.refuser(from.path)('L005', reason, at, `wilanis describe ${target.path} shows who may name it`);
  }

  /** Resolve path#operation from a document, with visibility; R001 when it names nothing. */
  opAt(opRef: string, from: Loaded, at: string): OpHit | undefined {
    const hit = this.scope.op(opRef);
    if (typeof hit === 'string') {
      this.refuser(from.path)('R001', hit, at, 'wilanis ls port');
      return undefined;
    }
    this.visible(from, hit.port, at);
    return hit;
  }

  /** path#operation with the path made canonical. */
  canonOp(opRef: string): string {
    const { path, op } = splitOp(opRef);
    return `${this.scope.canon(path)}#${op}`;
  }

  /** The effectful operations a feature allows. */
  effectsOf(feature: string | undefined): Effects {
    const doc = this.scope.registry.get('feature', `@features/${feature}/feature.json`)?.doc;
    const allowed = new Set((doc?.effects ?? []).map(effect => this.canonOp(effect)));
    return { allowed, at: `@features/${feature}/feature.json → effects` };
  }

  /** Every reason reachable under any profile, with the first file found refusing with it. */
  reachableReasons(reach: (profile: string | undefined) => ReachableRefusal[]): Map<string, string> {
    const reasons = new Map<string, string>();
    for (const profile of this.profiles()) {
      for (const refusal of reach(profile)) if (!reasons.has(refusal.reason)) reasons.set(refusal.reason, refusal.file);
    }
    return reasons;
  }

  // ---- values -------------------------------------------------------------------------------------

  /** Type a value where only {{secrets.<key>}} may be read; `why` says why nothing else may. */
  secretsRead(value: unknown, why: string): Read | string | undefined {
    const secrets = this.scope.project?.secrets ?? {};
    return this.scope.valueRead(value, (root, path) => {
      if (root !== 'secrets') return `{{${[root, ...path].join('.')}}}: ${why}`;
      if (path.length !== 1) return `{{secrets.${path.join('.')}}}: a secret is one key`;
      if (!(path[0] in secrets)) return `secret '${path[0]}' is not declared in project.json secrets`;
      return { type: STRING, optional: false };
    });
  }

  /** Type a settings block; C001 when it reads anything but a secret. */
  settingsRead(value: unknown, file: string, at: string): Read | undefined {
    const read = this.secretsRead(value, 'only {{secrets.<key>}} may appear in settings');
    if (typeof read !== 'string') return read;
    this.refuser(file)('C001', read, at, 'declare the key under project.json → secrets');
    return undefined;
  }

  // ---- layers -------------------------------------------------------------------------------------

  /** L001, L005 for every shape a type written in a non-native document names. */
  checkLayer(site: LayerSite): void {
    for (const [ref, where] of typeRefs(site.spec, site.at)) this.checkTypeRef(site, ref, where);
  }

  private checkTypeRef(site: LayerSite, ref: string, where: string): void {
    const refuse = this.refuser(site.from.path);
    const base = ref.replace(/(\[\])+$/, '');
    if (base.startsWith('$') || base === 'type') {
      refuse(
        'L001',
        `${site.what} uses '${base}' -- that belongs to native contracts only`,
        where,
        'name a shape of this tree, or a scalar type',
      );
    }
    if (base === 'unknown' && site.layer === 'core') {
      const hint = 'name the fields, or keep the value at the edge';
      refuse('L001', `${site.what} declares unknown -- only edge shapes and native contracts may`, where, hint);
    }
    if (!base.startsWith('@')) return;
    const target = this.scope.get('shape', base);
    if (!target) return; // R001 elsewhere
    this.visible(site.from, target, where);
    if (site.layer && target.doc.layer !== site.layer) {
      const message = `${site.what} names ${target.doc.layer} shape '${base}' from the ${site.layer} layer`;
      refuse('L001', message, where, LAYER_HINTS[site.layer]);
    }
  }
}
