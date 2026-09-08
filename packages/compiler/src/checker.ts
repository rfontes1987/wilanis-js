/**
 * wilanis check. Judges the whole tree statically so that nothing refuses at load. Rule families:
 *   D documents   R references   L layers/effects/visibility   G graphs   P static fields/resolvers
 *   B bindings/profiles   T triggers   A access (policies, credentials)   C connections/settings   S scenarios
 *   X plugin-specific
 */
import type { LoadResult } from '@wilanis/core';
import {
  isMap, isRun, isSwitch, RefusalList, type BindingDoc, type Fields, type GraphDoc, type Loaded, type Node,
  type Operation, type PolicyDoc, type PortDoc, type ProjectDoc, type ResolversDoc, type ShapeDoc, type TriggerDoc, type TypeSpec, type ConnectionDoc, policyPath,
} from '@wilanis/core';
import { Scope, WHOLE_TEMPLATE, READ_PATH, splitPath, type OpHit } from '@wilanis/core';
import { assignable, conforms, EMPTY_OBJECT, hasVars, show, STRING, substitute, typeAt, TypeError_, type Read, type Type } from '@wilanis/core';
import { expr } from '@wilanis/core';
import { readPath } from '@wilanis/engine';

const RESERVED = new Set(['in', 'const', 'request', 'secrets']);

export function checkTree(load: LoadResult): RefusalList {
  const out = new RefusalList();
  load.refusals.items.forEach(r => out.add(r));
  if (!load.registry.project) return out;
  const scope = new Scope(load.registry, load.resolve);
  new Checker(scope, out).run();
  for (const p of load.plugins) {
    const settings = scope.project?.plugins.find(x => x.use === p.root)?.settings ?? {};
    p.check?.({ scope, settings, refuse: (code, file, message, at, hint) => out.add({ code, file, message, at, hint }) });
  }
  return out;
}

class Checker {
  constructor(private s: Scope, private out: RefusalList) {}

  private refuse(code: string, file: string, message: string, at?: string, hint?: string) { this.out.add({ code, file, message, at, hint }); }

  private type(spec: TypeSpec | undefined, file: string, at: string): Type | undefined {
    if (spec === undefined) return undefined;
    try { return this.s.types.spec(spec); }
    catch (e) { if (e instanceof TypeError_) { this.refuse('R001', file, e.message, at, 'wilanis ls shape'); return undefined; } throw e; }
  }
  private fieldsType(f: Fields | undefined, file: string, at: string): Type | undefined {
    try { return this.s.types.fields(f); }
    catch (e) { if (e instanceof TypeError_) { this.refuse('R001', file, e.message, at); return undefined; } throw e; }
  }
  private quiet(spec: TypeSpec | undefined): Type | undefined { try { return spec === undefined ? undefined : this.s.types.spec(spec); } catch { return undefined; } }

  run() {
    this.checkProject();
    for (const sh of this.s.registry.all('shape')) this.checkShape(sh);
    for (const p of this.s.registry.all('port')) this.checkPort(p);
    for (const c of this.s.registry.all('connection')) this.checkConnection(c);
    for (const r of this.s.registry.all('resolvers')) this.checkResolversDoc(r);
    for (const g of this.s.registry.all('graph')) this.checkGraph(g, this.s.roleOf(g.path));
    for (const b of this.s.registry.all('binding')) this.checkBinding(b);
    for (const p of this.s.registry.all('policy')) this.checkPolicy(p);
    for (const t of this.s.registry.all('trigger')) this.checkTrigger(t);
    for (const sc of this.s.registry.all('scenario')) if (!this.s.get('trigger', sc.doc.trigger)) this.refuse('S001', sc.path, `scenario names unknown trigger '${sc.doc.trigger}'`, 'trigger', 'wilanis ls trigger');
    this.checkStartup(); // last: it walks bindings and graphs, so every resolvers document must already be read
  }

  // ---- project ------------------------------------------------------------------------------------

  checkProject() {
    const p = this.s.registry.project!;
    const doc = p.doc;
    for (const [i, pl] of doc.plugins.entries()) {
      const manifest = this.s.registry.get('plugin', `${pl.use}/plugin.json`);
      if (!manifest) continue;
      const settingsType = manifest.doc.settings ? this.type(manifest.doc.settings, p.path, `plugins/${i}`) : EMPTY_OBJECT;
      const r = this.settingsRead(pl.settings ?? {}, p.path, `plugins/${i}/settings`, doc.secrets ?? {});
      if (settingsType && r) { const bad = assignable(r.type, settingsType); if (bad) this.refuse('C002', p.path, `plugin '${pl.use}' settings: ${bad}`, `plugins/${i}/settings`, `wilanis describe ${pl.use}/plugin.json`); }
    }
    for (const [name, prof] of Object.entries(doc.profiles ?? {})) {
      for (const [portRef, bindingRef] of Object.entries(prof.bindings)) {
        const port = this.s.get('port', portRef);
        if (!port) { this.refuse('R001', p.path, `profile '${name}' names unknown port '${portRef}'`, `profiles/${name}/bindings`); continue; }
        if (port.native) this.refuse('B003', p.path, `profile '${name}' binds native port '${portRef}' -- the plugin binds it`, `profiles/${name}/bindings`);
        const b = this.s.get('binding', bindingRef);
        if (!b) { this.refuse('R001', p.path, `profile '${name}' names unknown binding '${bindingRef}'`, `profiles/${name}/bindings`); continue; }
        if (this.s.canon(b.doc.port) !== port.path) this.refuse('B004', p.path, `profile '${name}': binding '${bindingRef}' implements '${b.doc.port}', not '${portRef}'`, `profiles/${name}/bindings`);
      }
    }
    const profiles = this.s.profiles().length ? this.s.profiles() : [undefined];
    for (const port of this.s.registry.all('port')) {
      if (port.native) continue;
      for (const prof of profiles) {
        const b = this.s.bindingFor(port.path, prof);
        if (typeof b === 'string') this.refuse('B002', prof ? p.path : port.path, prof ? `profile '${prof}': ${b}` : b, prof ? `profiles/${prof}/bindings` : undefined, 'wilanis new binding <feature>/<name> --port <path>');
      }
    }
  }

  /**
   * The project's startup steps: each fires a domain port operation once, before any trigger kind starts.
   * A step runs with nothing received, so it may neither fire a native operation nor reach a read of
   * request.*; its inputs must meet the operation's contract, written as literals and secrets.
   */
  private checkStartup() {
    const p = this.s.registry.project!;
    const doc: ProjectDoc = p.doc, file = p.path;
    const profiles = this.s.profiles().length ? this.s.profiles() : [undefined];
    for (const [i, step] of (doc.startup ?? []).entries()) {
      const at = `startup/${i}`;
      const o = this.s.op(step.run);
      if (typeof o === 'string') { this.refuse('B006', file, `startup step ${i}: ${o}`, `${at}/run`, 'wilanis ls port'); continue; }
      // a `holds` operation starts something that outlives the run -- a listener, a watcher. It is a plugin's
      // to implement and has no per-profile binding, so a startup step names it directly.
      if (o.port.native && !o.op.holds) { this.refuse('B006', file, `startup step ${i} fires native operation '${step.run}'`, `${at}/run`, "a startup step fires a domain port; the port's binding reaches the native operation"); continue; }
      const accepts = o.op.accepts ?? {};
      const takes = Object.keys(accepts).length ? this.quiet({ fields: accepts }) : undefined;
      const read = this.s.valueRead(step.in ?? {}, (root, path) => {
        if (root !== 'secrets') return `{{${[root, ...path].join('.')}}}: a startup step runs before anything is received; only {{secrets.<key>}} may appear`;
        if (path.length !== 1) return `{{secrets.${path.join('.')}}}: a secret is one key`;
        if (!(path[0] in (doc.secrets ?? {}))) return `secret '${path[0]}' is not declared in project.json secrets`;
        return { type: STRING, optional: false };
      });
      if (typeof read === 'string') { this.refuse('B007', file, `startup step ${i}: ${read}`, `${at}/in`, 'write the value, or declare the key under project.json → secrets'); continue; }
      if (takes && read) { const bad = assignable(read.type, takes); if (bad) this.refuse('B007', file, `startup step ${i} → ${step.run}: ${bad}`, `${at}/in`, `wilanis describe ${step.run.split('#')[0]}`); }
      if (!takes && Object.keys(step.in ?? {}).length) this.refuse('B007', file, `startup step ${i}: '${step.run}' takes no input`, `${at}/in`, 'remove in');
      // nothing has been received, so no read of request.* can be met
      for (const prof of profiles) {
        for (const need of this.opNeeds(step.run, prof)) {
          this.refuse('B008', file, `startup step ${i}: ${need.file} reads request.${need.path.join('.')}, but a startup step runs before anything is received${prof ? ` (profile '${prof}')` : ''}`, `${at}/run`, 'fire this operation from a trigger, or bind the port to a graph that reads no request');
        }
      }
    }
  }

