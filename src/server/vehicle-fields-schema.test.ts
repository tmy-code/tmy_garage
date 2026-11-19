import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { VEHICLE_FIELDS } from '../shared/vehicle-fields.ts';
import { GOLDEN } from '../shared/vehicle-fields-golden.ts';
import { createApp } from './app.ts';
import { openDatabase } from './db.ts';

/** Columns of the vehicles table that are not Vehicle fields: the Garage it belongs to, and when it was added. */
const KNOWN_EXTRAS = ['garage_id', 'created_at'];

let db: DatabaseSync;

beforeEach(() => {
  db = openDatabase(':memory:');
});
afterEach(() => db.close());

describe('the Vehicle field table and the vehicles table', () => {
  it('agree on every column', () => {
    const dbColumns = (db.prepare('PRAGMA table_info(vehicles)').all() as { name: string }[]).map((c) => c.name);
    const tableColumns = Object.values(VEHICLE_FIELDS).map((f) => f.column);
    for (const column of tableColumns) expect(dbColumns, `column ${column} is missing in the database`).toContain(column);
    for (const column of dbColumns) {
      expect([...tableColumns, ...KNOWN_EXTRAS], `column ${column} is not described in vehicle-fields.ts`).toContain(column);
    }
  });

  it('reads a full row to the same JSON as before the table existed', async () => {
    db.prepare(
      `INSERT INTO vehicles (id, garage_id, kind, name, make, model, year, vin, first_registration_date, purchase_date, fuel, transmission, drivetrain,
         distribution, cooling, final_drive, cylinders, has_hydraulic_clutch, has_turbo, has_direct_injection, has_start_stop, has_adblue, has_ac,
         has_air_suspension, ownership, on_garage_page, sold_date, sold_odometer, sold_price, equipment, notion_page_id, archive_folder)
       VALUES ('veh-golden-1', 'default', 'car', 'Test car', 'Exemple', 'Test', 2015, 'VF1TESTVIN0000001', '2015-03-02', '2019-06-15', 'diesel',
         'manual', 'fwd', 'belt', NULL, NULL, 4, 0, 1, 0, 1, 0, 1, 0, 'sold', 0, '2024-05-01', 123456, 4500.5, '["Transmission chaîne","Turbo"]', NULL,
         'Exemple/Test car')`,
    ).run();
    const res = await createApp(db).request('/api/vehicles/veh-golden-1/garage-page', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shown: true }),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(GOLDEN);
  });
});
