import { PART_CATEGORIES, type PartCategory } from './catalogue.ts';
import type { DueInfo } from './due.ts';
import type { ComponentSpec, Confirmation, MaintenanceTask, Ownership, Service, Snapshot } from './types.ts';

/** A Maintenance Task's category: the one the owner picked, else 'other'. */
export function taskCategory(task: MaintenanceTask): PartCategory {
  return task.category ?? 'other';
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

/** A name or tag compared loosely: case, accents and spacing aside. Used to match Notion values with the app's. */
export function refKey(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * The mapping from the old names stays while phones may hold old snapshots (or an old server may answer): the
 * Component Specs were `vehicleSpecs`, and `status` was the `ownership` of a Vehicle and the `confirmation` of a
 * Vehicle Consumable or Component Spec.
 */
type LegacyStatus = { status?: unknown };
type LegacySnapshot = Omit<Snapshot, 'vehicles' | 'vehicleConsumables' | 'componentSpecs'> & {
  vehicles: (Omit<Snapshot['vehicles'][number], 'ownership'> & { ownership?: Ownership } & LegacyStatus)[];
  vehicleConsumables?: (Omit<Snapshot['vehicleConsumables'][number], 'confirmation'> & { confirmation?: Confirmation } & LegacyStatus)[];
  componentSpecs?: (Omit<ComponentSpec, 'confirmation'> & { confirmation?: Confirmation } & LegacyStatus)[];
  vehicleSpecs?: (Omit<ComponentSpec, 'confirmation'> & { confirmation?: Confirmation } & LegacyStatus)[];
};

/**
 * Fills in what an older offline copy lacks. A phone may hold a snapshot (or queued Services) saved
 * before workshop data existed; screens can then rely on every field being there.
 */
export function normalizeSnapshot(input: Snapshot): Snapshot {
  const { vehicleSpecs: legacySpecs, ...snapshot } = input as unknown as LegacySnapshot;
  return {
    ...snapshot,
    tasks: snapshot.tasks.map((t) => ({
      ...t,
      nameFr: t.nameFr ?? null,
      notes: t.notes ?? null,
      category: t.category ?? null,
      switchedOff: t.switchedOff ?? false,
      action: t.action ?? 'replace',
      refTaskId: t.refTaskId ?? null,
      notionPlanId: t.notionPlanId ?? null,
    })),
    refTasks: (snapshot.refTasks ?? []).map((r) => ({ ...r, applicableIf: r.applicableIf ?? [], consumableTypeIds: r.consumableTypeIds ?? [], componentTypeIds: r.componentTypeIds ?? [], toolIds: r.toolIds ?? [], instructions: r.instructions ?? null })),
    componentTypes: snapshot.componentTypes ?? [],
    consumableTypes: snapshot.consumableTypes ?? [],
    products: snapshot.products ?? [],
    tools: snapshot.tools ?? [],
    vehicleConsumables: (snapshot.vehicleConsumables ?? []).map(({ status, ...c }) => ({
      ...c,
      compatibleProductIds: c.compatibleProductIds ?? [],
      specification: c.specification ?? null,
      confirmation: c.confirmation ?? (status as Confirmation | undefined) ?? null,
    })),
    componentSpecs: (snapshot.componentSpecs ?? legacySpecs ?? []).map(({ status, ...s }) => ({ ...s, confirmation: s.confirmation ?? (status as Confirmation | undefined) ?? null })),
    notionPurchases: (snapshot.notionPurchases ?? []).map((p) => ({ ...p, productId: p.productId ?? null, quantity: p.quantity ?? null, price: p.price ?? null, shop: p.shop ?? null })),
    notion: snapshot.notion ?? null,
    services: snapshot.services.map(normalizeService),
    catalogue: (snapshot.catalogue ?? []).map((e) => ({ ...e, overrides: e.overrides ?? null, own: e.own ? { ...e.own, action: e.own.action ?? 'replace' } : null })),
    specLines: (snapshot.specLines ?? []).map((l) => ({ ...l, oem: l.oem ?? null, category: l.category ?? null })),
    vehicleParts: (snapshot.vehicleParts ?? []).map((p) => ({ ...p, partNumber: p.partNumber ?? null, price: p.price ?? null, taskId: p.taskId ?? null, specLineId: p.specLineId ?? null, notes: p.notes ?? null })),
    vehicles: snapshot.vehicles.map(({ status, ...v }) => ({
      ...v,
      ownership: v.ownership ?? (status as Ownership | undefined) ?? 'owned',
      vin: v.vin ?? null,
      firstRegistrationDate: v.firstRegistrationDate ?? null,
      purchaseDate: v.purchaseDate ?? null,
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
      onGaragePage: v.onGaragePage ?? (v.ownership ?? status ?? 'owned') === 'owned',
      equipment: v.equipment ?? [],
      notionPageId: v.notionPageId ?? null,
    })),
    fillups: (snapshot.fillups ?? []).map((f) => ({ ...f, odometer: f.odometer ?? null, notes: f.notes ?? null, fullTank: f.fullTank ?? true })),
    documents: snapshot.documents ?? [],
  };
}

export function normalizeService(service: Service): Service {
  return { ...service, partsUsed: (service.partsUsed ?? []).map((p) => ({ description: p.description, partNumber: p.partNumber ?? null, quantity: p.quantity, unit: p.unit, price: p.price ?? null, partId: p.partId ?? null, ...(p.consumableTypeId ? { consumableTypeId: p.consumableTypeId } : {}), ...(p.productId ? { productId: p.productId } : {}), ...(p.remember ? { remember: true } : {}) })), kind: service.kind ?? 'maintenance', title: service.title ?? null, category: service.category ?? null, performedBy: service.performedBy ?? 'diy', totalCost: service.totalCost ?? null };
}
