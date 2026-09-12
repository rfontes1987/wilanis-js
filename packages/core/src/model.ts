/**
 * The document model: one TypeScript type per document kind, mirroring schemas/*.schema.json.
 * A document's kind is its $schema (the published URL, or the alias @wilanis/<kind>.schema.json); its identity is its path (@...).
 */

export type Kind =
  | 'project'
  | 'plugin'
  | 'port'
  | 'binding'
  | 'graph'
  | 'trigger'
  | 'policy'
  | 'trigger-kind'
  | 'connection-kind'
  | 'connection'
  | 'codec'
  | 'feature'
  | 'shape'
  | 'scenario'
  | 'resolvers'
  | 'store';

export const KINDS: Kind[] = [
  'project',
  'plugin',
  'port',
  'binding',
  'graph',
  'trigger',
  'policy',
  'trigger-kind',
  'connection-kind',
  'connection',
  'codec',
  'feature',
  'shape',
  'scenario',
  'resolvers',
  'store',
];

/** The short alias a document may use as its $schema: @wilanis/<kind>.schema.json. */
export const WILANIS = '@wilanis';
/**
 * Where the schemas are published, so editors and agents can fetch them. The branch name carries the
 * schema version: main until 1.0 is published; from then on a tag (schemas-v1, later schemas-v2) that a
 * document written against it keeps validating under for as long as that version is read.
 */
export const SCHEMA_BASE = 'https://raw.githubusercontent.com/wilanis/wilanis-js/main/packages/core/schemas';
/** The short `$schema` a kind's documents carry, the form a reader writes: `@wilanis/graph.schema.json`. */
export const schemaRef = (kind: Kind) => `${WILANIS}/${kind}.schema.json`;
/** Where a kind's schema is fetched from, so an editor or an agent can resolve what the short form names. */
export const schemaUrl = (kind: Kind) => `${SCHEMA_BASE}/${kind}.schema.json`;
const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const KIND_OF_SCHEMA = new RegExp(`^(?:${escapeRe(WILANIS)}|${escapeRe(SCHEMA_BASE)})/([a-z-]+)\\.schema\\.json$`);
/** The kind a $schema names, in either form; undefined when it is not a wilanis schema. */
export function kindOfSchema(schema: unknown): Kind | undefined {
  if (typeof schema !== 'string') return undefined;
  const match = KIND_OF_SCHEMA.exec(schema);
  return match && (KINDS as string[]).includes(match[1]) ? (match[1] as Kind) : undefined;
}

/**
 * The three layers of a feature, named by the directory a document sits in. A document's layer is where it
 * lives, not what it is: `edge/` speaks the world's vocabulary, `domain/` holds the business rules, `data/`
 * translates and carries the effects. The layer is read off the path so a rule can be checked structurally,
 * never inferred from who happens to reference a document.
 */
export type Layer = 'edge' | 'domain' | 'data';
export const LAYERS: Layer[] = ['edge', 'domain', 'data'];

/** The layer a path declares: @features/<f>/<layer>/... -> that layer; anything else -> undefined. */
export function layerOf(path: string): Layer | undefined {
  const match = /^@features\/[^/]+\/([a-z]+)\//.exec(path);
  return match && (LAYERS as string[]).includes(match[1]) ? (match[1] as Layer) : undefined;
}

export const NODE_RUN = '@wilanis/node/run.schema.json';
export const NODE_SWITCH = '@wilanis/node/switch.schema.json';
export const NODE_MAP = '@wilanis/node/map.schema.json';

/** Every document: its kind, what it is for, and optionally a short human name a reader sees instead of its path. */
export interface Envelope {
  $schema: string;
  description: string;
  label?: string;
}

export type TypeRef = string;
export interface InlineObject {
  fields: Record<string, Field>;
  open?: boolean | TypeRef;
  description?: string;
}
export type TypeSpec = TypeRef | InlineObject;
/**
 * One field of a shape or a contract. `static`: where the operation is called the value must be a literal,
 * never a read; a field of type `type` always is. `resolves`: variable -> the path within the document this
 * field's literal names whose value is the type to bind it to (`resolves.ts` holds the grammar).
 */
export interface Field {
  type: TypeSpec;
  required?: boolean;
  description?: string;
  secret?: boolean;
  enum?: string[];
  binds?: string;
  static?: boolean;
  resolves?: Record<string, string>;
}
export type Fields = Record<string, Field>;

/**
 * A value where an operation is called: a literal as written, or a string carrying {{root.path}} templates.
 * Alone, a template takes that value and its type; embedded in text it is interpolated. Lists and objects
 * hold values. This is the one grammar for a node's in, a resolver's in, a delegation's in and a trigger's input.
 */
export type Value = unknown;
export type Values = Record<string, Value>;

/** One resolver: a named read of the trigger kind's context, request.params.id or request.headers['user-agent']. Nothing runs. */
export interface ResolverRead {
  read: string;
  label?: string;
  description?: string /** read as present: every trigger reaching it must guarantee it, by its kind or by a policy that proves it (A006) */;
  required?: boolean;
}
/** The resolvers a feature reads from the request, in one edge document a data graph or a binding names. */
export interface ResolversDoc extends Envelope {
  resolvers: Record<string, ResolverRead>;
}