  /** Type a settings block where only {{secrets.key}} may appear. */
  private settingsRead(value: unknown, file: string, at: string, secrets: Record<string, string>): Read | undefined {
    const r = this.s.valueRead(value, (root, path) => {
      if (root !== 'secrets') return `{{${[root, ...path].join('.')}}}: only {{secrets.<key>}} may appear in settings`;
      if (path.length !== 1) return `{{secrets.${path.join('.')}}}: a secret is one key`;
      if (!(path[0] in secrets)) return `secret '${path[0]}' is not declared in project.json secrets`;
      return { type: STRING, optional: false };
    });
    if (typeof r === 'string') { this.refuse('C001', file, r, at, 'declare the key under project.json → secrets'); return undefined; }
    return r ?? undefined;
  }

  // ---- shapes, ports, connections -----------------------------------------------------------------

  private *typeRefs(spec: TypeSpec, at: string): Generator<[string, string]> {
    if (typeof spec === 'string') { yield [spec, at]; return; }
    for (const [k, f] of Object.entries(spec.fields)) yield* this.typeRefs(f.type, `${at}/${k}`);
    if (typeof spec.open === 'string') yield [spec.open, `${at}/open`];
  }

  /** Layer discipline for a spec written in a non-native document. `layer` null: any shape layer is fine (the data layer translating edge to core). */
  private checkLayer(spec: TypeSpec, from: Loaded, at: string, layer: 'edge' | 'core' | null, what: string) {
    for (const [ref, where] of this.typeRefs(spec, at)) {
      const base = ref.replace(/(\[\])+$/, '');
      if (base.startsWith('$') || base === 'type') this.refuse('L001', from.path, `${what} uses '${base}' -- that belongs to native contracts only`, where);
      if (base === 'unknown' && layer === 'core') this.refuse('L001', from.path, `${what} declares unknown -- only edge shapes and native contracts may`, where, 'name the fields, or keep the value at the edge');
      if (base.startsWith('@')) {
        const target = this.s.get('shape', base);
        if (!target) continue; // R001 elsewhere
        const v = this.s.visibility(from, target); if (v) this.refuse('L005', from.path, v, where);
        if (layer && target.doc.layer !== layer) this.refuse('L001', from.path, `${what} names ${target.doc.layer} shape '${base}' from the ${layer} layer`, where, layer === 'core' ? 'core speaks core shapes; a trigger or binding translates edge to core' : 'edge shapes compose edge shapes only');
      }
    }
  }

  checkShape(sh: Loaded<ShapeDoc>) {
    const spec = { fields: sh.doc.fields, open: sh.doc.open };
    this.type(spec, sh.path, 'fields');
    this.checkLayer(spec, sh, 'fields', sh.doc.layer, `shape '${sh.path}'`);
  }

  checkPort(p: Loaded<PortDoc>) {
    for (const [name, op] of Object.entries(p.doc.operations)) {
      this.fieldsType(op.accepts, p.path, `operations/${name}/accepts`);
      this.type(op.returns, p.path, `operations/${name}/returns`);
      if (!p.native) {
        for (const [k, f] of Object.entries(op.accepts ?? {})) this.checkLayer(f.type, p, `operations/${name}/accepts/${k}`, 'core', `${name}.accepts.${k}`);
        if (op.returns) this.checkLayer(op.returns, p, `operations/${name}/returns`, 'core', `${name}.returns`);
        for (const [k, f] of Object.entries(op.accepts ?? {})) if (f.static) this.refuse('L006', p.path, `domain operation '${name}' marks '${k}' static -- static fields belong to native contracts; a binding fixes values`, `operations/${name}/accepts/${k}`, 'drop static, or fix the value in the binding');
      }
    }
  }

  checkConnection(c: Loaded<ConnectionDoc>) {
    const kind = this.s.get('connection-kind', c.doc.kind);
    if (!kind) { this.refuse('R001', c.path, `unknown connection kind '${c.doc.kind}'`, 'kind', 'wilanis ls connection-kind'); return; }
    const settingsType = this.type(kind.doc.settings, c.path, 'settings');
    const r = this.settingsRead(c.doc.settings, c.path, 'settings', this.s.project?.secrets ?? {});
    if (settingsType && r) { const bad = assignable(r.type, settingsType); if (bad) this.refuse('C002', c.path, `settings: ${bad}`, 'settings', `wilanis describe ${c.doc.kind}`); }
  }

  // ---- resolvers ----------------------------------------------------------------------------------

  /** A resolver: the segments it reads below `request`, and what every trigger kind that hands the path says its type is. */
  private resolverReads = new Map<string, Record<string, ResolverRead>>();

  /**
   * Judge a resolvers document once: every name is free, every read is a path some trigger kind hands.
   * A read no kind hands is refused here, at the document; whether the kinds that reach it hand it is T004.
   */
  checkResolversDoc(r: Loaded<ResolversDoc>) {
    const out: Record<string, ResolverRead> = {};
    for (const [name, spec] of Object.entries(r.doc.resolvers)) {
      const at = `resolvers/${name}`;
      if (RESERVED.has(name)) { this.refuse('P003', r.path, `resolver name '${name}' is reserved`, at, `in, const, request and secrets are roots; pick another name`); continue; }
      const path = splitPath(spec.read).slice(1);
      const read = this.s.requestRead(path);
      if (typeof read === 'string') { this.refuse('P002', r.path, `resolver '${name}': ${read}`, `${at}/read`, 'wilanis describe <trigger kind> shows what each kind hands as request.*'); continue; }
      // a resolver declared required is read as present; every trigger reaching it must then guarantee it (A006)
      out[name] = { path, read: spec.required ? { type: read.type, optional: false } : read, required: Boolean(spec.required) };
    }
    this.resolverReads.set(r.path, out);
  }

  /**
   * The resolvers a graph or binding may read, from the document it names. A domain graph names none: the
   * request is the world's, and the domain never sees it.
   */
  private resolversFor(ref: string | undefined, from: Loaded, allowed: boolean, at = 'resolvers'): Record<string, ResolverRead> {
    if (!ref) return {};
    if (!allowed) { this.refuse('L002', from.path, 'a domain graph never reads the request', at, 'read the request in the data layer: the data graph or the binding names the resolvers document'); return {}; }
    const doc = this.s.get('resolvers', ref);
    if (!doc) { this.refuse('R001', from.path, `unknown resolvers document '${ref}'`, at, 'wilanis ls resolvers'); return {}; }
    const v = this.s.visibility(from, doc); if (v) this.refuse('L005', from.path, v, at);
    return this.resolverReads.get(doc.path) ?? {};
  }

  /** The request.* paths a set of reads touches through the resolvers they name: what a trigger kind must hand. */
  private requestNeedsOf(resolvers: Record<string, ResolverRead>, reads: string[][], file: string): RequestNeed[] {
    const out: RequestNeed[] = [];
    for (const p of reads) { const r = resolvers[p[0]]; if (r) out.push({ path: [...r.path, ...p.slice(1)], file, required: r.required ? r.path : undefined }); }
    return out;
  }

