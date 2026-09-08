#!/usr/bin/env node
/** wilanis-view [root] [--port n] [--host h] [--open]: serve the viewer for a tree. */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { serveView } from './serve.js';

const USAGE = `wilanis-view [root] [--port 4400] [--host 127.0.0.1] [--open]

Serves every document of the tree as a page: graphs as a canvas of nodes, ports and edges; every reference
one click away; the browser's back button walks back. Open http://127.0.0.1:4400/#@features/... to land on
a document.`;

function parse(argv: string[]) {
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split(/=(.*)/s);
      if (v !== undefined) flags[k] = v;
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('-')) flags[k] = argv[++i];
      else flags[k] = 'true';
    } else positional.push(a);
  }
  return { flags, positional };
}

async function main() {
  const { flags, positional } = parse(process.argv.slice(2));
  if (flags.help) { console.log(USAGE); return; }
  const root = resolve(positional[0] ?? '.');
  if (!existsSync(join(root, 'project.json'))) { console.error(`no project.json in ${root}`); process.exit(2); }
  const { url } = await serveView(root, { port: flags.port ? Number(flags.port) : undefined, host: flags.host, log: s => console.log(s) });
  if (flags.open) {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
  }
}

main().catch(e => { console.error((e as Error).message); process.exit(1); });
