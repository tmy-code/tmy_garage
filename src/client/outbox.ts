import type { Fillup, OdometerReading, Service, Snapshot } from '../shared/types.ts';
import { normalizeService } from '../shared/workshop.ts';

/**
 * A change made on the phone that has not reached the server yet (see ADR 0001).
 * Only Services, Odometer Readings and Fill-ups can be queued; everything else needs a connection.
 */
export type OutboxOp = { kind: 'service'; data: Service } | { kind: 'reading'; data: OdometerReading } | { kind: 'fillup'; data: Fillup };

export function opRequest(op: OutboxOp): { path: string; body: unknown } {
  switch (op.kind) {
    case 'service':
      return { path: `/api/services/${op.data.id}`, body: op.data };
    case 'reading':
      return { path: `/api/odometer-readings/${op.data.id}`, body: op.data };
    case 'fillup':
      return { path: `/api/fillups/${op.data.id}`, body: op.data };
  }
}

/** Where to delete a record on the server, for taking back a change that already arrived. */
export function opDeletePath(op: OutboxOp): string {
  return opRequest(op).path;
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
  let { services, readings, fillups } = snapshot;
  for (const op of ops) {
    if (op.kind === 'service') services = upsert(services, normalizeService(op.data));
    else if (op.kind === 'reading') readings = upsert(readings, op.data);
    else fillups = upsert(fillups, op.data);
  }
  return { ...snapshot, services, readings, fillups };
}

/** Queues a change, replacing an earlier queued version of the same record so it is sent once. */
export function enqueueOp(ops: OutboxOp[], op: OutboxOp): OutboxOp[] {
  const without = ops.filter((o) => !(o.kind === op.kind && o.data.id === op.data.id));
  return [...without, op];
}
