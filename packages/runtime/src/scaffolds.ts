/**
 * `wilanis new` and `wilanis init`: the documents a tree starts from. Where each kind lives is placement's business
 * (HOME in core), so this module only says what one looks like when it is first written.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type AnyDoc, type Kind, schemaUrl } from '@wilanis/core';

// ---- scaffolds -------------------------------------------------------------------------------------

/**
 * Where a scaffolded document goes: inside a feature, in the layer its kind lives in. `target` may already
 * name a path (features/x/domain/y); a bare name is placed under the layer of the feature it belongs to.
 */
function into(target: string, layer: 'edge' | 'domain' | 'data', kind: string): string {
  const suffix = `.${kind}.json`;
  if (target.includes('/')) {
    const parts = target.split('/');
    // features/<name>/<rest> -- insert the layer when the author did not
    if (parts[0] === 'features' && parts.length > 2 && !['edge', 'domain', 'data'].includes(parts[2])) {
      return [...parts.slice(0, 2), layer, ...parts.slice(2)].join('/') + suffix;
    }
    return target + suffix;
  }
  return `${layer}/${target}${suffix}`;
}

/** What `wilanis new <kind>` writes: one builder per kind, each answering the files it creates. */
/** The published URL of a kind's schema. */
const schemaOf = (kind: Kind) => schemaUrl(kind);

const SCAFFOLDS: Record<string, (target: string, opts: Record<string, string | undefined>) => [string, unknown][]> = {
  project: (target, _opts) => {
    return [
      [
        'package.json',
        {
          name: target,
          private: true,
          type: 'module',
          scripts: { check: 'wilanis check .', rehearse: 'wilanis rehearse .', start: 'wilanis start .' },
          dependencies: { '@wilanis/plugin-http': '^0.1.0', '@wilanis/runtime': '^0.1.0' },
        },
      ],
      [
        'project.json',
        {
          $schema: schemaOf('project'),
          name: target,
          description: 'TODO',
          aliases: {},
          plugins: [
            { use: '@std' },
            { use: '@cli' },
            {
              use: '@http',
              from: '@wilanis/plugin-http',
              settings: { port: 8080, codecs: { 'application/json': '@http/codecs/json.codec.json' } },
            },
          ],
          secrets: {},
        },
      ],
    ];
  },
  feature: (target, _opts) => {
    return [
      [
        `features/${target}/feature.json`,
        { $schema: schemaOf('feature'), description: 'TODO', exports: [], effects: [] },
      ],
    ];
  },
  shape: (target, opts) => {
    // a shape is the world's (edge) or ours (domain); `layer: core` is the domain's word for it. The directory
    // is where a shape's layer is read from, so a path that names the layer decides it, and --layer the rest.
    const placed = into(target, opts.layer === 'edge' ? 'edge' : 'domain', 'shape');
    const layer = placed.split('/')[2] === 'edge' ? 'edge' : 'core';
    return [[placed, { $schema: schemaOf('shape'), layer, description: 'TODO', fields: {} }]];
  },
  port: (target, _opts) => {
    return [
      [
        into(target, 'domain', 'port'),
        {
          $schema: schemaOf('port'),
          description: 'TODO',
          operations: { example: { description: 'TODO', accepts: {}, returns: 'string' } },
        },
      ],
    ];
  },
  graph: (target, opts) => {
    return [
      [
        into(target, opts.layer === 'data' ? 'data' : 'domain', 'graph'),
        {
          $schema: schemaOf('graph'),
          description: 'TODO',
          nodes: [
            {
              type: '@wilanis/node/run.schema.json',
              id: 'first',
              run: '@std/text.port.json#fill',
              in: { values: {}, template: 'hello' },
            },
          ],
          out: { type: 'string', from: 'first' },
        },
      ],
    ];
  },
  binding: (target, opts) => {
    // meets the `example` operation a scaffolded port declares, by delegation; a real port's operations are B001s that name themselves
    return [
      [
        into(target, 'data', 'binding'),
        {
          $schema: schemaOf('binding'),
          description: 'TODO',
          port: opts.port ?? '@features/TODO/domain/TODO.port.json',
          operations: {
            example: { description: 'TODO', run: '@std/text.port.json#fill', in: { values: {}, template: 'TODO' } },
          },
        },
      ],
    ];
  },
  resolvers: (target, _opts) => {
    return [
      [
        into(target, 'edge', 'resolvers'),
        {
          $schema: schemaOf('resolvers'),
          description: 'TODO',
          resolvers: { caller: { read: "request.headers['user-agent']", description: 'TODO' } },
        },
      ],
    ];
  },
  trigger: (target, opts) => {
    return [
      [
        into(target, 'edge', 'trigger'),
        {
          $schema: schemaOf('trigger'),
          description: 'TODO',
          kind: opts.kind ?? '@http/http.trigger-kind.json',
          settings: { route: '/todo', method: 'GET', produces: 'application/json' },
          fire: { run: opts.run ?? '@features/TODO/domain/TODO.port.json#todo' },
        },
      ],
    ];
  },
  policy: (target, opts) => {
    // a gate: decides through a domain operation over what the guard hands, and says what each reason means
    return [
      [
        into(target, 'edge', 'policy'),
        {
          $schema: schemaOf('policy'),
          description: 'TODO',
          decide: {
            run: opts.run ?? '@features/TODO/domain/TODO.port.json#todo',
            in: { principal: '{{request.principal}}' },
          },
          outcomes: { anonymous: { effect: 'deny' } },
        },
      ],
    ];
  },
};

/** The documents `wilanis new <kind> <target>` writes, in the places placement says they live. */
export function scaffold(
  root: string,
  kind: string,
  target: string,
  opts: Record<string, string | undefined>,
): string[] {
  const build = SCAFFOLDS[kind];
  if (!build)
    throw new Error(
      `unknown kind '${kind}'; one of project, feature, shape, port, graph, binding, trigger, policy, resolvers`,
    );
  const files = build(target, opts);
  const written: string[] = [];
  for (const [rel, doc] of files) {
    const abs = join(root, rel);
    if (existsSync(abs)) throw new Error(`${rel} exists`);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, `${JSON.stringify(doc as AnyDoc, null, 2)}\n`);
    written.push(rel);
  }
  return written;
}

/**
 * wilanis init: write the agent's CLAUDE.md and hooks into a tree from the runtime's templates. A file that
 * exists is kept, never overwritten. Answers one line per file: `wrote <path>` or `kept <path>`.
 */
export function init(
  root: string,
  templates = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates'),
): string[] {
  const out: string[] = [];
  const put = (from: string, to: string) => {
    if (existsSync(to)) {
      out.push(`kept ${to}`);
      return;
    }
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, readFileSync(from));
    out.push(`wrote ${to}`);
  };
  for (const name of readdirSync(templates)) {
    const from = join(templates, name);
    const to = join(root, name.replace(/^dot-/, '.'));
    if (name === 'dot-claude') {
      for (const name of readdirSync(from)) put(join(from, name), join(to, name));
      continue;
    }
    put(from, to);
  }
  return out;
}
