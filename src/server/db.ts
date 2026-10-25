import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_GARAGE_ID = 'default';

// Append-only: never edit a migration that has shipped, add a new one.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE garages (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL
  );
  INSERT INTO garages (id, name) VALUES ('${DEFAULT_GARAGE_ID}', 'My garage');

  CREATE TABLE vehicles (
    id TEXT PRIMARY KEY,
    garage_id TEXT NOT NULL REFERENCES garages(id),
    kind TEXT NOT NULL CHECK (kind IN ('car', 'motorcycle')),
    name TEXT NOT NULL,
    make TEXT,
    model TEXT,
    year INTEGER,
    registration TEXT,
    status TEXT NOT NULL DEFAULT 'owned' CHECK (status IN ('owned', 'sold')),
    sold_date TEXT,
    sold_odometer INTEGER,
    sold_price REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE maintenance_tasks (
    id TEXT PRIMARY KEY,
    vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
    name TEXT NOT NULL,
    interval_km INTEGER,
    interval_months INTEGER,
    baseline_date TEXT,
    baseline_odometer INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (interval_km IS NOT NULL OR interval_months IS NOT NULL)
  );

  CREATE TABLE services (
    id TEXT PRIMARY KEY,
    vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
    date TEXT NOT NULL,
    odometer INTEGER NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE service_tasks (
    service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL REFERENCES maintenance_tasks(id),
    PRIMARY KEY (service_id, task_id)
  );

  CREATE TABLE odometer_readings (
    id TEXT PRIMARY KEY,
    vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
    date TEXT NOT NULL,
    odometer INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
  `
  ALTER TABLE maintenance_tasks ADD COLUMN official_interval_km INTEGER;
  ALTER TABLE maintenance_tasks ADD COLUMN official_interval_months INTEGER;
  `,
  `
  ALTER TABLE maintenance_tasks ADD COLUMN workshop_notes TEXT;

  CREATE TABLE vehicle_specs (
    id TEXT PRIMARY KEY,
    vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
    kind TEXT NOT NULL CHECK (kind IN ('torque', 'other')),
    name TEXT NOT NULL,
    value TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE part_specs (
    id TEXT PRIMARY KEY,
    vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
    name TEXT NOT NULL,
    characteristics TEXT,
    part_numbers TEXT,
    unit TEXT NOT NULL CHECK (unit IN ('piece', 'litre')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE fitment_positions (
    id TEXT PRIMARY KEY,
    vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE required_parts (
    task_id TEXT NOT NULL REFERENCES maintenance_tasks(id) ON DELETE CASCADE,
    part_spec_id TEXT NOT NULL REFERENCES part_specs(id) ON DELETE CASCADE,
    quantity REAL NOT NULL,
    sort INTEGER NOT NULL,
    PRIMARY KEY (task_id, part_spec_id)
  );

  CREATE TABLE required_tools (
    task_id TEXT NOT NULL REFERENCES maintenance_tasks(id) ON DELETE CASCADE,
    sort INTEGER NOT NULL,
    name TEXT NOT NULL,
    PRIMARY KEY (task_id, sort)
  );

  CREATE TABLE task_specs (
    task_id TEXT NOT NULL REFERENCES maintenance_tasks(id) ON DELETE CASCADE,
    spec_id TEXT NOT NULL REFERENCES vehicle_specs(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, spec_id)
  );

  CREATE TABLE parts_used (
    service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    sort INTEGER NOT NULL,
    part_spec_id TEXT REFERENCES part_specs(id) ON DELETE SET NULL,
    position_id TEXT REFERENCES fitment_positions(id),
    description TEXT NOT NULL,
    part_number TEXT,
    quantity REAL NOT NULL,
    unit TEXT NOT NULL CHECK (unit IN ('piece', 'litre')),
    price REAL,
    supplier TEXT,
    PRIMARY KEY (service_id, sort)
  );
  `,
  `
  ALTER TABLE part_specs ADD COLUMN standard_part TEXT;
  ALTER TABLE part_specs ADD COLUMN not_fitted INTEGER NOT NULL DEFAULT 0;
  CREATE UNIQUE INDEX part_specs_standard ON part_specs (vehicle_id, standard_part) WHERE standard_part IS NOT NULL;
  `,
  `
  ALTER TABLE vehicles ADD COLUMN first_registration TEXT;

  CREATE TABLE technical_inspections (
    id TEXT PRIMARY KEY,
    vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
    date TEXT NOT NULL,
    odometer INTEGER NOT NULL,
    centre TEXT,
    result TEXT NOT NULL CHECK (result IN ('passed', 'majorDefects', 'criticalDefects')),
    next_due_date TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE inspection_defects (
    inspection_id TEXT NOT NULL REFERENCES technical_inspections(id) ON DELETE CASCADE,
    sort INTEGER NOT NULL,
    description TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('minor', 'major', 'critical')),
    fixed_service_id TEXT REFERENCES services(id) ON DELETE SET NULL,
    PRIMARY KEY (inspection_id, sort)
  );

  CREATE TABLE modifications (
    id TEXT PRIMARY KEY,
    vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
    name TEXT NOT NULL,
    fitted_date TEXT NOT NULL,
    fitted_odometer INTEGER,
    removed_date TEXT,
    position_id TEXT REFERENCES fitment_positions(id),
    declared_to_insurer INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE documents (
    id TEXT PRIMARY KEY,
    vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
    owner_kind TEXT NOT NULL CHECK (owner_kind IN ('vehicle', 'service', 'modification', 'inspection')),
    owner_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT,
    issue_date TEXT,
    expiry_date TEXT,
    file_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX documents_owner ON documents (owner_kind, owner_id);
  `,
];

function schemaVersion(db: DatabaseSync): number {
  return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
}

/**
 * Opens the garage database and brings its schema up to date.
 * Before migrating an existing database, a copy is written to `backupDir` so an update can never lose history.
 */
export function openDatabase(path: string, backupDir?: string): DatabaseSync {
  const isNew = path === ':memory:' || !existsSync(path);
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');

  const current = schemaVersion(db);
  if (current < MIGRATIONS.length && !isNew && backupDir) {
    mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = join(backupDir, `garage-v${current}-${stamp}.sqlite`);
    db.prepare('VACUUM INTO ?').run(target);
  }

  for (let version = current; version < MIGRATIONS.length; version++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[version]!);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  return db;
}
