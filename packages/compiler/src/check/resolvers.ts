/**
 * P resolvers. A resolvers document names reads of the request; a data graph or a binding names the document
 * and reads {{name}}. Each document is judged once here (P002, P003); whether the trigger kinds that reach a
 * read hand it is judged at the trigger (T004). Also the walk that finds every request.* path an operation
 * reaches through its binding, which B008 and T004 hold their callers to.
 */
import { isSwitch, type Loaded, type ResolverRead as ResolverSpec, type ResolversDoc, splitPath } from '@wilanis/core';
import { type Judge, type JudgedResolver, RESERVED, type Refuser, readValuesOf } from './judge.js';

/**
 * One request.* path read under a trigger: where, and -- when the resolver declared itself required -- the
 * resolver's own path, which the trigger must guarantee.
 */
export interface RequestNeed {
  path: string[];
  file: string;
  required?: string[];
}

/** Judge a resolvers document: every name is free, every read is a path some trigger kind hands. */
export function checkResolversDoc(judge: Judge, doc: Loaded<ResolversDoc>): void {
  const refuse = judge.refuser(doc.path);
  const judged: Record<string, JudgedResolver> = {};
  for (const [name, spec] of Object.entries(doc.doc.resolvers)) {
    const resolver = judgeResolver(judge, refuse, name, spec);
    if (resolver) judged[name] = resolver;
  }
  judge.resolverReads.set(doc.path, judged);
}

function judgeResolver(judge: Judge, refuse: Refuser, name: string, spec: ResolverSpec): JudgedResolver | undefined {
  const at = `resolvers/${name}`;
  if (RESERVED.has(name)) {
    refuse(
      'P003',
      `resolver name '${name}' is reserved`,
      at,
      'in, const, request and secrets are roots; pick another name',
    );
    return undefined;
  }
  const path = splitPath(spec.read).slice(1);
  const read = judge.scope.requestRead(path);
  if (typeof read === 'string') {
    const hint = 'wilanis describe <trigger kind> shows what each kind hands as request.*';
    refuse('P002', `resolver '${name}': ${read}`, `${at}/read`, hint);
    return undefined;
  }
  // a resolver declared required is read as present; every trigger reaching it must then guarantee it (A006)
  const present = spec.required ? { type: read.type, optional: false } : read;
  return { path, read: present, required: Boolean(spec.required) };
}

/**
 * The resolvers a graph or binding may read, from the document it names. A domain graph names none: the
 * request is the world's, and the domain never sees it (L002).
 */
export function resolversFor(
  judge: Judge,
  ref: string | undefined,
  from: Loaded,
  allowed: boolean,
): Record<string, JudgedResolver> {
  if (!ref) return {};
  const refuse = judge.refuser(from.path);
  if (!allowed) {
    const hint = 'read the request in the data layer: the data graph or the binding names the resolvers document';
    refuse('L002', 'a domain graph never reads the request', 'resolvers', hint);
    return {};
  }
  const doc = judge.scope.get('resolvers', ref);
  if (!doc) {
    refuse('R001', `unknown resolvers document '${ref}'`, 'resolvers', 'wilanis ls resolvers');
    return {};
  }
  judge.visible(from, doc, 'resolvers');
  return judge.resolverReads.get(doc.path) ?? {};
}

/** The resolvers a document names, without refusing anything: the refusals were made where the document was judged. */
function quietResolvers(judge: Judge, ref: string | undefined): Record<string, JudgedResolver> {
  const doc = ref ? judge.scope.get('resolvers', ref) : undefined;
  return doc ? (judge.resolverReads.get(doc.path) ?? {}) : {};
}

/** The request.* paths a set of reads touches through the resolvers they name: what a trigger kind must hand. */
function requestNeedsOf(resolvers: Record<string, JudgedResolver>, reads: string[][], file: string): RequestNeed[] {
  const out: RequestNeed[] = [];
  for (const read of reads) {
    const resolver = resolvers[read[0]];
    if (!resolver) continue;
    out.push({
      path: [...resolver.path, ...read.slice(1)],
      file,
      required: resolver.required ? resolver.path : undefined,
    });
  }
  return out;
}

/** Every request.* path reachable from a domain port operation, through the binding that meets it under a profile. */
export function opNeeds(
  judge: Judge,
  opRef: string,
  profile: string | undefined,
  seen = new Set<string>(),
): RequestNeed[] {
  const hit = judge.scope.op(opRef);
  if (typeof hit === 'string' || hit.port.native) return [];
  const binding = judge.scope.bindingFor(hit.path, profile);
  if (typeof binding === 'string') return [];
  const bound = binding.doc.operations[hit.opName];
  if (!bound) return [];
  if (bound.graph) return graphNeeds(judge, judge.scope.canon(bound.graph), profile, seen);
  const resolvers = quietResolvers(judge, binding.doc.resolvers);
  return requestNeedsOf(resolvers, judge.scope.templateReads(bound.in), binding.path);
}

/** Every request.* path read under a graph: its own reads through its resolvers, and per node the one binding operation it reaches. */
function graphNeeds(judge: Judge, graphPath: string, profile: string | undefined, seen: Set<string>): RequestNeed[] {
  if (seen.has(graphPath)) return [];
  seen.add(graphPath);
  const graph = judge.scope.registry.get('graph', graphPath);
  if (!graph) return [];
  const reads = graph.doc.nodes.flatMap(node => judge.scope.templateReads(readValuesOf(node)));
  const out = requestNeedsOf(quietResolvers(judge, graph.doc.resolvers), reads, graph.path);
  for (const node of graph.doc.nodes) {
    if (isSwitch(node)) continue;
    const hit = judge.scope.op(node.run);
    if (typeof hit === 'string' || hit.port.native) continue;
    out.push(...opNeeds(judge, node.run, profile, seen));
  }
  return out;
}
