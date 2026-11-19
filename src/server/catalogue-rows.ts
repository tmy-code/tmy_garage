import type { DatabaseSync } from 'node:sqlite';
import type { CatalogueEntry, Conditions } from '../shared/catalogue.ts';

type Row = Record<string, any>;

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
