// What the Notion copy pushes (ADR 0005, amended by 0007): owned Vehicles and all their items. The spec lines are no longer copied.
// Pure: turns a snapshot into rows keyed by the app's ids, with no knowledge of the Notion API.
import { vehicleDue, type DueInfo } from '../shared/due.ts';
import type { IsoDate } from '../shared/dates.ts';
import { purchaseUnitPrice, type Snapshot, type Vehicle } from '../shared/types.ts';
import { SPEC_FLAGS } from '../shared/catalogue.ts';
import type { Messages } from '../shared/messages.ts';

export interface VehicleRow {
  appId: string;
  name: string;
  kind: string;
  make: string | null;
  model: string | null;
  year: number | null;
  build: string;
  odometer: number | null;
  odometerDate: IsoDate | null;
  kmPerDay: number | null;
  copiedOn: IsoDate;
}

export interface ItemRow {
  appId: string;
  vehicleAppId: string;
  name: string;
  partNumber: string | null;
  unit: string;
  quantity: number;
  state: string;
  lastUnitPrice: number | null;
  task: string | null;
  dueDate: IsoDate | null;
  dueStatus: string | null;
}

export interface NotionCopy {
  vehicles: VehicleRow[];
  items: ItemRow[];
}

/** The Build in one line, in the app's own words: "Essence · Manuelle · Chaîne · Turbo". */
export function buildSummary(v: Vehicle, t: Messages): string {
  const s = t.setup;
  const parts: string[] = [];
  if (v.fuel) parts.push(s.fuels[v.fuel]);
  if (v.transmission) parts.push(s.transmissions[v.transmission]);
  if (v.drivetrain) parts.push(s.drivetrains[v.drivetrain]);
  if (v.distribution) parts.push(`${s.distribution} : ${s.distributions[v.distribution]}`);
  if (v.finalDrive) parts.push(`${s.finalDrive} : ${s.finalDrives[v.finalDrive]}`);
  if (v.cooling) parts.push(`${s.cooling} : ${s.coolings[v.cooling]}`);
  if (v.cylinders) parts.push(`${v.cylinders} ${s.cylinders.toLowerCase()}`);
  for (const flag of SPEC_FLAGS) if (v[flag]) parts.push(s.flags[flag]);
  return parts.join(' · ');
}

export function buildCopy(snapshot: Snapshot, today: IsoDate, t: Messages): NotionCopy {
  const owned = snapshot.vehicles.filter((v) => v.status === 'owned');
  const ownedIds = new Set(owned.map((v) => v.id));
  const dueByTask = new Map<string, DueInfo>();

  const vehicles = owned.map((v): VehicleRow => {
    const { usage, due } = vehicleDue(snapshot, v.id, today);
    for (const d of due) dueByTask.set(d.taskId, d);
    return {
      appId: v.id,
      name: v.name,
      kind: v.kind === 'car' ? t.setup.car : t.setup.motorcycle,
      make: v.make,
      model: v.model,
      year: v.year,
      build: buildSummary(v, t),
      odometer: usage.latest?.odometer ?? null,
      odometerDate: usage.latest?.date ?? null,
      kmPerDay: usage.kmPerDay === null ? null : Math.round(usage.kmPerDay * 10) / 10,
      copiedOn: today,
    };
  });

  const tasks = new Map(snapshot.tasks.map((task) => [task.id, task]));
  const items = snapshot.vehicleParts
    .filter((p) => ownedIds.has(p.vehicleId))
    .map((p): ItemRow => {
      const last = snapshot.purchases
        .filter((x) => x.partId === p.id && x.quantity > 0)
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
        .at(-1);
      const task = p.taskId ? tasks.get(p.taskId) : undefined;
      const due = task ? dueByTask.get(task.id) : undefined;
      return {
        appId: p.id,
        vehicleAppId: p.vehicleId,
        name: p.name,
        partNumber: p.partNumber,
        unit: t.parts.unitSingular[p.unit],
        quantity: p.quantity,
        state: p.toBuy ? STATE_TO_BUY : STATE_BOUGHT,
        lastUnitPrice: last ? Math.round(purchaseUnitPrice(last) * 100) / 100 : null,
        task: task ? (task.nameFr ?? task.name) : null,
        dueDate: due?.dueDate ?? null,
        dueStatus: due ? t.status[due.status] : null,
      };
    });

  return { vehicles, items };
}

export const STATE_TO_BUY = 'À acheter';
export const STATE_BOUGHT = 'Achetée';
