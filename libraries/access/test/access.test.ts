import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkTree } from '@wilanis/compiler';
import { loadTree, type PluginModule } from '@wilanis/core';
import auth from '@wilanis/plugin-auth';
import http from '@wilanis/plugin-http';
import { BUILTIN_PLUGINS, rehearse } from '@wilanis/runtime';
import { describe, expect, it } from 'vitest';

/**
 * The access tree on its own: it checks and rehearses with its development binding, and the rules that judge policies
 * and credentials refuse each way of getting them wrong. A host includes `features/access` and binds identity.port.json
 * itself; what a host gets is tested where the host is (the example, in this workspace).
 */
const TREE = fileURLToPath(new URL('..', import.meta.url));
const PLUGINS: Record<string, PluginModule> = { ...BUILTIN_PLUGINS, '@http': http, '@auth': auth };
const codes = (root: string) => checkTree(loadTree(root, PLUGINS)).items.map(refusal => refusal.code);

/**
 * A JSON document a sabotage edit reaches into: it writes a malformed value at an arbitrary path, so every path is
 * readable, writable and deletable. Typing the nodes as JSON instead would narrow at every step of every edit below.
 */
type Doc = Record<string, any>;

/** A throwaway copy of the tree, without what a check must not read. */
function copyOfTree(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wilanis-access-'));
  cpSync(TREE, dir, {
    recursive: true,
    filter: path => !path.includes('node_modules') && !path.includes('.wilanis') && !path.includes('/test'),
  });
  return dir;
}

/** The refusal codes a copy answers with, once it has been broken; the copy does not outlive the answer. */
function codesAfter(change: (dir: string) => void): string[] {
  const dir = copyOfTree();
  change(dir);
  const out = codes(dir);
  rmSync(dir, { recursive: true, force: true });
  return out;
}

/** Copy the tree, apply an edit to one file, answer the refusal codes. */
function sabotage(file: string, edit: (doc: Doc) => void): string[] {
  return codesAfter(dir => {
    const path = join(dir, file);
    const doc = JSON.parse(readFileSync(path, 'utf8'));
    edit(doc);
    writeFileSync(path, JSON.stringify(doc));
  });
}

/** Copy the tree, move one document, answer the refusal codes. */
function relocate(from: string, to: string): string[] {
  return codesAfter(dir => {
    mkdirSync(dirname(join(dir, to)), { recursive: true });
    renameSync(join(dir, from), join(dir, to));
  });
}

describe('the access tree on its own', () => {
  it('passes check with its development binding, and nothing is included', () => {
    const load = loadTree(TREE, PLUGINS);
    expect(checkTree(load).items).toEqual([]);
    expect(load.registry.files.some(file => file.included)).toBe(false);
    expect(load.registry.get('binding', '@features/access-dev/data/identity.binding.json')).toBeDefined();
  });
  it('rehearses every branch of every decision and every sign-in, whatever the seed', async () => {
    for (const seed of [1, 2, 3]) {
      const run = await rehearse(loadTree(TREE, PLUGINS), { seed });
      expect(run.ok).toBe(true);
      expect(run.lines.join('\n')).toMatch(/require-recorder {2}switch 'decide' {2}3\/3 branches/);
      expect(run.lines.join('\n')).toMatch(
        /when has\(principal\) && 'recorder' in principal.roles {2}answered from 'granted'/,
      );
    }
  });
  it('exports what a host binds and gates with, and nothing else', () => {
    const feature = JSON.parse(readFileSync(join(TREE, 'features/access/feature.json'), 'utf8'));
    expect(feature.exports).toEqual([
      '@features/access/domain/access.port.json',
      '@features/access/domain/identity.port.json',
      '@features/access/edge/signed-in.policy.json',
      '@features/access/edge/employees-only.policy.json',
      '@features/access/edge/can-record.policy.json',
      '@features/access/edge/otp-verified.policy.json',
    ]);
  });
});

