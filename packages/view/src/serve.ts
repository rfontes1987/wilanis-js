/**
 * The viewer's HTTP server: the page at /, the document list at /api/index, one document's view at
 * /api/doc?path=..., one schema at /api/schema?path=... (read from the installed @wilanis/core, so a node's
 * type and a document's $schema open the schema that judges it), and /api/version so the page can notice
 * the tree changed and refetch. The tree is
 * loaded on every request: a save in the editor shows on the next paint, and the server holds no state
 * that could go stale.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
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
  log?: (line: string) => void;
}

export interface ViewServer {
  url: string;
  server: Server;
  close(): Promise<void>;
}

/** The page itself: one static file, served here and copied into a static site. */
export const PAGE = fileURLToPath(new URL('../client/index.html', import.meta.url));

/** The file of a schema in the installed @wilanis/core, or undefined when rel names none. */
function schemaFile(rel: string): string | undefined {
  if (schemaRelOf(`@wilanis/${rel}`) === undefined) return undefined;
  try {
    const file = fileURLToPath(import.meta.resolve(`@wilanis/core/schemas/${rel}`));
    return existsSync(file) ? file : undefined;
  } catch {
    return undefined;
  }
}

/** Every JSON file under a directory, deepest last, as a path and the time it changed. */
function stamps(dir: string, into: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.') || name === 'node_modules') continue;
    const path = join(dir, name);
    const found = statSync(path);
    if (found.isDirectory()) stamps(path, into);
    else if (name.endsWith('.json')) into.push(path, String(found.mtimeMs));
  }
  return into;
}

/** A fingerprint of every JSON file under root: paths and modification times. Changes when the tree does. */
export function versionOf(root: string): string {
  let hash = 2166136261;
  for (const stamp of stamps(root))
    for (const char of stamp) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
  return (hash >>> 0).toString(16);
}

/** Serve the viewer for the tree at root. Answers the URL and a way to stop. */
export async function serveView(root: string, opts: ServeViewOptions = {}): Promise<ViewServer> {
  const log = opts.log ?? (() => {});
  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  /** The page itself, which the browser asks for once. */
  const page = (res: ServerResponse) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(readFileSync(PAGE));
  };
  /** One document's view, or why there is none. */
  const document = async (res: ServerResponse, url: URL) => {
    const path = url.searchParams.get('path');
    if (!path) return json(res, 400, { error: 'path is required' });
    const load = await loadProject(root, { plugins: opts.plugins });
    const view = viewOf(load, path);
    if (!view) return json(res, 404, { error: `no document at '${path}'`, refusals: load.refusals.items });
    json(res, 200, view);
  };
  /** One schema, as the page shows it. */
  const schema = (res: ServerResponse, url: URL) => {
    const rel = url.searchParams.get('path');
    if (!rel) return json(res, 400, { error: 'path is required' });
    const file = schemaFile(rel);
    if (!file) return json(res, 404, { error: `no schema at '${rel}'` });
    json(res, 200, schemaViewOf(rel, JSON.parse(readFileSync(file, 'utf8')), file));
  };
  const routes: Record<string, (res: ServerResponse, url: URL) => void | Promise<void>> = {
    '/': res => page(res),
    '/api/version': res => json(res, 200, { version: versionOf(root) }),
    '/api/index': async res => {
      const load = await loadProject(root, { plugins: opts.plugins });
      json(res, 200, { ...indexOf(load), version: versionOf(root) });
    },
    '/api/doc': document,
    '/api/schema': schema,
  };
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      const route = routes[url.pathname];
      if (route) await route(res, url);
      else json(res, 404, { error: 'not found' });
    } catch (error) {
      log(`error: ${(error as Error).stack ?? error}`);
      json(res, 500, { error: (error as Error).message });
    }
  };
  const server = createServer((req, res) => {
    void handle(req, res);
  });
  const host = opts.host ?? '127.0.0.1';
  await new Promise<void>((ok, fail) => {
    server.once('error', fail);
    server.listen(opts.port ?? 4400, host, () => ok());
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : opts.port;
  const url = `http://${host}:${port}/`;
  log(`viewing ${root} at ${url}`);
  return {
    url,
    server,
    close: () => new Promise<void>((ok, fail) => server.close(error => (error ? fail(error) : ok()))),
  };
}
