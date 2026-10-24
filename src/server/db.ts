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