  /** Resolve path#operation from a document, with visibility. */
  private opAt(opRef: string, from: Loaded, at: string): OpHit | undefined {
    const o = this.s.op(opRef);
    if (typeof o === 'string') { this.refuse('R001', from.path, o, at, 'wilanis ls port'); return undefined; }
    const v = this.s.visibility(from, o.port); if (v) this.refuse('L005', from.path, v, at);
    return o;
  }

  // ---- inputs: one grammar, judged against accepts -----------------------------------------------

  /**
   * Judge the values given where an operation is called against what it accepts. Fields of type `type`
   * and fields marked static must be literals: the checker reads them here, and binds the variables the
   * type fields name. Every other value is typed by `read` in the caller's context. `extra` are inputs
   * typed elsewhere (a map's bound element). Answers the bound variables.
   */
  checkInputs(given: Record<string, unknown>, accepts: Fields | undefined, read: (value: unknown, at: string) => Read | undefined, file: string, at: string, what: string, from: Loaded, layer: 'edge' | 'core' | null, extra: Record<string, Read> = {}): Record<string, Type> {
    const c = accepts ?? {};
    for (const k of new Set([...Object.keys(given), ...Object.keys(extra)])) if (!(k in c)) this.refuse('G006', file, `'${k}' is not an input of ${what} (inputs: ${Object.keys(c).join(', ') || 'none'})`, `${at}/${k}`, 'wilanis describe <port>');
    const subst: Record<string, Type> = {};
    // type fields first: the rest may be typed through the variables they bind
    for (const [k, f] of Object.entries(c)) {
      if (this.quiet(f.type)?.kind !== 'type') continue;
      if (!(k in given)) { if (f.required !== false) this.refuse('G005', file, `${what} requires '${k}'`, at); continue; }
      const v = given[k];
      if (typeof v !== 'string' || !this.s.literal(v)) { this.refuse('P001', file, `'${k}' is a type reference, written as a literal string`, `${at}/${k}`, 'e.g. "@features/tasks/domain/Task.shape.json[]"'); continue; }
      const t = this.type(v, file, `${at}/${k}`);
      if (!t) continue;
      this.checkLayer(v, from, `${at}/${k}`, layer, `'${k}'`);
      if (f.binds) subst[f.binds] = t;
    }
    for (const [k, f] of Object.entries(c)) {
      if (this.quiet(f.type)?.kind === 'type') continue;
      let r: Read | undefined;
      if (k in extra) r = extra[k];
      else if (k in given) {
        if (f.static && !this.s.literal(given[k])) { this.refuse('P001', file, `'${k}' is static: write the value, not a read`, `${at}/${k}`, 'a static field is judged before anything runs'); continue; }
        r = read(given[k], `${at}/${k}`);
      } else { if (f.required !== false) this.refuse('G005', file, `${what} requires input '${k}'`, at); continue; }
      if (!r) continue;
      let want = this.type(f.type, file, `${at}/${k}`); if (!want) continue;
      if (hasVars(want)) want = substitute(want, subst);
      if (r.optional && f.required !== false) { this.refuse('G004', file, `'${k}' may be missing at run time but ${what} requires it`, `${at}/${k}`, 'route around it with a switch on has(...), or make the contract field optional'); continue; }
      const bad = assignable(r.type, want);
      if (bad) this.refuse('G004', file, `'${k}': ${bad}`, `${at}/${k}`);
    }
    return subst;
  }

  /** The variables an operation's type fields bind at a call site, quietly. */
  private bindsOf(given: Record<string, unknown>, accepts: Fields | undefined): Record<string, Type> {
    const subst: Record<string, Type> = {};
    for (const [k, f] of Object.entries(accepts ?? {})) if (f.binds && f.type === 'type' && typeof given[k] === 'string') { const t = this.quiet(given[k] as string); if (t) subst[f.binds] = t; }
    return subst;
  }

  /** A `read` whose templates `resolve` types; a read that cannot be typed is G003. */
  private reader(resolve: (root: string, path: string[]) => Read | string | undefined, file: string): (value: unknown, at: string) => Read | undefined {
    return (value, at) => {
      const r = this.s.valueRead(value, resolve);
      if (typeof r === 'string') { this.refuse('G003', file, r, at); return undefined; }
      return r;
    };
  }

  // ---- bindings -----------------------------------------------------------------------------------

  checkBinding(b: Loaded<BindingDoc>) {
    const port = this.s.get('port', b.doc.port);
    if (!port) { this.refuse('R001', b.path, `binding implements unknown port '${b.doc.port}'`, 'port'); return; }
    if (port.native) { this.refuse('B003', b.path, `'${b.doc.port}' is a native port; the plugin binds it`, 'port'); return; }
    const vis = this.s.visibility(b, port); if (vis) this.refuse('L005', b.path, vis, 'port');
    if (!b.feature) this.refuse('L007', b.path, 'a binding lives inside a feature folder', undefined, 'move it under features/<name>/');
    const feature = b.feature ? this.s.registry.get('feature', `@features/${b.feature}/feature.json`)?.doc : undefined;
    const effects = new Set((feature?.effects ?? []).map(e => { const i = e.lastIndexOf('#'); return `${this.s.canon(e.slice(0, i))}${e.slice(i)}`; }));
    const effectsAt = `@features/${b.feature}/feature.json → effects`;
    const rreads = this.resolversFor(b.doc.resolvers, b, true);

    for (const opName of Object.keys(port.doc.operations)) if (!b.doc.operations[opName]) this.refuse('B001', b.path, `operation '${opName}' of '${port.path}' is not bound`, 'operations');
    for (const [opName, bop] of Object.entries(b.doc.operations)) {
      const op = port.doc.operations[opName];
      if (!op) { this.refuse('B001', b.path, `'${opName}' is not an operation of '${port.path}' (${Object.keys(port.doc.operations).join(', ')})`, `operations/${opName}`); continue; }
      const accepts = this.fieldsType(op.accepts, port.path, `operations/${opName}/accepts`);
      const returns = this.type(op.returns, port.path, `operations/${opName}/returns`);
      const at = `operations/${opName}`;
      if (bop.graph) {
        const g = this.s.get('graph', bop.graph);
        if (!g) { this.refuse('R001', b.path, `unknown graph '${bop.graph}'`, `${at}/graph`); continue; }
        const v = this.s.visibility(b, g); if (v) this.refuse('L005', b.path, v, `${at}/graph`);
        const gin = this.quiet(g.doc.in), gout = this.quiet(g.doc.out?.type);
        if (accepts) {
          const names = Object.keys(op.accepts ?? {});
          if (!gin) { if (names.length) this.refuse('B005', b.path, `'${opName}' accepts fields but graph '${bop.graph}' takes nothing`, `${at}/graph`); }
          else if (gin.kind === 'object') { const bad = assignable(accepts, gin); if (bad) this.refuse('B005', b.path, `'${opName}' accepts → graph in: ${bad}`, `${at}/graph`, "the operation's accepts must be assignable to the graph's in shape"); }
          else if (names.length !== 1) this.refuse('B005', b.path, `graph '${bop.graph}' takes ${show(gin)} whole, so '${opName}' must accept exactly one field; it accepts ${names.join(', ') || 'none'}`, `${at}/graph`, 'a graph whose in is not a shape receives the one field the operation accepts');
          else {
            // the graph takes a value whole: the operation's one field is that value
            const f = (accepts as Extract<Type, { kind: 'object' }>).fields[names[0]];
            if (!f.required) this.refuse('B005', b.path, `'${opName}' accepts '${names[0]}' optionally but graph '${bop.graph}' takes it whole, so it must be given`, `${at}/graph`);
            const bad = assignable(f.type, gin); if (bad) this.refuse('B005', b.path, `'${opName}' accepts ${names[0]}: ${show(f.type)} → graph in ${show(gin)}: ${bad}`, `${at}/graph`);
          }
        }
        if (returns && !gout) this.refuse('B005', b.path, `'${opName}' returns ${show(returns)} but graph '${bop.graph}' answers nothing`, `${at}/graph`);
        if (returns && gout) { const bad = assignable(gout, returns); if (bad) this.refuse('B005', b.path, `graph out → '${opName}' returns: ${bad}`, `${at}/graph`); }
        if (!returns && gout) this.refuse('B005', b.path, `graph '${bop.graph}' answers ${show(gout)} but '${opName}' returns nothing`, `${at}/graph`);
      } else if (bop.run) {
        const o = this.opAt(bop.run, b, `${at}/run`);
        if (!o) continue;
        if (o.op.pure !== true && !effects.has(`${o.path}#${o.opName}`)) this.refuse('L003', b.path, `'${opName}' delegates to effectful '${o.path}#${o.opName}' which the feature does not allow`, `${at}/run`, `add "${o.path}#${o.opName}" to ${effectsAt}`);
        let tReturns = this.type(o.op.returns, o.port.path, 'returns');
        const resolve = (root: string, path: string[]): Read | string => {
          if (root in rreads) return readAt(rreads[root].read, path);
          if (root === 'in') return accepts ? typeAt(accepts, path) : 'this operation accepts nothing';
          return `'${root}' is not in or a resolver of this binding (resolvers: ${Object.keys(rreads).join(', ') || 'none'})`;
        };
        // what the delegate gets: the statement's own values, and the caller's by name for the rest
        const given: Record<string, unknown> = { ...(bop.in ?? {}) };
        for (const k of Object.keys(o.op.accepts ?? {})) if (!(k in given) && op.accepts?.[k]) given[k] = `{{in.${k}}}`;
        const subst = this.checkInputs(given, o.op.accepts, this.reader(resolve, b.path), b.path, `${at}/in`, `'${bop.run}'`, b, null);
        if (tReturns && hasVars(tReturns)) tReturns = substitute(tReturns, subst);
        if (returns) {
          if (!tReturns) this.refuse('B005', b.path, `'${opName}' returns ${show(returns)} but '${bop.run}' returns nothing`, `${at}/run`);
          else { const bad = assignable(tReturns, returns); if (bad) this.refuse('B005', b.path, `'${bop.run}' returns ${show(tReturns)} → '${opName}' returns ${show(returns)}: ${bad}`, `${at}/run`, 'declare the answer type in in, or bind a data graph that shapes it'); }
        }
      }
    }
  }

