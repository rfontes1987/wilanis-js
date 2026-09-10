/**
 * T triggers. A trigger names a kind and settings that fit it (R001, T001), fires a domain port whose contract
 * its edge shapes meet (L006, T002), reads the request into its input (T003), reaches only request.* paths its
 * kind hands (T004) and guarantees the ones a resolver requires (A006), and maps every refusal reason it can
 * reach, and no other (T005, T006). What gates it is judged in access.ts. S scenarios name a trigger (S001).
 */
import {
  type Field,
  type Loaded,
  type Operation,
  type PolicyDoc,
  policyPath,
  type ScenarioDoc,
  show,
  splitPath,
  type TriggerDoc,
  type TriggerKindDoc,
  type Type,
  typeAt,
} from '@wilanis/core';
import { readPath } from '@wilanis/engine';
import { refusalsOfTrigger } from '../refusals.js';
import { checkAccess } from './access.js';
import { type Judge, type Refuser, underProfile } from './judge.js';
import { opNeeds, type RequestNeed } from './resolvers.js';
import { assignableWire, atOrBelow, mismatch, requestOnly } from './typing.js';

/** The refusal for a scenario naming a trigger the tree does not have (S001), or nothing when it names one. */
export function checkScenario(judge: Judge, scenario: Loaded<ScenarioDoc>): void {
  if (judge.scope.get('trigger', scenario.doc.trigger)) return;
  judge.refuser(scenario.path)(
    'S001',
    `scenario names unknown trigger '${scenario.doc.trigger}'`,
    'trigger',
    'wilanis ls trigger',
  );
}

/**
 * Every refusal a trigger can earn: the kind and settings it names (R001, T001), the domain port it fires and
 * whether its edge shapes meet that contract (L006, T002), the request it reads into its input (T003) and the
 * paths its kind hands (T004), the reasons it maps (T005, T006), and what gates it (A001, A004, A005, A006).
 */
export function checkTrigger(judge: Judge, trigger: Loaded<TriggerDoc>): void {
  new TriggerCheck(judge, trigger).run();
}

/** The refusal table a kind keeps in a trigger's settings, when it is an object there. */
function tableAt(settings: Record<string, unknown>, path: string): Record<string, unknown> {
  const table = readPath(settings, path.split('.'));
  return table && typeof table === 'object' && !Array.isArray(table) ? (table as Record<string, unknown>) : {};
}

class TriggerCheck {
  private readonly refuse: Refuser;
  private readonly file: string;
  private readonly doc: TriggerDoc;

  constructor(
    private readonly judge: Judge,
    private readonly trigger: Loaded<TriggerDoc>,
  ) {
    this.file = trigger.path;
    this.doc = trigger.doc;
    this.refuse = judge.refuser(trigger.path);
  }

  run(): void {
    const kind = this.judge.scope.get('trigger-kind', this.doc.kind);
    if (!kind) {
      this.refuse('R001', `unknown trigger kind '${this.doc.kind}'`, 'kind', 'wilanis ls trigger-kind');
      return;
    }
    this.checkSettings(kind);
    if (this.doc.in)
      this.judge.checkLayer({ spec: this.doc.in, from: this.trigger, at: 'in', layer: 'edge', what: 'in' });
    if (this.doc.out)
      this.judge.checkLayer({ spec: this.doc.out, from: this.trigger, at: 'out', layer: 'edge', what: 'out' });
    const hit = this.judge.scope.op(this.doc.fire.run);
    if (typeof hit === 'string') {
      this.refuse('R001', hit, 'fire/run', 'wilanis ls port');
      return;
    }
    if (hit.port.native) {
      const hint = "a trigger fires a domain port; the port's binding reaches the native operation";
      this.refuse('L006', `trigger fires native operation '${this.doc.fire.run}'`, 'fire/run', hint);
      return;
    }
    this.judge.visible(this.trigger, hit.port, 'fire/run');
    const inType = this.judge.type(this.doc.in, this.file, 'in');
    const outType = this.judge.type(this.doc.out, this.file, 'out');
    const ctx = this.judge.scope.contextType(kind.doc, this.doc.settings);
    this.checkFireIn(inType, ctx);
    this.checkContract(hit.op, inType, outType);
    this.checkRequestReach(ctx);
    checkAccess(this.judge, this.trigger, ctx);
    if (kind.doc.refusals) this.checkRefusalTable(kind.doc.refusals);
  }

  /** T001: settings fit the kind's, and a type setting names an edge shape. */
  private checkSettings(kind: Loaded<TriggerKindDoc>): void {
    const declared = this.judge.type(kind.doc.settings, this.file, 'settings');
    const read = this.judge.settingsRead(this.doc.settings, this.file, 'settings');
    const bad = mismatch(read?.type, declared);
    if (bad) this.refuse('T001', `settings: ${bad}`, 'settings', `wilanis describe ${this.doc.kind}`);
    for (const [name, field] of Object.entries(kind.doc.settings.fields)) this.checkTypeSetting(name, field);
  }

  private checkTypeSetting(name: string, field: Field): void {
    const value = this.doc.settings[name];
    if (this.judge.quiet(field.type)?.kind !== 'type' || value === undefined) return;
    const at = `settings/${name}`;
    if (typeof value !== 'string') {
      this.refuse('T001', `settings.${name} is a type reference, written as a string`, at);
      return;
    }
    if (this.judge.type(value, this.file, at)) {
      this.judge.checkLayer({ spec: value, from: this.trigger, at, layer: 'edge', what: `settings.${name}` });
    }
  }

