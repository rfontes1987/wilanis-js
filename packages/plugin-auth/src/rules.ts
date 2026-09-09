/**
 * The plugin's own rules -- what only @auth can judge. X101: settings.session names no shape. X102: a challenge outcome
 * names a method the settings do not declare, or gates a trigger no attachment of which gives a challenge answer, so it
 * could never be met. X103: a session write names another type than the session shape, or keys the shape does not
 * declare.
 */
import { isMap, isRun, type PluginCheckContext, type PolicyDoc, policyPath, type ShapeDoc } from '@wilanis/core';
import { doc, ROOT, type Settings } from './settings.js';

type Scope = PluginCheckContext['scope'];
type Refuse = PluginCheckContext['refuse'];
/** A shape as the registry holds it: its path, and the shape document itself. */
type Shape = { path: string; doc: ShapeDoc };

/** X101: the shape settings.session names, refusing when it names something that is not one. */
function sessionShape(scope: Scope, settings: Settings, refuse: Refuse): Shape | undefined {
  const shape = settings.session ? (scope.get('shape', settings.session) as Shape | undefined) : undefined;
  if (settings.session && !shape)
    refuse({
      code: 'X101',
      file: '@project.json',
      message: `settings.session names '${settings.session}', which is not a shape`,
      at: `plugins/${ROOT}/settings/session`,
      hint: 'wilanis ls shape',
    });
  return shape;
}

/** X102: every challenge outcome names a method the settings declare. */
function checkMethods(scope: Scope, settings: Settings, refuse: Refuse) {
  const methods = settings.challenge?.methods ?? {};
  for (const policy of scope.registry.all('policy'))
    for (const [reason, outcome] of Object.entries((policy.doc as PolicyDoc).outcomes))
      if (outcome.effect === 'challenge' && outcome.method && !methods[outcome.method])
        refuse({
          code: 'X102',
          file: policy.path,
          message: `outcome '${reason}' challenges by method '${outcome.method}', which ${ROOT} settings.challenge.methods does not declare`,
          at: `outcomes/${reason}/method`,
          hint: `declare it under project.json → plugins → ${ROOT} → settings.challenge.methods, with how a caller obtains a code`,
        });
}

/** X102: a trigger whose policy may challenge gives the guard somewhere to read the answer. */
function checkAnswerable(scope: Scope, refuse: Refuse) {
  for (const trigger of scope.registry.all('trigger')) {
    const uses = trigger.doc.policies ?? [];
    const challenges = uses.some(use =>
      Object.values(scope.get('policy', policyPath(use))?.doc.outcomes ?? {}).some(
        outcome => outcome.effect === 'challenge',
      ),
    );
    if (challenges && !uses.some(use => typeof use !== 'string' && use.in?.challenge !== undefined))
      refuse({
        code: 'X102',
        file: trigger.path,
        message:
          'a policy of this trigger may challenge the caller, but no attachment gives the guard a challenge answer, so the challenge could never be met',
        at: 'policies',
        hint: 'give it: "in": { "challenge": { "id": "{{request.flags[\'challenge-id\']}}", "code": "{{request.flags.code}}" } }',
      });
  }
}

/** Where a session operation is written, and what it was given. */
interface Write {
  file: string;
  at: string;
  run: string;
  given: Record<string, unknown> | undefined;
}

/** What every X103 judgement reads: the session shape, the settings that named it, and how to refuse. */
interface Session {
  shape: Shape;
  settings: Settings;
  scope: Scope;
  refuse: Refuse;
}

/** X103: the operation this write names, when it is one of the session port's; undefined otherwise. */
function sessionOperation(write: Write, scope: Scope): string | undefined {
  if (scope.canon(write.run.split('#')[0]) !== doc('session.port.json')) return undefined;
  const operation = write.run.split('#')[1];
  return ['get', 'set', 'remove'].includes(operation) ? operation : undefined;
}

/** X103: the type a write names is the session shape. */
function judgeType(write: Write, operation: string, session: Session) {
  const type = write.given?.type;
  if (typeof type === 'string' && session.scope.canon(type) !== session.shape.path)
    session.refuse({
      code: 'X103',
      file: write.file,
      message: `${operation} names type '${type}', but the session shape is '${session.settings.session}'`,
      at: `${write.at}/type`,
      hint: `write "type": "${session.settings.session}"`,
    });
}

/** Whether the session shape declares this attribute, or is open to any. */
const declares = (session: Session, key: string) =>
  Object.hasOwn(session.shape.doc.fields, key) || Boolean(session.shape.doc.open);

/** X103: every attribute a set writes is one the session shape declares. */
function judgeSet(write: Write, session: Session) {
  const values = write.given?.values;
  if (!values || typeof values !== 'object' || Array.isArray(values)) return;
  for (const key of Object.keys(values))
    if (!declares(session, key))
      session.refuse({
        code: 'X103',
        file: write.file,
        message: `set writes '${key}', which ${session.settings.session} does not declare`,
        at: `${write.at}/values/${key}`,
        hint: 'declare the attribute in the session shape, or drop it',
      });
}

/** X103: every attribute a remove drops is one the session shape declares. */
function judgeRemove(write: Write, session: Session) {
  const keys = write.given?.keys;
  if (!Array.isArray(keys)) return;
  for (const key of keys)
    if (typeof key === 'string' && !declares(session, key))
      session.refuse({
        code: 'X103',
        file: write.file,
        message: `remove drops '${key}', which ${session.settings.session} does not declare`,
        at: `${write.at}/keys`,
        hint: 'name attributes of the session shape',
      });
}

/** X103: one session operation's inputs, against the session shape. */
function judgeWrite(write: Write, session: Session) {
  const operation = sessionOperation(write, session.scope);
  if (!operation) return;
  judgeType(write, operation, session);
  if (operation === 'set') judgeSet(write, session);
  if (operation === 'remove') judgeRemove(write, session);
}

/** X103: every session write a graph's nodes make. */
function checkGraphWrites(session: Session) {
  for (const graph of session.scope.registry.all('graph'))
    for (const node of graph.doc.nodes)
      if (isRun(node) || isMap(node))
        judgeWrite({ file: graph.path, at: `nodes/${node.id}/in`, run: node.run, given: node.in }, session);
}

/** X103: every session write a binding's operations make. */
function checkBindingWrites(session: Session) {
  for (const binding of session.scope.registry.all('binding'))
    for (const [name, operation] of Object.entries(binding.doc.operations))
      if (operation.run)
        judgeWrite(
          { file: binding.path, at: `operations/${name}/in`, run: operation.run, given: operation.in },
          session,
        );
}

/** What only @auth can judge: X101, X102 and X103. */
export function check({ scope, settings, refuse }: PluginCheckContext) {
  const declared = settings as Settings;
  const shape = sessionShape(scope, declared, refuse);
  checkMethods(scope, declared, refuse);
  checkAnswerable(scope, refuse);
  if (!shape) return;
  const session: Session = { shape, settings: declared, scope, refuse };
  checkGraphWrites(session);
  checkBindingWrites(session);
}
