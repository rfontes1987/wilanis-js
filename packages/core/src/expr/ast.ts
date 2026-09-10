/**
 * The one expression grammar, used by switch rules. Deliberately small and statically typed against the
 * node's inputs: has(path), comparisons, membership, && || !, len(x), literals, paths.
 *
 *   expr := or ; or := and ('||' and)* ; and := unary ('&&' unary)* ; unary := '!' unary | cmp
 *   cmp  := primary (('=='|'!='|'<'|'<='|'>'|'>='|'in') primary)?
 *   primary := number | string | true | false | path | has '(' path ')' | len '(' expr ')' | '(' expr ')'
 *
 * `x in list` is true when the list holds x: `'admin' in principal.roles`.
 */

export type Comparison = '==' | '!=' | '<' | '<=' | '>' | '>=';
export type BinaryOp = '&&' | '||' | 'in' | Comparison;

export type Expr =
  | { kind: 'lit'; value: string | number | boolean }
  | { kind: 'path'; path: string[] }
  | { kind: 'has'; path: string[] }
  | { kind: 'len'; arg: Expr }
  | { kind: 'not'; arg: Expr }
  | { kind: 'bin'; op: BinaryOp; left: Expr; right: Expr };

export const COMPARISONS: readonly Comparison[] = ['==', '!=', '<=', '>=', '<', '>'];
export const ORDERINGS: readonly Comparison[] = ['<', '<=', '>', '>='];

/** What an expression that cannot be lexed, parsed or typed throws; a rule turns it into a refusal. */
export class ExprError extends Error {}
