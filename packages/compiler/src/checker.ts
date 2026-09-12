/**
 * wilanis check. Judges the whole tree statically so that nothing refuses at load. Rule families, each in
 * its module under check/:
 *   D documents (the loader)   R references   L layers/effects/visibility   G graphs (graph.ts, inputs.ts)
 *   P static fields/resolvers (resolvers.ts)   B bindings/profiles (bindings.ts, project.ts)
 *   T triggers (triggers.ts)   A access (access.ts)   C connections, settings and stores (project.ts, contracts.ts)
 *   S scenarios (triggers.ts)   X plugin-specific (each plugin's own `check`)
 */
import { type LoadResult, type PluginModule, RefusalList, Scope } from '@wilanis/core';
import { checkPolicy } from './check/access.js';
import { checkBinding } from './check/bindings.js';
import { checkConnection, checkPort, checkShape, checkStore } from './check/contracts.js';
import { checkGraph } from './check/graph.js';
import { Judge } from './check/judge.js';
import { checkProject, checkStartup } from './check/project.js';
import { checkResolversDoc } from './check/resolvers.js';
import { checkScenario, checkTrigger } from './check/triggers.js';

/** Every refusal of a loaded tree: the loader's, then every rule family's, then each plugin's own. */
export function checkTree(load: LoadResult): RefusalList {
  const out = new RefusalList();
  for (const refusal of load.refusals.items) out.add(refusal);
  const project = load.registry.project;
  if (!project) return out;
  const scope = new Scope(load.registry, load.resolve);
  judgeTree(new Judge(scope, project, out));
  for (const plugin of load.plugins) checkPlugin(plugin, scope, out);
  return out;
}

/** The order of judgement: documents before what names them, and startup last, once every resolvers document is read. */
function judgeTree(judge: Judge): void {
  const { registry } = judge.scope;
  checkProject(judge);
  for (const shape of registry.all('shape')) checkShape(judge, shape);
  for (const port of registry.all('port')) checkPort(judge, port);
  for (const connection of registry.all('connection')) checkConnection(judge, connection);
  for (const store of registry.all('store')) checkStore(judge, store);
  for (const resolvers of registry.all('resolvers')) checkResolversDoc(judge, resolvers);
  for (const graph of registry.all('graph')) checkGraph(judge, graph, judge.scope.roleOf(graph.path));
  for (const binding of registry.all('binding')) checkBinding(judge, binding);
  for (const policy of registry.all('policy')) checkPolicy(judge, policy);
  for (const trigger of registry.all('trigger')) checkTrigger(judge, trigger);
  for (const scenario of registry.all('scenario')) checkScenario(judge, scenario);
  checkStartup(judge);
}

/** X rules: what only the plugin can judge, given its settings and a way to refuse. */
function checkPlugin(plugin: PluginModule, scope: Scope, out: RefusalList): void {
  const settings = scope.project?.plugins.find(use => use.use === plugin.root)?.settings ?? {};
  plugin.check?.({ scope, settings, refuse: refusal => out.add(refusal) });
}