  // ---- graphs -------------------------------------------------------------------------------------

  checkGraph(g: Loaded<GraphDoc>, role: 'domain' | 'data') {
    const doc = g.doc, file = g.path;
    const feature = g.feature ? this.s.registry.get('feature', `@features/${g.feature}/feature.json`)?.doc : undefined;
    const effects = new Set((feature?.effects ?? []).map(e => { const i = e.lastIndexOf('#'); return `${this.s.canon(e.slice(0, i))}${e.slice(i)}`; }));
    const effectsAt = `@features/${g.feature}/feature.json → effects`;
    const layer: 'core' | null = role === 'data' ? null : 'core';

    if (role === 'domain') this.checkNotPassThrough(g);

    const rreads = this.resolversFor(doc.resolvers, g, role === 'data');

    const inType = this.type(doc.in, file, 'in');
    if (doc.in) this.checkLayer(doc.in, g, 'in', layer, 'in');
    if (doc.out) this.checkLayer(doc.out.type, g, 'out/type', layer, 'out');
    const outType = this.type(doc.out?.type, file, 'out/type');
    const constTypes: Record<string, Type> = {};
    for (const [k, c] of Object.entries(doc.constants ?? {})) {
      const t = this.type(c.type, file, `constants/${k}/type`);
      if (!t) continue;
      const bad = conforms(c.value, t);
      if (bad) this.refuse('G013', file, `constant '${k}' does not conform to ${show(t)}: ${bad}`, `constants/${k}/value`);
      constTypes[k] = t.kind === 'string' && typeof c.value === 'string' ? { kind: 'string', enum: [c.value] } : t;
    }

    // node table
    const nodes = new Map<string, Node>();
    const ops = new Map<string, OpHit>();
    for (const n of doc.nodes) {
      if (RESERVED.has(n.id)) this.refuse('G001', file, `node id '${n.id}' is reserved`, `nodes/${n.id}`);
      if (nodes.has(n.id)) { this.refuse('G001', file, `duplicate node id '${n.id}'`, `nodes/${n.id}`); continue; }
      nodes.set(n.id, n);
      if (isSwitch(n)) continue;
      const o = this.opAt(n.run, g, `nodes/${n.id}/run`);
      if (!o) continue;
      ops.set(n.id, o);
      if (role === 'domain' && o.port.native && o.op.pure !== true) this.refuse('L002', file, `domain graph runs effectful native operation '${n.run}'`, `nodes/${n.id}`, 'reach the effect through a domain port whose binding runs it');
      if (role === 'data' && !o.port.native) this.refuse('L002', file, `data graph runs domain operation '${n.run}'`, `nodes/${n.id}`, 'a data graph implements a domain port; it speaks native ports only');
      if (role === 'data' && o.port.native && o.op.pure !== true && !effects.has(`${o.path}#${o.opName}`)) this.refuse('L003', file, `node '${n.id}' runs effectful '${o.path}#${o.opName}' which the feature does not allow`, `nodes/${n.id}`, `add "${o.path}#${o.opName}" to ${effectsAt}`);
      // what a `holds` operation starts outlives the run, so a request must never start one
      if (o.op.holds) this.refuse('L008', file, `node '${n.id}' runs '${n.run}', which starts something that outlives the run`, `nodes/${n.id}`, 'name it in project.json → startup, where what a tree starts is declared');
    }

    // reads and node output types (lazy: a node's output type may depend on its type fields)
    const readsIn = new Set<string>(), readsConst = new Set<string>(), readNodes = new Set<string>();
    const outTypes = new Map<string, Type | undefined>();
    const computing = new Set<string>();
    // first pass, syntactic: what each node reads, and what a routing switch proves present for the node it routes to
    const deps = new Map<string, Set<string>>();
    const present = new Map<string, Set<string>>();
    for (const n of nodes.values()) {
      const d = new Set<string>();
      for (const p of this.s.templateReads(isMap(n) ? [n.in ?? {}, n.over] : n.in ?? {})) if (nodes.has(p[0])) d.add(p[0]);
      deps.set(n.id, d);
      if (!isSwitch(n)) continue;
      for (const rule of n.rules) {
        let parsed: expr.Expr;
        try { parsed = expr.parse(rule.when); } catch { continue; } // refused below, where the rule is judged
        // has(x) on a read input proves that path present for the node the rule routes to
        const proved = new Set<string>();
        const walk = (e: expr.Expr) => {
          if (e.t === 'bin' && e.op === '&&') { walk(e.l); walk(e.r); }
          else if (e.t === 'has') { const v = n.in[e.p[0]]; const whole = typeof v === 'string' ? WHOLE_TEMPLATE.exec(v) : null; if (whole) proved.add([whole[1], ...e.p.slice(1)].join('.')); }
        };
        walk(parsed);
        if (proved.size) present.set(rule.to, new Set([...(present.get(rule.to) ?? []), ...proved]));
      }
    }
    /** What a node may take as present: what routed it, and what routed anything it reads -- a node downstream of a routed one runs only after it did. */
    const provedFor = (id: string, seen = new Set<string>()): Set<string> => {
      if (seen.has(id)) return new Set(); seen.add(id);
      const out = new Set(present.get(id) ?? []);
      for (const d of deps.get(id) ?? []) for (const p of provedFor(d, seen)) out.add(p);
      return out;
    };
    let reading: string | undefined;
    const narrowed = (src: string) => Boolean(reading && [...provedFor(reading)].some(p => src === p || src.startsWith(p + '.')));

    const nodeOut = (id: string): Type | undefined => {
      if (outTypes.has(id)) return outTypes.get(id);
      const n = nodes.get(id)!;
      if (isSwitch(n)) { outTypes.set(id, STRING); return STRING; }
      const o = ops.get(id);
      if (!o) { outTypes.set(id, undefined); return undefined; }
      if (computing.has(id)) return undefined;
      computing.add(id);
      let ret = this.quiet(o.op.returns) ?? EMPTY_OBJECT;
      if (hasVars(ret)) ret = substitute(ret, this.bindsOf(n.in ?? {}, o.op.accepts));
      computing.delete(id);
      const t: Type = isMap(n) ? { kind: 'list', of: ret } : ret;
      outTypes.set(id, t);
      return t;
    };

    /** Type one root a value reads: the input, a constant, a resolver, or a node. A path the routing switch proved present loses its optionality wherever the node reads it, inside an object or a list as much as alone. */
    const rootRead = (root: string, path: string[]): Read | string | undefined => {
      const r = rootReadRaw(root, path);
      if (r && typeof r === 'object' && r.optional && narrowed([root, ...path].join('.'))) return { type: r.type, optional: false };
      return r;
    };
    const rootReadRaw = (root: string, path: string[]): Read | string | undefined => {
      if (root === 'in') {
        if (!inType) return `reads in.${path.join('.')} but the graph declares no in`;
        readsIn.add(path[0] ?? '*');
        return typeAt(inType, path);
      }
      if (root === 'const') {
        if (!path.length || !constTypes[path[0]]) return `unknown constant 'const.${path.join('.')}' (constants: ${Object.keys(constTypes).join(', ') || 'none'})`;
        readsConst.add(path[0]);
        return typeAt(constTypes[path[0]], path.slice(1));
      }
      if (root === 'request') return `graphs do not read request.* -- a resolvers document does; name it in resolvers and read {{name}}`;
      if (root in rreads) return readAt(rreads[root].read, path);
      if (!nodes.has(root)) return `unknown node '${root}' (nodes: ${[...nodes.keys()].join(', ')})`;
      readNodes.add(root);
      const base = nodeOut(root);
      if (!base) return undefined; // its operation was refused already
      return typeAt(base, path);
    };
    /** Type one value; a whole template the routing switch proved present loses its optionality. */
    const valueRead = (value: unknown, at: string): Read | undefined => {
      const r = this.s.valueRead(value, rootRead);
      if (typeof r === 'string') { this.refuse('G003', file, r, at); return undefined; }
      if (!r) return undefined;
      if (r.optional && typeof value === 'string') { const whole = WHOLE_TEMPLATE.exec(value); if (whole && narrowed(whole[1])) return { type: r.type, optional: false }; }
      return r;
    };
    /** valueRead with the narrowing of node `id` in force. */
    const readFor = (id: string) => (value: unknown, at: string): Read | undefined => { const prev = reading; reading = id; try { return valueRead(value, at); } finally { reading = prev; } };

    const routedBy = new Map<string, string>();
    for (const n of nodes.values()) {
      const at = `nodes/${n.id}`;
      const read = readFor(n.id);

      if (isSwitch(n)) {
        const inputs: Record<string, Read> = {};
        for (const [k, v] of Object.entries(n.in)) { const r = read(v, `${at}/in/${k}`); if (r) inputs[k] = r; }
        for (const [i, rule] of n.rules.entries()) {
          try {
            const t = expr.check(expr.parse(rule.when), inputs);
            if (t.kind !== 'boolean') this.refuse('G011', file, `rule ${i}: '${rule.when}' is ${show(t)}, not boolean`, `${at}/rules/${i}/when`);
          } catch (e) { this.refuse('G011', file, `rule ${i}: ${(e as Error).message}`, `${at}/rules/${i}/when`); }
        }
        for (const target of [...n.rules.map(r => r.to), n.else]) {
          if (!nodes.has(target)) { this.refuse('G009', file, `routes to unknown node '${target}'`, at); continue; }
          if (target === n.id) this.refuse('G009', file, 'switch routes to itself', at);
          const prev = routedBy.get(target);
          if (prev && prev !== n.id) this.refuse('G009', file, `node '${target}' is routed by both '${prev}' and '${n.id}'`, at, 'a node has one router');
          routedBy.set(target, n.id);
        }
        continue;
      }
      const o = ops.get(n.id);
      if (!o) continue;
      // a map's element arrives as `item`, or through bind: inputs typed from the list, not given in in
      const extra: Record<string, Read> = {};
      if (isMap(n)) {
        const over = read(n.over, `${at}/over`);
        if (over) {
          if (over.type.kind !== 'list') this.refuse('G012', file, `over is ${show(over.type)}, not a list`, `${at}/over`);
          else if (over.optional) this.refuse('G004', file, `over may be missing at run time`, `${at}/over`);
          else if (n.bind) {
            for (const [k, p] of Object.entries(n.bind)) {
              const r = typeAt(over.type.of, p ? p.split('.') : []);
              if (typeof r === 'string') { this.refuse('G012', file, `bind.${k}: ${r}`, `${at}/bind/${k}`); continue; }
              if (k in (n.in ?? {})) this.refuse('G006', file, `'${k}' is both bound and given in in`, `${at}/bind/${k}`);
              extra[k] = r;
            }
          } else {
            if ('item' in (n.in ?? {})) this.refuse('G006', file, `'item' is the element; do not give it in in`, `${at}/in/item`);
            extra.item = { type: over.type.of, optional: false };
          }
        }
      }
      this.checkInputs(n.in ?? {}, o.op.accepts, read, file, `${at}/in`, `'${n.run}'`, g, layer, extra);
      nodeOut(n.id);
    }

    // cycles (data deps + routing deps)
    for (const [t, sw] of routedBy) deps.get(t)?.add(sw);
    const state = new Map<string, 0 | 1 | 2>();
    const visit = (id: string, stack: string[]): void => {
      const s = state.get(id) ?? 0;
      if (s === 2) return;
      if (s === 1) { this.refuse('G007', file, `cycle: ${[...stack.slice(stack.indexOf(id)), id].join(' → ')}`, `nodes/${id}`); return; }
      state.set(id, 1);
      for (const d of deps.get(id) ?? []) visit(d, [...stack, id]);
      state.set(id, 2);
    };
    for (const id of nodes.keys()) visit(id, []);

    // output
    const candidates = doc.out ? (Array.isArray(doc.out.from) ? doc.out.from : [doc.out.from]) : [];
    for (const c of candidates) {
      const n = nodes.get(c);
      if (!n) { this.refuse('G010', file, `out.from names unknown node '${c}'`, 'out/from'); continue; }
      if (isSwitch(n)) { this.refuse('G010', file, `out.from names switch '${c}' -- a switch routes, it produces nothing`, 'out/from', 'name the node it routes to'); continue; }
      readNodes.add(c);
      const t = nodeOut(c);
      if (t && outType) { const bad = assignable(t, outType); if (bad) this.refuse('G010', file, `'${c}' answers ${show(t)} but out is ${show(outType)}: ${bad}`, 'out/from'); }
    }
    if (candidates.length > 1) {
      const routed = (id: string, seen = new Set<string>()): boolean => { if (seen.has(id)) return false; seen.add(id); return routedBy.has(id) || [...(deps.get(id) ?? [])].some(d => routed(d, seen)); };
      for (const c of candidates) if (nodes.has(c) && !routed(c)) this.refuse('G010', file, `out.from candidate '${c}' is never routed -- it always settles, so later candidates are dead`, 'out/from', 'candidates are alternatives; each one sits behind a switch');
    }
    if (doc.out && candidates.length === 0) this.refuse('G010', file, 'out declares a type but names no node', 'out/from');
    // unused
    if (inType?.kind === 'object' && !readsIn.has('*')) for (const k of Object.keys(inType.fields)) if (!readsIn.has(k)) this.refuse('G008', file, `in.${k} is read by no edge`, 'in', 'wire it, or remove it from the in shape');
    for (const k of Object.keys(constTypes)) if (!readsConst.has(k)) this.refuse('G008', file, `constant '${k}' is read by no edge`, `constants/${k}`);
    for (const n of nodes.values()) if (!isSwitch(n) && !readNodes.has(n.id)) this.refuse('G008', file, `node '${n.id}' is read by nothing`, `nodes/${n.id}`, 'wire its result into another node, or name it in out.from');
  }

