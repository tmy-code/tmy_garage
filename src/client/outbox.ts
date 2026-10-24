import type { OdometerReading, Service, Snapshot } from '../shared/types.ts';
import { normalizeService } from '../shared/workshop.ts';

/**
 * A change made on the phone that has not reached the server yet (see ADR 0001).
 * Only Services and Odometer Readings can be queued; everything else needs a connection.
 */
export type OutboxOp = { kind: 'service'; data: Service } | { kind: 'reading'; data: OdometerReading };

export function opRequest(op: OutboxOp): { path: string; body: unknown } {
  return op.kind === 'service'
    ? { path: `/api/services/${op.data.id}`, body: op.data }
    : { path: `/api/odometer-readings/${op.data.id}`, body: op.data };
}

function upsert<T extends { id: string }>(items: T[], item: T): T[] {
  const index = items.findIndex((i) => i.id === item.id);
  if (index === -1) return [...items, item];
  const copy = [...items];
  copy[index] = item;
  return copy;
}

/** The snapshot as the user should see it: the last server copy with queued changes applied on top. */
export function applyOutbox(snapshot: Snapshot, ops: OutboxOp[]): Snapshot {
  let { services, readings } = snapshot;
  for (const op of ops) {
    if (op.kind === 'service') services = upsert(services, normalizeService(op.data));
    else readings = upsert(readings, op.data);
  }
  return { ...snapshot, services, readings };
}

/** Queues a change, replacing an earlier queued version of the same record so it is sent once. */
export function enqueueOp(ops: OutboxOp[], op: OutboxOp): OutboxOp[] {
  const without = ops.filter((o) => !(o.kind === op.kind && o.data.id === op.data.id));
  return [...without, op];
}