describe('sabotage: what a policy declares', () => {
  it("A001 a policy whose input reads outside the request, or does not fit the decision under the trigger's kind", () => {
    expect(
      sabotage('features/access/edge/signed-in.policy.json', policy => {
        policy.decide.in.principal = '{{in.principal}}';
      }),
    ).toContain('A001');
    expect(
      sabotage('features/access/edge/signed-in.policy.json', policy => {
        policy.decide.in.principal = '{{request.headers}}';
      }),
    ).toContain('A001');
    expect(
      sabotage('features/access/edge/signed-in.policy.json', policy => {
        policy.decide.in.principal = '{{request.nothing}}';
      }),
    ).toContain('A001');
    expect(
      sabotage('features/access/domain/access.port.json', port => {
        port.operations.requireSignedIn.accepts.principal.required = true;
      }),
    ).toContain('A001');
  });
  it('A002 a reason the decision can reach that outcomes does not map, and a challenge without a method', () => {
    expect(
      sabotage('features/access/edge/employees-only.policy.json', policy => {
        delete policy.outcomes.forbidden;
      }),
    ).toEqual(['A002']);
    expect(
      sabotage('features/access/edge/otp-verified.policy.json', policy => {
        delete policy.outcomes.otp.method;
      }),
    ).toEqual(['A002']);
  });
  it('A003 an outcome nothing the decision reaches refuses with', () => {
    expect(
      sabotage('features/access/edge/signed-in.policy.json', policy => {
        policy.outcomes.teapot = { effect: 'deny' };
      }),
    ).toEqual(['A003']);
  });
});

describe('sabotage: a policy against the trigger that attaches it', () => {
  it('A004 a credential read where the kind hands nothing: a flag on an http route', () => {
    expect(
      sabotage('features/access/edge/get-preferences.trigger.json', trigger => {
        trigger.policies[0].in.token = '{{request.flags.token}}';
      }),
    ).toEqual(['A004']);
  });
  it('A005 a policy reading the caller on a trigger that gives the guard nothing', () => {
    expect(
      sabotage('features/access/edge/get-preferences.trigger.json', trigger => {
        trigger.policies = ['@access/edge/signed-in.policy.json'];
        delete trigger.settings.response.refusals.invalid_credential;
      }),
    ).toEqual(['A005']);
  });
  it('A006 a resolver read as required that no policy of the trigger proves', () => {
    expect(
      sabotage('features/access/edge/signed-in.policy.json', policy => {
        delete policy.proves;
      }),
    ).toEqual(['A006', 'A006', 'A006']);
    // without the declaration the read is optional again, which the graph cannot feed to a required input
    expect(
      sabotage('features/access/edge/session.resolvers.json', doc => {
        delete doc.resolvers.sid.required;
      }),
    ).toContain('G004');
  });
});

describe('sabotage: a policy against the rules of other families', () => {
  it('L006 a policy deciding through a native operation; D008 a policy outside the edge layer', () => {
    expect(
      sabotage('features/access/edge/signed-in.policy.json', policy => {
        policy.decide.run = '@std/object.port.json#make';
      }),
    ).toContain('L006');
    expect(
      relocate('features/access/edge/signed-in.policy.json', 'features/access/domain/signed-in.policy.json'),
    ).toContain('D008');
  });
  it('X102 a challenge by a method the settings do not declare; X103 a session write outside the session shape', () => {
    expect(
      sabotage('features/access/edge/otp-verified.policy.json', policy => {
        policy.outcomes.otp.method = 'sms';
      }),
    ).toEqual(['X102']);
    expect(
      sabotage('features/access/data/write-theme.graph.json', graph => {
        graph.nodes[0].in.values = { colour: '{{in.theme}}' };
      }),
    ).toEqual(['X103']);
    expect(
      sabotage('features/access/data/write-theme.graph.json', graph => {
        graph.nodes[0].in.type = '@access/domain/Grant.shape.json';
        graph.out.type = '@access/domain/Grant.shape.json';
      }),
    ).toContain('X103');
  });
});
