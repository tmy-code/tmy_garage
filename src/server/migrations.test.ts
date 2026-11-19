import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  Snapshot,
  Vehicle,
} from '../shared/types.ts';
import { API_VERSION } from '../shared/api-version.ts';
import { createApp } from './app.ts';
import { openDatabase } from './db.ts';
import { db, app, call, createVehicle, snapshot, setApp, setupGarage } from './test-helpers.ts';

setupGarage();

describe('migrations', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'garage-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('does not back up a brand new database, and reopening is a no-op', () => {
    const path = join(dir, 'garage.sqlite');
    openDatabase(path, join(dir, 'backups')).close();
    openDatabase(path, join(dir, 'backups')).close();
    expect(() => readdirSync(join(dir, 'backups'))).toThrow();
  });

  it('backs up an existing database before migrating it, and keeps its data', () => {
    const path = join(dir, 'garage.sqlite');
    // A database as the first release left it: schema version 1, without workshop data.
    const old = openDatabase(path, undefined, 1);
    old.exec(`INSERT INTO vehicles (id, garage_id, kind, name) VALUES ('v1', 'default', 'car', 'Old car')`);
    old.exec(`INSERT INTO maintenance_tasks (id, vehicle_id, name, interval_km) VALUES ('t1', 'v1', 'Oil', 10000)`);
    old.close();

    const migrated = openDatabase(path, join(dir, 'backups'));
    const backups = readdirSync(join(dir, 'backups'));
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/^garage-v1-.*\.sqlite$/);
    const task = migrated.prepare('SELECT * FROM maintenance_tasks').get() as Record<string, unknown>;
    expect(task).toMatchObject({ id: 't1', interval_km: 10000, action: 'replace' });
    migrated.close();
  });

  it('moves Documents to their Garage when insurance arrives', () => {
    const path = join(dir, 'garage.sqlite');
    const old = openDatabase(path, undefined, 5);
    old.exec(`INSERT INTO vehicles (id, garage_id, kind, name) VALUES ('v1', 'default', 'car', 'Old car')`);
    old.exec(`INSERT INTO documents (id, vehicle_id, owner_kind, owner_id, type, file_name, content_type, size)
              VALUES ('d1', 'v1', 'vehicle', 'v1', 'registration', 'a.pdf', 'application/pdf', 3)`);
    old.close();
    const migrated = openDatabase(path);
    expect(migrated.prepare('SELECT garage_id, vehicle_id, owner_kind FROM documents').all()).toEqual([
      { garage_id: 'default', vehicle_id: 'v1', owner_kind: 'vehicle' },
    ]);
    migrated.close();
  });

  it('keeps each vehicle’s fuel when flex-fuel joins the fuels', () => {
    const path = join(dir, 'garage.sqlite');
    const old = openDatabase(path, undefined, 15);
    old.exec(`INSERT INTO vehicles (id, garage_id, kind, name, fuel) VALUES ('p', 'default', 'car', 'Petrol car', 'phev'), ('n', 'default', 'car', 'Old car', NULL)`);
    old.close();
    const migrated = openDatabase(path);
    expect(migrated.prepare('SELECT id, fuel FROM vehicles ORDER BY id').all()).toEqual([
      { id: 'n', fuel: null },
      { id: 'p', fuel: 'phev' },
    ]);
    migrated.exec(`UPDATE vehicles SET fuel = 'flexfuel' WHERE id = 'n'`);
    migrated.close();
  });

  it('keeps every Service’s odometer when it becomes optional', () => {
    const path = join(dir, 'garage.sqlite');
    const old = openDatabase(path, undefined, 16);
    old.exec(`INSERT INTO vehicles (id, garage_id, kind, name) VALUES ('v1', 'default', 'car', 'Old car')`);
    old.exec(`INSERT INTO maintenance_tasks (id, vehicle_id, name, interval_km) VALUES ('t1', 'v1', 'Oil', 10000)`);
    old.exec(`INSERT INTO services (id, vehicle_id, date, odometer) VALUES ('s1', 'v1', '2026-01-10', 20000)`);
    old.exec(`INSERT INTO service_tasks (service_id, task_id) VALUES ('s1', 't1')`);
    old.close();
    const migrated = openDatabase(path);
    expect(migrated.prepare('SELECT id, odometer FROM services').all()).toEqual([{ id: 's1', odometer: 20000 }]);
    expect(migrated.prepare('SELECT service_id, task_id FROM service_tasks').all()).toEqual([{ service_id: 's1', task_id: 't1' }]);
    migrated.exec(`INSERT INTO services (id, vehicle_id, date) VALUES ('s2', 'v1', '2026-02-01')`);
    migrated.close();
  });

  it('keeps sold vehicles off the garage page, as before, when the choice arrives', () => {
    const path = join(dir, 'garage.sqlite');
    const old = openDatabase(path, undefined, 10);
    old.exec(`INSERT INTO vehicles (id, garage_id, kind, name) VALUES ('kept', 'default', 'car', 'Kept car')`);
    old.exec(`INSERT INTO vehicles (id, garage_id, kind, name, status) VALUES ('gone', 'default', 'car', 'Sold car', 'sold')`);
    old.close();
    const migrated = openDatabase(path);
    expect(migrated.prepare('SELECT id, on_garage_page FROM vehicles ORDER BY id').all()).toEqual([
      { id: 'gone', on_garage_page: 0 },
      { id: 'kept', on_garage_page: 1 },
    ]);
    migrated.close();
  });

  it('adds the catalogue’s own intervals and switched-off tasks, and keeps no rules by build', () => {
    const path = join(dir, 'garage.sqlite');
    const old = openDatabase(path, undefined, 18);
    old.exec(`INSERT INTO vehicles (id, garage_id, kind, name) VALUES ('v1', 'default', 'car', 'Old car')`);
    old.exec(`INSERT INTO maintenance_tasks (id, vehicle_id, name, interval_km) VALUES ('t1', 'v1', 'Oil', 10000)`);
    old.exec(`INSERT INTO catalogue_parts (garage_id, code, conditions, removed) VALUES ('default', 'wipers', '{}', 1)`);
    old.close();
    const migrated = openDatabase(path);
    expect(migrated.prepare('SELECT switched_off FROM maintenance_tasks').all()).toEqual([{ switched_off: 0 }]);
    expect(migrated.prepare('SELECT code, removed, interval_set FROM catalogue_parts').all()).toEqual([{ code: 'wipers', removed: 1, interval_set: 0 }]);
    expect(migrated.prepare(`SELECT name FROM pragma_table_info('catalogue_parts') WHERE name = 'interval_rules'`).all()).toEqual([]);
    migrated.close();
  });

  it('turns what the owner changed on the car tyres template into the same change on front and rear tyres', () => {
    const path = join(dir, 'garage.sqlite');
    // Just before the migration that split this template (a fixed version, so later migrations do not move it).
    const old = openDatabase(path, undefined, 28);
    old.exec(`INSERT INTO catalogue_parts (garage_id, code, conditions, removed) VALUES ('default', 'tires', '{}', 1)`);
    old.close();
    const migrated = openDatabase(path);
    expect(migrated.prepare('SELECT code, removed FROM catalogue_parts ORDER BY code').all()).toEqual([
      { code: 'tires_front', removed: 1 },
      { code: 'tires_rear', removed: 1 },
    ]);
    migrated.close();
  });

  it('turns what the owner changed on the fork oil and seals template into the same change on each', () => {
    const path = join(dir, 'garage.sqlite');
    // Just before the migration that split this template (a fixed version, so later migrations do not move it).
    const old = openDatabase(path, undefined, 29);
    old.exec(`INSERT INTO catalogue_parts (garage_id, code, conditions, removed) VALUES ('default', 'moto_fork_oil_seals', '{}', 1)`);
    old.close();
    const migrated = openDatabase(path);
    expect(migrated.prepare('SELECT code, removed FROM catalogue_parts ORDER BY code').all()).toEqual([
      { code: 'moto_fork_oil', removed: 1 },
      { code: 'moto_fork_seals', removed: 1 },
    ]);
    migrated.close();
  });

  it('turns what the owner changed on the car shock absorbers template into the same change on front and rear', () => {
    const path = join(dir, 'garage.sqlite');
    // Just before the migration that split this template (a fixed version, so later migrations do not move it).
    const old = openDatabase(path, undefined, 30);
    old.exec(`INSERT INTO catalogue_parts (garage_id, code, conditions, removed) VALUES ('default', 'shock_absorbers', '{}', 1)`);
    old.close();
    const migrated = openDatabase(path);
    expect(migrated.prepare('SELECT code, removed FROM catalogue_parts ORDER BY code').all()).toEqual([
      { code: 'shock_absorbers_front', removed: 1 },
      { code: 'shock_absorbers_rear', removed: 1 },
    ]);
    migrated.close();
  });

  it('drops the rules by build a database may already hold', () => {
    const path = join(dir, 'garage.sqlite');
    const old = openDatabase(path, undefined, 19);
    old.exec(`INSERT INTO catalogue_parts (garage_id, code, conditions, removed) VALUES ('default', 'wipers', '{}', 1)`);
    old.close();
    const migrated = openDatabase(path);
    expect(migrated.prepare('SELECT code FROM catalogue_parts').all()).toEqual([{ code: 'wipers' }]);
    migrated.close();
  });

  it('moves the twelve categories into six, for Tasks and the owner’s own parts', () => {
    const path = join(dir, 'garage.sqlite');
    const old = openDatabase(path, undefined, 20);
    old.exec(`INSERT INTO vehicles (id, garage_id, kind, name) VALUES ('v1', 'default', 'car', 'Old car')`);
    const task = (id: string, category: string | null) =>
      old.exec(`INSERT INTO maintenance_tasks (id, vehicle_id, name, interval_km, category) VALUES ('${id}', 'v1', '${id}', 1000, ${category ? `'${category}'` : 'NULL'})`);
    for (const c of ['engine', 'ignition', 'fuel_exhaust', 'cooling', 'transmission', 'drivetrain', 'brakes', 'tires_suspension', 'electrical', 'hvac', 'body', 'other']) task(c, c);
    task('none', null);
    old.exec(`INSERT INTO catalogue_parts (garage_id, code, kind, name, unit, category, interval_km) VALUES ('default', 'own_a', 'car', 'Roof rack', 'piece', 'body', 1000)`);
    old.exec(`INSERT INTO catalogue_parts (garage_id, code, conditions, removed) VALUES ('default', 'wipers', '{}', 1)`);
    old.close();

    const migrated = openDatabase(path);
    const categories = Object.fromEntries((migrated.prepare('SELECT id, category FROM maintenance_tasks').all() as { id: string; category: string | null }[]).map((r) => [r.id, r.category]));
    expect(categories).toEqual({
      engine: 'engine', ignition: 'engine', fuel_exhaust: 'engine',
      transmission: 'transmission', drivetrain: 'transmission',
      brakes: 'brakes',
      tires_suspension: 'chassis', body: 'chassis',
      electrical: 'electrical',
      cooling: 'cooling_climate', hvac: 'cooling_climate',
      other: 'other',
      none: null,
    });
    expect(migrated.prepare('SELECT code, category FROM catalogue_parts ORDER BY code').all()).toEqual([
      { code: 'own_a', category: 'chassis' },
      { code: 'wipers', category: null },
    ]);
    expect(() => migrated.exec(`UPDATE maintenance_tasks SET category = 'hvac' WHERE id = 'none'`)).toThrow();
    migrated.close();
  });

  it('drops the fitted-parts positions, keeping every Part Used', () => {
    const path = join(dir, 'garage.sqlite');
    const old = openDatabase(path, undefined, 21);
    old.exec(`INSERT INTO vehicles (id, garage_id, kind, name) VALUES ('v1', 'default', 'car', 'Old car')`);
    old.exec(`INSERT INTO services (id, vehicle_id, date, odometer) VALUES ('s1', 'v1', '2026-01-10', 20000)`);
    old.exec(`INSERT INTO part_specs (id, vehicle_id, standard_part, name, unit) VALUES ('p1', 'v1', 'tires', 'tires', 'piece')`);
    old.exec(`INSERT INTO fitment_positions (id, vehicle_id, name, standard_part) VALUES ('tyres', 'v1', 'tires', 'tires')`);
    old.exec(`INSERT INTO parts_used (service_id, sort, part_spec_id, position_id, description, quantity, unit, price) VALUES ('s1', 0, 'p1', 'tyres', 'Michelin', 4, 'piece', 480)`);
    old.close();

    const migrated = openDatabase(path);
    expect(migrated.prepare(`SELECT name FROM sqlite_master WHERE name = 'fitment_positions'`).all()).toEqual([]);
    expect(migrated.prepare('SELECT service_id, sort, description, quantity FROM service_items').all()).toEqual([
      { service_id: 's1', sort: 0, description: 'Michelin', quantity: 4 },
    ]);
    // A Service still takes its components with it.
    migrated.exec(`DELETE FROM services WHERE id = 's1'`);
    expect(migrated.prepare('SELECT COUNT(*) AS n FROM service_items').get()).toEqual({ n: 0 });
    migrated.close();
  });

  it('drops insurance, inspections, modifications, quotes and drivers, keeping vehicles, services and Documents', async () => {
    const path = join(dir, 'garage.sqlite');
    const old = openDatabase(path, undefined, 22);
    old.exec(`INSERT INTO vehicles (id, garage_id, kind, name, registration, vin) VALUES ('v1', 'default', 'car', 'Old car', 'AA-000-AA', 'VF1TESTVIN0000001')`);
    old.exec(`INSERT INTO services (id, vehicle_id, date, odometer) VALUES ('s1', 'v1', '2026-01-10', 20000)`);
    old.exec(`INSERT INTO insurance_policies (id, garage_id, insurer, start_date) VALUES ('pol', 'default', 'Assurance Exemple', '2025-04-01')`);
    old.exec(`INSERT INTO documents (id, garage_id, vehicle_id, owner_kind, owner_id, type, file_name, content_type, size)
              VALUES ('d1', 'default', 'v1', 'service', 's1', 'invoice', 'a.pdf', 'application/pdf', 3),
                     ('d2', 'default', NULL, 'policy', 'pol', 'policySchedule', 'b.pdf', 'application/pdf', 3)`);
    old.close();

    const migrated = openDatabase(path);
    const tables = (migrated.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((t) => t.name);
    for (const gone of ['insurance_policies', 'drivers', 'quotes', 'claims', 'covers', 'policy_terms', 'technical_inspections', 'modifications']) {
      expect(tables).not.toContain(gone);
    }
    expect(migrated.prepare('SELECT id, vin FROM vehicles').all()).toEqual([{ id: 'v1', vin: 'VF1TESTVIN0000001' }]);
    expect(migrated.prepare('SELECT id FROM services').all()).toEqual([{ id: 's1' }]);
    // Both Documents stay stored; only the Service's receipt is shown.
    expect(migrated.prepare('SELECT COUNT(*) AS n FROM documents').get()).toEqual({ n: 2 });
    migrated.close();
    const reopened = openDatabase(path);
    const snap = (await (await createApp(reopened).request('/api/snapshot')).json()) as Snapshot;
    expect(snap.documents.map((d) => d.id)).toEqual(['d1']);
    reopened.close();
  });

  it('guesses a Task’s action from its name, folds the Official Interval into the Interval, and sums the prices into a Service’s cost', () => {
    const path = join(dir, 'garage.sqlite');
    const old = openDatabase(path, undefined, 23);
    old.exec(`INSERT INTO vehicles (id, garage_id, kind, name) VALUES ('v1', 'default', 'car', 'Old car')`);
    old.exec(`INSERT INTO maintenance_tasks (id, vehicle_id, name, name_fr, interval_km, interval_months, official_interval_km, official_interval_months) VALUES
      ('t1', 'v1', 'Change engine oil', NULL, 15000, 12, 10000, NULL),
      ('t2', 'v1', 'Check tyre pressure', NULL, NULL, 1, NULL, NULL),
      ('t3', 'v1', 'Nettoyer le filtre', 'Nettoyer le filtre', 20000, NULL, NULL, 24),
      ('t4', 'v1', 'Lubricate the chain', NULL, 1000, NULL, 800, NULL)`);
    old.exec(`INSERT INTO services (id, vehicle_id, date, odometer) VALUES ('s1', 'v1', '2026-01-10', 20000), ('s2', 'v1', '2026-02-10', 21000)`);
    old.exec(`INSERT INTO parts_used (service_id, sort, description, quantity, unit, price) VALUES
      ('s1', 0, 'Oil', 4, 'litre', 40), ('s1', 1, 'Filter', 1, 'piece', 12.5), ('s2', 0, 'Pads', 1, 'piece', NULL)`);
    old.close();

    const migrated = openDatabase(path);
    expect(migrated.prepare('SELECT id, action, interval_km, interval_months FROM maintenance_tasks ORDER BY id').all()).toEqual([
      { id: 't1', action: 'replace', interval_km: 10000, interval_months: 12 },
      { id: 't2', action: 'inspect', interval_km: null, interval_months: 1 },
      { id: 't3', action: 'clean', interval_km: 20000, interval_months: 24 },
      { id: 't4', action: 'adjust', interval_km: 800, interval_months: null },
    ]);
    expect(migrated.prepare('SELECT id, performed_by, total_cost FROM services ORDER BY id').all()).toEqual([
      { id: 's1', performed_by: 'diy', total_cost: 52.5 },
      { id: 's2', performed_by: 'diy', total_cost: null },
    ]);
    migrated.close();
  });

  it('converts the earlier model to the five parts: spec lines, task notes, paused tasks, components', () => {
    const path = join(dir, 'garage.sqlite');
    const old = openDatabase(path, undefined, 23);
    old.exec(`INSERT INTO vehicles (id, garage_id, kind, name, fuel, transmission, cooling, final_drive, cylinders)
              VALUES ('v1', 'default', 'motorcycle', 'Old bike', 'petrol', 'manual', 'liquid', 'chain', 2)`);
    old.exec(`INSERT INTO part_specs (id, vehicle_id, standard_part, name, unit, characteristics, part_numbers, not_fitted) VALUES
      ('p-oil', 'v1', 'moto_engine_oil', 'moto_engine_oil', 'litre', '10W-40, JASO MA2', NULL, 0),
      ('p-chain', 'v1', 'moto_chain', 'moto_chain', 'piece', NULL, 'DID 520', 0),
      ('p-belt', 'v1', 'moto_drive_belt', 'moto_drive_belt', 'piece', '', NULL, 1),
      ('p-rack', 'v1', NULL, 'Roof rack', 'piece', 'Thule', NULL, 0)`);
    old.exec(`INSERT INTO vehicle_specs (id, vehicle_id, kind, name, value, notes) VALUES ('vs1', 'v1', 'torque', 'Drain plug', '30 Nm', 'new washer')`);
    old.exec(`INSERT INTO maintenance_tasks (id, vehicle_id, name, name_fr, interval_km, interval_months, standard_part, workshop_notes) VALUES
      ('t-oil', 'v1', 'Engine oil', NULL, 8000, 12, 'moto_engine_oil', 'Warm the engine first'),
      ('t-belt', 'v1', 'Final drive belt', NULL, 60000, NULL, 'moto_drive_belt', NULL),
      ('t-own', 'v1', 'Wash', NULL, NULL, 1, NULL, NULL)`);
    old.exec(`INSERT INTO required_parts (task_id, part_spec_id, quantity, sort) VALUES ('t-oil', 'p-oil', 3.2, 0)`);
    old.exec(`INSERT INTO required_tools (task_id, sort, name) VALUES ('t-oil', 0, '17 mm socket')`);
    old.exec(`INSERT INTO task_specs (task_id, spec_id) VALUES ('t-oil', 'vs1')`);
    old.exec(`INSERT INTO services (id, vehicle_id, date, odometer) VALUES ('s1', 'v1', '2026-01-10', 20000)`);
    old.exec(`INSERT INTO parts_used (service_id, sort, part_spec_id, description, quantity, unit, price, supplier) VALUES
      ('s1', 0, 'p-oil', 'Motul 7100', 3, 'litre', 40, 'Shop')`);
    old.close();

    const migrated = openDatabase(path, undefined, 25);
    const tables = (migrated.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((t) => t.name);
    for (const gone of ['part_specs', 'vehicle_specs', 'required_parts', 'required_tools', 'task_specs', 'parts_used']) expect(tables).not.toContain(gone);
    expect(migrated.prepare('SELECT label, value, spec_group FROM spec_lines ORDER BY spec_group, sort').all()).toEqual([
      { label: 'Engine oil', value: '10W-40, JASO MA2', spec_group: 'fluids' },
      { label: 'Chain', value: 'DID 520', spec_group: 'parts' },
      { label: 'Roof rack', value: 'Thule', spec_group: 'parts' },
      { label: 'Drain plug', value: '30 Nm (new washer)', spec_group: 'torque' },
    ]);
    const tasks = migrated.prepare('SELECT id, name, notes, switched_off, category FROM maintenance_tasks ORDER BY id').all() as Record<string, unknown>[];
    expect(tasks.find((t) => t.id === 't-oil')).toMatchObject({
      name: 'Change engine oil and filter',
      notes: 'Warm the engine first\nNeeds: Engine oil ×3.2 L\nTools: 17 mm socket\nSpecs: Drain plug: 30 Nm',
      switched_off: 0,
      category: 'engine',
    });
    // A part set aside as not on the vehicle pauses its Task; an own Task stays as it is.
    expect(tasks.find((t) => t.id === 't-belt')).toMatchObject({ switched_off: 1 });
    expect(tasks.find((t) => t.id === 't-own')).toMatchObject({ name: 'Wash', switched_off: 0, category: null });
    expect(migrated.prepare('SELECT description, quantity FROM service_items').all()).toEqual([{ description: 'Motul 7100 (Shop)', quantity: 3 }]);
    expect(migrated.prepare('SELECT total_cost FROM services').get()).toEqual({ total_cost: 40 });
    migrated.close();
  });

  it('keeps the parts and receipts already there when purchases arrive, with an empty legacy log', () => {
    const path = join(dir, 'garage.sqlite');
    const old = openDatabase(path, undefined, 35);
    old.exec(`INSERT INTO vehicles (id, garage_id, kind, name) VALUES ('v1', 'default', 'motorcycle', 'Old bike')`);
    old.exec(`INSERT INTO vehicle_parts (id, vehicle_id, name, unit, quantity, price) VALUES ('p1', 'v1', 'Motul 7100 10W-40', 'litre', 5, 8)`);
    old.exec(`INSERT INTO documents (id, garage_id, vehicle_id, owner_kind, owner_id, type, file_name, content_type, size)
              VALUES ('d1', 'default', 'v1', 'vehicle', 'v1', 'manual', 'manual.pdf', 'application/pdf', 10)`);
    old.close();
    const migrated = openDatabase(path);
    expect(migrated.prepare('SELECT id, name, to_buy, notes FROM vehicle_items').all()).toEqual([{ id: 'p1', name: 'Motul 7100 10W-40', to_buy: 0, notes: null }]);
    expect(migrated.prepare('SELECT count(*) AS n FROM purchases').get()).toEqual({ n: 0 });
    expect(migrated.prepare('SELECT id, owner_kind FROM documents').all()).toEqual([{ id: 'd1', owner_kind: 'vehicle' }]);
    // The legacy CHECK still lets a document belong to a purchase (kept so a rollback works).
    migrated.exec(`INSERT INTO documents (id, garage_id, vehicle_id, owner_kind, owner_id, type, file_name, content_type, size)
                   VALUES ('d2', 'default', 'v1', 'purchase', 'x', 'invoice', 'r.pdf', 'application/pdf', 10)`);
    migrated.close();
  });

  it('adds an empty ref_purchases table and leaves the legacy purchases alone', () => {
    const path = join(dir, 'garage.sqlite');
    const latest = (openDatabase(':memory:').prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    const old = openDatabase(path, undefined, latest - 5);
    old.exec(`INSERT INTO vehicles (id, garage_id, kind, name) VALUES ('v1', 'default', 'motorcycle', 'Old bike')`);
    old.exec(`INSERT INTO vehicle_parts (id, vehicle_id, name, unit, quantity) VALUES ('p1', 'v1', 'Motul 7100 10W-40', 'litre', 5)`);
    old.exec(`INSERT INTO purchases (id, part_id, vehicle_id, date, quantity, total_paid) VALUES ('b1', 'p1', 'v1', '2026-01-10', 5, 40)`);
    expect(() => old.prepare('SELECT * FROM ref_purchases').all()).toThrow();
    old.close();
    const migrated = openDatabase(path);
    expect(migrated.prepare('SELECT count(*) AS n FROM ref_purchases').get()).toEqual({ n: 0 });
    expect(migrated.prepare('SELECT id FROM purchases').all()).toEqual([{ id: 'b1' }]);
    expect(migrated.prepare('SELECT id FROM vehicle_items').all()).toEqual([{ id: 'p1' }]);
    migrated.close();
  });

  it('lets the parts already there start with no Spec Line', () => {
    const path = join(dir, 'garage.sqlite');
    const old = openDatabase(path, undefined, 36);
    old.exec(`INSERT INTO vehicles (id, garage_id, kind, name) VALUES ('v1', 'default', 'motorcycle', 'Old bike')`);
    old.exec(`INSERT INTO vehicle_parts (id, vehicle_id, name, unit, quantity) VALUES ('p1', 'v1', 'Motul 7100 10W-40', 'litre', 5)`);
    old.close();
    const migrated = openDatabase(path);
    expect(migrated.prepare('SELECT id, spec_line_id FROM vehicle_items').all()).toEqual([{ id: 'p1', spec_line_id: null }]);
    migrated.close();
  });

  it('renames the Vehicle Part table to Vehicle Item and keeps every link', () => {
    const path = join(dir, 'garage.sqlite');
    const old = openDatabase(path, undefined, 40);
    old.exec(`INSERT INTO vehicles (id, garage_id, kind, name) VALUES ('v1', 'default', 'motorcycle', 'Old bike')`);
    old.exec(`INSERT INTO vehicle_parts (id, vehicle_id, name, unit, quantity) VALUES ('p1', 'v1', 'Motul 7100 10W-40', 'litre', 5)`);
    old.exec(`INSERT INTO services (id, vehicle_id, date) VALUES ('s1', 'v1', '2026-10-01')`);
    old.exec(`INSERT INTO service_items (service_id, sort, description, quantity, unit, part_id) VALUES ('s1', 0, 'Motul 7100 10W-40', 5, 'litre', 'p1')`);
    old.exec(`INSERT INTO purchases (id, part_id, vehicle_id, date, quantity, total_paid) VALUES ('b1', 'p1', 'v1', '2026-01-10', 5, 40)`);
    old.close();
    const migrated = openDatabase(path);
    expect(migrated.prepare('SELECT id, name FROM vehicle_items').all()).toEqual([{ id: 'p1', name: 'Motul 7100 10W-40' }]);
    expect(() => migrated.prepare('SELECT * FROM vehicle_parts').all()).toThrow();
    expect(migrated.prepare('SELECT item_id FROM service_items').all()).toEqual([{ item_id: 'p1' }]);
    expect(migrated.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(migrated.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('vehicle_items_vehicle', 'vehicle_parts_vehicle')`).all()).toEqual([{ name: 'vehicle_items_vehicle' }]);
    migrated.exec(`DELETE FROM vehicle_items WHERE id = 'p1'`);
    expect(migrated.prepare('SELECT item_id FROM service_items').all()).toEqual([{ item_id: null }]);
    expect(migrated.prepare('SELECT count(*) AS n FROM purchases').get()).toEqual({ n: 0 });
    migrated.close();
  });

  it('guesses the category of the spec lines already there from their label', () => {
    const path = join(dir, 'garage.sqlite');
    const old = openDatabase(path, undefined, 25);
    old.exec(`INSERT INTO vehicles (id, garage_id, kind, name) VALUES ('v1', 'default', 'motorcycle', 'Old bike')`);
    old.exec(`INSERT INTO spec_lines (id, vehicle_id, label, value, spec_group, sort) VALUES
      ('a', 'v1', 'Engine oil', '10W-40', 'fluids', 0), ('b', 'v1', 'Front tyre', '120/70', 'parts', 0), ('c', 'v1', 'Brake fluid', 'DOT 4', 'fluids', 1),
      ('d', 'v1', 'Chain', '520', 'parts', 1), ('e', 'v1', 'Battery', '12 V', 'parts', 2), ('f', 'v1', 'Coolant', '50/50', 'fluids', 2),
      ('g', 'v1', 'Drain plug', '30 Nm', 'torque', 0), ('h', 'v1', 'Roof rack', 'Thule', 'parts', 3)`);
    old.close();
    const migrated = openDatabase(path);
    expect(migrated.prepare('SELECT id, category FROM spec_lines ORDER BY id').all()).toEqual([
      { id: 'a', category: 'engine' },
      { id: 'b', category: 'chassis' },
      { id: 'c', category: 'brakes' },
      { id: 'd', category: 'transmission' },
      { id: 'e', category: 'electrical' },
      { id: 'f', category: 'cooling_climate' },
      { id: 'g', category: null },
      { id: 'h', category: null },
    ]);
    migrated.close();
  });
});

describe('fuel log migration', () => {
  it('adds the fill-ups table and leaves the data already there alone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'garage-fuel-'));
    try {
      const path = join(dir, 'garage.sqlite');
      // 38 migrations came before the fuel log.
      const old = openDatabase(path, undefined, 38);
      old.exec(`INSERT INTO vehicles (id, garage_id, kind, name) VALUES ('v1', 'default', 'motorcycle', 'Old bike')`);
      old.close();
      const migrated = openDatabase(path);
      expect(migrated.prepare('SELECT id FROM vehicles').all()).toEqual([{ id: 'v1' }]);
      expect(migrated.prepare('SELECT count(*) AS n FROM fuel_fillups').get()).toEqual({ n: 0 });
      migrated.exec(`INSERT INTO fuel_fillups (id, vehicle_id, date, litres, total_paid) VALUES ('f1', 'v1', '2026-10-01', 40, 68)`);
      expect(migrated.prepare('SELECT odometer, full_tank, notes FROM fuel_fillups').get()).toEqual({ odometer: null, full_tank: 1, notes: null });
      migrated.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Notion sync migration', () => {
  it('adds the Notion tables and columns and keeps the data already there', () => {
    const dir = mkdtempSync(join(tmpdir(), 'garage-notion-'));
    try {
      const path = join(dir, 'garage.sqlite');
      // 39 migrations came before the Notion sync.
      const old = openDatabase(path, undefined, 39);
      old.exec(`INSERT INTO vehicles (id, garage_id, kind, name) VALUES ('v1', 'default', 'motorcycle', 'Old bike')`);
      old.exec(`INSERT INTO spec_lines (id, vehicle_id, label, value, spec_group, sort) VALUES ('s1', 'v1', 'Engine oil', '10W-40', 'fluids', 0)`);
      old.exec(`INSERT INTO maintenance_tasks (id, vehicle_id, name, interval_km) VALUES ('t1', 'v1', 'Oil change', 6000)`);
      old.close();

      const migrated = openDatabase(path);
      expect(migrated.prepare('SELECT id, label, value FROM spec_lines').all()).toEqual([{ id: 's1', label: 'Engine oil', value: '10W-40' }]);
      expect(migrated.prepare('SELECT id, name, interval_km, ref_task_id, notion_plan_id, plan_auto, notion_removed FROM maintenance_tasks').all()).toEqual([
        { id: 't1', name: 'Oil change', interval_km: 6000, ref_task_id: null, notion_plan_id: null, plan_auto: 0, notion_removed: 0 },
      ]);
      expect(migrated.prepare('SELECT equipment FROM vehicles').get()).toEqual({ equipment: '[]' });
      for (const table of ['ref_tasks', 'ref_component_types', 'consumable_types', 'products', 'tools', 'vehicle_consumables', 'component_specs', 'notion_state']) {
        expect(migrated.prepare(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
      }
      // One catalogue row per Notion page per garage; one task per catalogue task and vehicle; a page may serve several vehicles.
      migrated.exec(`INSERT INTO ref_tasks (id, garage_id, notion_id, name, action) VALUES ('r1', 'default', 'n1', 'Vidange', 'replace')`);
      expect(() => migrated.exec(`INSERT INTO ref_tasks (id, garage_id, notion_id, name, action) VALUES ('r2', 'default', 'n1', 'Autre', 'replace')`)).toThrow();
      migrated.exec(`UPDATE maintenance_tasks SET ref_task_id = 'r1', notion_plan_id = 'pl1' WHERE id = 't1'`);
      expect(() => migrated.exec(`INSERT INTO maintenance_tasks (id, vehicle_id, name, interval_km, ref_task_id) VALUES ('t2', 'v1', 'Vidange', 1, 'r1')`)).toThrow();
      migrated.exec(`INSERT INTO vehicles (id, garage_id, kind, name) VALUES ('v2', 'default', 'car', 'Car')`);
      migrated.exec(`INSERT INTO component_specs (id, garage_id, vehicle_id, notion_id, label, value) VALUES ('a', 'default', 'v1', 'n9', 'Couple', '25'), ('b', 'default', 'v2', 'n9', 'Couple', '25')`);
      migrated.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lets the catalogue say Nettoyage and Réglage, keeping the catalogue rows already there', () => {
    const latest = (openDatabase(':memory:').prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    const dir = mkdtempSync(join(tmpdir(), 'garage-actions-'));
    try {
      const path = join(dir, 'garage.sqlite');
      const old = openDatabase(path, undefined, latest - 6);
      old.exec(`INSERT INTO ref_tasks (id, garage_id, notion_id, name, action, applicable_if, default_km, category) VALUES ('r1', 'default', 'n1', 'Vidange', 'replace', '["Moto"]', 6000, 'engine')`);
      expect(() => old.exec(`INSERT INTO ref_tasks (id, garage_id, notion_id, name, action) VALUES ('r2', 'default', 'n2', 'Tension', 'adjust')`)).toThrow();
      old.close();

      const migrated = openDatabase(path);
      expect(migrated.prepare('SELECT id, notion_id, name, action, applicable_if, default_km, category FROM ref_tasks').all()).toEqual([
        { id: 'r1', notion_id: 'n1', name: 'Vidange', action: 'replace', applicable_if: '["Moto"]', default_km: 6000, category: 'engine' },
      ]);
      migrated.exec(`INSERT INTO ref_tasks (id, garage_id, notion_id, name, action) VALUES ('r2', 'default', 'n2', 'Tension', 'adjust'), ('r3', 'default', 'n3', 'Graissage', 'clean')`);
      expect(() => migrated.exec(`INSERT INTO ref_tasks (id, garage_id, notion_id, name, action) VALUES ('r4', 'default', 'n4', 'X', 'polish')`)).toThrow();
      expect(() => migrated.exec(`INSERT INTO ref_tasks (id, garage_id, notion_id, name, action) VALUES ('r5', 'default', 'n1', 'Doublon', 'replace')`)).toThrow();
      migrated.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the glossary rename migration', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'garage-rename-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const latest = () => (openDatabase(':memory:').prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  const seed = (path: string, backupDir?: string) => {
    // The version just before the rename (the ADR 0009 migration came after it).
    const old = openDatabase(path, undefined, latest() - 4);
    old.exec(`
      INSERT INTO vehicles (id, garage_id, kind, name, status) VALUES ('v1', 'default', 'car', 'Sold car', 'sold'), ('v2', 'default', 'car', 'Kept car', 'owned');
      INSERT INTO vehicle_consumables (id, garage_id, vehicle_id, notion_id, name, status) VALUES ('vc1', 'default', 'v1', 'n1', 'Huile', 'to_confirm');
      INSERT INTO vehicle_specs (id, garage_id, vehicle_id, notion_id, label, value, status) VALUES ('vs1', 'default', 'v1', 'n2', 'Couple', '25', 'confirmed');
    `);
    old.close();
    return backupDir;
  };

  it('renames the table and the columns and keeps the values', () => {
    const path = join(dir, 'garage.sqlite');
    seed(path);
    const migrated = openDatabase(path);
    expect(migrated.prepare('SELECT id, ownership FROM vehicles ORDER BY id').all()).toEqual([
      { id: 'v1', ownership: 'sold' },
      { id: 'v2', ownership: 'owned' },
    ]);
    expect(migrated.prepare('SELECT id, confirmation FROM vehicle_consumables').all()).toEqual([{ id: 'vc1', confirmation: 'to_confirm' }]);
    expect(migrated.prepare('SELECT id, confirmation FROM component_specs').all()).toEqual([{ id: 'vs1', confirmation: 'confirmed' }]);
    expect(() => migrated.prepare('SELECT * FROM vehicle_specs').all()).toThrow();
    expect(() => migrated.exec(`UPDATE vehicles SET ownership = 'x' WHERE id = 'v2'`)).toThrow();
    const indexes = (migrated.prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`).all() as { name: string }[]).map((i) => i.name);
    expect(indexes).toContain('component_specs_vehicle');
    expect(indexes).not.toContain('vehicle_specs_vehicle');
    migrated.close();
  });

  it('writes the backup before renaming, still with the old names', () => {
    const path = join(dir, 'garage.sqlite');
    const backups = join(dir, 'backups');
    seed(path);
    openDatabase(path, backups).close();
    const copy = readdirSync(backups).find((f) => f.startsWith(`garage-v${latest() - 4}-`) && f.endsWith('.sqlite'));
    expect(copy).toBeDefined();
    const saved = openDatabase(join(backups, copy!), undefined, latest() - 4);
    expect(saved.prepare('SELECT status FROM vehicles WHERE id = ?').get('v1')).toEqual({ status: 'sold' });
    expect(saved.prepare('SELECT status FROM vehicle_specs').all()).toEqual([{ status: 'confirmed' }]);
    saved.close();
  });

  it('answers the snapshot with the new names only', async () => {
    const bike = await createVehicle();
    db.exec(`
      INSERT INTO vehicle_consumables (id, garage_id, vehicle_id, notion_id, name, confirmation) VALUES ('vc1', 'default', '${bike.id}', 'n7', 'Huile', 'to_confirm');
      INSERT INTO component_specs (id, garage_id, vehicle_id, notion_id, label, value, confirmation) VALUES ('vs1', 'default', '${bike.id}', 'n8', 'Couple', '25', 'confirmed');
    `);
    const s = (await snapshot()) as unknown as Record<string, any>;
    expect(s.vehicles[0]).toHaveProperty('ownership', 'owned');
    expect(s.vehicles[0]).not.toHaveProperty('status');
    expect(s.componentSpecs).toMatchObject([{ id: 'vs1', confirmation: 'confirmed' }]);
    expect(s).not.toHaveProperty('vehicleSpecs');
    expect(s.itemSpecs[0]).toHaveProperty('confirmation', 'to_confirm');
    expect(s.itemSpecs[0]).not.toHaveProperty('status');
    expect(s.componentSpecs[0]).not.toHaveProperty('status');
  });
});

describe('the Item Spec migration (ADR 0009)', () => {
  it('adds the Item Spec link and the move record, keeping the parts and Spec Lines already there', () => {
    const dir = mkdtempSync(join(tmpdir(), 'garage-itemspec-'));
    try {
      const path = join(dir, 'garage.sqlite');
      const latest = (openDatabase(':memory:').prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
      const old = openDatabase(path, undefined, latest - 3);
      old.exec(`INSERT INTO vehicles (id, garage_id, kind, name) VALUES ('v1', 'default', 'motorcycle', 'Old bike')`);
      old.exec(`INSERT INTO spec_lines (id, vehicle_id, label, value, spec_group, sort) VALUES ('s1', 'v1', 'Engine oil', '10W-40', 'fluids', 0)`);
      old.exec(`INSERT INTO vehicle_parts (id, vehicle_id, name, unit, quantity, spec_line_id) VALUES ('p1', 'v1', 'Motul 7100 10W-40', 'litre', 5, 's1')`);
      expect(() => old.prepare('SELECT item_spec_id FROM vehicle_parts').all()).toThrow();
      expect(() => old.prepare('SELECT * FROM spec_line_moves').all()).toThrow();
      old.close();

      const migrated = openDatabase(path);
      expect(migrated.prepare('SELECT id, spec_line_id, item_spec_id FROM vehicle_items').all()).toEqual([{ id: 'p1', spec_line_id: 's1', item_spec_id: null }]);
      expect(migrated.prepare('SELECT id, label FROM spec_lines').all()).toEqual([{ id: 's1', label: 'Engine oil' }]);
      expect(migrated.prepare('SELECT count(*) AS n FROM spec_line_moves').get()).toEqual({ n: 0 });
      migrated.exec(`INSERT INTO spec_line_moves (spec_line_id, target, notion_id, created_page) VALUES ('s1', 'item_spec', 'page-item-1', 1)`);
      expect(() => migrated.exec(`INSERT INTO spec_line_moves (spec_line_id, target, notion_id, created_page) VALUES ('s1', 'item_spec', 'page-item-2', 1)`)).toThrow();
      expect(() => migrated.exec(`INSERT INTO spec_line_moves (spec_line_id, target, notion_id, created_page) VALUES ('s1', 'wheel', 'x', 0)`)).toThrow();
      migrated.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('still accepts a Document upload from any client: the desktop-only rule is in the screens only', async () => {
    const uploads = mkdtempSync(join(tmpdir(), 'garage-uploads-'));
    try {
      setApp(createApp(db, undefined, { uploadsDir: uploads }));
      const bike = await createVehicle();
      const form = new FormData();
      form.set('file', new File(['%PDF-1.4 test'], 'receipt.pdf', { type: 'application/pdf' }));
      form.set('ownerKind', 'vehicle');
      form.set('ownerId', bike.id);
      form.set('type', 'invoice');
      expect((await app.request('/api/documents', { method: 'POST', body: form })).status).toBe(201);
    } finally {
      rmSync(uploads, { recursive: true, force: true });
    }
  });

  it('sends the API version 5 header', async () => {
    expect(API_VERSION).toBe(5);
    expect((await call('GET', '/api/snapshot')).headers.get('x-api-version')).toBe('5');
  });
});
