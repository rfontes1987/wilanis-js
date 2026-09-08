/**
 * The viewer's HTTP server: the page at /, the document list at /api/index, one document's view at
 * /api/doc?path=..., one schema at /api/schema?path=... (read from the installed @wilanis/core, so a node's
 * type and a document's $schema open the schema that judges it), and /api/version so the page can notice
 * the tree changed and refetch. The tree is
 * loaded on every request: a save in the editor shows on the next paint, and the server holds no state
 * that could go stale.
 */
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PluginModule } from '@wilanis/core';
import { loadProject } from '@wilanis/runtime';
import { indexOf, schemaRelOf, schemaViewOf, viewOf } from './model.js';

export interface ServeViewOptions {
  port?: number;
  host?: string;
  /** Plugins beyond the builtins and the packages project.json names (tests). */
  plugins?: Record<string, PluginModule>;
  log?: (s: string) => void;
}

export interface ViewServer { url: string; server: Server; close(): Promise<void> }

const PAGE = fileURLToPath(new URL('../client/index.html', import.meta.url));

/** The file of a schema in the installed @wilanis/core, or undefined when rel names none. */
function schemaFile(rel: string): string | undefined {
  if (schemaRelOf(`@wilanis/${rel}`) === undefined) return undefined;
  try {
    const file = fileURLToPath(import.meta.resolve(`@wilanis/core/schemas/${rel}`));
    return existsSync(file) ? file : undefined;
  } catch { return undefined; }
}

/** A fingerprint of every JSON file under root: paths and modification times. Changes when the tree does. */
export function versionOf(root: string): string {
  let h = 2166136261;
  const mix = (s: string) => { for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } };
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith('.') || name === 'node_modules') continue;
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (name.endsWith('.json')) { mix(p); mix(String(st.mtimeMs)); }
    }
  };
  walk(root);
  return (h >>> 0).toString(16);
}

/** Serve the viewer for the tree at root. Answers the URL and a way to stop. */
export async function serveView(root: string, opts: ServeViewOptions = {}): Promise<ViewServer> {
  const log = opts.log ?? (() => {});
  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(readFileSync(PAGE));
      } else if (url.pathname === '/api/version') {
        json(res, 200, { version: versionOf(root) });
      } else if (url.pathname === '/api/index') {
        const load = await loadProject(root, { plugins: opts.plugins });
        json(res, 200, { ...indexOf(load), version: versionOf(root) });
      } else if (url.pathname === '/api/doc') {
        const path = url.searchParams.get('path');
        if (!path) return json(res, 400, { error: 'path is required' });
        const load = await loadProject(root, { plugins: opts.plugins });
        const view = viewOf(load, path);
        if (!view) return json(res, 404, { error: `no document at '${path}'`, refusals: load.refusals.items });
        json(res, 200, view);
      } else if (url.pathname === '/api/schema') {
        const rel = url.searchParams.get('path');
        if (!rel) return json(res, 400, { error: 'path is required' });
        const file = schemaFile(rel);
        if (!file) return json(res, 404, { error: `no schema at '${rel}'` });
        json(res, 200, schemaViewOf(rel, JSON.parse(readFileSync(file, 'utf8')), file));
      } else json(res, 404, { error: 'not found' });
    } catch (e) {
      log(`error: ${(e as Error).stack ?? e}`);
      json(res, 500, { error: (e as Error).message });
    }
  };
  const server = createServer((req, res) => { void handle(req, res); });
  const host = opts.host ?? '127.0.0.1';
  await new Promise<void>((ok, fail) => { server.once('error', fail); server.listen(opts.port ?? 4400, host, () => ok()); });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : opts.port;
  const url = `http://${host}:${port}/`;
  log(`viewing ${root} at ${url}`);
  return { url, server, close: () => new Promise<void>((ok, fail) => server.close(e => (e ? fail(e) : ok()))) };
}