/** One step of the project's startup: the domain port operation it fires, the values it takes, and whether serving may proceed when it refuses. */
export interface StartupStep {
  run: string;
  in?: Values;
  required?: boolean;
  label?: string;
  description?: string;
}

export interface ProjectDoc extends Envelope {
  name: string;
  aliases?: Record<string, string>;
  /** use: the alias root; from: the npm package that ships it (absent for the runtime's builtins @std and @cli). */
  plugins: { use: string; from?: string; settings?: Record<string, unknown> }[];
  /**
   * Trees this one includes: npm packages whose `features/` load as if they sat here, judged by every rule, bound
   * by bindings and profiles. `features` picks which of the package's features come along (default: all). An
   * include's aliases come along; its connections, plugins, settings, startup and profiles do not -- configuring
   * a tree is the host's job, and a port the include leaves unbound is the host's to bind.
   */
  includes?: { from: string; features?: string[] }[];
  secrets?: Record<string, string>;
  /** What runs once when the tree is served, in order, after every plugin's postLoad and before any trigger kind starts: `required` (the default) stops serve when the step refuses. */
  startup?: StartupStep[];
  profiles?: Record<string, { description?: string; bindings: Record<string, string> }>;
  /** The blob registry's directory; absent: under the system temp dir. */
  blobs?: { dir?: string };
}
/**
 * What a guarding plugin adds to every trigger kind's context once it has identified the caller (request.principal,
 * request.session, request.challenge), and the reasons it refuses with on its own -- a credential that does not
 * verify -- which every trigger giving it a credential must map like any other reason (T005).
 */
export interface GuardDoc {
  context: InlineObject;
  refuses?: Record<string, string>;
  credentials: Record<string, GuardCredential>;
}
/** One credential the guard verifies: the type a trigger's attachment must give it, and the context fields it yields once verified. */
export interface GuardCredential {
  type: TypeSpec;
  yields: string[];
  description?: string;
}
export interface PluginDoc extends Envelope {
  settings?: InlineObject;
  grants: {
    ports?: string[];
    triggerKinds?: string[];
    connectionKinds?: string[];
    codecs?: string[];
    shapes?: string[];
  };
  guard?: GuardDoc;
}
/**
 * `refuses`: running it ends the graph on purpose; its static `reason` input names the outcome, and a trigger
 * kind maps that word to how it answers. `holds`: running it starts something that outlives the run -- a
 * listener, a watcher -- which a project's startup list names and the runtime stops when the process ends.
 */
export interface Operation {
  description: string;
  accepts?: Fields;
  returns?: TypeSpec;
  pure?: boolean;
  refuses?: boolean;
  holds?: boolean;
}
export interface PortDoc extends Envelope {
  operations: Record<string, Operation>;
}
export interface BindingOp {
  graph?: string;
  run?: string;
  in?: Values;
  description?: string;
}
/** How a domain port is met. `resolvers` names the resolvers document whose reads a delegation may use. */
export interface BindingDoc extends Envelope {
  port: string;
  resolvers?: string;
  operations: Record<string, BindingOp>;
}

export interface RunNode {
  type: typeof NODE_RUN;
  id: string;
  label?: string;
  description?: string;
  run: string;
  in?: Values;
}
export interface SwitchNode {
  type: typeof NODE_SWITCH;
  id: string;
  label?: string;
  description?: string;
  in: Values;
  rules: { when: string; to: string; description?: string }[];
  else: string;
}
export interface MapNode {
  type: typeof NODE_MAP;
  id: string;
  label?: string;
  description?: string;
  run: string;
  over: Value;
  in?: Values;
  bind?: Record<string, string>;
  onItemFailure?: 'fail' | 'collect';
}
export type Node = RunNode | SwitchNode | MapNode;
/** Whether a graph node is the one that calls an operation, narrowed so its `run` and `in` may be read. */
export const isRun = (node: Node): node is RunNode => node.type === NODE_RUN;
/** Whether a graph node is the one that routes on its rules, narrowed so its cases may be read. */
export const isSwitch = (node: Node): node is SwitchNode => node.type === NODE_SWITCH;
/** Whether a graph node is the one that runs per element, narrowed so its `over` and binding may be read. */
export const isMap = (node: Node): node is MapNode => node.type === NODE_MAP;

export interface GraphDoc extends Envelope {
  /** The resolvers document whose reads this graph may use as {{name}}; data graphs only. */
  resolvers?: string;
  constants?: Record<string, { type: TypeSpec; value: unknown; description?: string }>;
  in?: TypeRef;
  out?: { type: TypeRef; from: string | string[]; description?: string };
  nodes: Node[];
}
/** What a trigger fires: one run node. The node type is implicit -- trigger.schema.json declares it. */
export interface FireNode {
  description?: string;
  label?: string;
  run: string;
  in?: Values;
}
/**
 * One policy attached to a trigger: the policy, and `in` -- the credentials this trigger gives the guard, by the names the
 * guard's plugin.json declares (`token`, `challenge`), each read from the kind's context like any input; a list is the
 * places one may sit, the first present wins. A bare path attaches a policy that reads what an earlier attachment supplied.
 */
