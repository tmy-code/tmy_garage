import { catalogueOrder, PART_CATEGORIES, partCategory, type PartCategory } from './catalogue.ts';
import { addDays, type IsoDate } from './dates.ts';
import { vehicleDue, type DueInfo } from './due.ts';
import type { FitmentPosition, MaintenanceTask, Modification, PartSpec, PartUsed, Service, Snapshot, Vehicle } from './types.ts';

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
    .sort((a, b) => catalogueOrder(a.standardPart) - catalogueOrder(b.standardPart));
}

/** The most recent Part Used for a Part Spec: what to buy again. */
export function lastUsed(snapshot: Snapshot, partSpec: PartSpec): PartUsage | null {
  return usages(snapshot, partSpec.vehicleId, (p) => p.partSpecId === partSpec.id)[0] ?? null;
}

/** Something fitted at a Fitment Position: a Part Used in a Service, or a Modification. */
export interface FittedItem {
  label: string;
  date: IsoDate;
  odometer: number | null;
  modification: Modification | null;
}

export interface Fitment {
  position: FitmentPosition;
  /** What is fitted there now: the most recent Part Used or Modification at this position. */
  current: FittedItem | null;
  /** Earlier Parts and Modifications at this position, most recent first. */
  previous: FittedItem[];
}

/**
 * A Vehicle's Fitment Positions in catalogue order: those of its fitted Standard Parts, then older free-named ones.
 * A Standard Part marked as not on the Vehicle hides its position, unless something was already fitted there.
 */
export function positionsOf(snapshot: Snapshot, vehicle: Vehicle): FitmentPosition[] {
  const notFitted = new Set(
    snapshot.partSpecs.filter((p) => p.vehicleId === vehicle.id && p.notFitted && p.standardPart).map((p) => p.standardPart),
  );
  const used = new Set([
    ...snapshot.services.filter((s) => s.vehicleId === vehicle.id).flatMap((s) => s.partsUsed.map((p) => p.positionId)),
    ...snapshot.modifications.filter((m) => m.vehicleId === vehicle.id).map((m) => m.positionId),
  ]);
  return snapshot.positions
    .filter((p) => p.vehicleId === vehicle.id && (!p.standardPart || !notFitted.has(p.standardPart) || used.has(p.id)))
    .sort((a, b) => catalogueOrder(a.standardPart) - catalogueOrder(b.standardPart));
}

export function fitments(snapshot: Snapshot, vehicle: Vehicle): Fitment[] {
  const vehicleId = vehicle.id;
  return positionsOf(snapshot, vehicle)
    .map((position) => {
      const items: FittedItem[] = [
        ...usages(snapshot, vehicleId, (p) => p.positionId === position.id).map((u) => ({
          label: [u.part.description, u.part.partNumber].filter(Boolean).join(' · '),
          date: u.date,
          odometer: u.odometer,
          modification: null,
        })),
        ...snapshot.modifications
          .filter((m) => m.vehicleId === vehicleId && m.positionId === position.id)
          .map((m) => ({ label: m.name, date: m.fittedDate, odometer: m.fittedOdometer, modification: m })),
      ].sort((a, b) => (a.date === b.date ? (b.odometer ?? 0) - (a.odometer ?? 0) : a.date < b.date ? 1 : -1));
      // A Modification that was taken off is history, not what is fitted now.
      const currentIndex = items.findIndex((i) => !i.modification?.removedDate);
      const current = items[currentIndex] ?? null;
      return { position, current, previous: items.filter((_, i) => i !== currentIndex) };
    });
}

/** A Maintenance Task's category: its Standard Part's if it replaces one, else the one the owner picked, else 'other'. */
export function taskCategory(task: MaintenanceTask): PartCategory {
  return task.standardPart !== null ? partCategory(task.standardPart) : (task.category ?? 'other');
}

export interface TaskGroups {
  /** Categories in screen order, leaving out empty ones; each keeps the order it was given (most urgent first). */
  groups: { category: PartCategory; due: DueInfo[] }[];
  /** Paused Tasks, apart from the categories. */
  paused: DueInfo[];
}

/** A Vehicle's Tasks with their due information, grouped by category, paused ones set apart. */
export function groupByCategory(due: DueInfo[], tasks: Map<string, MaintenanceTask>): TaskGroups {
  const active = due.filter((d) => d.status !== 'paused' && tasks.has(d.taskId));
  return {
    groups: PART_CATEGORIES.map((category) => ({ category, due: active.filter((d) => taskCategory(tasks.get(d.taskId)!) === category) })).filter(
      (g) => g.due.length > 0,
    ),
    paused: due.filter((d) => d.status === 'paused' && tasks.has(d.taskId)),
  };
}

/** How far ahead the shopping list looks, beyond what is already due soon or overdue. */
export const SHOPPING_HORIZON_DAYS = 60;

export interface ShoppingItem {
  partSpec: PartSpec;
  /** Total needed across the upcoming Tasks; null while one of them does not say how much. */
  quantity: number | null;
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
            item.quantity = item.quantity === null || r.quantity === null ? null : item.quantity + r.quantity;
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
      nameFr: t.nameFr ?? null,
      workshopNotes: t.workshopNotes ?? null,
      standardPart: t.standardPart ?? null,
      category: t.category ?? null,
      requiredParts: t.requiredParts ?? [],
      tools: t.tools ?? [],
      specIds: t.specIds ?? [],
    })),
    services: snapshot.services.map(normalizeService),
    vehicleSpecs: snapshot.vehicleSpecs ?? [],
    partSpecs: (snapshot.partSpecs ?? []).map((p) => ({
      ...p,
      nameFr: p.nameFr ?? null,
      oemReference: p.oemReference ?? null,
      standardPart: p.standardPart ?? null,
      notFitted: p.notFitted ?? false,
    })),
    positions: (snapshot.positions ?? []).map((p) => ({ ...p, standardPart: p.standardPart ?? null })),
    vehicles: snapshot.vehicles.map((v) => ({
      ...v,
      firstRegistration: v.firstRegistration ?? null,
      vin: v.vin ?? null,
      version: v.version ?? null,
      fiscalPower: v.fiscalPower ?? null,
      nationalType: v.nationalType ?? null,
      purchaseDate: v.purchaseDate ?? null,
      overnightParking: v.overnightParking ?? null,
      fuel: v.fuel ?? null,
      transmission: v.transmission ?? null,
      drivetrain: v.drivetrain ?? null,
      distribution: v.distribution ?? null,
      cooling: v.cooling ?? null,
      finalDrive: v.finalDrive ?? null,
      cylinders: v.cylinders ?? null,
      hasHydraulicClutch: v.hasHydraulicClutch ?? false,
      hasTurbo: v.hasTurbo ?? false,
      hasDirectInjection: v.hasDirectInjection ?? false,
      hasStartStop: v.hasStartStop ?? false,
      hasAdblue: v.hasAdblue ?? false,
      hasAc: v.hasAc ?? false,
      hasAirSuspension: v.hasAirSuspension ?? false,
      onGaragePage: v.onGaragePage ?? v.status === 'owned',
    })),
    inspections: snapshot.inspections ?? [],
    modifications: snapshot.modifications ?? [],
    documents: snapshot.documents ?? [],
    drivers: snapshot.drivers ?? [],
    policies: snapshot.policies ?? [],
    claims: snapshot.claims ?? [],
    quotes: snapshot.quotes ?? [],
  };
}

export function normalizeService(service: Service): Service {
  return { ...service, partsUsed: service.partsUsed ?? [] };
}
