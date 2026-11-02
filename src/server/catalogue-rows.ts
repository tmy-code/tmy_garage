import type { DatabaseSync } from 'node:sqlite';
import type { Build, CatalogueEntry, Conditions } from '../shared/catalogue.ts';

type Row = Record<string, any>;

/** A Vehicle row's Build. */
export const buildOfRow = (r: Row): Build => ({
  kind: r.kind,
  fuel: r.fuel,
  transmission: r.transmission,
  drivetrain: r.drivetrain,
  distribution: r.distribution,
  cooling: r.cooling,
  finalDrive: r.final_drive,
  cylinders: r.cylinders,
  hasHydraulicClutch: r.has_hydraulic_clutch === 1,
  hasTurbo: r.has_turbo === 1,
  hasDirectInjection: r.has_direct_injection === 1,
  hasStartStop: r.has_start_stop === 1,
  hasAdblue: r.has_adblue === 1,
  hasAc: r.has_ac === 1,
  hasAirSuspension: r.has_air_suspension === 1,
});

/** What the owner changed in a Garage's plan templates (the catalogue). */
export function catalogueEntries(db: DatabaseSync, garageId: string): CatalogueEntry[] {
  return (db.prepare('SELECT * FROM catalogue_parts WHERE garage_id = ? ORDER BY created_at, code').all(garageId) as Row[]).map((r) => ({
    code: r.code,
    own: r.kind
      ? {
          kind: r.kind,
          name: r.name,
          nameFr: r.name_fr,
          unit: r.unit,
          category: r.category,
          action: r.action ?? 'replace',
          intervalKm: r.interval_km,
          intervalMonths: r.interval_months,
        }
      : null,
    conditions: r.conditions ? (JSON.parse(r.conditions) as Conditions) : null,
    characteristics: r.characteristics,
    removed: r.removed === 1,
    overrides:
      !r.kind && (r.name || r.name_fr || r.category || r.action)
        ? { name: r.name, nameFr: r.name_fr, category: r.category, action: r.action }
        : null,
    interval: r.interval_set === 1 ? { intervalKm: r.interval_km, intervalMonths: r.interval_months } : null,
  }));
}
