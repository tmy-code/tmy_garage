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
  `
  ALTER TABLE vehicles ADD COLUMN vin TEXT;
  ALTER TABLE vehicles ADD COLUMN version TEXT;
  ALTER TABLE vehicles ADD COLUMN fiscal_power INTEGER;
  ALTER TABLE vehicles ADD COLUMN national_type TEXT;
  ALTER TABLE vehicles ADD COLUMN purchase_date TEXT;
  ALTER TABLE vehicles ADD COLUMN overnight_parking TEXT;

  CREATE TABLE drivers (
    id TEXT PRIMARY KEY,
    garage_id TEXT NOT NULL REFERENCES garages(id),
    name TEXT NOT NULL,
    birth_date TEXT,
    car_licence_date TEXT,
    motorcycle_licence_date TEXT,
    motorcycle_licence TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE insurance_policies (
    id TEXT PRIMARY KEY,
    garage_id TEXT NOT NULL REFERENCES garages(id),
    insurer TEXT NOT NULL,
    policy_number TEXT,
    start_date TEXT NOT NULL,
    cancelled_date TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE policy_drivers (
    policy_id TEXT NOT NULL REFERENCES insurance_policies(id) ON DELETE CASCADE,
    driver_id TEXT NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    PRIMARY KEY (policy_id, driver_id)
  );

  CREATE TABLE policy_terms (
    id TEXT PRIMARY KEY,
    policy_id TEXT NOT NULL REFERENCES insurance_policies(id) ON DELETE CASCADE,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (end_date > start_date)
  );

  CREATE TABLE covers (
    id TEXT PRIMARY KEY,
    term_id TEXT NOT NULL REFERENCES policy_terms(id) ON DELETE CASCADE,
    vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
    level TEXT NOT NULL CHECK (level IN ('thirdParty', 'thirdPartyExtended', 'comprehensive')),
    guarantees TEXT,
    excess REAL,
    premium REAL,
    crm REAL,
    notes TEXT,
    UNIQUE (term_id, vehicle_id)
  );

  CREATE TABLE claims (
    id TEXT PRIMARY KEY,
    policy_id TEXT NOT NULL REFERENCES insurance_policies(id) ON DELETE CASCADE,
    vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
    driver_id TEXT REFERENCES drivers(id) ON DELETE SET NULL,
    date TEXT NOT NULL,
    responsibility TEXT NOT NULL CHECK (responsibility IN ('notAtFault', 'partlyAtFault', 'atFault')),
    amount REAL,
    description TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE quotes (
    id TEXT PRIMARY KEY,
    vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
    insurer TEXT NOT NULL,
    date TEXT NOT NULL,
    level TEXT NOT NULL CHECK (level IN ('thirdParty', 'thirdPartyExtended', 'comprehensive')),
    guarantees TEXT,
    excess REAL,
    premium REAL NOT NULL,
    valid_until TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- A Policy's Documents belong to no single Vehicle, so Documents now belong to the Garage directly.
  CREATE TABLE documents_new (
    id TEXT PRIMARY KEY,
    garage_id TEXT NOT NULL REFERENCES garages(id),
    vehicle_id TEXT REFERENCES vehicles(id),
    owner_kind TEXT NOT NULL CHECK (owner_kind IN ('vehicle', 'service', 'modification', 'inspection', 'policy', 'cover', 'claim')),
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
  INSERT INTO documents_new
    SELECT d.id, v.garage_id, d.vehicle_id, d.owner_kind, d.owner_id, d.type, d.title, d.issue_date, d.expiry_date,
           d.file_name, d.content_type, d.size, d.created_at
    FROM documents d JOIN vehicles v ON v.id = d.vehicle_id;
  DROP TABLE documents;
  ALTER TABLE documents_new RENAME TO documents;
  CREATE INDEX documents_owner ON documents (owner_kind, owner_id);
  `,
  `
  -- A device (phone, browser) that asked to receive Reminders, as handed over by its browser's push service.
  CREATE TABLE push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    garage_id TEXT NOT NULL REFERENCES garages(id),
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    lang TEXT NOT NULL CHECK (lang IN ('en', 'fr')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Which Reminders were already sent, so each one goes out once per status (and overdue ones weekly).
  CREATE TABLE reminders_sent (
    garage_id TEXT NOT NULL REFERENCES garages(id),
    key TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('dueSoon', 'overdue')),
    sent_on TEXT NOT NULL,
    PRIMARY KEY (garage_id, key, status)
  );

  CREATE TABLE reminder_runs (
    garage_id TEXT PRIMARY KEY REFERENCES garages(id),
    last_date TEXT NOT NULL
  );
  `,
  `
  ALTER TABLE maintenance_tasks ADD COLUMN name_fr TEXT;
  ALTER TABLE part_specs ADD COLUMN name_fr TEXT;
  ALTER TABLE part_specs ADD COLUMN oem_reference TEXT;
  `,
];

function schemaVersion(db: DatabaseSync): number {
  return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
}

/**
 * Opens the garage database and brings its schema up to date.
 * Before migrating an existing database, a copy is written to `backupDir` so an update can never lose history.
 * `targetVersion` stops short of the latest schema, so tests can recreate a database an older release left behind.
 */
export function openDatabase(path: string, backupDir?: string, targetVersion = MIGRATIONS.length): DatabaseSync {
  const isNew = path === ':memory:' || !existsSync(path);
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');

  const current = schemaVersion(db);
  if (current < targetVersion && !isNew && backupDir) {
    mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = join(backupDir, `garage-v${current}-${stamp}.sqlite`);
    db.prepare('VACUUM INTO ?').run(target);
  }

  for (let version = current; version < targetVersion; version++) {
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
