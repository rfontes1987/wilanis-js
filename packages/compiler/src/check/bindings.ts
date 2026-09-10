/**
 * B bindings. A binding implements a domain port (R001, B003, L005) from inside a feature (L007), binds every
 * operation of it and nothing else (B001), and meets each operation's contract (B005): through a data graph
 * whose in and out fit it, or by delegating to an operation the feature allows (L003) with inputs that fit.
 */
import {
  assignable,
  type BindingDoc,
  type BindingOp,
  hasVars,
  type Loaded,
  type Operation,
  type PortDoc,
  show,
  substitute,
  type Type,
  typeAt,
  type Values,
} from '@wilanis/core';
import { passedInputs } from '../documents.js';
import { checkInputs, reader } from './inputs.js';
import type { Effects, Judge, JudgedResolver, Refuser, Resolve } from './judge.js';
import { resolversFor } from './resolvers.js';
import { mismatch, readAt } from './typing.js';

type ObjectType = Extract<Type, { kind: 'object' }>;

/** One operation of the port as the binding must meet it. */
interface Contract {
  opName: string;
  op: Operation;
  at: string;
  accepts: ObjectType | undefined;
  returns: Type | undefined;
}

/**
 * The refusals for a binding: the domain port it implements (R001, B003, L005) from inside a feature (L007),
 * every operation of that port bound and no other (B001), each met by a data graph or a delegation whose
 * contract fits (B005) and whose effects the feature allows (L003).
 */
export function checkBinding(judge: Judge, binding: Loaded<BindingDoc>): void {
  const refuse = judge.refuser(binding.path);
  const port = judge.scope.get('port', binding.doc.port);
  if (!port) {
    refuse('R001', `binding implements unknown port '${binding.doc.port}'`, 'port', 'wilanis ls port');
    return;
  }
  if (port.native) {
    refuse(
      'B003',
      `'${binding.doc.port}' is a native port; the plugin binds it`,
      'port',
      'bind a domain port instead, or name the native operation from a graph',
    );
    return;
  }
  judge.visible(binding, port, 'port');
  if (!binding.feature)
    refuse('L007', 'a binding lives inside a feature folder', undefined, 'move it under features/<name>/');
  const check = new BindingCheck(judge, binding, port);
  for (const opName of Object.keys(port.doc.operations)) {
    if (!binding.doc.operations[opName])
      refuse(
        'B001',
        `operation '${opName}' of '${port.path}' is not bound`,
        'operations',
        `add '${opName}' under operations in the binding, or wilanis new binding <feature>/<name> --port ${port.path}`,
      );
  }
  for (const [opName, bound] of Object.entries(binding.doc.operations)) check.operation(opName, bound);
}

class BindingCheck {
  private readonly refuse: Refuser;
  private readonly effects: Effects;
  private readonly resolvers: Record<string, JudgedResolver>;

  constructor(
    private readonly judge: Judge,
    private readonly binding: Loaded<BindingDoc>,
    private readonly port: Loaded<PortDoc>,
  ) {
    this.refuse = judge.refuser(binding.path);
    this.effects = judge.effectsOf(binding.feature);
    this.resolvers = resolversFor(judge, binding.doc.resolvers, binding, true);
  }

  /** One bound operation: it is an operation of the port (B001), and its graph or delegate meets the contract. */
  operation(opName: string, bound: BindingOp): void {
    const op = this.port.doc.operations[opName];
    const at = `operations/${opName}`;
    if (!op) {
      const names = Object.keys(this.port.doc.operations).join(', ');
      this.refuse(
        'B001',
        `'${opName}' is not an operation of '${this.port.path}' (${names})`,
        at,
        `wilanis describe ${this.port.path} lists its operations`,
      );
      return;
    }
    const accepts = this.judge.fieldsType(op.accepts, this.port.path, `${at}/accepts`);
    const returns = this.judge.type(op.returns, this.port.path, `${at}/returns`);
    const contract: Contract = { opName, op, at, accepts: accepts?.kind === 'object' ? accepts : undefined, returns };
    if (bound.graph) this.graphMeets(contract, bound.graph);
    else if (bound.run) this.delegateMeets(contract, bound.run, bound.in);
  }

  // ---- a data graph -------------------------------------------------------------------------------

  /** B005: the operation's accepts fit the graph's in, and the graph's out fits the returns. */
  private graphMeets(contract: Contract, graphRef: string): void {
    const at = `${contract.at}/graph`;
    const graph = this.judge.scope.get('graph', graphRef);
    if (!graph) {
      this.refuse('R001', `unknown graph '${graphRef}'`, at, 'wilanis ls graph');
      return;
    }
    this.judge.visible(this.binding, graph, at);
    const graphIn = this.judge.quiet(graph.doc.in);
    const graphOut = this.judge.quiet(graph.doc.out?.type);
    if (contract.accepts) this.acceptsFitGraph(contract, graphRef, graphIn);
    this.graphAnswers(contract, graphRef, graphOut);
  }

