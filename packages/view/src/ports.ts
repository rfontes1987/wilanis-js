/**
 * The ports of a node and where its operation leads: each field an operation accepts and answers, how one input value
 * was written, and the attribute ports a deep read opens under the field it reads.
 */
import { bindings } from '@wilanis/compiler';
import type { Operation, Type, Values } from '@wilanis/core';
import { hasVars, type Scope, show, splitPath, substitute, TEMPLATE, WHOLE_TEMPLATE } from '@wilanis/core';
import type { VEdge, VNode, VPort, VTarget } from './types.js';
import { labelOf, readable } from './types.js';

/** The port that stands for a whole value, rather than one of its fields. */
export const WHOLE = '';

export const ordinal = (place: number) =>
  `${place}${['th', 'st', 'nd', 'rd'][place % 100 > 10 && place % 100 < 14 ? 0 : Math.min(place % 10, 4) % 4] ?? 'th'}`;

/**
 * Make sure a node offers the port a read names, opening every level of a deep path as an attribute under
 * its parent: `body.id` sits under `body`. A parent that is not there yet (a key of an open object) is added too.
 */
/** Where an attribute port sits: after its parent and after every attribute already under it, else at the end. */
function insertAt(outputs: VPort[], parent: string | undefined): number {
  if (parent === undefined) return outputs.length;
  const parentAt = outputs.findIndex(port => port.name === parent);
  if (parentAt < 0) return outputs.length;
  let at = parentAt + 1;
  while (at < outputs.length && outputs[at].name.startsWith(`${parent}.`)) at++;
  return at;
}

export function attributePorts(node: VNode, name: string, typeAtPath: (path: string[]) => Type | undefined) {
  if (node.outputs.some(port => port.name === name)) return;
  const segments = name.split('.');
  for (let depth = 1; depth <= segments.length; depth++) {
    const path = segments.slice(0, depth);
    const portName = path.join('.');
    if (node.outputs.some(port => port.name === portName)) continue;
    const type = typeAtPath(path);
    const port: VPort = {
      name: portName,
      type: type ? show(type) : undefined,
      ...(depth > 1 ? { depth: depth - 1 } : {}),
    };
    const parent = depth > 1 ? segments.slice(0, depth - 1).join('.') : undefined;
    node.outputs.splice(insertAt(node.outputs, parent), 0, port);
  }
}

/** The operation a node runs and where it leads. An unknown operation still answers a target the page can name. */
export function targetOf(scope: Scope, opRef: string): { op?: Operation; target: VTarget } {
  const hit = scope.op(opRef);
  const hash = opRef.lastIndexOf('#');
  const path = hash < 0 ? opRef : opRef.slice(0, hash);
  const opName = hash < 0 ? '' : opRef.slice(hash + 1);
  const portPath = scope.canon(path);
  if (typeof hit === 'string')
    return {
      target: {
        op: opRef,
        opName,
        port: portPath,
        portLabel: labelOf(scope.registry.any(portPath)) || readable(stemOf(portPath)),
        native: false,
        implementation: portPath,
      },
    };
  const target: VTarget = {
    op: `${hit.path}#${hit.opName}`,
    opName: hit.opName,
    port: hit.path,
    portLabel: labelOf(hit.port),
    native: Boolean(hit.port.native),
    implementation: hit.path,
  };
  if (hit.port.native) markNative(target, hit.op);
  else markBound(scope, target, hit.path, hit.opName);
  return { op: hit.op, target };
}

/** What a native operation is: pure or an effect, and whether it may refuse. */
function markNative(target: VTarget, op: Operation) {
  target.pure = op.pure === true;
  target.effect = op.pure !== true;
  if (op.refuses) target.refuses = true;
}

/** Which bindings meet a domain port's operation, and which one the page opens first. */
function markBound(scope: Scope, target: VTarget, port: string, opName: string) {
  target.bindings = scope.bindingsFor(port).map(binding => {
    const operation = binding.doc.operations[opName];
    const graph = operation?.graph ? scope.get('graph', operation.graph) : undefined;
    return {
      path: binding.path,
      label: labelOf(binding),
      graph: graph?.path,
      graphLabel: graph ? labelOf(graph) : undefined,
      run: operation?.run,
    };
  });
  const first = target.bindings[0];
  if (first) target.implementation = first.graph ?? first.path;
}

export const stemOf = (path: string) =>
  path
    .slice(path.lastIndexOf('/') + 1)
    .replace(/\.json$/, '')
    .replace(/\.[a-z-]+$/, '');

/** How one input value was written: a literal, text with reads, or a whole read (no annotation). */
/** How a string was written: a whole read (no annotation), text with reads in it, or a literal that may name a document. */
function writtenText(scope: Scope, text: string): Pick<VPort, 'literal' | 'text' | 'ref'> {
  if (WHOLE_TEMPLATE.test(text)) return {};
  if (text.includes('{{')) return { text };
  const target = text.startsWith('@') ? scope.any(text.replace(/(\[\])+$/, '')) : undefined;
  return { literal: JSON.stringify(text), ...(target ? { ref: target.path } : {}) };
}