  /**
   * T003: fire.in reads the request only and fits the trigger's in, wire-loosely: a read that may be missing (a
   * query key, a flag, a header) may feed a required field. The edge judges the input when it arrives, and a
   * request without it is refused there (a 400, a usage error), never run.
   */
  private checkFireIn(inType: Type | undefined, ctx: Type): void {
    if (this.doc.fire.in === undefined) return;
    if (!inType) {
      this.refuse('T003', 'fire.in is given but the trigger declares no in', 'fire/in');
      return;
    }
    const read = this.judge.scope.valueRead(
      this.doc.fire.in,
      requestOnly(ctx, "a trigger's input reads request.* only"),
    );
    if (typeof read === 'string') {
      this.refuse(
        'T003',
        `fire.in: ${read}`,
        'fire/in',
        `wilanis describe ${this.doc.kind} shows what this kind hands`,
      );
      return;
    }
    if (!read) return;
    const bad = assignableWire(read.type, inType);
    if (bad) this.refuse('T003', `fire.in → in: ${bad}`, 'fire/in');
  }

  /** T002: the trigger's in feeds the operation's accepts, and its returns feed the trigger's out. */
  private checkContract(op: Operation, inType: Type | undefined, outType: Type | undefined): void {
    const run = this.doc.fire.run;
    const takes = this.judge.acceptsType(op);
    const answers = this.judge.quiet(op.returns);
    if (takes && !inType) this.refuse('T002', `'${run}' takes ${show(takes)} but the trigger declares no in`, 'in');
    const badIn = mismatch(inType, takes);
    if (badIn) {
      this.refuse(
        'T002',
        `in → ${run}: ${badIn}`,
        'in',
        "the edge shape must be assignable to the operation's core contract, field for field",
      );
    }
    if (answers && !outType)
      this.refuse('T002', `'${run}' answers ${show(answers)} but the trigger declares no out`, 'out');
    if (outType && !answers) this.refuse('T002', `trigger declares out but '${run}' returns nothing`, 'out');
    const badOut = mismatch(answers, outType);
    if (badOut) this.refuse('T002', `${run} → out: ${badOut}`, 'out');
  }

  private policies(): Loaded<PolicyDoc>[] {
    return (this.doc.policies ?? [])
      .map(ref => this.judge.scope.get('policy', policyPath(ref)))
      .filter((policy): policy is Loaded<PolicyDoc> => Boolean(policy));
  }

  /** T004, A006: every request.* a resolver reads under this trigger is in the kind's context; a required one is guaranteed. */
  private checkRequestReach(ctx: Type): void {
    const policies = this.policies();
    const decides = policies.map(policy => policy.doc.decide.run);
    const proven = policies.flatMap(policy => policy.doc.proves ?? []).map(path => splitPath(path).slice(1).join('.'));
    for (const profile of this.judge.profiles()) {
      for (const run of [this.doc.fire.run, ...decides]) {
        for (const need of opNeeds(this.judge, run, profile)) this.checkNeed(need, ctx, proven, profile);
      }
    }
  }

  private checkNeed(need: RequestNeed, ctx: Type, proven: string[], profile: string | undefined): void {
    const reach = typeAt(ctx, need.path);
    if (typeof reach === 'string') {
      const message = `${need.file} reads request.${need.path.join('.')} but trigger kind '${this.doc.kind}' hands no such value${underProfile(profile)}`;
      this.refuse(
        'T004',
        message,
        'kind',
        'fire this operation from a kind that hands it, or bind the port differently under a profile',
      );
      return;
    }
    // a resolver declared required is read as present: this trigger's kind must hand it always, or a policy of this trigger must prove it
    if (!need.required) return;
    const own = typeAt(ctx, need.required);
    const path = need.required.join('.');
    const guaranteed = (typeof own === 'object' && !own.optional) || proven.some(proof => atOrBelow(path, proof));
    if (guaranteed) return;
    const message = `${need.file} reads request.${path} as required, but trigger kind '${this.doc.kind}' hands it only sometimes and no policy of this trigger proves it${underProfile(profile)}`;
    const hint = `gate this trigger with a policy whose proves lists "request.${path}", or drop required from the resolver and route around its absence`;
    this.refuse('A006', message, 'policies', hint);
  }

  /**
   * T005, T006. The graph says why it refused, in one word; the kind says how that word is answered. Each reason
   * this trigger can reach -- through what it fires, what gates it, and the guard that identifies its caller --
   * must be mapped, and nothing may be mapped that it cannot reach.
   */
  private checkRefusalTable(tablePath: string): void {
    const atPath = `settings/${tablePath.replace(/\./g, '/')}`;
    const mapped = tableAt(this.doc.settings, tablePath);
    const reachable = this.judge.reachableReasons(profile => refusalsOfTrigger(this.judge.scope, this.doc, profile));
    for (const [reason, from] of reachable) {
      if (mapped[reason] !== undefined) continue;
      const message = `${from} may refuse with reason '${reason}', which settings.${tablePath} does not map`;
      this.refuse(
        'T005',
        message,
        atPath,
        `add "${reason}" under settings.${tablePath}: how this trigger answers that outcome`,
      );
    }
    for (const reason of Object.keys(mapped)) {
      if (reachable.has(reason)) continue;
      const message = `settings.${tablePath} maps reason '${reason}', but nothing this trigger fires, gates on or identifies with refuses with it`;
      this.refuse('T006', message, `${atPath}/${reason}`, 'remove it, or spell the reason the way the graph does');
    }
  }
}
