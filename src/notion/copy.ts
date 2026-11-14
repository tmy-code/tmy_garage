// What the Notion copy pushes (ADR 0005, amended by 0007 and 0008): owned Vehicles only; Articles is no longer copied (ADR 0008).
// Pure: turns a snapshot into rows keyed by the app's ids, with no knowledge of the Notion API.
import { vehicleDue } from '../shared/due.ts';
import type { IsoDate } from '../shared/dates.ts';
import type { Snapshot, Vehicle } from '../shared/types.ts';
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

export interface NotionCopy {
  vehicles: VehicleRow[];
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
  const owned = snapshot.vehicles.filter((v) => v.ownership === 'owned');

  const vehicles = owned.map((v): VehicleRow => {
    const { usage } = vehicleDue(snapshot, v.id, today);
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

  return { vehicles };
}
