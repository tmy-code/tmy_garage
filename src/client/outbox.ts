import type { Fillup, OdometerReading, Service, Snapshot, VehicleItem } from '../shared/types.ts';
import { catalogueOf } from '../shared/catalogue.ts';
import { logService, type LogServiceResult, type NewVehicleItem } from '../shared/service-logging.ts';
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

function toVehicleItem(i: NewVehicleItem): VehicleItem {
  return { ...i, itemSpecId: null, specLineId: null, notes: null };
}

/** The Service as the queue sends it: the stored form, plus `remember` on lines whose item is still to be added. */
export function serviceToSend(result: Extract<LogServiceResult, { ok: true }>): Service {
  const newIds = new Set(result.newItems.map((i) => i.id));
  return {
    ...result.service,
    componentsUsed: result.service.componentsUsed.map((p) => (p.itemId && newIds.has(p.itemId) ? { ...p, remember: true } : p)),
  };
}

/** The snapshot as the user should see it: the last server copy with queued changes applied on top. */
export function applyOutbox(snapshot: Snapshot, ops: OutboxOp[]): Snapshot {
  let { services, readings, fillups, vehicleItems } = snapshot;
  const catalogue = catalogueOf(snapshot);
  for (const op of ops) {
    if (op.kind === 'service') {
      const draft = normalizeService(op.data);
      const ctx = {
        tasks: snapshot.tasks.filter((t) => t.vehicleId === draft.vehicleId),
        items: vehicleItems.filter((i) => i.vehicleId === draft.vehicleId),
        catalogue,
      };
      let n = 0;
      const newId = () => `queued-${draft.id}-${n++}`;
      const r = logService(ctx, draft, { newId, canAddToItems: true });
      if (!r.ok) {
        // Stays visible as typed; the server will move it to the rejected ones.
        services = upsert(services, draft);
        continue;
      }
      let service = r.service;
      for (const item of r.newItems) {
        if (vehicleItems.some((i) => i.id === item.id)) {
          // An item of another Vehicle: the server ignores the insert and the line keeps no link.
          service = { ...service, componentsUsed: service.componentsUsed.map((p) => (p.itemId === item.id ? { ...p, itemId: null } : p)) };
        } else {
          vehicleItems = [...vehicleItems, toVehicleItem(item)];
        }
      }
      services = upsert(services, service);
    } else if (op.kind === 'reading') readings = upsert(readings, op.data);
    else fillups = upsert(fillups, op.data);
  }
  return { ...snapshot, services, readings, fillups, vehicleItems };
}

/** Queues a change, replacing an earlier queued version of the same record so it is sent once. */
export function enqueueOp(ops: OutboxOp[], op: OutboxOp): OutboxOp[] {
  const without = ops.filter((o) => !(o.kind === op.kind && o.data.id === op.data.id));
  return [...without, op];
}
