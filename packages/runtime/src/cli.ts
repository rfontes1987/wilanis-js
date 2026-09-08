#!/usr/bin/env node
/** The wilanis command line. */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KINDS, type Kind, type LoadResult } from '@wilanis/core';
import { checkTree } from '@wilanis/compiler';
import { loadProject } from './project.js';
import { runTrigger, serve } from './serve.js';
import { describe, fuzz, ls, map, regress, rehearse, scaffold, summarize } from './tools.js';

const USAGE = `wilanis -- declarative dataflow, judged by a compiler, run by a stateless engine

  wilanis check    [root] [--profile p]            judge the whole tree; exit 1 with every refusal
  wilanis rehearse [root] [--seed n] [-v]          run every trigger, and every branch of every switch
  wilanis fuzz     [root] [--runs n]               write one scenario per trigger per seed to scenarios/
  wilanis regress  [root]                          replay every scenario and diff node by node
  wilanis serve    [root] [--profile p]            run every plugin's postLoad, start every trigger kind
  wilanis run      <trigger> [root] [--in json] [--flag=v ...]   fire one cli trigger
  wilanis ls       [root] [kind]                   every document, or those of one kind
  wilanis describe <path> [root]                   a document, with its contract laid out
  wilanis map      [root]                          trigger → graph → port → binding → graph
  wilanis new      <kind> <name|path> [root] [--layer edge|data] [--port p] [--run p#op] [--kind k]
                   kinds: project feature shape port graph binding trigger resolvers
  wilanis init     [root]                          write CLAUDE.md and agent hooks into a tree

Every path is @-rooted (@features/tasks/tasks.port.json) or through a project alias.
Plugins beyond @std and @cli are npm packages named by "from" in project.json.`;

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
    } else if (a === '-v') flags.verbose = 'true';
    else positional.push(a);
  }
  return { flags, positional };
}

async function load(root: string): Promise<LoadResult> {
  const abs = resolve(root);
  if (!existsSync(join(abs, 'project.json'))) { console.error(`no project.json in ${abs}`); process.exit(2); }
  return loadProject(abs);
}

async function check(root: string): Promise<LoadResult> {
  const l = await load(root);
  const r = checkTree(l);
  if (!r.ok) { console.error(r.format()); console.error(`\n${r.items.length} refusal(s)`); process.exit(1); }
  return l;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { flags, positional } = parse(rest);
  const rootArg = (n: number) => positional[n] ?? '.';
  switch (cmd) {
    case 'check': { const l = await check(rootArg(0)); console.log(`ok: ${l.registry.files.length} documents`); break; }
    case 'rehearse': {
      const l = await check(rootArg(0));
      const r = await rehearse(l, { seed: flags.seed ? Number(flags.seed) : undefined, profile: flags.profile, verbose: Boolean(flags.verbose) });
      console.log(r.lines.join('\n'));
      if (!r.ok) process.exit(1);
      break;
    }
    case 'fuzz': { const l = await check(rootArg(0)); const w = await fuzz(l, { runs: flags.runs ? Number(flags.runs) : undefined, profile: flags.profile }); console.log(w.map(f => `wrote ${f}`).join('\n')); break; }
    case 'regress': { const l = await check(rootArg(0)); const r = await regress(l, { profile: flags.profile }); console.log(r.lines.join('\n') || 'no scenarios -- run wilanis fuzz first'); if (!r.ok) process.exit(1); break; }
    case 'serve': {
      const l = await check(rootArg(0));
      const stop = await serve(l, { profile: flags.profile });
      const bye = async () => { await stop(); process.exit(0); };
      process.on('SIGINT', bye); process.on('SIGTERM', bye);
      break;
    }
    case 'run': {
      const l = await check(rootArg(1));
      const { flags: f2 } = parse(rest.slice(1));
      const { report, answer } = await runTrigger(l, positional[0], f2, positional.slice(2), { profile: flags.profile, seed: flags.seed ? Number(flags.seed) : undefined });
      if (flags.verbose) console.error(summarize(report));
      console.log(typeof answer === 'string' ? answer : JSON.stringify(answer ?? report, null, 2));
      if (report.status !== 'done') process.exit(1);
      break;
    }
    case 'ls': {
      const kind = positional.find(p => (KINDS as string[]).includes(p)) as Kind | undefined;
      const root = positional.find(p => !(KINDS as string[]).includes(p)) ?? '.';
      console.log(ls(await load(root), kind).join('\n'));
      break;
    }
    case 'describe': console.log(describe(await load(rootArg(1)), positional[0])); break;
    case 'map': console.log(map(await load(rootArg(0))).join('\n')); break;
    case 'new': {
      const [kind, target] = positional;
      if (!kind || !target) { console.error(USAGE); process.exit(2); }
      console.log(scaffold(resolve(rootArg(2)), kind, target, flags).map(f => `wrote ${f}`).join('\n'));
      break;
    }
    case 'init': {
      const root = resolve(rootArg(0));
      const tpl = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');
      for (const f of readdirSync(tpl)) {
        const from = join(tpl, f), to = join(root, f.replace(/^dot-/, '.'));
        mkdirSync(dirname(to), { recursive: true });
        if (existsSync(to)) { console.log(`kept ${to}`); continue; }
        if (f === 'dot-claude') { mkdirSync(to, { recursive: true }); for (const g of readdirSync(from)) { writeFileSync(join(to, g), readFileSync(join(from, g))); console.log(`wrote ${join(to, g)}`); } continue; }
        writeFileSync(to, readFileSync(from)); console.log(`wrote ${to}`);
      }
      break;
    }
    default: console.log(USAGE); process.exit(cmd ? 2 : 0);
  }
}

main().catch(e => { console.error((e as Error).message); process.exit(1); });