export interface PolicyUse {
  policy: string;
  in?: Values;
  description?: string;
}
export type PolicyRef = string | PolicyUse;
/** The policy a trigger's entry names, whether it was written as a bare path or as an object with inputs. */
export const policyPath = (ref: PolicyRef) => (typeof ref === 'string' ? ref : ref.policy);
/**
 * `policies`: what gates this trigger, in order -- the first that does not allow answers, and the trigger maps each reason
 * they can refuse with like any other (T005). Absent, the trigger is public: no credential is read, no caller identified.
 */
export interface TriggerDoc extends Envelope {
  kind: string;
  settings: Record<string, unknown>;
  in?: TypeRef;
  out?: TypeRef;
  policies?: PolicyRef[];
  fire: FireNode;
}
/**
 * How a policy answers one reason its decision can refuse with: `deny` ends the run there; `challenge` opens a
 * challenge of `method` through the guarding plugin, and the caller is told how to answer it. Allow is the
 * decision finishing, so it is never written.
 */
export interface Outcome {
  effect: 'deny' | 'challenge';
  method?: string;
  description?: string;
}
/**
 * A gate on a trigger: `decide` fires a domain port operation the way a trigger's `fire` does, reading what the kind
 * and the guard hand as request.*; the graph behind it allows by answering and refuses with a reason, and `outcomes`
 * says what each reason means. Validating a credential never happens here: the guard has already done that.
 */
export interface PolicyDoc extends Envelope {
  decide: FireNode;
  outcomes: Record<
    string,
    Outcome
  > /** request.* paths present once this policy allows -- request.principal, request.session -- which a required resolver may lean on (A006) */;
  proves?: string[];
}
/** `refusals`: the dotted settings path holding the map from a refusal's reason to how this kind answers it; every reason a trigger can reach must be a key there (T005). */
export interface TriggerKindDoc extends Envelope {
  settings: InlineObject;
  context: InlineObject;
  refusals?: string;
}
/** `storage`: a connection of this kind reaches a storage engine, so a store may name it; the granting plugin registers the engine. */
export interface ConnectionKindDoc extends Envelope {
  settings: InlineObject;
  storage?: boolean;
}
export interface ConnectionDoc extends Envelope {
  kind: string;
  settings: Record<string, unknown>;
}
export interface CodecDoc extends Envelope {
  yields: 'declared' | TypeRef;
}
export interface FeatureDoc extends Envelope {
  dependsOn?: string[];
  exports?: string[];
  effects?: string[];
}
export interface ShapeDoc extends Envelope {
  layer: 'edge' | 'core';
  fields: Fields;
  open?: boolean | TypeRef;
}
/** One field of a collection holding the key of another: which collection, and what removing a referenced record does. */
export interface StoreRef {
  collection: string;
  /** refuse is the only value there will be: nothing is ever deleted on a tree's behalf. */
  onRemove?: 'refuse';
  description?: string;
}
/**
 * One collection of a store: the shape its records have, the field that identifies one, the constraints the
 * records are held to, and what it holds. `unique` lists combinations no two records may repeat, each inner
 * list one constraint over those fields together; `refs` says which fields hold another collection's key;
 * `defaults` is what existing rows receive when `ensure` adds a column, never what a graph writes.
 */
export interface Collection {
  of: TypeRef;
  key: string;
  unique?: string[][];
  refs?: Record<string, StoreRef>;
  defaults?: Record<string, unknown>;
  description?: string;
}
/**
 * What a feature keeps: the connection its records live behind, and the collections kept there, by name. The
 * collection is where the record type is written down, so a call site names the store and the collection and
 * nothing else.
 */
export interface StoreDoc extends Envelope {
  connection: string;
  collections: Record<string, Collection>;
}

export interface ScenarioDoc extends Envelope {
  trigger: string;
  seed: number;
  in?: unknown;
  request?: Record<string, unknown>;
  stubs?: Record<string, unknown>;
  expect: {
    status: 'done' | 'failed' | 'blocked';
    output?: unknown;
    nodes: Record<string, { status: string; out?: unknown; selected?: string }>;
  };
}

export interface DocByKind {
  project: ProjectDoc;
  plugin: PluginDoc;
  port: PortDoc;
  binding: BindingDoc;
  graph: GraphDoc;
  trigger: TriggerDoc;
  policy: PolicyDoc;
  'trigger-kind': TriggerKindDoc;
  'connection-kind': ConnectionKindDoc;
  connection: ConnectionDoc;
  codec: CodecDoc;
  feature: FeatureDoc;
  shape: ShapeDoc;
  scenario: ScenarioDoc;
  resolvers: ResolversDoc;
  store: StoreDoc;
}
export type AnyDoc = DocByKind[Kind];
