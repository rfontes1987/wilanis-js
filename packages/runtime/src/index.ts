/**
 * @wilanis/runtime: everything that runs a tree. The embedder (fire a trigger: input mapping, compile,
 * run, prune), the gates (rehearse, fuzz, regress), discovery (ls, describe, map), scaffolds, project
 * loading with plugin packages, start, and the `wilanis` command line. Ships the @std and @cli plugins.
 */
export { Embedder, prune, fillTemplates, coerceWire, type FireOptions } from './embed.js';
export { rehearse, fuzz, regress, describe, ls, map, scaffold, init, stubEffects, embedderFor, generatedFire, failedLeaf, summarize, type Rehearsal } from './tools.js';
export { branchesOf, casesFor, switchesOf, satisfy, type Branch, type Case, type Demands, type Domain } from './branches.js';
export { start, runTrigger, postLoad, runStartup, Served, contentTypeOf } from './serve.js';
export { FileBlobStore } from './blobs.js';
export { loadProject, resolvePlugins, type PluginResolution } from './project.js';
export { BUILTIN_PLUGINS } from './plugins/index.js';
export { std } from './plugins/std.js';
export { cli as cliTriggers } from './plugins/cli-trigger.js';
