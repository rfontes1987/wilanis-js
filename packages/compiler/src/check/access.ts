/**
 * A access. A policy decides through a domain port operation, reads the request only, and says what every
 * reason its decision can refuse with means (A001, A002, A003). Where a trigger attaches policies, each
 * attachment's `in` gives the guard a credential it declares, read where the kind hands it (A004); a policy
 * that reads what the guard hands leans on a credential yielding it, which some attachment must give (A005);
 * a credential no policy reads is refused too (A004); each policy's input fits under the kind (A001).
 */
import {
  assignable,
  type GuardCredential,
  type Loaded,
  type Operation,
  type Outcome,
  type PluginDoc,
  type PolicyDoc,
  type PolicyRef,
  policyPath,
  READ_PATH,
  show,
  splitPath,
  type TriggerDoc,
  type Type,
  typeAt,
} from '@wilanis/core';
import { refusalsReachable } from '../refusals.js';
import type { Judge, Refuser } from './judge.js';
import { assignableWire, requestOnly } from './typing.js';

const NO_GUARD_HINT = 'add a guarding plugin to project.json → plugins, such as @wilanis/plugin-auth';

// ---- a policy on its own ------------------------------------------------------------------------

export function checkPolicy(judge: Judge, policy: Loaded<PolicyDoc>): void {
  new PolicyCheck(judge, policy).run();
}

class PolicyCheck {
  private readonly refuse: Refuser;
  private readonly doc: PolicyDoc;

  constructor(
    private readonly judge: Judge,
    private readonly policy: Loaded<PolicyDoc>,
  ) {
    this.refuse = judge.refuser(policy.path);
    this.doc = policy.doc;
  }

  /** What its reads are worth under a kind is judged where a trigger attaches it, since the context differs per kind. */
  run(): void {
    const run = this.doc.decide.run;
    const hit = this.judge.scope.op(run);
    if (typeof hit === 'string') {
      this.refuse('R001', hit, 'decide/run', 'wilanis ls port');
      return;
    }
    if (hit.port.native) {
      const hint = "a policy decides through a domain port; the port's binding reaches the native operation";
      this.refuse('L006', `policy decides through native operation '${run}'`, 'decide/run', hint);
      return;
    }
    this.judge.visible(this.policy, hit.port, 'decide/run');
    this.checkReads();
    this.checkProves();
    this.checkDecideInput(hit.op);
    this.checkOutcomes();
  }

  /** A001: the decision's input reads the request only. */
  private checkReads(): void {
    for (const read of this.judge.scope.templateReads(this.doc.decide.in)) {
      if (read[0] === 'request') continue;
      const hint =
        'read what the kind and the guard hand: request.principal, request.session, request.challenge, request.headers...';
      this.refuse('A001', `decide.in reads '${read[0]}', but a policy's input reads request.* only`, 'decide/in', hint);
    }
  }

  /** A001: what the policy proves present once it allows is a request.* path the guard or a kind hands; a required resolver leans on it (A006). */
  private checkProves(): void {
    for (const [index, path] of (this.doc.proves ?? []).entries()) {
      const at = `proves/${index}`;
      const segments = READ_PATH.test(path) ? splitPath(path) : [];
      if (segments[0] !== 'request' || segments.length < 2) {
        this.refuse(
          'A001',
          `proves names '${path}', which is not a request.* path`,
          at,
          'write request.principal, request.session...',
        );
        continue;
      }
      const read = this.judge.scope.requestRead(segments.slice(1));
      if (typeof read === 'string') {
        this.refuse(
          'A001',
          `proves names request.${segments.slice(1).join('.')}: ${read}`,
          at,
          'wilanis describe the guarding plugin shows what it hands',
        );
      }
    }
  }

  /** A001: the decision gives an input exactly when the operation takes one. */
  private checkDecideInput(op: Operation): void {
    const run = this.doc.decide.run;
    const takes = this.judge.acceptsType(op);
    const given = this.doc.decide.in !== undefined;
    if (given && !takes)
      this.refuse('A001', `decide.in is given but '${run}' takes no input`, 'decide/in', 'remove in');
    if (takes && !given)
      this.refuse(
        'A001',
        `'${run}' takes ${show(takes)} but decide gives nothing`,
        'decide',
        'write in: what the decision reads from the request',
      );
  }

