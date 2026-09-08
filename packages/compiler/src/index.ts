/**
 * @wilanis/compiler: `checkTree` judges a loaded tree against every rule; `Compiler` lowers a judged graph
 * to a kernel spec whose handlers are plugin functions or nested specs; `buildEnv` and `runGraph` run it.
 */
export * from './checker.js';
export * from './compiler.js';
