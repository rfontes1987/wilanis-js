/**
 * G inputs: one grammar for the values given where an operation is called, judged against what it accepts.
 * Fields of type `type` and fields marked static must be literals: the checker reads them here, and binds the
 * variables they name (P001) -- a type field from its own literal, a static field through its `resolves`.
 * Every other value is typed by the site's reader in the caller's context (G003), must be an input (G006),
 * present when required (G005), and assignable (G004).
 */
import {
  assignable,
  type Field,
  type Fields,
  hasVars,
  type Loaded,
  type Read,
  resolvedHere,
  substitute,
  type Type,
} from '@wilanis/core';
import type { Judge, Reader, Refuser, Resolve, ShapeLayer } from './judge.js';

/** Where an operation is called: what is given, what it accepts, and how a value given there is typed. */
export interface CallSite {
  given: Record<string, unknown>;
  accepts: Fields | undefined;
  read: Reader;
  file: string;
  at: string;
  /** the callee, for messages */
  what: string;
  from: Loaded;
  layer: ShapeLayer;
  /** inputs typed elsewhere (a map's bound element) */
  extra?: Record<string, Read>;
}

/** A reader whose templates `resolve` types; a read that cannot be typed is G003. */
export function reader(judge: Judge, resolve: Resolve, file: string): Reader {
  const refuse = judge.refuser(file);
  return (value, at) => {
    const read = judge.scope.valueRead(value, resolve);
    if (typeof read !== 'string') return read;
    refuse('G003', read, at, 'read in, const, request or a node that runs before this one');
    return undefined;
  };
}

/** Judge a call site; answers the variables its type fields bind. */
export function checkInputs(judge: Judge, site: CallSite): Record<string, Type> {
  return new InputCheck(judge, site).run();
}

class InputCheck {
  private readonly refuse: Refuser;
  private readonly accepts: Fields;
  private readonly extra: Record<string, Read>;
  private readonly subst: Record<string, Type> = {};

  constructor(
    private readonly judge: Judge,
    private readonly site: CallSite,
  ) {
    this.refuse = judge.refuser(site.file);
    this.accepts = site.accepts ?? {};
    this.extra = site.extra ?? {};
  }

  run(): Record<string, Type> {
    this.checkUnknown();
    // what binds comes first: the rest may be typed through the variables bound here
    for (const [name, field] of Object.entries(this.accepts))
      if (this.isTypeField(field)) this.checkTypeField(name, field);
    this.bindResolved();
    for (const [name, field] of Object.entries(this.accepts))
      if (!this.isTypeField(field)) this.checkValueField(name, field);
    return this.subst;
  }

  /**
   * The second channel a variable is bound through: a static field whose `resolves` names where the type is
   * written down (a store's collection), read through the same core resolution the compiler and the gate's
   * stub use, so no two of them can disagree about what this call site binds.
   */
  private bindResolved(): void {
    Object.assign(this.subst, resolvedHere(this.accepts, this.site.given, this.judge.scope.resolving()));
  }

  private isTypeField(field: Field): boolean {
    return this.judge.quiet(field.type)?.kind === 'type';
  }

  /** G006: everything given is an input. */
  private checkUnknown(): void {
    const inputs = Object.keys(this.accepts).join(', ') || 'none';
    for (const name of new Set([...Object.keys(this.site.given), ...Object.keys(this.extra)])) {
      if (name in this.accepts) continue;
      this.refuse(
        'G006',
        `'${name}' is not an input of ${this.site.what} (inputs: ${inputs})`,
        `${this.site.at}/${name}`,
        'wilanis describe <port>',
      );
    }
  }

  /** G005 when a required input is not given. */
  private requireGiven(field: Field, message: string): void {
    if (field.required !== false)
      this.refuse('G005', message, this.site.at, `give it under in, or mark the field optional in ${this.site.what}`);
  }

  /** A type field is a literal type reference: read here, judged for its layer, bound to its variable. */
  private checkTypeField(name: string, field: Field): void {
    const at = `${this.site.at}/${name}`;
    if (!(name in this.site.given)) {
      this.requireGiven(field, `${this.site.what} requires '${name}'`);
      return;
    }
    const value = this.site.given[name];
    if (typeof value !== 'string' || !this.judge.scope.literal(value)) {
      this.refuse(
        'P001',
        `'${name}' is a type reference, written as a literal string`,
        at,
        'e.g. "@features/tasks/domain/Task.shape.json[]"',
      );
      return;
    }
    const type = this.judge.type(value, this.site.file, at);
    if (!type) return;
    this.judge.checkLayer({ spec: value, from: this.site.from, at, layer: this.site.layer, what: `'${name}'` });
    if (field.binds) this.subst[field.binds] = type;
  }

  /** A value field: typed from where it comes, then held to the contract, with the bound variables substituted. */
  private checkValueField(name: string, field: Field): void {
    const at = `${this.site.at}/${name}`;
    const read = this.readOf(name, field);
    if (!read) return;
    let want = this.judge.type(field.type, this.site.file, at);
    if (!want) return;
    if (hasVars(want)) want = substitute(want, this.subst);
    if (read.optional && field.required !== false) {
      const hint = 'route around it with a switch on has(...), or make the contract field optional';
      this.refuse('G004', `'${name}' may be missing at run time but ${this.site.what} requires it`, at, hint);
      return;
    }
    const bad = assignable(read.type, want);
    if (bad)
      this.refuse(
        'G004',
        `'${name}': ${bad}`,
        at,
        `make what '${name}' reads and what ${this.site.what} takes one type`,
      );
  }

  /** How an input is typed: from `extra`, from the value given (a static field as a literal, P001), or not at all (G005 when required). */
  private readOf(name: string, field: Field): Read | undefined {
    if (name in this.extra) return this.extra[name];
    if (!(name in this.site.given)) {
      this.requireGiven(field, `${this.site.what} requires input '${name}'`);
      return undefined;
    }
    const at = `${this.site.at}/${name}`;
    if (field.static && !this.judge.scope.literal(this.site.given[name])) {
      this.refuse(
        'P001',
        `'${name}' is static: write the value, not a read`,
        at,
        'a static field is judged before anything runs',
      );
      return undefined;
    }
    return this.site.read(this.site.given[name], at);
  }
}