  /** A002, A003: each reason the decision can reach means something here, and nothing here is out of reach. */
  private checkOutcomes(): void {
    const run = this.doc.decide.run;
    const reachable = this.judge.reachableReasons(profile => refusalsReachable(this.judge.scope, run, profile));
    for (const [reason, from] of reachable) {
      if (this.doc.outcomes[reason]) continue;
      const hint = `add "${reason}": { "effect": "deny" } or { "effect": "challenge", "method": "..." }`;
      this.refuse('A002', `${from} may refuse with reason '${reason}', which outcomes does not map`, 'outcomes', hint);
    }
    for (const [reason, outcome] of Object.entries(this.doc.outcomes))
      this.checkOutcome(reason, outcome, reachable.has(reason));
  }

  private checkOutcome(reason: string, outcome: Outcome, reachable: boolean): void {
    const at = `outcomes/${reason}`;
    if (!reachable) {
      const message = `outcomes maps reason '${reason}', but nothing '${this.doc.decide.run}' reaches refuses with it`;
      this.refuse('A003', message, at, 'remove it, or spell the reason the way the graph does');
    }
    if (outcome.effect === 'challenge' && !outcome.method) {
      this.refuse(
        'A002',
        `outcome '${reason}' challenges but names no method`,
        at,
        'name the method the guard opens: "method": "otp"',
      );
    }
    if (outcome.effect === 'deny' && outcome.method) {
      this.refuse(
        'A002',
        `outcome '${reason}' denies, so a method means nothing`,
        `${at}/method`,
        'remove method, or make the effect a challenge',
      );
    }
  }
}

// ---- what gates a trigger -----------------------------------------------------------------------

/** Judge what gates a trigger under its own kind: the credentials its attachments give, and its policies' reads. */
export function checkAccess(judge: Judge, trigger: Loaded<TriggerDoc>, ctx: Type): void {
  new AccessCheck(judge, trigger, ctx).run();
}

class AccessCheck {
  private readonly refuse: Refuser;
  private readonly doc: TriggerDoc;
  private readonly guard: Loaded<PluginDoc> | undefined;
  private readonly creds: Record<string, GuardCredential>;
  /** what the guard hands: the fields of its context */
  private readonly handed: Set<string>;
  private readonly uses: PolicyRef[];
  /** what the credentials given yield */
  private yielded = new Set<string>();
  /** what the policies attached read of what the guard hands */
  private readonly needed = new Set<string>();

  constructor(
    private readonly judge: Judge,
    private readonly trigger: Loaded<TriggerDoc>,
    private readonly ctx: Type,
  ) {
    this.refuse = judge.refuser(trigger.path);
    this.doc = trigger.doc;
    this.guard = judge.scope.guard();
    this.creds = this.guard?.doc.guard?.credentials ?? {};
    this.handed = new Set(Object.keys(this.guard?.doc.guard?.context.fields ?? {}));
    this.uses = this.doc.policies ?? [];
  }

  run(): void {
    const given = this.checkCredentials();
    this.yielded = new Set([...given].flatMap(name => this.yieldsOf(name)));
    for (const [index, use] of this.uses.entries()) this.checkAttachment(use, `policies/${index}`);
    for (const name of given) {
      if (this.yieldsOf(name).some(key => this.needed.has(key))) continue;
      const message = `credential '${name}' is given, but no policy of this trigger reads what it yields (request.${this.yieldsOf(name).join(', request.')})`;
      this.refuse('A004', message, 'policies', 'drop it, or attach a policy that decides on it');
    }
  }

  private yieldsOf(credential: string): string[] {
    return this.creds[credential]?.yields ?? [];
  }

  // ---- credentials --------------------------------------------------------------------------------

  /** A004 for every credential an attachment gives; answers the names of those the guard verifies. */
  private checkCredentials(): Set<string> {
    const given = new Set<string>();
    for (const [index, use] of this.uses.entries()) {
      if (typeof use === 'string') continue;
      for (const [name, value] of Object.entries(use.in ?? {})) {
        if (this.checkCredential(name, value, `policies/${index}/in/${name}`)) given.add(name);
      }
    }
    return given;
  }

  /** One credential given: the guard verifies it, and each place it may sit reads what the kind hands, of the type the guard asks. */
  private checkCredential(name: string, value: unknown, at: string): boolean {
    const cred = this.creds[name];
    if (!cred) {
      this.refuseUnknownCredential(name, at);
      return false;
    }
    const want = this.judge.quiet(cred.type);
    // a list is the places the credential may sit, the first present wins: each place is judged on its own
    for (const place of Array.isArray(value) ? value : [value]) this.checkCredentialRead(name, place, want, at);
    return true;
  }

