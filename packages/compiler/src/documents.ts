/**
 * What both judges read off a document: the variables a call site binds, the inputs a delegation passes
 * on, and the nodes a graph answers with. The checker and the compiler agree on these by sharing them.
 */
import type { GraphDoc, Operation, Scope, Type, Values } from '@wilanis/core';

/** The variables an operation's `type` fields bind at one call site: each is a literal type reference in `given`. */
export function bindings(scope: Scope, op: Operation, given: Values | undefined): Record<string, Type> {
  const subst: Record<string, Type> = {};
  for (const [name, field] of Object.entries(op.accepts ?? {})) {
    if (!field.binds || field.type !== 'type') continue;
    const value = given?.[name];
    if (typeof value !== 'string') continue;
    try {
      subst[field.binds] = scope.types.spec(value);
    } catch {
      /* unknown type: R001 elsewhere */
    }
  }
  return subst;
}

/**
 * What a delegation hands its target: the statement's own values, and for every input it does not give that
 * the bound operation also accepts, the caller's value by name.
 */
export function passedInputs(target: Operation, op: Operation, given: Values | undefined): Values {
  const out: Values = { ...(given ?? {}) };
  for (const name of Object.keys(target.accepts ?? {})) {
    if (!(name in out) && op.accepts?.[name]) out[name] = `{{in.${name}}}`;
  }
  return out;
}

/** The nodes a graph answers with, in order of preference; nothing when it answers nothing. */
export function outputCandidates(doc: GraphDoc): string[] | undefined {
  if (!doc.out) return undefined;
  return Array.isArray(doc.out.from) ? doc.out.from : [doc.out.from];
}
