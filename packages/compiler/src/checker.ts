/**
 * wilanis check. Judges the whole tree statically so that nothing refuses at load. Rule families:
 *   D documents   R references   L layers/effects/visibility   G graphs   P params/resolvers
 *   B bindings/profiles   T triggers   C connections/settings   S scenarios   X plugin-specific
 */
import type { LoadResult } from '@wilanis/core';
import {
  isMap, isRun, isSwitch, RefusalList, type BindingDoc, type Fields, type GraphDoc, type Loaded, type Node,
  type Operation, type PortDoc, type Resolvers, type ShapeDoc, type Source, type TriggerDoc, type TypeSpec, type ConnectionDoc,
} from '@wilanis/core';
import { Scope, type OpHit } from '@wilanis/core';
import { assignable, conforms, EMPTY_OBJECT, hasVars, show, STRING, substitute, typeAt, TypeError_, type Read, type Type } from '@wilanis/core';
import { expr } from '@wilanis/core';

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
    const roles = this.s.graphRoles();
    for (const [path, e] of roles) {
      if (e.roles.size > 1) this.refuse('L004', path, `graph is fired by a trigger and bound by a binding (${e.by.join(', ')})`, undefined, 'a graph is either domain (behind a trigger) or data (behind a binding); split it');
    }
    for (const g of this.s.registry.all('graph')) this.checkGraph(g, this.s.roleOf(g.path, roles));
    for (const b of this.s.registry.all('binding')) this.checkBinding(b);
    for (const t of this.s.registry.all('trigger')) this.checkTrigger(t);
    for (const sc of this.s.registry.all('scenario')) if (!this.s.get('graph', sc.doc.graph)) this.refuse('S001', sc.path, `scenario names unknown graph '${sc.doc.graph}'`, 'graph');
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

  /** Type a settings block where only {{secrets.key}} may appear. */
  private settingsRead(value: unknown, file: string, at: string, secrets: Record<string, string>): Read | undefined {
    const r = this.s.paramRead(value, (root, path) => {
      if (root !== 'secrets') return `{{${[root, ...path].join('.')}}}: only {{secrets.<key>}} may appear in settings`;
      if (path.length !== 1) return `{{secrets.${path.join('.')}}}: a secret is one key`;
      if (!(path[0] in secrets)) return `secret '${path[0]}' is not declared in project.json secrets`;
      return { type: STRING, optional: false };
    });
    if (typeof r === 'string') { this.refuse('C001', file, r, at, 'declare the key under project.json → secrets'); return undefined; }
    return r;
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
      this.fieldsType(op.params, p.path, `operations/${name}/params`);
      if (!p.native) {
        for (const [k, f] of Object.entries(op.accepts ?? {})) this.checkLayer(f.type, p, `operations/${name}/accepts/${k}`, 'core', `${name}.accepts.${k}`);
        if (op.returns) this.checkLayer(op.returns, p, `operations/${name}/returns`, 'core', `${name}.returns`);
        if (op.params) this.refuse('L006', p.path, `domain operation '${name}' declares params -- params belong to native operations, fixed in bindings`, `operations/${name}/params`, 'make it an accepts field, or fix the value in the binding');
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

  // ---- params and resolvers -----------------------------------------------------------------------

  /**
   * Check a resolvers block. Answers name -> returns type. `allowRequest`: whether {{request.*}} is legal
   * in resolver inputs here (data layer yes, domain layer no). `effects`: the allowlist, or null to skip.
   */
  checkResolvers(resolvers: Resolvers | undefined, from: Loaded, allowRequest: boolean, nativeOnly: boolean, effects: Set<string> | null, effectsAt: string): Record<string, Type> {
    const types: Record<string, Type> = {};
    if (!resolvers) return types;
    const visiting = new Set<string>();
    const file = from.path;
    const resolveType = (name: string, stack: string[]): Type | undefined => {
      if (types[name]) return types[name];
      if (visiting.has(name)) { this.refuse('P004', file, `resolver cycle: ${[...stack, name].join(' → ')}`, `resolvers/${name}`); return undefined; }
      const spec = resolvers[name];
      visiting.add(name);
      const o = this.opAt(spec.run, from, `resolvers/${name}/run`);
      if (!o) { visiting.delete(name); return undefined; }
      if (nativeOnly && !o.port.native) this.refuse('L002', file, `resolver '${name}' runs domain operation '${spec.run}' from the data layer`, `resolvers/${name}/run`, 'the data layer speaks native ports only');
      if (o.port.native && o.op.pure !== true && effects && !effects.has(`${o.path}#${o.opName}`)) this.refuse('L003', file, `resolver '${name}' runs effectful '${o.path}#${o.opName}' which the feature does not allow`, `resolvers/${name}/run`, `add "${o.path}#${o.opName}" to ${effectsAt}`);
      const resolve = (root: string, path: string[]): Read | string => {
        if (root === 'request') return allowRequest ? this.s.requestRead(path) : 'request.* is read by the data layer only -- declare this resolver in the binding';
        if (root in resolvers) { const t = resolveType(root, [...stack, name]); return t ? typeAt(t, path) : `resolver '${root}' could not be typed`; }
        return `'${root}' is not a resolver here (resolvers: ${Object.keys(resolvers).join(', ')}); a resolver reads request.* and other resolvers`;
      };
      this.checkFieldsValue(spec.in ?? {}, o.op.accepts, resolve, file, `resolvers/${name}/in`, `'${spec.run}' accepts`, true, from, null);
      const subst = this.checkFieldsValue(spec.params ?? {}, o.op.params, resolve, file, `resolvers/${name}/params`, `'${spec.run}' params`, true, from, null);
      let ret = this.type(o.op.returns, o.port.path, 'returns') ?? EMPTY_OBJECT;
      if (hasVars(ret)) ret = substitute(ret, subst);
      types[name] = ret;
      visiting.delete(name);
      return ret;
    };
    for (const name of Object.keys(resolvers)) resolveType(name, []);
    return types;
  }

  /** Resolve path#operation from a document, with visibility. */
  private opAt(opRef: string, from: Loaded, at: string): OpHit | undefined {
    const o = this.s.op(opRef);
    if (typeof o === 'string') { this.refuse('R001', from.path, o, at, 'wilanis ls port'); return undefined; }
    const v = this.s.visibility(from, o.port); if (v) this.refuse('L005', from.path, v, at);
    return o;
  }

  /** Judge a params-like literal against a Fields contract. Answers the variables bound by `type` params. */
  checkFieldsValue(value: Record<string, unknown>, contract: Fields | undefined, resolve: (root: string, path: string[]) => Read | string, file: string, at: string, what: string, report: boolean, from: Loaded, layer: 'edge' | 'core' | null): Record<string, Type> {
    const subst: Record<string, Type> = {};
    const c = contract ?? {};
    const refuse = (msg: string, where: string, hint?: string) => { if (report) this.refuse('P001', file, msg, where, hint); };
    for (const k of Object.keys(value)) if (!(k in c)) refuse(`'${k}' is not in ${what} (${Object.keys(c).join(', ') || 'nothing'})`, `${at}/${k}`, 'wilanis describe <port>');
    for (const [k, f] of Object.entries(c)) {
      if (!(k in value)) { if (f.required !== false) refuse(`${what} requires '${k}'`, at); continue; }
      const want = this.quiet(f.type);
      if (!want) continue;
      if (want.kind === 'type') {
        const v = value[k];
        if (typeof v !== 'string') { refuse(`'${k}' is a type reference, written as a string`, `${at}/${k}`); continue; }
        const t = report ? this.type(v, file, `${at}/${k}`) : this.quiet(v);
        if (!t) continue;
        if (report) this.checkLayer(v, from, `${at}/${k}`, layer, `param '${k}'`);
        if (f.binds) subst[f.binds] = t;
        continue;
      }
      const got = this.s.paramRead(value[k], resolve);
      if (typeof got === 'string') { refuse(`'${k}': ${got}`, `${at}/${k}`); continue; }
      if (got.optional && f.required !== false) { refuse(`'${k}' may be missing at run time but ${what} requires it`, `${at}/${k}`, 'read a required path, or make the contract field optional'); continue; }
      const bad = assignable(got.type, want);
      if (bad) refuse(`'${k}': ${bad}`, `${at}/${k}`);
    }
    return subst;
  }

  /** Judge wired inputs against an accepts contract, with the operation's type variables bound by `subst`. */
  checkInputsAgainst(given: Record<string, Read | undefined>, accepts: Fields | undefined, file: string, at: string, what: string, subst: Record<string, Type> = {}) {
    const c = accepts ?? {};
    for (const k of Object.keys(given)) if (!(k in c)) this.refuse('G006', file, `'${k}' is not an input of ${what} (inputs: ${Object.keys(c).join(', ') || 'none'})`, `${at}/${k}`, 'wilanis describe <port>');
    for (const [k, f] of Object.entries(c)) {
      if (!(k in given)) { if (f.required !== false) this.refuse('G005', file, `${what} requires input '${k}'`, at); continue; }
      const r = given[k]; if (!r) continue;
      let want = this.type(f.type, file, `${at}/${k}`); if (!want) continue;
      if (hasVars(want)) want = substitute(want, subst);
      if (r.optional && f.required !== false) { this.refuse('G004', file, `'${k}' may be missing at run time but ${what} requires it`, `${at}/${k}`, 'route around it with a switch on has(...), or make the contract field optional'); continue; }
      const bad = assignable(r.type, want);
      if (bad) this.refuse('G004', file, `'${k}': ${bad}`, `${at}/${k}`);
    }
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
    const rtypes = this.checkResolvers(b.doc.resolvers, b, true, true, effects, effectsAt);

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
          if (!gin) { if (Object.keys(op.accepts ?? {}).length) this.refuse('B005', b.path, `'${opName}' accepts fields but graph '${bop.graph}' takes nothing`, `${at}/graph`); }
          else { const bad = assignable(accepts, gin); if (bad) this.refuse('B005', b.path, `'${opName}' accepts → graph in: ${bad}`, `${at}/graph`, "the operation's accepts must be assignable to the graph's in shape"); }
        }
        if (returns && !gout) this.refuse('B005', b.path, `'${opName}' returns ${show(returns)} but graph '${bop.graph}' answers nothing`, `${at}/graph`);
        if (returns && gout) { const bad = assignable(gout, returns); if (bad) this.refuse('B005', b.path, `graph out → '${opName}' returns: ${bad}`, `${at}/graph`); }
        if (!returns && gout) this.refuse('B005', b.path, `graph '${bop.graph}' answers ${show(gout)} but '${opName}' returns nothing`, `${at}/graph`);
      } else if (bop.run) {
        const o = this.opAt(bop.run, b, `${at}/run`);
        if (!o) continue;
        if (!o.port.native) { this.refuse('L002', b.path, `'${opName}' delegates to domain operation '${bop.run}' -- a binding speaks native ports only`, `${at}/run`); continue; }
        if (o.op.pure !== true && !effects.has(`${o.path}#${o.opName}`)) this.refuse('L003', b.path, `'${opName}' delegates to effectful '${o.path}#${o.opName}' which the feature does not allow`, `${at}/run`, `add "${o.path}#${o.opName}" to ${effectsAt}`);
        let tAccepts = this.fieldsType(o.op.accepts, o.port.path, 'accepts');
        let tReturns = this.type(o.op.returns, o.port.path, 'returns');
        const resolve = (root: string, path: string[]): Read | string => {
          if (root in rtypes) return typeAt(rtypes[root], path);
          if (root === 'in') return accepts ? typeAt(accepts, path) : 'this operation accepts nothing';
          return `'${root}' is not in or a resolver of this binding (resolvers: ${Object.keys(rtypes).join(', ') || 'none'})`;
        };
        const subst = this.checkFieldsValue(bop.params ?? {}, o.op.params, resolve, b.path, `${at}/params`, `'${bop.run}' params`, true, b, null);
        if (tAccepts && hasVars(tAccepts)) tAccepts = substitute(tAccepts, subst);
        if (tReturns && hasVars(tReturns)) tReturns = substitute(tReturns, subst);
        if (accepts && tAccepts) { const bad = assignable(accepts, tAccepts); if (bad) this.refuse('B005', b.path, `'${opName}' accepts → '${bop.run}' accepts: ${bad}`, `${at}/run`, 'a delegation passes inputs by name; otherwise bind a data graph'); }
        if (returns) {
          if (!tReturns) this.refuse('B005', b.path, `'${opName}' returns ${show(returns)} but '${bop.run}' returns nothing`, `${at}/run`);
          else { const bad = assignable(tReturns, returns); if (bad) this.refuse('B005', b.path, `'${bop.run}' returns ${show(tReturns)} → '${opName}' returns ${show(returns)}: ${bad}`, `${at}/run`, 'declare the answer type in params, or bind a data graph that shapes it'); }
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

    const rtypes = this.checkResolvers(doc.resolvers, g, role === 'data', role === 'data', role === 'data' ? effects : null, effectsAt);

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
    }

    // sources and node output types (lazy: a node's output type may depend on its type params)
    const readsIn = new Set<string>(), readsConst = new Set<string>(), readNodes = new Set<string>();
    const outTypes = new Map<string, Type | undefined>();
    const computing = new Set<string>();
    const present = new Map<string, Set<string>>(); // node -> source paths a routing switch proved present
    let reading: string | undefined;
    const narrowed = (src: string) => { const set = reading ? present.get(reading) : undefined; return Boolean(set && [...set].some(p => src === p || src.startsWith(p + '.'))); };

    const paramResolve = (root: string, path: string[]): Read | string => {
      if (root in rtypes) return typeAt(rtypes[root], path);
      if (root === 'in') { if (!inType) return 'the graph declares no in'; readsIn.add(path[0] ?? '*'); return typeAt(inType, path); }
      return `'${root}' is not in or a resolver of this graph (resolvers: ${Object.keys(rtypes).join(', ') || 'none'})`;
    };

    const nodeOut = (id: string): Type | undefined => {
      if (outTypes.has(id)) return outTypes.get(id);
      const n = nodes.get(id)!;
      if (isSwitch(n)) { outTypes.set(id, STRING); return STRING; }
      const o = ops.get(id);
      if (!o) { outTypes.set(id, undefined); return undefined; }
      if (computing.has(id)) return undefined;
      computing.add(id);
      let ret = this.quiet(o.op.returns) ?? EMPTY_OBJECT;
      if (hasVars(ret)) ret = substitute(ret, this.checkFieldsValue(n.params ?? {}, o.op.params, paramResolve, file, `nodes/${id}/params`, '', false, g, layer));
      computing.delete(id);
      const t: Type = isMap(n) ? { kind: 'list', of: ret } : ret;
      outTypes.set(id, t);
      return t;
    };

    const sourceRead = (src: Source, at: string, report = true): Read | undefined => {
      const refuse = (code: string, msg: string, where: string, hint?: string) => { if (report) this.refuse(code, file, msg, where, hint); };
      if (typeof src === 'string') {
        const [root, ...path] = src.split('.');
        let base: Type | undefined;
        if (root === 'in') {
          if (!inType) { refuse('G003', `reads '${src}' but the graph declares no in`, at); return undefined; }
          base = inType; readsIn.add(path[0] ?? '*');
        } else if (root === 'const') {
          if (!path.length || !constTypes[path[0]]) { refuse('G003', `unknown constant '${src}' (constants: ${Object.keys(constTypes).join(', ') || 'none'})`, at); return undefined; }
          base = constTypes[path[0]]; readsConst.add(path[0]); path.shift();
        } else if (root === 'request') {
          refuse('G003', `graphs do not read request.* -- a resolver's in does`, at, 'declare a resolver and read {{name.path}} in params');
          return undefined;
        } else {
          if (!nodes.has(root)) { refuse('G003', `unknown node '${root}' in source '${src}'`, at, `nodes: ${[...nodes.keys()].join(', ')}`); return undefined; }
          readNodes.add(root);
          base = nodeOut(root);
          if (!base) return undefined;
        }
        const r = typeAt(base, path);
        if (typeof r === 'string') { refuse('G003', `'${src}': ${r}`, at); return undefined; }
        return r.optional && narrowed(src) ? { type: r.type, optional: false } : r;
      }
      if (Array.isArray(src)) {
        const reads = src.map((s, i) => sourceRead(s, `${at}/${i}`, report));
        if (reads.some(r => !r)) return undefined;
        const first = reads[0] as Read | undefined;
        if (!first) return { type: { kind: 'list', of: { kind: 'unknown' } }, optional: false };
        for (const [i, r] of reads.entries()) { const bad = assignable(r!.type, first.type); if (bad) refuse('G004', `list element ${i} is ${show(r!.type)}, element 0 is ${show(first.type)}`, `${at}/${i}`, 'a list holds one type'); }
        return { type: { kind: 'list', of: first.type }, optional: false };
      }
      const fields: Record<string, { type: Type; required: boolean }> = {};
      for (const [k, s] of Object.entries(src)) {
        const r = sourceRead(s, `${at}/${k}`, report);
        if (!r) return undefined;
        fields[k] = { type: r.type, required: !r.optional };
      }
      return { type: { kind: 'object', fields, open: false }, optional: false };
    };

    const givenReads = (n: Node, at: string): Record<string, Read | undefined> => {
      const given: Record<string, Read | undefined> = {};
      const prev = reading; reading = n.id;
      for (const [k, s] of Object.entries(n.in ?? {})) given[k] = sourceRead(s, `${at}/in/${k}`);
      if (isMap(n)) {
        const over = sourceRead(n.over, `${at}/over`);
        if (over) {
          if (over.type.kind !== 'list') this.refuse('G012', file, `over is ${show(over.type)}, not a list`, `${at}/over`);
          else if (over.optional) this.refuse('G004', file, `over may be missing at run time`, `${at}/over`);
          else if (n.bind) {
            for (const [k, p] of Object.entries(n.bind)) {
              const r = typeAt(over.type.of, p ? p.split('.') : []);
              if (typeof r === 'string') { this.refuse('G012', file, `bind.${k}: ${r}`, `${at}/bind/${k}`); continue; }
              if (k in given) this.refuse('G006', file, `'${k}' is both bound and wired`, `${at}/bind/${k}`);
              given[k] = r;
            }
          } else {
            if ('item' in given) this.refuse('G006', file, `'item' is the element; do not wire it`, `${at}/in/item`);
            given.item = { type: over.type.of, optional: false };
          }
        }
      }
      reading = prev;
      return given;
    };

    const routedBy = new Map<string, string>();
    const deps = new Map<string, Set<string>>();
    for (const n of nodes.values()) {
      const at = `nodes/${n.id}`;
      const d = new Set<string>();
      const collect = (src: Source) => { if (typeof src === 'string') { const root = src.split('.')[0]; if (nodes.has(root)) d.add(root); } else if (Array.isArray(src)) src.forEach(collect); else Object.values(src).forEach(collect); };
      Object.values(n.in ?? {}).forEach(collect);
      if (isMap(n)) collect(n.over);
      deps.set(n.id, d);

      if (isSwitch(n)) {
        const inputs: Record<string, Read> = {};
        for (const [k, s] of Object.entries(n.in)) { const r = sourceRead(s, `${at}/in/${k}`); if (r) inputs[k] = r; }
        for (const [i, rule] of n.rules.entries()) {
          try {
            const parsed = expr.parse(rule.when);
            const t = expr.check(parsed, inputs);
            if (t.kind !== 'boolean') this.refuse('G011', file, `rule ${i}: '${rule.when}' is ${show(t)}, not boolean`, `${at}/rules/${i}/when`);
            const proved = new Set<string>();
            const walk = (e: expr.Expr) => { if (e.t === 'bin' && e.op === '&&') { walk(e.l); walk(e.r); } else if (e.t === 'has') { const src = n.in[e.p[0]]; if (typeof src === 'string') proved.add([src, ...e.p.slice(1)].join('.')); } };
            walk(parsed);
            if (proved.size) present.set(rule.to, new Set([...(present.get(rule.to) ?? []), ...proved]));
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
      const given = givenReads(n, at);
      const subst = this.checkFieldsValue(n.params ?? {}, o.op.params, paramResolve, file, `${at}/params`, `'${n.run}' params`, true, g, layer);
      this.checkInputsAgainst(given, o.op.accepts, file, `${at}/in`, `'${n.run}'`, subst);
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
    const g = this.s.get('graph', doc.graph);
    if (!g) { this.refuse('R001', file, `unknown graph '${doc.graph}'`, 'graph'); return; }
    const v = this.s.visibility(t, g); if (v) this.refuse('L005', file, v, 'graph');
    const tin = this.type(doc.in, file, 'in'), tout = this.type(doc.out, file, 'out');
    const ctx = this.s.contextType(kind.doc, doc.settings);
    if (doc.input !== undefined) {
      if (!tin) this.refuse('T003', file, 'input is mapped but the trigger declares no in', 'input');
      else {
        const read = this.s.paramRead(doc.input, (root, path) => root === 'request' ? typeAt(ctx, path) : `'${root}': a trigger's input reads request.* only`);
        if (typeof read === 'string') this.refuse('T003', file, `input: ${read}`, 'input', `wilanis describe ${doc.kind} shows what this kind hands`);
        else if (read.optional) this.refuse('T003', file, 'input reads a value that may be missing', 'input');
        else { const bad = assignableWire(read.type, tin); if (bad) this.refuse('T003', file, `input → in: ${bad}`, 'input'); }
      }
    }
    const gin = this.quiet(g.doc.in), gout = this.quiet(g.doc.out?.type);
    if (gin && !tin) this.refuse('T002', file, `graph takes ${show(gin)} but the trigger declares no in`, 'in');
    if (tin && gin) { const bad = assignable(tin, gin); if (bad) this.refuse('T002', file, `in → graph in: ${bad}`, 'in', "the edge shape must be assignable to the graph's core shape, field for field"); }
    if (gout && !tout) this.refuse('T002', file, `graph answers ${show(gout)} but the trigger declares no out`, 'out');
    if (tout && !gout) this.refuse('T002', file, 'trigger declares out but the graph answers nothing', 'out');
    if (tout && gout) { const bad = assignable(gout, tout); if (bad) this.refuse('T002', file, `graph out → out: ${bad}`, 'out'); }
    // request reachability: every request.* a resolver reads under this trigger must be in the kind's context
    const profiles = this.s.profiles().length ? this.s.profiles() : [undefined];
    for (const prof of profiles) {
      for (const need of this.requestNeeds(g.path, prof)) {
        const rr = typeAt(ctx, need.path);
        if (typeof rr === 'string') this.refuse('T004', file, `${need.file} reads request.${need.path.join('.')} but trigger kind '${doc.kind}' hands no such value${prof ? ` (profile '${prof}')` : ''}`, 'kind', 'fire this graph from a kind that hands it, or bind the port differently under a profile');
      }
    }
  }

  /** Every request.* path read by resolvers reachable from a graph: its own, and per node the one binding operation it reaches. */
  private requestNeeds(graphPath: string, profile: string | undefined, seen = new Set<string>()): { path: string[]; file: string }[] {
    if (seen.has(graphPath)) return []; seen.add(graphPath);
    const g = this.s.registry.get('graph', graphPath); if (!g) return [];
    const out: { path: string[]; file: string }[] = [];
    const reads = (resolvers: Resolvers | undefined, names: Iterable<string>, file: string) => {
      for (const name of names) { const r = resolvers?.[name]; if (!r) continue; for (const p of this.s.templateReads({ ...(r.in ?? {}), ...(r.params ?? {}) })) if (p[0] === 'request') out.push({ path: p.slice(1), file }); }
    };
    reads(g.doc.resolvers, Object.keys(g.doc.resolvers ?? {}), g.path);
    for (const n of g.doc.nodes) {
      if (isSwitch(n)) continue;
      const o = this.s.op(n.run);
      if (typeof o === 'string' || o.port.native) continue;
      const b = this.s.bindingFor(o.path, profile);
      if (typeof b === 'string') continue;
      const bop = b.doc.operations[o.opName];
      if (!bop) continue;
      if (bop.graph) out.push(...this.requestNeeds(this.s.canon(bop.graph), profile, seen));
      else reads(b.doc.resolvers, new Set(this.s.templateReads(bop.params).map(p => p[0])), b.path);
    }
    return out;
  }
}

/** Assignability at the edge: wire text (query, params, headers, form fields) may feed any scalar; the codec/trigger coerces and judges it at run time. */
function assignableWire(from: Type, to: Type): string | null {
  if (from.kind === 'string' && !from.enum && (to.kind === 'string' || to.kind === 'number' || to.kind === 'boolean')) return null;
  if (from.kind === 'list' && to.kind === 'list') return assignableWire(from.of, to.of);
  if (from.kind === 'object' && to.kind === 'object') {
    for (const [k, tf] of Object.entries(to.fields)) {
      const ff = from.fields[k];
      if (!ff) { if (tf.required) return `missing required field '${k}'`; continue; }
      if (tf.required && !ff.required) return `field '${k}' is optional but required here`;
      const r = assignableWire(ff.type, tf.type); if (r) return `field '${k}': ${r}`;
    }
    return null;
  }
  return assignable(from, to);
}