  private refuseUnknownCredential(name: string, at: string): void {
    if (this.guard) {
      const verifies = Object.keys(this.creds).join(', ') || 'none';
      this.refuse(
        'A004',
        `'${name}' is not a credential the guard verifies (it verifies ${verifies})`,
        at,
        `wilanis describe ${this.guard.path}`,
      );
      return;
    }
    this.refuse(
      'A004',
      `'${name}' is given as a credential, but no plugin of this project identifies callers`,
      at,
      NO_GUARD_HINT,
    );
  }

  private checkCredentialRead(name: string, value: unknown, want: Type | undefined, at: string): void {
    const read = this.judge.scope.valueRead(value, requestOnly(this.ctx, 'a credential is read from the request'));
    if (typeof read === 'string') {
      this.refuse(
        'A004',
        `credential '${name}': ${read}`,
        at,
        `wilanis describe ${this.doc.kind} shows what this kind hands`,
      );
      return;
    }
    if (!read || !want) return;
    const bad = assignableWire(read.type, want);
    if (bad)
      this.refuse(
        'A004',
        `credential '${name}' → ${show(want)}: ${bad}`,
        at,
        `wilanis describe ${this.guard?.path} shows what the guard takes`,
      );
  }

  // ---- policies -----------------------------------------------------------------------------------

  /** One attachment: the policy exists and is visible; its reads of the guard's context are backed (A005); its input fits (A001). */
  private checkAttachment(use: PolicyRef, at: string): void {
    const ref = policyPath(use);
    const policy = this.judge.scope.get('policy', ref);
    if (!policy) {
      this.refuse('R001', `unknown policy '${ref}'`, at, 'wilanis ls policy');
      return;
    }
    this.judge.visible(this.trigger, policy, at);
    const hit = this.judge.scope.op(policy.doc.decide.run);
    if (typeof hit === 'string' || hit.port.native) return; // refused at the policy
    for (const read of this.judge.scope.templateReads(policy.doc.decide.in)) {
      if (read[0] === 'request') this.checkGuardRead(policy, ref, read, at);
    }
    this.checkPolicyInput(policy, hit.op, at);
  }

  /** A005: a policy that reads what the guard hands leans on a credential yielding it, which some attachment of this trigger must give. */
  private checkGuardRead(policy: Loaded<PolicyDoc>, ref: string, read: string[], at: string): void {
    const key = read[1];
    if (!this.guard) {
      if (typeof typeAt(this.ctx, read.slice(1)) !== 'string') return;
      const message = `policy '${policy.path}' reads request.${key}, which no trigger kind hands and no plugin of this project identifies callers to supply`;
      this.refuse('A005', message, at, NO_GUARD_HINT);
      return;
    }
    if (!this.handed.has(key)) return;
    this.needed.add(key);
    if (this.yielded.has(key)) return;
    const from = Object.entries(this.creds)
      .filter(([, cred]) => cred.yields.includes(key))
      .map(([name]) => name);
    const verified = from.length ? `a ${from.join(' or a ')}` : 'nothing it verifies';
    const message = `policy '${policy.path}' reads request.${key}, which the guard hands once it verified ${verified}, but no attachment on this trigger gives one`;
    const hint = from.length
      ? `write { "policy": "${ref}", "in": { "${from[0]}": "{{request.headers.authorization}}" } } -- the read is where this kind hands the credential`
      : 'a policy reads only what the guard hands';
    this.refuse('A005', message, at, hint);
  }

  /** A001: the policy's input, typed under this kind's context, fits the decision's contract. */
  private checkPolicyInput(policy: Loaded<PolicyDoc>, op: Operation, at: string): void {
    const takes = this.judge.acceptsType(op);
    if (!takes || policy.doc.decide.in === undefined) return;
    const under = `policy '${policy.path}' under kind '${this.doc.kind}'`;
    const read = this.judge.scope.valueRead(
      policy.doc.decide.in,
      requestOnly(this.ctx, "a policy's input reads request.* only"),
    );
    if (typeof read === 'string') {
      this.refuse('A001', `${under}: ${read}`, at, `wilanis describe ${this.doc.kind} shows what this kind hands`);
      return;
    }
    if (!read) return;
    const bad = assignable(read.type, takes);
    if (bad) {
      const hint =
        'a read that may be missing (an anonymous caller) feeds an input the operation declares required: false, and the graph decides on has(...)';
      this.refuse('A001', `${under}: decide.in → ${policy.doc.decide.run}: ${bad}`, at, hint);
    }
  }
}