  // ---- triggers -----------------------------------------------------------------------------------

  checkTrigger(t: Loaded<TriggerDoc>) {
    const doc = t.doc, file = t.path;
    const kind = this.s.get('trigger-kind', doc.kind);
    if (!kind) { this.refuse('R001', file, `unknown trigger kind '${doc.kind}'`, 'kind', 'wilanis ls trigger-kind'); return; }
    const settingsType = this.type(kind.doc.settings, file, 'settings');
    const r = this.settingsRead(doc.settings, file, 'settings', this.s.project?.secrets ?? {});
    if (settingsType && r) { const bad = assignable(r.type, settingsType); if (bad) this.refuse('T001', file, `settings: ${bad}`, 'settings', `wilanis describe ${doc.kind}`); }
    for (const [k, f] of Object.entries(kind.doc.settings.fields)) {
      const v = doc.settings[k];
      if (this.quiet(f.type)?.kind === 'type' && v !== undefined) {
        if (typeof v !== 'string') { this.refuse('T001', file, `settings.${k} is a type reference, written as a string`, `settings/${k}`); continue; }
        if (this.type(v, file, `settings/${k}`)) this.checkLayer(v, t, `settings/${k}`, 'edge', `settings.${k}`);
      }
    }
    if (doc.in) this.checkLayer(doc.in, t, 'in', 'edge', 'in');
    if (doc.out) this.checkLayer(doc.out, t, 'out', 'edge', 'out');
    const o = this.s.op(doc.fire.run);
    if (typeof o === 'string') { this.refuse('R001', file, o, 'fire/run', 'wilanis ls port'); return; }
    if (o.port.native) { this.refuse('L006', file, `trigger fires native operation '${doc.fire.run}'`, 'fire/run', 'a trigger fires a domain port; the port\'s binding reaches the native operation'); return; }
    const v = this.s.visibility(t, o.port); if (v) this.refuse('L005', file, v, 'fire/run');
    const tin = this.type(doc.in, file, 'in'), tout = this.type(doc.out, file, 'out');
    const ctx = this.s.contextType(kind.doc, doc.settings);
    if (doc.fire.in !== undefined) {
      if (!tin) this.refuse('T003', file, 'fire.in is given but the trigger declares no in', 'fire/in');
      else {
        const read = this.s.valueRead(doc.fire.in, (root, path) => root === 'request' ? typeAt(ctx, path) : `'${root}': a trigger's input reads request.* only`);
        // a read that may be missing (a query key, a flag, a header) may feed a required field: the edge judges the input
        // when it arrives, and a request without it is refused there (a 400, a usage error), never run
        if (typeof read === 'string') this.refuse('T003', file, `fire.in: ${read}`, 'fire/in', `wilanis describe ${doc.kind} shows what this kind hands`);
        else if (read) { const bad = assignableWire(read.type, tin); if (bad) this.refuse('T003', file, `fire.in → in: ${bad}`, 'fire/in'); }
      }
    }
    const accepts = o.op.accepts ?? {};
    const gin = Object.keys(accepts).length ? this.quiet({ fields: accepts }) : undefined;
    const gout = this.quiet(o.op.returns);
    if (gin && !tin) this.refuse('T002', file, `'${doc.fire.run}' takes ${show(gin)} but the trigger declares no in`, 'in');
    if (tin && gin) { const bad = assignable(tin, gin); if (bad) this.refuse('T002', file, `in → ${doc.fire.run}: ${bad}`, 'in', "the edge shape must be assignable to the operation's core contract, field for field"); }
    if (gout && !tout) this.refuse('T002', file, `'${doc.fire.run}' answers ${show(gout)} but the trigger declares no out`, 'out');
    if (tout && !gout) this.refuse('T002', file, `trigger declares out but '${doc.fire.run}' returns nothing`, 'out');
    if (tout && gout) { const bad = assignable(gout, tout); if (bad) this.refuse('T002', file, `${doc.fire.run} → out: ${bad}`, 'out'); }
    // request reachability: every request.* a resolver reads under this trigger must be in the kind's context
    const profiles = this.s.profiles().length ? this.s.profiles() : [undefined];
    const decides = (doc.policies ?? []).map(ref => this.s.get('policy', policyPath(ref))).filter((p): p is Loaded<PolicyDoc> => Boolean(p)).map(p => p.doc.decide.run);
    const proven = (doc.policies ?? []).flatMap(ref => this.s.get('policy', policyPath(ref))?.doc.proves ?? []).map(p => splitPath(p).slice(1).join('.'));
    for (const prof of profiles) {
      for (const run of [doc.fire.run, ...decides]) for (const need of this.opNeeds(run, prof)) {
        const rr = typeAt(ctx, need.path);
        if (typeof rr === 'string') { this.refuse('T004', file, `${need.file} reads request.${need.path.join('.')} but trigger kind '${doc.kind}' hands no such value${prof ? ` (profile '${prof}')` : ''}`, 'kind', 'fire this operation from a kind that hands it, or bind the port differently under a profile'); continue; }
        // a resolver declared required is read as present: this trigger's kind must hand it always, or a policy of this trigger must prove it
        if (need.required) {
          const own = typeAt(ctx, need.required);
          const guaranteed = (typeof own === 'object' && !own.optional) || proven.some(p => { const q = need.required!.join('.'); return q === p || q.startsWith(p + '.'); });
          if (!guaranteed) this.refuse('A006', file, `${need.file} reads request.${need.required.join('.')} as required, but trigger kind '${doc.kind}' hands it only sometimes and no policy of this trigger proves it${prof ? ` (profile '${prof}')` : ''}`, 'policies', `gate this trigger with a policy whose proves lists "request.${need.required.join('.')}", or drop required from the resolver and route around its absence`);
        }
      }
    }
    this.checkAccess(t, ctx);
    // refusals: the graph says why it refused, in one word; the kind says how that word is answered. Each
    // reason this trigger can reach -- through what it fires, what gates it, and the guard that identifies
    // its caller -- must be mapped, and nothing may be mapped that it cannot reach.
    if (kind.doc.refusals) {
      const at = kind.doc.refusals, atPath = `settings/${at.replace(/\./g, '/')}`;
      const table = readPath(doc.settings, at.split('.'));
      const mapped = table && typeof table === 'object' && !Array.isArray(table) ? (table as Record<string, unknown>) : {};
      const reachable = new Map<string, string>();
      for (const prof of profiles) for (const r of refusalsOfTrigger(this.s, doc, prof)) if (!reachable.has(r.reason)) reachable.set(r.reason, r.file);
      for (const [reason, from] of reachable) if (mapped[reason] === undefined) this.refuse('T005', file, `${from} may refuse with reason '${reason}', which settings.${at} does not map`, atPath, `add "${reason}" under settings.${at}: how this trigger answers that outcome`);
      for (const reason of Object.keys(mapped)) if (!reachable.has(reason)) this.refuse('T006', file, `settings.${at} maps reason '${reason}', but nothing this trigger fires, gates on or identifies with refuses with it`, `${atPath}/${reason}`, 'remove it, or spell the reason the way the graph does');
    }
  }

