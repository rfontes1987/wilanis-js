/**
 * @wilanis/plugin-reload, the @reload plugin: watch the tree and serve it again when it changes.
 *
 * The plugin decides only *when* to reload. Loading the tree and judging it belong to the runtime, and reach
 * this handler as `serving.reload()` -- a plugin never imports the compiler or the runtime.
 */
import { watch, type FSWatcher } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Hold, PluginModule, Serving } from '@wilanis/core';
import type { Handler } from '@wilanis/engine';

const ROOT = '@reload';
const DOCS = fileURLToPath(new URL('../docs', import.meta.url));
const P = (name: string) => `${ROOT}/${name}`;
const DEFAULT_DEBOUNCE = 120;

/** Directories whose churn is never a document change: what a reload would read is under neither. */
const IGNORED = /(^|[\\/])(node_modules|dist|\.git)([\\/]|$)/;

/**
 * Watch the tree and serve it again when a document changes. Answers once the watcher is up; the watching
 * itself outlives the run, so the runtime holds it and closes it when the process stops.
 */
const watchTree: Handler = async ({ in: input, ctx }) => {
  const env = ctx.env as { serving?: Serving; hold?: Hold; plugins?: Record<string, Record<string, unknown>> };
  const serving = env.serving;
  if (!serving || !env.hold) throw new Error(`'${P('watch.port.json')}#watch' watches the tree while it is served, so it runs from a project's startup list -- not from a graph`);
  const settings = env.plugins?.[ROOT] ?? {};
  const wait = Number(input.debounceMs ?? settings.debounceMs ?? DEFAULT_DEBOUNCE);
  const { root, log } = serving;

  let timer: NodeJS.Timeout | undefined;
  let running = false;
  let again = false;

  const reload = async () => {
    if (running) { again = true; return; } // an edit during a reload is answered by the next one
    running = true;
    try {
      const r = await serving.reload();
      if (r.ok) log(`reload: ${r.documents} documents, serving the new tree`);
      else log(`reload refused, still serving the last good tree:\n${r.refusals}`);
    } catch (e) {
      log(`reload failed, still serving the last good tree: ${(e as Error).message}`);
    } finally {
      running = false;
      if (again) { again = false; void reload(); }
    }
  };

  const watcher: FSWatcher = watch(root, { recursive: true }, (_event, name) => {
    if (name && (IGNORED.test(name) || !name.endsWith('.json'))) return; // only documents matter
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; void reload(); }, wait);
  });

  log(`reload: watching ${root} -- an edit is served once it passes wilanis check`);
  env.hold({
    label: `reload ${root}`,
    stop: async () => { if (timer) clearTimeout(timer); watcher.close(); },
  });
  return { watching: root };
};

const reload: PluginModule = {
  root: ROOT,
  docs: DOCS,
  handlers: { [`${P('watch.port.json')}#watch`]: watchTree },
};

export default reload;
