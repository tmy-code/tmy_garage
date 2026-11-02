import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { Catalogue } from '../shared/catalogue.ts';
import { buildOfRow, catalogueEntries } from './catalogue-rows.ts';

type Row = Record<string, any>;

/** A name compared loosely: case, accents and spacing aside. */
const looseName = (name: string | null) =>
  (name ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/**
 * The rework onto the five parts (Vehicle Profile, Maintenance Plan, Service History Log, Mileage Log and the status
 * worked out from them), run once on a database in the earlier model. Nothing the owner entered is lost:
 *
 * - Part Specs and Vehicle Specs become the Profile's spec lines, one label and value each (a part set aside as not
 *   on the vehicle, and a Part Spec nobody filled in, have nothing to keep);
 * - what a Task needed (Required Parts, Required Tools, linked specs) is written into its notes;
 * - a Task whose part was set aside, or that no longer fits its Build, is switched off, as it was paused before;
 * - a Task named after its part gets the name of the job, and every Task has its category;
 * - Parts Used become the components of a Service (the supplier goes into the description).
 *
 * After this a Vehicle's Tasks are its own: the catalogue only seeds a new Vehicle's plan.
 */
export function convertToFiveParts(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE spec_lines (
      id TEXT PRIMARY KEY,
      vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
      label TEXT NOT NULL,
      value TEXT NOT NULL,
      spec_group TEXT NOT NULL CHECK (spec_group IN ('fluids', 'parts', 'torque', 'other')),
      sort INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (vehicle_id, label)
    );
    ALTER TABLE catalogue_parts ADD COLUMN action TEXT CHECK (action IN ('replace', 'inspect', 'clean', 'adjust'));
    ALTER TABLE maintenance_tasks RENAME COLUMN workshop_notes TO notes;
  `);

  const catalogues = new Map<string, Catalogue>();
  const catalogueOf = (garageId: string) => {
    let c = catalogues.get(garageId);
    if (!c) catalogues.set(garageId, (c = new Catalogue(catalogueEntries(db, garageId))));
    return c;
  };

  const insertLine = db.prepare('INSERT INTO spec_lines (id, vehicle_id, label, value, spec_group, sort) VALUES (?, ?, ?, ?, ?, ?)');
  const setNotes = db.prepare('UPDATE maintenance_tasks SET notes = ? WHERE id = ?');
  const setOff = db.prepare('UPDATE maintenance_tasks SET switched_off = 1 WHERE id = ?');

  for (const v of db.prepare('SELECT * FROM vehicles').all() as Row[]) {
    const catalogue = catalogueOf(v.garage_id);
    const build = buildOfRow(v);
    const partLabel = (p: Row): string => (p.standard_part ? (catalogue.known(p.standard_part)?.en ?? p.name) : p.name);

    // --- the Profile's spec lines ---
    const lines = new Map<string, { value: string; group: string }>();
    const add = (label: string, value: string, group: string) => {
      const before = lines.get(label);
      lines.set(label, before ? { ...before, value: `${before.value} / ${value}` } : { value, group });
    };
    const partSpecs = db.prepare('SELECT * FROM part_specs WHERE vehicle_id = ? ORDER BY created_at, rowid').all(v.id) as Row[];
    for (const p of partSpecs) {
      if (p.not_fitted === 1) continue;
      const value = [p.characteristics, p.oem_reference ? `OEM ${p.oem_reference}` : null, p.part_numbers].filter(Boolean).join(' · ');
      if (value) add(partLabel(p), value, p.unit === 'litre' ? 'fluids' : 'parts');
    }
    const vehicleSpecs = db.prepare('SELECT * FROM vehicle_specs WHERE vehicle_id = ? ORDER BY created_at, rowid').all(v.id) as Row[];
    for (const s of vehicleSpecs) add(s.name, s.notes ? `${s.value} (${s.notes})` : s.value, s.kind === 'torque' ? 'torque' : 'other');
    const sorts = new Map<string, number>();
    for (const [label, { value, group }] of lines) {
      const sort = sorts.get(group) ?? 0;
      sorts.set(group, sort + 1);
      insertLine.run(randomUUID(), v.id, label, value, group, sort);
    }

    // --- the Tasks ---
    const specById = new Map(partSpecs.map((p) => [p.id as string, p]));
    const vehicleSpecById = new Map(vehicleSpecs.map((s) => [s.id as string, s]));
    for (const t of db.prepare('SELECT * FROM maintenance_tasks WHERE vehicle_id = ? ORDER BY created_at, rowid').all(v.id) as Row[]) {
      const needs = (db.prepare('SELECT * FROM required_parts WHERE task_id = ? ORDER BY sort').all(t.id) as Row[]).flatMap((r) => {
        const spec = specById.get(r.part_spec_id);
        if (!spec) return [];
        const unit = spec.unit === 'litre' ? ' L' : '';
        return [`${partLabel(spec)}${r.quantity != null ? ` ×${r.quantity}${unit}` : ''}`];
      });
      const tools = (db.prepare('SELECT name FROM required_tools WHERE task_id = ? ORDER BY sort').all(t.id) as Row[]).map((r) => r.name as string);
      const specs = (db.prepare('SELECT spec_id FROM task_specs WHERE task_id = ? ORDER BY rowid').all(t.id) as Row[]).flatMap((r) => {
        const s = vehicleSpecById.get(r.spec_id);
        return s ? [`${s.name}: ${s.value}`] : [];
      });
      const notes = [t.notes, needs.length ? `Needs: ${needs.join(', ')}` : null, tools.length ? `Tools: ${tools.join(', ')}` : null, specs.length ? `Specs: ${specs.join('; ')}` : null]
        .filter(Boolean)
        .join('\n');
      if (notes !== (t.notes ?? '')) setNotes.run(notes, t.id);

      if (t.standard_part) {
        const spec = partSpecs.find((p) => p.standard_part === t.standard_part);
        if ((spec && spec.not_fitted === 1) || !catalogue.fits(build, t.standard_part)) setOff.run(t.id);
        const part = catalogue.known(t.standard_part);
        if (part) {
          // A Task still named after its part (never renamed by the owner) gets the name of the job.
          if (part.builtIn && part.task && part.task.en !== t.name && catalogue.legacyTaskNames(part.code).map(looseName).includes(looseName(t.name))) {
            const fr = !t.name_fr || catalogue.legacyTaskNames(part.code).map(looseName).includes(looseName(t.name_fr)) ? part.task.fr : t.name_fr;
            db.prepare('UPDATE maintenance_tasks SET name = ?, name_fr = ? WHERE id = ?').run(part.task.en, fr, t.id);
          }
          if (t.category === null) db.prepare('UPDATE maintenance_tasks SET category = ? WHERE id = ?').run(part.category, t.id);
        }
      }
    }
  }

  db.exec(`
    CREATE TABLE service_items (
      service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      sort INTEGER NOT NULL,
      description TEXT NOT NULL,
      part_number TEXT,
      quantity REAL NOT NULL,
      unit TEXT NOT NULL CHECK (unit IN ('piece', 'litre')),
      PRIMARY KEY (service_id, sort)
    );
    INSERT INTO service_items (service_id, sort, description, part_number, quantity, unit)
      SELECT service_id, sort,
             CASE WHEN supplier IS NULL OR supplier = '' THEN description ELSE description || ' (' || supplier || ')' END,
             part_number, quantity, unit
      FROM parts_used;
    DROP TABLE parts_used;
    DROP TABLE task_specs;
    DROP TABLE required_parts;
    DROP TABLE required_tools;
    DROP TABLE part_specs;
    DROP TABLE vehicle_specs;
    DROP TABLE part_catalogue_moves;
    DROP TABLE schedule_moves;
    ALTER TABLE maintenance_tasks DROP COLUMN standard_part;
    ALTER TABLE maintenance_tasks DROP COLUMN custom_interval;
  `);
}