  // ---- access: policies and the credentials they are given ------------------------------------------

  /**
   * A policy on its own: it decides through a domain port operation, reads the request only, and says what
   * every reason its decision can refuse with means. What its reads are worth under a kind is judged where
   * a trigger attaches it (A001), since the context differs per kind.
   */
  checkPolicy(p: Loaded<PolicyDoc>) {
    const doc = p.doc, file = p.path;
    const o = this.s.op(doc.decide.run);
    if (typeof o === 'string') { this.refuse('R001', file, o, 'decide/run', 'wilanis ls port'); return; }
    if (o.port.native) { this.refuse('L006', file, `policy decides through native operation '${doc.decide.run}'`, 'decide/run', 'a policy decides through a domain port; the port\'s binding reaches the native operation'); return; }
    const v = this.s.visibility(p, o.port); if (v) this.refuse('L005', file, v, 'decide/run');
    for (const read of this.s.templateReads(doc.decide.in)) if (read[0] !== 'request') this.refuse('A001', file, `decide.in reads '${read[0]}', but a policy's input reads request.* only`, 'decide/in', 'read what the kind and the guard hand: request.principal, request.session, request.challenge, request.headers...');
    // what the policy proves present once it allows: request.* paths the guard or a kind hands; a resolver declared required leans on it (A006)
    for (const [i, p] of (doc.proves ?? []).entries()) {
      const segs = READ_PATH.test(p) ? splitPath(p) : [];
      if (segs[0] !== 'request' || segs.length < 2) { this.refuse('A001', file, `proves names '${p}', which is not a request.* path`, `proves/${i}`, 'write request.principal, request.session...'); continue; }
      const r = this.s.requestRead(segs.slice(1));
      if (typeof r === 'string') this.refuse('A001', file, `proves names request.${segs.slice(1).join('.')}: ${r}`, `proves/${i}`, 'wilanis describe the guarding plugin shows what it hands');
    }
    const gin = Object.keys(o.op.accepts ?? {}).length ? this.quiet({ fields: o.op.accepts! }) : undefined;
    if (doc.decide.in !== undefined && !gin) this.refuse('A001', file, `decide.in is given but '${doc.decide.run}' takes no input`, 'decide/in', 'remove in');
    if (gin && doc.decide.in === undefined) this.refuse('A001', file, `'${doc.decide.run}' takes ${show(gin)} but decide gives nothing`, 'decide', 'write in: what the decision reads from the request');
    // outcomes: each reason the decision can reach means something here, and nothing here is out of reach
    const profiles = this.s.profiles().length ? this.s.profiles() : [undefined];
    const reachable = new Map<string, string>();
    for (const prof of profiles) for (const r of refusalsReachable(this.s, doc.decide.run, prof)) if (!reachable.has(r.reason)) reachable.set(r.reason, r.file);
    for (const [reason, from] of reachable) if (!doc.outcomes[reason]) this.refuse('A002', file, `${from} may refuse with reason '${reason}', which outcomes does not map`, 'outcomes', `add "${reason}": { "effect": "deny" } or { "effect": "challenge", "method": "..." }`);
    for (const [reason, out] of Object.entries(doc.outcomes)) {
      if (!reachable.has(reason)) this.refuse('A003', file, `outcomes maps reason '${reason}', but nothing '${doc.decide.run}' reaches refuses with it`, `outcomes/${reason}`, 'remove it, or spell the reason the way the graph does');
      if (out.effect === 'challenge' && !out.method) this.refuse('A002', file, `outcome '${reason}' challenges but names no method`, `outcomes/${reason}`, 'name the method the guard opens: "method": "otp"');
      if (out.effect === 'deny' && out.method) this.refuse('A002', file, `outcome '${reason}' denies, so a method means nothing`, `outcomes/${reason}/method`, 'remove method, or make the effect a challenge');
    }
  }

