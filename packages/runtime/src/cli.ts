#!/usr/bin/env node
/** The wilanis command line. */
import { createWriteStream, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { checkTree } from '@wilanis/compiler';
import type { BlobHandle } from '@wilanis/core';
import { KINDS, type Kind, type LoadResult } from '@wilanis/core';
import { loadProject } from './project.js';
import { runTrigger, start } from './serve.js';
import { describe, fuzz, init, ls, map, regress, rehearse, scaffold, summarize } from './tools.js';

const USAGE = `wilanis -- declarative dataflow, judged by a compiler, run by a stateless engine

  wilanis check    [root] [--profile word]            judge the whole tree; exit 1 with every refusal
  wilanis rehearse [root] [--seed n] [-v]          run every trigger, and every branch of every switch
  wilanis fuzz     [root] [--runs n]               write one scenario per trigger per seed to scenarios/
  wilanis regress  [root]                          replay every scenario and diff node by node
  wilanis start    [root] [--profile word]            run postLoad and the project's startup steps; what
                   listens is what those steps say
  wilanis run      <trigger> [root] [--in json] [--file path] [--out path] [--flag=v ...]
                   fire one cli trigger; --file hands a file as request.file, --out receives a blob answer
  wilanis ls       [root] [kind]                   every document, or those of one kind
  wilanis describe <path> [root]                   a document, with its contract laid out
  wilanis map      [root]                          trigger → graph → port → binding → graph
  wilanis new      <kind> <name|path> [root] [--layer edge|data] [--port word] [--run word#op] [--kind k]
                   [--of shape]
                   kinds: project feature shape port graph binding store trigger policy resolvers
  wilanis init     [root]                          write CLAUDE.md and agent hooks into a tree

Every path is @-rooted (@features/tasks/tasks.port.json) or through a project alias.
Plugins beyond @std and @cli are npm packages named by "from" in project.json.`;

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
    if (word === '-v') {
      flags.verbose = 'true';
      continue;
    }
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

async function load(root: string): Promise<LoadResult> {
  const abs = resolve(root);
  if (!existsSync(join(abs, 'project.json'))) {
    console.error(`no project.json in ${abs}`);
    process.exit(2);
  }
  return loadProject(abs);
}

async function check(root: string): Promise<LoadResult> {
  const loaded = await load(root);
  const answer = checkTree(loaded);
  if (!answer.ok) {
    console.error(answer.format());
    console.error(`\n${answer.items.length} refusal(s)`);
    process.exit(1);
  }
  return loaded;
}

/** What the command line gave: the flags, the words, and the root each command reads from. */
interface Given {
  flags: Record<string, string>;
  positional: string[];
  rootArg: (at: number) => string;
  /** The words after the command, for a command that reads its own flags from them. */
  rest: string[];
}

/** What each command does. Every one works from a loaded, checked tree; `wilanis <cmd> --help` prints USAGE. */
const COMMANDS: Record<string, (given: Given) => Promise<void> | void> = {
  check: async ({ rootArg }) => {
    const loaded = await check(rootArg(0));
    console.log(`ok: ${loaded.registry.files.length} documents`);
  },
  rehearse: async ({ flags, rootArg }) => {
    const loaded = await check(rootArg(0));
    const answer = await rehearse(loaded, {
      seed: flags.seed ? Number(flags.seed) : undefined,
      profile: flags.profile,
      verbose: Boolean(flags.verbose),
    });
    console.log(answer.lines.join('\n'));
    if (!answer.ok) process.exit(1);
  },
  fuzz: async ({ flags, rootArg }) => {
    const loaded = await check(rootArg(0));
    const written = await fuzz(loaded, { runs: flags.runs ? Number(flags.runs) : undefined, profile: flags.profile });
    console.log(written.map(file => `wrote ${file}`).join('\n'));
  },
  regress: async ({ flags, rootArg }) => {
    const loaded = await check(rootArg(0));
    const answer = await regress(loaded, { profile: flags.profile });
    console.log(answer.lines.join('\n') || 'no scenarios -- run wilanis fuzz first');
    if (!answer.ok) process.exit(1);
  },
  start: async ({ flags, rootArg }) => {
    const loaded = await check(rootArg(0));
    const { stop, held } = await start(loaded, { profile: flags.profile });
    if (!held) {
      console.log('nothing is held: project.json declares no startup step that listens, so there is nothing to serve');
      await stop();
    }
    const bye = async () => {
      await stop();
      process.exit(0);
    };
    process.on('SIGINT', bye);
    process.on('SIGTERM', bye);
  },
  run: async ({ flags, positional, rootArg, rest }) => {
    const loaded = await check(rootArg(1));
    const { flags: f2 } = parse(rest.slice(1));
    let delivered = false;
    const deliver = async (body: Readable, handle: BlobHandle) => {
      delivered = true;
      if (f2.out) {
        await pipeline(body, createWriteStream(f2.out));
        console.error(`wrote ${f2.out} (${handle.contentType}, ${handle.size} bytes)`);
      } else await pipeline(body, process.stdout, { end: false });
    };
    const { report, answer } = await runTrigger(
      loaded,
      positional[0],
      { flags: f2, args: positional.slice(2) },
      {
        profile: flags.profile,
        seed: flags.seed ? Number(flags.seed) : undefined,
        deliver,
      },
    );
    if (flags.verbose) console.error(summarize(report));
    if (!delivered) console.log(typeof answer === 'string' ? answer : JSON.stringify(answer ?? report, null, 2));
    if (report.status !== 'done') process.exit(1);
  },
  ls: async ({ positional }) => {
    const kind = positional.find(word => (KINDS as string[]).includes(word)) as Kind | undefined;
    const root = positional.find(word => !(KINDS as string[]).includes(word)) ?? '.';
    console.log(ls(await load(root), kind).join('\n'));
  },
  describe: async ({ positional, rootArg }) => {
    console.log(describe(await load(rootArg(1)), positional[0]));
  },
  map: async ({ rootArg }) => {
    console.log(map(await load(rootArg(0))).join('\n'));
  },
  new: async ({ flags, positional, rootArg }) => {
    const [kind, target] = positional;
    if (!kind || !target) {
      console.error(USAGE);
      process.exit(2);
    }
    console.log(
      scaffold(resolve(rootArg(2)), kind, target, flags)
        .map(file => `wrote ${file}`)
        .join('\n'),
    );
  },
  init: async ({ rootArg }) => {
    console.log(init(resolve(rootArg(0))).join('\n'));
  },
};

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { flags, positional } = parse(rest);
  const run = COMMANDS[cmd ?? ''];
  if (!run) {
    console.log(USAGE);
    process.exit(cmd ? 2 : 0);
  }
  await run({ flags, positional, rest, rootArg: (at: number) => positional[at] ?? '.' });
}

main().catch(error => {
  console.error((error as Error).message);
  process.exit(1);
});