export function written(scope: Scope, value: unknown): Pick<VPort, 'literal' | 'text' | 'ref'> {
  if (value === undefined) return {};
  if (typeof value === 'string') return writtenText(scope, value);
  if (scope.literal(value)) return { literal: JSON.stringify(value) };
  return { text: JSON.stringify(value) };
}

/** The input ports of an operation call: every declared field, marked when not given, plus any given field the contract does not declare. */
/** A field's type as a reader sees it: a type parameter, an enum, or the spec with this call's variables filled in. */
function fieldType(scope: Scope, field: { type: unknown; enum?: string[] }, subst: Record<string, Type>) {
  if (field.type === 'type') return 'type';
  if (field.enum) return field.enum.map(one => JSON.stringify(one)).join(' | ');
  try {
    let type = scope.types.spec(field.type as never);
    if (hasVars(type)) type = substitute(type, subst);
    return show(type);
  } catch {
    return typeof field.type === 'string' ? field.type : undefined;
  }
}

/** How one input is given: written at the call, bound from each element of a map, or not given at all. */
function howGiven(scope: Scope, value: unknown, bind: Record<string, string> | undefined, name: string) {
  if (value !== undefined) return written(scope, value);
  if (bind && name in bind) return { bound: bind[name] };
  return { missing: true };
}

/** The input ports of a call: each field the operation accepts, typed with the variables this call binds, and how it is given -- written, bound from each element of a map, or not at all. */
export function inputPorts(
  scope: Scope,
  op: Operation | undefined,
  given: Values | undefined,
  bind?: Record<string, string>,
): VPort[] {
  const ports: VPort[] = [];
  const subst = op ? bindings(scope, op, given) : {};
  const typeOf = (field: { type: unknown; enum?: string[] }) => fieldType(scope, field, subst);
  for (const [name, field] of Object.entries(op?.accepts ?? {})) {
    const how = howGiven(scope, given?.[name], bind, name);
    ports.push({
      name,
      type: typeOf(field),
      required: field.required !== false,
      static: field.static || field.type === 'type' || undefined,
      description: field.description,
      ...how,
    });
  }
  for (const [name, value] of Object.entries(given ?? {}))
    if (!op?.accepts?.[name]) ports.push({ name, ...written(scope, value) });
  return ports;
}

/** What an operation answers at one call site: its return type with the variables its `type` fields bind. */
export function resultType(scope: Scope, op: Operation | undefined, given: Values | undefined): Type | undefined {
  if (!op?.returns) return undefined;
  try {
    const type = scope.types.spec(op.returns);
    return hasVars(type) ? substitute(type, bindings(scope, op, given)) : type;
  } catch {
    return undefined;
  }
}

/** The output ports: the whole value first, then the fields of the result when it is an object. */
/** The type of the whole answer: resolved where it resolves, else the spec the contract wrote. */
function wholeType(resolved: Type | undefined, returns: unknown): string | undefined {
  if (resolved) return show(resolved);
  return typeof returns === 'string' ? returns : undefined;
}

export function outputPorts(result: Type | undefined, op: Operation | undefined): VPort[] {
  if (!op?.returns) return [];
  return [{ name: WHOLE, type: wholeType(result, op.returns) }, ...fieldPorts(result)];
}

/** One port per top-level field of an object type. */
export function fieldPorts(type: Type | undefined, wholeLabel?: string): VPort[] {
  const out: VPort[] = wholeLabel !== undefined ? [{ name: WHOLE, type: wholeLabel }] : [];
  if (type?.kind === 'object')
    for (const [name, field] of Object.entries(type.fields))
      out.push({ name, type: show(field.type), required: field.required });
  return out;
}

/** Every {{...}} read a value names, however deeply it is nested. */
function readsIn(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (typeof value === 'string') {
    for (const found of value.matchAll(TEMPLATE)) into.add(found[1]);
    return into;
  }
  if (Array.isArray(value)) {
    for (const each of value) readsIn(each, into);
    return into;
  }
  if (value && typeof value === 'object')
    for (const each of Object.values(value as Record<string, unknown>)) readsIn(each, into);
  return into;
}

/**
 * Data edges: every {{root.path}} read in a node's inputs becomes an edge from the root's port to the input.
 * A read through a resolver leaves the request node at the path the resolver names.
 */
/** Where one read leaves: the node it names, or the request node at the path its resolver names. */
function leaves(read: string, resolvers: Map<string, { path: string[] }>) {
  const [root, ...path] = splitPath(read);
  if (root === 'secrets') return undefined;
  const resolver = resolvers.get(root);
  if (!resolver) return { from: root, fromPort: path.join('.') };
  return { from: 'request', fromPort: [...resolver.path, ...path].join('.') };
}

export function wire(
  edges: VEdge[],
  to: string,
  values: Values | undefined,
  resolvers: Map<string, { path: string[] }>,
) {
  for (const [toPort, value] of Object.entries(values ?? {}))
    for (const read of readsIn(value)) {
      const source = leaves(read, resolvers);
      if (source) edges.push({ ...source, to, toPort, kind: 'data' });
    }
}