  /**
   * What gates a trigger, under its own kind. Each attachment's `in` gives the guard a credential it declares, read
   * where this kind hands something and of the type the guard asks (A004); each policy's input types under this kind's
   * context and fits the decision's contract, an optional read feeding an optional input (A001); a policy that reads
   * what the guard hands leans on a credential yielding it, which some attachment of this trigger must give (A005); a
   * credential no policy of the trigger reads is refused too (A004), since nothing would ever decide on it.
   */
  private checkAccess(t: Loaded<TriggerDoc>, ctx: Type) {
    const doc = t.doc, file = t.path;
    const guard = this.s.guard();
    const creds = guard?.doc.guard?.credentials ?? {};
    const handed = new Set(Object.keys(guard?.doc.guard?.context.fields ?? {}));
    const uses = doc.policies ?? [];
    const given = new Set<string>();
    for (const [i, use] of uses.entries()) {
      if (typeof use === 'string') continue;
      for (const [name, value] of Object.entries(use.in ?? {})) {
        const at = `policies/${i}/in/${name}`;
        const cred = creds[name];
        if (!cred) {
          if (guard) this.refuse('A004', file, `'${name}' is not a credential the guard verifies (it verifies ${Object.keys(creds).join(', ') || 'none'})`, at, `wilanis describe ${guard.path}`);
          else this.refuse('A004', file, `'${name}' is given as a credential, but no plugin of this project identifies callers`, at, 'add a guarding plugin to project.json → plugins, such as @wilanis/plugin-auth');
          continue;
        }
        const want = this.quiet(cred.type);
        // a list is the places the credential may sit, the first present wins: each place is judged on its own
        for (const alt of Array.isArray(value) ? value : [value]) {
          const read = this.s.valueRead(alt, (root, path) => root === 'request' ? typeAt(ctx, path) : `'${root}': a credential is read from the request`);
          if (typeof read === 'string') { this.refuse('A004', file, `credential '${name}': ${read}`, at, `wilanis describe ${doc.kind} shows what this kind hands`); continue; }
          if (read && want) { const bad = assignableWire(read.type, want); if (bad) this.refuse('A004', file, `credential '${name}' → ${show(want)}: ${bad}`, at, `wilanis describe ${guard!.path} shows what the guard takes`); }
        }
        given.add(name);
      }
    }
    const yielded = new Set([...given].flatMap(n => creds[n]?.yields ?? []));
    const needed = new Set<string>();
    for (const [i, use] of uses.entries()) {
      const ref = policyPath(use);
      const p = this.s.get('policy', ref);
      if (!p) { this.refuse('R001', file, `unknown policy '${ref}'`, `policies/${i}`, 'wilanis ls policy'); continue; }
      const v = this.s.visibility(t, p); if (v) this.refuse('L005', file, v, `policies/${i}`);
      const o = this.s.op(p.doc.decide.run);
      if (typeof o === 'string' || o.port.native) continue; // refused at the policy
      for (const r of this.s.templateReads(p.doc.decide.in)) {
        if (r[0] !== 'request') continue;
        if (!guard) { if (typeof typeAt(ctx, r.slice(1)) === 'string') this.refuse('A005', file, `policy '${p.path}' reads request.${r[1]}, which no trigger kind hands and no plugin of this project identifies callers to supply`, `policies/${i}`, 'add a guarding plugin to project.json → plugins, such as @wilanis/plugin-auth'); continue; }
        if (!handed.has(r[1])) continue;
        needed.add(r[1]);
        if (yielded.has(r[1])) continue;
        const from = Object.entries(creds).filter(([, c]) => c.yields.includes(r[1])).map(([n]) => n);
        this.refuse('A005', file, `policy '${p.path}' reads request.${r[1]}, which the guard hands once it verified ${from.length ? `a ${from.join(' or a ')}` : 'nothing it verifies'}, but no attachment on this trigger gives one`, `policies/${i}`, from.length ? `write { "policy": "${ref}", "in": { "${from[0]}": "{{request.headers.authorization}}" } } -- the read is where this kind hands the credential` : 'a policy reads only what the guard hands');
      }
      const gin = Object.keys(o.op.accepts ?? {}).length ? this.quiet({ fields: o.op.accepts! }) : undefined;
      if (!gin || p.doc.decide.in === undefined) continue;
      const read = this.s.valueRead(p.doc.decide.in, (root, path) => root === 'request' ? typeAt(ctx, path) : `'${root}': a policy's input reads request.* only`);
      if (typeof read === 'string') { this.refuse('A001', file, `policy '${p.path}' under kind '${doc.kind}': ${read}`, `policies/${i}`, `wilanis describe ${doc.kind} shows what this kind hands`); continue; }
      if (!read) continue;
      const bad = assignable(read.type, gin);
      if (bad) this.refuse('A001', file, `policy '${p.path}' under kind '${doc.kind}': decide.in → ${p.doc.decide.run}: ${bad}`, `policies/${i}`, 'a read that may be missing (an anonymous caller) feeds an input the operation declares required: false, and the graph decides on has(...)');
    }
    for (const name of given) if (!(creds[name]?.yields ?? []).some(y => needed.has(y))) this.refuse('A004', file, `credential '${name}' is given, but no policy of this trigger reads what it yields (request.${(creds[name]?.yields ?? []).join(', request.')})`, 'policies', 'drop it, or attach a policy that decides on it');
  }

