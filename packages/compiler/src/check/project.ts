/**
 * The project document. C connections/settings: plugin settings read secrets only and fit the manifest (C001,
 * C002). B bindings/profiles: a profile names domain ports and bindings that implement them (R001, B003,
 * B004), and every domain port is met under every profile (B002). Startup: each step fires a domain port
 * operation (or a native one that holds) before anything is received (B006, B007, B008).
 */
import { EMPTY_OBJECT, type Loaded, type Operation, type PortDoc, type StartupStep } from '@wilanis/core';
import { type Judge, underProfile } from './judge.js';
import { opNeeds } from './resolvers.js';
import { mismatch } from './typing.js';

export function checkProject(judge: Judge): void {
  checkPluginSettings(judge);
  for (const [name, profile] of Object.entries(judge.project.doc.profiles ?? {})) {
    for (const entry of Object.entries(profile.bindings)) checkProfileBinding(judge, name, entry);
  }
  for (const port of judge.scope.registry.all('port')) {
    if (port.native) continue;
    for (const profile of judge.profiles()) checkPortMet(judge, port, profile);
  }
}

/** C001, C002: a plugin's settings read secrets only and fit what its manifest declares. */
function checkPluginSettings(judge: Judge): void {
  const { path, doc } = judge.project;
  const refuse = judge.refuser(path);
  for (const [index, use] of doc.plugins.entries()) {
    const manifest = judge.scope.registry.get('plugin', `${use.use}/plugin.json`);
    if (!manifest) continue;
    const at = `plugins/${index}/settings`;
    const declared = manifest.doc.settings ? judge.type(manifest.doc.settings, path, `plugins/${index}`) : EMPTY_OBJECT;
    const read = judge.settingsRead(use.settings ?? {}, path, at);
    const bad = mismatch(read?.type, declared);
    if (bad) refuse('C002', `plugin '${use.use}' settings: ${bad}`, at, `wilanis describe ${use.use}/plugin.json`);
  }
}

/** R001, B003, B004: a profile binds a domain port to a binding that implements it. */
function checkProfileBinding(judge: Judge, name: string, [portRef, bindingRef]: [string, string]): void {
  const refuse = judge.refuser(judge.project.path);
  const at = `profiles/${name}/bindings`;
  const port = judge.scope.get('port', portRef);
  if (!port) {
    refuse('R001', `profile '${name}' names unknown port '${portRef}'`, at);
    return;
  }
  if (port.native) refuse('B003', `profile '${name}' binds native port '${portRef}' -- the plugin binds it`, at);
  const binding = judge.scope.get('binding', bindingRef);
  if (!binding) {
    refuse('R001', `profile '${name}' names unknown binding '${bindingRef}'`, at);
    return;
  }
  if (judge.scope.canon(binding.doc.port) !== port.path) {
    refuse('B004', `profile '${name}': binding '${bindingRef}' implements '${binding.doc.port}', not '${portRef}'`, at);
  }
}

/** B002: a domain port has one binding under a profile. */
function checkPortMet(judge: Judge, port: Loaded<PortDoc>, profile: string | undefined): void {
  const binding = judge.scope.bindingFor(port.path, profile);
  if (typeof binding !== 'string') return;
  const hint = 'wilanis new binding <feature>/<name> --port <path>';
  if (profile)
    judge.refuser(judge.project.path)('B002', `profile '${profile}': ${binding}`, `profiles/${profile}/bindings`, hint);
  else judge.refuser(port.path)('B002', binding, undefined, hint);
}

/**
 * The project's startup steps: each fires a domain port operation once, before any trigger kind starts.
 * A step runs with nothing received, so it may neither fire a native operation nor reach a read of
 * request.*; its inputs must meet the operation's contract, written as literals and secrets.
 */
export function checkStartup(judge: Judge): void {
  for (const [index, step] of (judge.project.doc.startup ?? []).entries()) checkStep(judge, step, index);
}

function checkStep(judge: Judge, step: StartupStep, index: number): void {
  const refuse = judge.refuser(judge.project.path);
  const at = `startup/${index}/run`;
  const hit = judge.scope.op(step.run);
  if (typeof hit === 'string') {
    refuse('B006', `startup step ${index}: ${hit}`, at, 'wilanis ls port');
    return;
  }
  // a `holds` operation starts something that outlives the run -- a listener, a watcher. It is a plugin's
  // to implement and has no per-profile binding, so a startup step names it directly.
  if (hit.port.native && !hit.op.holds) {
    const hint = "a startup step fires a domain port; the port's binding reaches the native operation";
    refuse('B006', `startup step ${index} fires native operation '${step.run}'`, at, hint);
    return;
  }
  checkStepInputs(judge, step, index, hit.op);
  checkStepReads(judge, step, index);
}

/** B007: a step's inputs are literals and secrets that meet the operation's contract. */
function checkStepInputs(judge: Judge, step: StartupStep, index: number, op: Operation): void {
  const refuse = judge.refuser(judge.project.path);
  const at = `startup/${index}/in`;
  const takes = judge.acceptsType(op);
  const why = 'a startup step runs before anything is received; only {{secrets.<key>}} may appear';
  const read = judge.secretsRead(step.in ?? {}, why);
  if (typeof read === 'string') {
    refuse(
      'B007',
      `startup step ${index}: ${read}`,
      at,
      'write the value, or declare the key under project.json → secrets',
    );
    return;
  }
  const bad = mismatch(read?.type, takes);
  if (bad)
    refuse('B007', `startup step ${index} → ${step.run}: ${bad}`, at, `wilanis describe ${step.run.split('#')[0]}`);
  if (!takes && Object.keys(step.in ?? {}).length)
    refuse('B007', `startup step ${index}: '${step.run}' takes no input`, at, 'remove in');
}

/** B008: nothing has been received when a step runs, so no read of request.* can be met. */
function checkStepReads(judge: Judge, step: StartupStep, index: number): void {
  const refuse = judge.refuser(judge.project.path);
  const hint = 'fire this operation from a trigger, or bind the port to a graph that reads no request';
  for (const profile of judge.profiles()) {
    for (const need of opNeeds(judge, step.run, profile)) {
      const message = `startup step ${index}: ${need.file} reads request.${need.path.join('.')}, but a startup step runs before anything is received${underProfile(profile)}`;
      refuse('B008', message, `startup/${index}/run`, hint);
    }
  }
}