  private acceptsFitGraph(contract: Contract, graphRef: string, graphIn: Type | undefined): void {
    const at = `${contract.at}/graph`;
    const names = Object.keys(contract.op.accepts ?? {});
    if (!graphIn) {
      if (names.length)
        this.refuse(
          'B005',
          `'${contract.opName}' accepts fields but graph '${graphRef}' takes nothing`,
          at,
          `declare in on graph '${graphRef}', or drop accepts from the operation`,
        );
      return;
    }
    if (graphIn.kind === 'object') {
      const bad = mismatch(contract.accepts, graphIn);
      if (bad)
        this.refuse(
          'B005',
          `'${contract.opName}' accepts → graph in: ${bad}`,
          at,
          "the operation's accepts must be assignable to the graph's in shape",
        );
      return;
    }
    if (names.length !== 1) {
      const message = `graph '${graphRef}' takes ${show(graphIn)} whole, so '${contract.opName}' must accept exactly one field; it accepts ${names.join(', ') || 'none'}`;
      this.refuse('B005', message, at, 'a graph whose in is not a shape receives the one field the operation accepts');
      return;
    }
    this.wholeFitsGraph(contract, graphRef, graphIn, names[0]);
  }

  /** The graph takes a value whole: the operation's one field is that value, so it must be given and fit. */
  private wholeFitsGraph(contract: Contract, graphRef: string, graphIn: Type, name: string): void {
    const at = `${contract.at}/graph`;
    const field = contract.accepts?.fields[name];
    if (!field) return;
    if (!field.required) {
      this.refuse(
        'B005',
        `'${contract.opName}' accepts '${name}' optionally but graph '${graphRef}' takes it whole, so it must be given`,
        at,
        `mark '${name}' required under accepts, or give graph '${graphRef}' a shape for its in`,
      );
    }
    const bad = assignable(field.type, graphIn);
    if (bad)
      this.refuse(
        'B005',
        `'${contract.opName}' accepts ${name}: ${show(field.type)} → graph in ${show(graphIn)}: ${bad}`,
        at,
        `make '${name}' and the in of graph '${graphRef}' one type`,
      );
  }

  private graphAnswers(contract: Contract, graphRef: string, graphOut: Type | undefined): void {
    const at = `${contract.at}/graph`;
    const { opName, returns } = contract;
    if (returns && !graphOut)
      this.refuse(
        'B005',
        `'${opName}' returns ${show(returns)} but graph '${graphRef}' answers nothing`,
        at,
        `declare out on graph '${graphRef}', or drop returns from the operation`,
      );
    const bad = mismatch(graphOut, returns);
    if (bad)
      this.refuse(
        'B005',
        `graph out → '${opName}' returns: ${bad}`,
        at,
        `make the out of graph '${graphRef}' and the returns of '${opName}' one type`,
      );
    if (!returns && graphOut)
      this.refuse(
        'B005',
        `graph '${graphRef}' answers ${show(graphOut)} but '${opName}' returns nothing`,
        at,
        `declare returns on '${opName}', or drop out from graph '${graphRef}'`,
      );
  }

  // ---- a delegation -------------------------------------------------------------------------------

  /** The feature allows the effect (L003), the inputs fit the target (G rules), and its answer fits the returns (B005). */
  private delegateMeets(contract: Contract, run: string, given: Values | undefined): void {
    const at = `${contract.at}/run`;
    const hit = this.judge.opAt(run, this.binding, at);
    if (!hit) return;
    const key = `${hit.path}#${hit.opName}`;
    if (hit.op.pure !== true && !this.effects.allowed.has(key)) {
      this.refuse(
        'L003',
        `'${contract.opName}' delegates to effectful '${key}' which the feature does not allow`,
        at,
        `add "${key}" to ${this.effects.at}`,
      );
    }
    let answers = this.judge.type(hit.op.returns, hit.port.path, 'returns');
    const passed = passedInputs(hit.op, contract.op, given);
    const subst = checkInputs(this.judge, {
      given: passed,
      accepts: hit.op.accepts,
      read: reader(this.judge, this.resolve(contract), this.binding.path),
      file: this.binding.path,
      at: `${contract.at}/in`,
      what: `'${run}'`,
      from: this.binding,
      layer: null,
    });
    if (answers && hasVars(answers)) answers = substitute(answers, subst);
    this.delegateAnswers(contract, run, answers);
  }

  /** What a delegation's values may read: the binding's resolvers, and the operation's own inputs. */
  private resolve(contract: Contract): Resolve {
    return (root, path) => {
      if (root in this.resolvers) return readAt(this.resolvers[root].read, path);
      if (root === 'in') return contract.accepts ? typeAt(contract.accepts, path) : 'this operation accepts nothing';
      return `'${root}' is not in or a resolver of this binding (resolvers: ${Object.keys(this.resolvers).join(', ') || 'none'})`;
    };
  }

  private delegateAnswers(contract: Contract, run: string, answers: Type | undefined): void {
    const { opName, returns } = contract;
    const at = `${contract.at}/run`;
    if (!returns) return;
    if (!answers) {
      this.refuse(
        'B005',
        `'${opName}' returns ${show(returns)} but '${run}' returns nothing`,
        at,
        `wilanis describe ${run} shows what it answers; drop returns, or delegate to an operation that answers`,
      );
      return;
    }
    const bad = assignable(answers, returns);
    if (bad) {
      const message = `'${run}' returns ${show(answers)} → '${opName}' returns ${show(returns)}: ${bad}`;
      this.refuse('B005', message, at, 'declare the answer type in in, or bind a data graph that shapes it');
    }
  }
}
