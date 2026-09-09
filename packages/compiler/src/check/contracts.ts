/**
 * Shapes, ports and connections. A shape's fields resolve and speak their own layer (R001, L001, L005). A
 * port's operations resolve; a domain operation speaks core shapes and fixes no value itself (L001, L006).
 * A connection names a kind and its settings fit it, reading secrets only (R001, C001, C002).
 */
import type { ConnectionDoc, Loaded, Operation, PortDoc, ShapeDoc } from '@wilanis/core';
import type { Judge } from './judge.js';
import { mismatch } from './typing.js';

export function checkShape(judge: Judge, shape: Loaded<ShapeDoc>): void {
  const spec = { fields: shape.doc.fields, open: shape.doc.open };
  judge.type(spec, shape.path, 'fields');
  judge.checkLayer({ spec, from: shape, at: 'fields', layer: shape.doc.layer, what: `shape '${shape.path}'` });
}

export function checkPort(judge: Judge, port: Loaded<PortDoc>): void {
  for (const [name, op] of Object.entries(port.doc.operations)) {
    judge.fieldsType(op.accepts, port.path, `operations/${name}/accepts`);
    judge.type(op.returns, port.path, `operations/${name}/returns`);
    if (!port.native) checkDomainOperation(judge, port, name, op);
  }
}

/** A domain operation speaks core shapes (L001) and marks nothing static (L006): a binding fixes values. */
function checkDomainOperation(judge: Judge, port: Loaded<PortDoc>, name: string, op: Operation): void {
  const at = `operations/${name}`;
  const accepts = Object.entries(op.accepts ?? {});
  for (const [key, field] of accepts) {
    judge.checkLayer({
      spec: field.type,
      from: port,
      at: `${at}/accepts/${key}`,
      layer: 'core',
      what: `${name}.accepts.${key}`,
    });
  }
  if (op.returns)
    judge.checkLayer({ spec: op.returns, from: port, at: `${at}/returns`, layer: 'core', what: `${name}.returns` });
  for (const [key, field] of accepts) {
    if (!field.static) continue;
    const message = `domain operation '${name}' marks '${key}' static -- static fields belong to native contracts; a binding fixes values`;
    judge.refuser(port.path)('L006', message, `${at}/accepts/${key}`, 'drop static, or fix the value in the binding');
  }
}

export function checkConnection(judge: Judge, connection: Loaded<ConnectionDoc>): void {
  const refuse = judge.refuser(connection.path);
  const kind = judge.scope.get('connection-kind', connection.doc.kind);
  if (!kind) {
    refuse('R001', `unknown connection kind '${connection.doc.kind}'`, 'kind', 'wilanis ls connection-kind');
    return;
  }
  const declared = judge.type(kind.doc.settings, connection.path, 'settings');
  const read = judge.settingsRead(connection.doc.settings, connection.path, 'settings');
  const bad = mismatch(read?.type, declared);
  if (bad) refuse('C002', `settings: ${bad}`, 'settings', `wilanis describe ${connection.doc.kind}`);
}
