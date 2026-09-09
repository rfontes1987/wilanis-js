/** The environment handlers see, and one run of a compiled graph. */
import type { Scope } from '@wilanis/core';
import { splitPath, TEMPLATE } from '@wilanis/core';
import { Kernel, type Report, type RunOptions } from '@wilanis/engine';
import type { Compiled } from './compiler.js';

type Settings = Record<string, unknown>;

/** Secrets as the project declares them: a key names an environment variable; a missing one is noted and reads as empty. */
class Secrets {
  readonly missing = new Set<string>();

  constructor(
    private readonly declared: Record<string, string>,
    private readonly env: NodeJS.ProcessEnv,
  ) {}

  read(key: string): string {
    const varName = this.declared[key];
    const value = varName ? this.env[varName] : undefined;
    if (value !== undefined) return value;
    this.missing.add(`${key} (${varName ?? 'undeclared'})`);
    return '';
  }

  /** A copy of a value with every {{secrets.key}} replaced; any other template stays as written. */
  substitute(value: unknown): unknown {
    if (typeof value === 'string') return value.replace(TEMPLATE, (_, template: string) => this.replacement(template));
    if (Array.isArray(value)) return value.map(item => this.substitute(item));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value as Settings).map(([key, item]) => [key, this.substitute(item)]));
    }
    return value;
  }

  private replacement(template: string): string {
    const [root, key] = splitPath(template);
    return root === 'secrets' ? this.read(key) : `{{${template}}}`;
  }
}

/** The environment handlers see: connections with secrets substituted, plugin settings, a type resolver. */
export function buildEnv(scope: Scope, env: NodeJS.ProcessEnv = process.env): { env: Settings; missing: string[] } {
  const project = scope.project;
  const secrets = new Secrets(project?.secrets ?? {}, env);
  const connections: Record<string, { kind: string; settings: Settings }> = {};
  for (const connection of scope.registry.all('connection')) {
    const settings = secrets.substitute(connection.doc.settings) as Settings;
    connections[connection.path] = { kind: scope.canon(connection.doc.kind), settings };
  }
  const plugins: Record<string, Settings> = {};
  for (const use of project?.plugins ?? []) plugins[use.use] = secrets.substitute(use.settings ?? {}) as Settings;
  const resolveType = (ref: string) => scope.types.spec(ref);
  return { env: { connections, plugins, canon: scope.canon, resolveType }, missing: [...secrets.missing] };
}

/** Run a compiled graph once. */
export async function runGraph(compiled: Compiled, opts: RunOptions): Promise<Report> {
  return new Kernel(compiled.handlers).run(compiled.spec, opts);
}