  /**
   * A domain graph earns its place by doing something the port call alone cannot: composing more than one
   * node, routing, mapping, or supplying a value the caller never gave. One node that forwards its input to
   * one port operation is boilerplate between the trigger and the binding -- the trigger fires the port.
   */
  private checkNotPassThrough(g: Loaded<GraphDoc>) {
    const doc = g.doc;
    if (doc.nodes.length !== 1) return;
    const n = doc.nodes[0];
    if (!isRun(n)) return;
    if (Object.keys(doc.constants ?? {}).length || doc.resolvers) return;
    const o = this.s.op(n.run);
    if (typeof o === 'string' || o.port.native) return;
    // every input forwarded one-for-one from the graph's own in, and nothing added
    const given = Object.entries(n.in ?? {});
    if (!given.every(([k, v]) => v === `{{in.${k}}}`)) return;
    this.refuse('L007', g.path, `graph only forwards its input to '${n.run}'`, undefined,
      `it adds no rule of its own; fire ${n.run} from the trigger and delete this graph`);
  }

  /** Every request.* path reachable from a domain port operation: through the binding that meets it. */
  private opNeeds(opRef: string, profile: string | undefined, seen = new Set<string>()): RequestNeed[] {
    const o = this.s.op(opRef);
    if (typeof o === 'string' || o.port.native) return [];
    const b = this.s.bindingFor(o.path, profile);
    if (typeof b === 'string') return [];
    const bop = b.doc.operations[o.opName];
    if (!bop) return [];
    if (bop.graph) return this.requestNeeds(this.s.canon(bop.graph), profile, seen);
    return this.requestNeedsOf(this.quietResolvers(b.doc.resolvers), this.s.templateReads(bop.in), b.path);
  }

  /** The resolvers a document names, without refusing anything: the refusals were made where the document was judged. */
  private quietResolvers(ref: string | undefined): Record<string, ResolverRead> {
    const doc = ref ? this.s.get('resolvers', ref) : undefined;
    return doc ? this.resolverReads.get(doc.path) ?? {} : {};
  }

  /** Every request.* path read under a graph: its own reads through its resolvers, and per node the one binding operation it reaches. */
  private requestNeeds(graphPath: string, profile: string | undefined, seen = new Set<string>()): RequestNeed[] {
    if (seen.has(graphPath)) return []; seen.add(graphPath);
    const g = this.s.registry.get('graph', graphPath); if (!g) return [];
    const reads = g.doc.nodes.flatMap(n => this.s.templateReads(isSwitch(n) ? n.in : isMap(n) ? [n.in ?? {}, n.over] : n.in ?? {}));
    const out = this.requestNeedsOf(this.quietResolvers(g.doc.resolvers), reads, g.path);
    for (const n of g.doc.nodes) {
      if (isSwitch(n)) continue;
      const o = this.s.op(n.run);
      if (typeof o === 'string' || o.port.native) continue;
      out.push(...this.opNeeds(n.run, profile, seen));
    }
    return out;
  }
}

/** One refusal a port operation can end in: the literal reason, the graph (or binding) that calls refuse, and the node (or binding operation) that does. */
export interface ReachableRefusal { reason: string; file: string; node: string }

/**
 * Every reason a run of `opRef` can refuse with under a profile: the walk goes through the binding that meets
 * the operation, into the graph it runs or the operation it delegates to, and on through every domain call.
 * A refusing operation's `reason` is static, so what the walk finds is what a run can say. The checker holds
 * the trigger to it (T005, T006); the viewer shows it.
 */
export function refusalsReachable(scope: Scope, opRef: string, profile?: string, seen = new Set<string>()): ReachableRefusal[] {
  const o = scope.op(opRef);
  if (typeof o === 'string' || o.port.native) return [];
  const b = scope.bindingFor(o.path, profile);
  if (typeof b === 'string') return [];
  const bop = b.doc.operations[o.opName];
  if (!bop) return [];
  if (bop.graph) return graphRefusals(scope, scope.canon(bop.graph), profile, seen);
  return bop.run ? callRefusals(scope, bop.run, bop.in, b.path, o.opName, profile, seen) : [];
}

/**
 * Every reason a trigger can be answered with: what it fires, what each of its policies decides through,
 * and -- when an attachment gives the guard a credential -- the guard's own reasons, a credential that does not
 * verify among them.
 */
export function refusalsOfTrigger(scope: Scope, t: TriggerDoc, profile?: string): ReachableRefusal[] {
  const out = refusalsReachable(scope, t.fire.run, profile);
  for (const ref of t.policies ?? []) {
    const p = scope.get('policy', policyPath(ref));
    if (p) out.push(...refusalsReachable(scope, p.doc.decide.run, profile));
  }
  const guard = scope.guard();
  const gives = (t.policies ?? []).some(u => typeof u !== 'string' && Object.keys(u.in ?? {}).length);
  if (gives && guard) for (const reason of Object.keys(guard.doc.guard!.refuses ?? {})) out.push({ reason, file: guard.path, node: 'identify' });
  return out;
}

/** One call site: the literal reason when the operation refuses, else whatever the operation reaches. */
function callRefusals(scope: Scope, run: string, given: Record<string, unknown> | undefined, file: string, node: string, profile: string | undefined, seen: Set<string>): ReachableRefusal[] {
  const o = scope.op(run);
  if (typeof o === 'string') return [];
  if (o.op.refuses) { const r = given?.reason; return typeof r === 'string' && scope.literal(r) ? [{ reason: r, file, node }] : []; }
  return o.port.native ? [] : refusalsReachable(scope, run, profile, seen);
}

function graphRefusals(scope: Scope, graphPath: string, profile: string | undefined, seen: Set<string>): ReachableRefusal[] {
  if (seen.has(graphPath)) return []; seen.add(graphPath);
  const g = scope.registry.get('graph', graphPath); if (!g) return [];
  const out: ReachableRefusal[] = [];
  for (const n of g.doc.nodes) { if (isSwitch(n)) continue; out.push(...callRefusals(scope, n.run, n.in, g.path, n.id, profile, seen)); }
  return out;
}

/**
 * Assignability at the edge: wire text (query, route placeholders, headers, form fields, flags) may feed any scalar,
 * and a value that may be missing may feed a required field -- the trigger coerces and judges the input when it
 * arrives, and a request missing it is refused there rather than run.
 */
function assignableWire(from: Type, to: Type): string | null {
  if (from.kind === 'string' && !from.enum && (to.kind === 'string' || to.kind === 'number' || to.kind === 'boolean')) return null;
  if (from.kind === 'list' && to.kind === 'list') return assignableWire(from.of, to.of);
  if (from.kind === 'object' && to.kind === 'object') {
    for (const [k, tf] of Object.entries(to.fields)) {
      const ff = from.fields[k];
      if (!ff) { if (tf.required) return `missing required field '${k}'`; continue; }
      const r = assignableWire(ff.type, tf.type); if (r) return `field '${k}': ${r}`;
    }
    return null;
  }
  return assignable(from, to);
}

/** One request.* path read under a trigger: where, and -- when the resolver declared itself required -- the resolver's own path, which the trigger must guarantee. */
interface RequestNeed { path: string[]; file: string; required?: string[] }

/** One resolver as judged: the segments below request, the read's type and optionality, and whether the document declared it required. */
interface ResolverRead { path: string[]; read: Read; required?: boolean }

/** A read continued below a typed root: the root's optionality carries into what is read beneath it. */
function readAt(base: Read, path: string[]): Read | string {
  const r = typeAt(base.type, path);
  return typeof r === 'string' ? r : { type: r.type, optional: base.optional || r.optional };
}
