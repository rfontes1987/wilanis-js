/**
 * The document model: one TypeScript type per document kind, mirroring schemas/*.schema.json.
 * A document's kind is its $schema (the published URL, or the alias @wilanis/<kind>.schema.json); its identity is its path (@...).
 */

export type Kind =
  | 'project' | 'plugin' | 'port' | 'binding' | 'graph' | 'trigger'
  | 'trigger-kind' | 'connection-kind' | 'connection' | 'codec' | 'feature' | 'shape' | 'scenario';

export const KINDS: Kind[] = [
  'project', 'plugin', 'port', 'binding', 'graph', 'trigger',
  'trigger-kind', 'connection-kind', 'connection', 'codec', 'feature', 'shape', 'scenario',
];

/** The short alias a document may use as its $schema: @wilanis/<kind>.schema.json. */
export const WILANIS = '@wilanis';
/**
 * Where the schemas are published, so editors and agents can fetch them. The branch name carries the
 * schema major version: a document written against schemas-v1 keeps validating for as long as v1 lives.
 */
export const SCHEMA_BASE = 'https://raw.githubusercontent.com/rfontes1987/wilanis/schemas-v1/packages/core/schemas';
export const schemaRef = (kind: Kind) => `${WILANIS}/${kind}.schema.json`;
export const schemaUrl = (kind: Kind) => `${SCHEMA_BASE}/${kind}.schema.json`;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const KIND_OF_SCHEMA = new RegExp(`^(?:${escapeRe(WILANIS)}|${escapeRe(SCHEMA_BASE)})/([a-z-]+)\\.schema\\.json$`);
/** The kind a $schema names, in either form; undefined when it is not a wilanis schema. */
export function kindOfSchema(s: unknown): Kind | undefined {
  if (typeof s !== 'string') return undefined;
  const m = KIND_OF_SCHEMA.exec(s);
  return m && (KINDS as string[]).includes(m[1]) ? (m[1] as Kind) : undefined;
}

export const NODE_RUN = '@wilanis/node/run.schema.json';
export const NODE_SWITCH = '@wilanis/node/switch.schema.json';
export const NODE_MAP = '@wilanis/node/map.schema.json';

export interface Envelope { $schema: string; description: string }

export type TypeRef = string;
export interface InlineObject { fields: Record<string, Field>; open?: boolean | TypeRef; description?: string }
export type TypeSpec = TypeRef | InlineObject;
export interface Field { type: TypeSpec; required?: boolean; description?: string; secret?: boolean; enum?: string[]; binds?: string }
export type Fields = Record<string, Field>;

export type Source = string | Source[] | { [k: string]: Source };
export type Sources = Record<string, Source>;
export type Params = Record<string, unknown>;

export interface ResolverSpec { run: string; in?: Params; params?: Params; description?: string }
export type Resolvers = Record<string, ResolverSpec>;

export interface ProjectDoc extends Envelope {
  name: string;
  aliases?: Record<string, string>;
  /** use: the alias root; from: the npm package that ships it (absent for the runtime's builtins @std and @cli). */
  plugins: { use: string; from?: string; settings?: Record<string, unknown> }[];
  secrets?: Record<string, string>;
  profiles?: Record<string, { description?: string; bindings: Record<string, string> }>;
}
export interface PluginDoc extends Envelope {
  settings?: InlineObject;
  grants: { ports?: string[]; triggerKinds?: string[]; connectionKinds?: string[]; codecs?: string[] };
}
export interface Operation { description: string; accepts?: Fields; returns?: TypeSpec; params?: Fields; pure?: boolean }
export interface PortDoc extends Envelope { operations: Record<string, Operation> }
export interface BindingOp { graph?: string; run?: string; params?: Params; description?: string }
export interface BindingDoc extends Envelope { port: string; resolvers?: Resolvers; operations: Record<string, BindingOp> }

export interface RunNode { type: typeof NODE_RUN; id: string; description?: string; run: string; in?: Sources; params?: Params }
export interface SwitchNode { type: typeof NODE_SWITCH; id: string; description?: string; in: Sources; rules: { when: string; to: string; description?: string }[]; else: string }
export interface MapNode { type: typeof NODE_MAP; id: string; description?: string; run: string; over: Source; in?: Sources; bind?: Record<string, string>; params?: Params; onItemFailure?: 'fail' | 'collect' }
export type Node = RunNode | SwitchNode | MapNode;
export const isRun = (n: Node): n is RunNode => n.type === NODE_RUN;
export const isSwitch = (n: Node): n is SwitchNode => n.type === NODE_SWITCH;
export const isMap = (n: Node): n is MapNode => n.type === NODE_MAP;

