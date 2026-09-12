#!/usr/bin/env node
import { spawn } from 'node:child_process';
/** wilanis-view [root] [--port n] [--host h] [--open] [--static dir]: serve the viewer for a tree, or write it. */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { serveView } from './serve.js';
import { writeSite } from './static.js';

const USAGE = `wilanis-view [root] [--port 4400] [--host 127.0.0.1] [--open] [--static <dir>]

Serves every document of the tree as a page: graphs as a canvas of nodes, ports and edges; every reference
one click away; the browser's back button walks back. Open http://127.0.0.1:4400/#@features/... to land on
a document.

--static <dir> writes the same page and every answer behind it into <dir> and exits, for a tree published
from a host that runs nothing. Paths are written relative to the tree's parent, so the site names no disk.`;

/** What a flag is worth: what follows its `=`, else the next word when that is not a flag, else just being there. */
function flagValue(argv: string[], at: number, written: string | undefined): { value: string; next: number } {
  if (written !== undefined) return { value: written, next: at };
  const following = argv[at + 1];
  if (following !== undefined && !following.startsWith('-')) return { value: following, next: at + 1 };
  return { value: 'true', next: at };
}

function parse(argv: string[]) {
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  for (let at = 0; at < argv.length; at++) {
    const word = argv[at];
    if (!word.startsWith('--')) {
      positional.push(word);
      continue;
    }
    const [name, written] = word.slice(2).split(/=(.*)/s);
    const { value, next } = flagValue(argv, at, written);
    flags[name] = value;
    at = next;
  }
  return { flags, positional };
}

/** The command this platform opens a URL with. */
function opener(): string {
  if (process.platform === 'darwin') return 'open';
  if (process.platform === 'win32') return 'start';
  return 'xdg-open';
}

async function main() {
  const { flags, positional } = parse(process.argv.slice(2));
  if (flags.help) {
    console.log(USAGE);
    return;
  }
  const root = resolve(positional[0] ?? '.');
  if (!existsSync(join(root, 'project.json'))) {
    console.error(`no project.json in ${root}`);
    process.exit(2);
  }
  if (flags.static !== undefined) {
    if (flags.static === 'true') {
      console.error('--static needs a directory to write into: --static site/example');
      process.exit(2);
    }
    const written = await writeSite(root, flags.static);
    console.log(`wrote ${written.length} files to ${flags.static}`);
    return;
  }
  const { url } = await serveView(root, {
    port: flags.port ? Number(flags.port) : undefined,
    host: flags.host,
    log: line => console.log(line),
  });
  if (flags.open) {
    const cmd = opener();
    spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
  }
}

main().catch(error => {
  console.error((error as Error).message);
  process.exit(1);
});
