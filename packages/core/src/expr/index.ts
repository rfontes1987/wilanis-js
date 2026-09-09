/** The switch expression grammar: its AST, parser, type checker and evaluator. */
export * from './ast.js';
export { check, type Inputs } from './check.js';
export { compilePredicate, evaluate } from './evaluate.js';
export { parse } from './parse.js';
