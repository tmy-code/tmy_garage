import { catalogueOrder } from './catalogue.ts';
import { addDays, type IsoDate } from './dates.ts';
import { vehicleDue, type DueInfo } from './due.ts';
import type { FitmentPosition, MaintenanceTask, PartSpec, PartUsed, Service, Snapshot, Vehicle } from './types.ts';

/** A Part Used together with the Service it went in with. */
export interface PartUsage {
  part: PartUsed;
  serviceId: string;
  date: IsoDate;
  odometer: number;
}

function newestFirst(a: Service, b: Service): number {
  return a.date === b.date ? b.odometer - a.odometer : a.date < b.date ? 1 : -1;
}

function usages(snapshot: Snapshot, vehicleId: string, matches: (p: PartUsed) => boolean): PartUsage[] {
  return snapshot.services
    .filter((s) => s.vehicleId === vehicleId)
    .sort(newestFirst)
    .flatMap((s) => s.partsUsed.filter(matches).map((part) => ({ part, serviceId: s.id, date: s.date, odometer: s.odometer })));
}

/**
 * A Vehicle's Part Specs, Standard Parts first in catalogue order. Standard Parts marked as not on the
 * Vehicle are left out unless asked for, or unless one of `keep` (already chosen somewhere) is among them.
 */
export function partSpecsOf(snapshot: Snapshot, vehicle: Vehicle, { notFitted = false, keep = [] as (string | null)[] } = {}): PartSpec[] {
  return snapshot.partSpecs
    .filter((p) => p.vehicleId === vehicle.id && (notFitted || !p.notFitted || keep.includes(p.id)))
    .sort((a, b) => catalogueOrder(vehicle.kind, a.standardPart) - catalogueOrder(vehicle.kind, b.standardPart));
}

/** The most recent Part Used for a Part Spec: what to buy again. */
export function lastUsed(snapshot: Snapshot, partSpec: PartSpec): PartUsage | null {
  return usages(snapshot, partSpec.vehicleId, (p) => p.partSpecId === partSpec.id)[0] ?? null;
}

export interface Fitment {
  position: FitmentPosition;
  /** What is fitted there now: the most recent Part Used at this position. */
  current: PartUsage | null;
  /** Earlier Parts at this position, most recent first. */
  previous: PartUsage[];
}

export function fitments(snapshot: Snapshot, vehicleId: string): Fitment[] {
  return snapshot.positions
    .filter((p) => p.vehicleId === vehicleId)
    .map((position) => {
      const [current = null, ...previous] = usages(snapshot, vehicleId, (p) => p.positionId === position.id);
      return { position, current, previous };
    });
}

/** How far ahead the shopping list looks, beyond what is already due soon or overdue. */
export const SHOPPING_HORIZON_DAYS = 60;

export interface ShoppingItem {
  partSpec: PartSpec;
  /** Total needed across the upcoming Tasks. */
  quantity: number;
  tasks: { task: MaintenanceTask; due: DueInfo }[];
  lastUsed: PartUsage | null;
}

export interface VehicleShopping {
  vehicle: Vehicle;
  items: ShoppingItem[];
  /** Upcoming Tasks whose Required Parts have not been entered yet. */
  tasksWithoutParts: MaintenanceTask[];
}

function upcoming(due: DueInfo, today: IsoDate): boolean {
  if (due.status === 'overdue' || due.status === 'dueSoon') return true;
  return due.dueDate !== null && due.dueDate <= addDays(today, SHOPPING_HORIZON_DAYS);
}

/** The Parts needed for each owned Vehicle's Tasks coming due, from their Required Parts. */
export function shoppingList(snapshot: Snapshot, today: IsoDate): VehicleShopping[] {
  const tasks = new Map(snapshot.tasks.map((t) => [t.id, t]));
  const partSpecs = new Map(snapshot.partSpecs.map((p) => [p.id, p]));
  return snapshot.vehicles
    .filter((v) => v.status === 'owned')
    .map((vehicle) => {
      const items = new Map<string, ShoppingItem>();
      const tasksWithoutParts: MaintenanceTask[] = [];
      for (const due of vehicleDue(snapshot, vehicle.id, today).due.filter((d) => upcoming(d, today))) {
        const task = tasks.get(due.taskId)!;
        const required = task.requiredParts.filter((r) => partSpecs.has(r.partSpecId));
        if (required.length === 0) tasksWithoutParts.push(task);
        for (const r of required) {
          const item = items.get(r.partSpecId);
          if (item) {
            item.quantity += r.quantity;
            item.tasks.push({ task, due });
          } else {
            const partSpec = partSpecs.get(r.partSpecId)!;
            items.set(r.partSpecId, { partSpec, quantity: r.quantity, tasks: [{ task, due }], lastUsed: lastUsed(snapshot, partSpec) });
          }
        }
      }
      return { vehicle, items: [...items.values()], tasksWithoutParts };
    })
    .filter((v) => v.items.length > 0 || v.tasksWithoutParts.length > 0);
}

/**
 * Fills in what an older offline copy lacks. A phone may hold a snapshot (or queued Services) saved
 * before workshop data existed; screens can then rely on every field being there.
 */
export function normalizeSnapshot(snapshot: Snapshot): Snapshot {
  return {
    ...snapshot,
    tasks: snapshot.tasks.map((t) => ({
      ...t,
      workshopNotes: t.workshopNotes ?? null,
      requiredParts: t.requiredParts ?? [],
      tools: t.tools ?? [],
      specIds: t.specIds ?? [],
    })),
    services: snapshot.services.map(normalizeService),
    vehicleSpecs: snapshot.vehicleSpecs ?? [],
    partSpecs: (snapshot.partSpecs ?? []).map((p) => ({ ...p, standardPart: p.standardPart ?? null, notFitted: p.notFitted ?? false })),
    positions: snapshot.positions ?? [],
  };
}

export function normalizeService(service: Service): Service {
  return { ...service, partsUsed: service.partsUsed ?? [] };
}
