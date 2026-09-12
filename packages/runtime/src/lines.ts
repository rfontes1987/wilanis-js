/**
 * How one document's contract reads: a type as a reader sees it, one field of a shape or a settings block, and
 * one operation of a port with the inputs it accepts. `wilanis describe` prints these; where a type variable
 * comes from is among them, since a contract that resolves a type says so and no caller repeats it.
 */
import { type Loaded, type PortDoc, type Scope, show } from '@wilanis/core';

/** A spec as one reader sees it, or the spec itself when it does not resolve. */
export function shower(scope: Scope) {
  return (spec: unknown) => {
    try {
      return show(scope.types.spec(spec as string));
    } catch {
      return JSON.stringify(spec);
    }
  };
}

/** Where the variables one field binds come from: its own literal, or the path its `resolves` reads. */
function bindsOf(field: { binds?: string; resolves?: Record<string, string> }): string {
  const named = field.binds ? [`binds ${field.binds}`] : [];
  const resolved = Object.entries(field.resolves ?? {}).map(([variable, path]) => `binds ${variable} from ${path}`);
  const both = [...named, ...resolved];
  return both.length ? ` ${both.join(', ')}` : '';
}

/** One input one port's operation accepts: one type parameter is shown as `type`, and one static one says so. */
function acceptsLine(
  name: string,
  field: {
    type: unknown;
    required?: boolean;
    enum?: string[];
    binds?: string;
    static?: boolean;
    resolves?: Record<string, string>;
    description?: string;
  },
  showType: (spec: unknown) => string,
): string {
  const optional = field.required === false ? '?' : '';
  const type = field.type === 'type' ? 'type' : showType(field.type);
  const isStatic = field.static || field.type === 'type' ? '  (static)' : '';
  const allowed = field.enum ? ` ∈ ${field.enum.join('|')}` : '';
  const says = field.description ? `  -- ${field.description}` : '';
  return `    in  ${name}${optional}: ${type}${isStatic}${bindsOf(field)}${allowed}${says}`;
}

/** What an operation says about itself: whether it is pure, may refuse, or holds something until stopped. */
function operationLine(name: string, op: { pure?: boolean; refuses?: unknown; holds?: boolean; description?: string }) {
  const pure = op.pure ? '  (pure)' : '';
  const refuses = op.refuses ? '  (refuses on purpose)' : '';
  const holds = op.holds ? '  (holds until stopped)' : '';
  return `#${name}${pure}${refuses}${holds}: ${op.description}`;
}

/** A port: every operation, what it accepts and what it answers. */
export function portLines(doc: Loaded, showType: (spec: unknown) => string): string[] {
  const lines: string[] = [];
  for (const [name, op] of Object.entries((doc.doc as PortDoc).operations)) {
    lines.push(operationLine(name, op));
    for (const [field, accepts] of Object.entries(op.accepts ?? {})) lines.push(acceptsLine(field, accepts, showType));
    if (op.returns) lines.push(`    returns ${showType(op.returns)}`);
  }
  return lines;
}

/** What one field says about itself: optional, its type, the values it allows, what it binds, and its description. */
export function fieldLine(
  name: string,
  field: { type: unknown; required?: boolean; enum?: string[]; binds?: string; description?: string },
  showType: (spec: unknown) => string,
): string {
  const optional = field.required === false ? '?' : '';
  const type = typeof field.type === 'string' ? field.type : showType(field.type);
  const allowed = field.enum ? ` ∈ ${field.enum.join('|')}` : '';
  const binds = field.binds ? ` binds ${field.binds}` : '';
  const says = field.description ? `  -- ${field.description}` : '';
  return `    ${name}${optional}: ${type}${allowed}${binds}${says}`;
}
