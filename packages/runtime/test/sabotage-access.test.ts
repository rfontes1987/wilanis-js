import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkTree } from '@wilanis/compiler';
import { loadTree, schemaRef } from '@wilanis/core';
import { describe, expect, it } from 'vitest';
import { describe as describeDoc, rehearse } from '../src/index.js';
import { codes, EXAMPLE, INCLUDES, PLUGINS, sabotage } from './example-harness.js';

describe('sabotage: access, as the example attaches the included policies', () => {
  it('A004 a credential the guard does not verify, one read where the kind hands nothing, and one no policy of the trigger reads', () => {
    expect(
      sabotage('features/monitor/edge/record-entry.trigger.json', trigger => {
        trigger.policies[0].in = { badge: '{{request.headers.authorization}}' };
      }),
    ).toContain('A004');
    expect(
      sabotage('features/monitor/edge/record-entry.trigger.json', trigger => {
        trigger.policies[0].in = { token: '{{request.flags.token}}' };
      }),
    ).toContain('A004');
    expect(
      sabotage('features/monitor/edge/record-entry.trigger.json', trigger => {
        trigger.policies[0].in.challenge = { id: '{{request.query.cid}}', code: '{{request.query.code}}' };
      }),
    ).toEqual(['A004']);
  });
  it('A005 a policy reading the caller on a trigger that gives the guard nothing', () => {
    expect(
      sabotage('features/monitor/edge/record-entry.trigger.json', trigger => {
        trigger.policies = ['@access/edge/employees-only.policy.json', '@access/edge/can-record.policy.json'];
        delete trigger.settings.response.refusals.invalid_credential;
      }),
    ).toEqual(['A005', 'A005']);
  });
  it("T005 a policy's reason the trigger does not map; T006 a mapped reason no policy reaches once the policy is gone", () => {
    expect(
      sabotage('features/monitor/edge/record-entry.trigger.json', trigger => {
        delete trigger.settings.response.refusals.forbidden;
      }),
    ).toEqual(['T005']);
    expect(
      sabotage('features/monitor/edge/record-entry.trigger.json', trigger => {
        trigger.policies.pop();
      }),
    ).toEqual([]);
    expect(
      sabotage('features/monitor/edge/record-entry.trigger.json', trigger => {
        delete trigger.policies;
        delete trigger.settings.response.refusals.invalid_credential;
      }),
    ).toEqual(['T006', 'T006']);
  });
  it('R001 a trigger naming a policy that is not there', () => {
    expect(
      sabotage('features/hello/edge/hello-gated.trigger.json', trigger => {
        trigger.policies = ['@access/edge/nope.policy.json'];
      }),
    ).toContain('R001');
  });
  it('D009 a local feature the include also ships; D010 an include that is not a tree, or one asking a feature it does not ship or a plugin the project lacks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wilanis-'));
    cpSync(EXAMPLE, dir, { recursive: true, filter: path => !path.includes('node_modules') });
    mkdirSync(join(dir, 'features/access'), { recursive: true });
    writeFileSync(
      join(dir, 'features/access/feature.json'),
      JSON.stringify({ $schema: schemaRef('feature'), description: 'mine' }),
    );
    expect(codes(dir)).toContain('D009');
    rmSync(dir, { recursive: true, force: true });
    const lib = INCLUDES[0];
    expect(
      checkTree(loadTree(EXAMPLE, PLUGINS, [{ ...lib, dir: tmpdir() }])).items.map(refusal => refusal.code),
    ).toContain('D010');
    expect(
      checkTree(loadTree(EXAMPLE, PLUGINS, [{ ...lib, features: ['access', 'nope'] }])).items.map(
        refusal => refusal.code,
      ),
    ).toContain('D010');
    expect(
      sabotage('project.json', project => {
        project.plugins = project.plugins.filter((plugin: any) => plugin.use !== '@cli');
      }),
    ).toContain('D010');
  });
  it('an included document says where it came from, and the include brings its alias along', () => {
    const load = loadTree(EXAMPLE, PLUGINS, INCLUDES);
    const policy = load.registry.get('policy', load.resolve('@access/edge/signed-in.policy.json'));
    expect(policy?.included).toBe('@wilanis/access');
    expect(policy?.file).toContain('libraries/access/features/access/edge/signed-in.policy.json');
    expect(load.registry.get('trigger', '@features/monitor/edge/record-entry.trigger.json')?.included).toBeUndefined();
    expect(describeDoc(load, '@access/edge/signed-in.policy.json')).toContain('included from  @wilanis/access');
    // the dev feature and the connections of the library stay behind
    expect(load.registry.get('feature', '@features/access-dev/feature.json')).toBeUndefined();
    expect(
      load.registry
        .all('connection')
        .map(caller => caller.path)
        .sort(),
    ).toEqual([
      '@connections/customers.connection.json',
      '@connections/employees.connection.json',
      '@connections/monitor-api.connection.json',
    ]);
  });
  it('the `in` operator: a role check in a switch rule, and a branch the rehearsal can steer both ways', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wilanis-'));
    cpSync(EXAMPLE, dir, { recursive: true, filter: path => !path.includes('node_modules') });
    const run = await rehearse(loadTree(dir, PLUGINS, INCLUDES), { seed: 5 });
    rmSync(dir, { recursive: true, force: true });
    const lines = run.lines.filter(
      line => line.includes("'recorder' in principal.roles") || line.includes('require-recorder'),
    );
    expect(lines.some(line => line.includes("answered from 'granted'"))).toBe(true);
    expect(run.ok).toBe(true);
  });
});