export interface GraphDoc extends Envelope {
  resolvers?: Resolvers;
  constants?: Record<string, { type: TypeSpec; value: unknown; description?: string }>;
  in?: TypeRef; out?: { type: TypeRef; from: string | string[]; description?: string };
  nodes: Node[];
}
export interface TriggerDoc extends Envelope { kind: string; settings: Record<string, unknown>; in?: TypeRef; input?: unknown; out?: TypeRef; graph: string }
export interface TriggerKindDoc extends Envelope { settings: InlineObject; context: InlineObject }
export interface ConnectionKindDoc extends Envelope { settings: InlineObject }
export interface ConnectionDoc extends Envelope { kind: string; settings: Record<string, unknown> }
export interface CodecDoc extends Envelope { yields: 'declared' | TypeRef }
export interface FeatureDoc extends Envelope { dependsOn?: string[]; exports?: string[]; effects?: string[] }
export interface ShapeDoc extends Envelope { layer: 'edge' | 'core'; fields: Fields; open?: boolean | TypeRef }
export interface ScenarioDoc extends Envelope {
  graph: string; seed: number; in?: unknown; request?: Record<string, unknown>; stubs?: Record<string, unknown>;
  expect: { status: 'done' | 'failed' | 'blocked'; output?: unknown; nodes: Record<string, { status: string; out?: unknown; selected?: string }> };
}

export interface DocByKind {
  project: ProjectDoc; plugin: PluginDoc; port: PortDoc; binding: BindingDoc; graph: GraphDoc; trigger: TriggerDoc;
  'trigger-kind': TriggerKindDoc; 'connection-kind': ConnectionKindDoc; connection: ConnectionDoc; codec: CodecDoc;
  feature: FeatureDoc; shape: ShapeDoc; scenario: ScenarioDoc;
}
export type AnyDoc = DocByKind[Kind];

/** A document as loaded. */
export interface Loaded<T extends AnyDoc = AnyDoc> {
  doc: T;
  kind: Kind;
  /** Canonical path: @features/tasks/tasks.port.json, or @http/http.port.json for a native document. */
  path: string;
  /** The filename stem. */
  name: string;
  /** The feature folder it sits in, if any. */
  feature?: string;
  /** The plugin alias that shipped it, if native. */
  native?: string;
}

/** One reason the tree is refused: the file, the rule, and the direction of the fix. */
export interface Refusal { code: string; message: string; file: string; at?: string; hint?: string }

export class RefusalList {
  readonly items: Refusal[] = [];
  add(r: Refusal) { this.items.push(r); return this; }
  get ok() { return this.items.length === 0; }
  format(): string {
    return this.items.map(r => `${r.code}  ${r.file}${r.at ? `#${r.at}` : ''}\n    ${r.message}${r.hint ? `\n    → ${r.hint}` : ''}`).join('\n');
  }
}

/** Everything the loader found, by canonical path. */
export class Registry {
  private byPath = new Map<string, Loaded>();
  readonly files: Loaded[] = [];
  add(entry: Loaded): Loaded | undefined {
    const dup = this.byPath.get(entry.path);
    this.byPath.set(entry.path, entry);
    this.files.push(entry);
    return dup;
  }
  get<K extends Kind>(kind: K, path: string): Loaded<DocByKind[K]> | undefined {
    const e = this.byPath.get(path);
    return e && e.kind === kind ? (e as Loaded<DocByKind[K]>) : undefined;
  }
  any(path: string): Loaded | undefined { return this.byPath.get(path); }
  all<K extends Kind>(kind: K): Loaded<DocByKind[K]>[] { return this.files.filter(f => f.kind === kind) as Loaded<DocByKind[K]>[]; }
  get project(): Loaded<ProjectDoc> | undefined { return this.all('project')[0]; }
}

/** Split path#operation. */
export function splitOp(opRef: string): { path: string; op: string } {
  const i = opRef.lastIndexOf('#');
  return { path: opRef.slice(0, i), op: opRef.slice(i + 1) };
}
