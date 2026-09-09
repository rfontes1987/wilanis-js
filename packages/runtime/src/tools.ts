/**
 * The gates and the discovery commands. All of them work from a loaded, checked tree; each lives in the module for
 * what it does, and this file is the one name the CLI and the package's index reach for.
 */
export { describe, ls, map } from './discovery.js';
export { fuzz, regress } from './fuzz.js';
export { type Rehearsal, rehearse } from './rehearse.js';
export { init, scaffold } from './scaffolds.js';
export {
  embedderFor,
  failedBelow,
  failedLeaf,
  generatedFire,
  policyRoots,
  stubEffects,
  summarize,
} from './stubbing.js';
