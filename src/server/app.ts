import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { Hono, type Context } from 'hono';
import type { ZodType } from 'zod';
import {
  copyTasksInput,
  odometerReadingInput,
  sellInput,
  serviceInput,
  taskInput,
  vehicleInput,
} from '../shared/schemas.ts';
import type { MaintenanceTask, OdometerReading, Service, Snapshot, Vehicle } from '../shared/types.ts';
import { DEFAULT_GARAGE_ID } from './db.ts';

class HttpError extends Error {
  readonly status: 400 | 404 | 409 | 422;
  constructor(status: 400 | 404 | 409 | 422, message: string) {
    super(message);
    this.status = status;
  }
}

async function parse<T>(c: Context, schema: ZodType<T, any, any>): Promise<T> {
  const body = await c.req.json().catch(() => {
    throw new HttpError(400, 'Body must be JSON');
  });
  const result = schema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0]!;
    throw new HttpError(422, `${issue.path.join('.') || 'body'}: ${issue.message}`);
  }
  return result.data;
}

type Row = Record<string, any>;

const toVehicle = (r: Row): Vehicle => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  make: r.make,
  model: r.model,
  year: r.year,
  registration: r.registration,
  status: r.status,
  soldDate: r.sold_date,
  soldOdometer: r.sold_odometer,
  soldPrice: r.sold_price,
});

const toTask = (r: Row): MaintenanceTask => ({
  id: r.id,
  vehicleId: r.vehicle_id,
  name: r.name,
  intervalKm: r.interval_km,
  intervalMonths: r.interval_months,
  officialIntervalKm: r.official_interval_km,
  officialIntervalMonths: r.official_interval_months,
  baselineDate: r.baseline_date,
  baselineOdometer: r.baseline_odometer,
});

const toReading = (r: Row): OdometerReading => ({ id: r.id, vehicleId: r.vehicle_id, date: r.date, odometer: r.odometer });

/**
 * The HTTP API. Every query is scoped to one Garage; until users exist, that is the default Garage.
 * Services and Odometer Readings are written with PUT and a client-generated id, so the phone's
 * offline send queue can safely replay them.
 */
export function createApp(db: DatabaseSync, garageId: string = DEFAULT_GARAGE_ID): Hono {
  const app = new Hono();

  function vehicleOrThrow(id: string): Row {
    const row = db.prepare('SELECT * FROM vehicles WHERE id = ? AND garage_id = ?').get(id, garageId) as Row | undefined;
    if (!row) throw new HttpError(404, 'Vehicle not found');
    return row;
  }

  function taskOrThrow(id: string): Row {
    const row = db
      .prepare(
        `SELECT t.* FROM maintenance_tasks t JOIN vehicles v ON v.id = t.vehicle_id
         WHERE t.id = ? AND v.garage_id = ?`,
      )
      .get(id, garageId) as Row | undefined;
    if (!row) throw new HttpError(404, 'Maintenance Task not found');
    return row;
  }

  function transaction<T>(fn: () => T): T {
    db.exec('BEGIN');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function snapshot(): Snapshot {
    const vehicles = (db.prepare('SELECT * FROM vehicles WHERE garage_id = ? ORDER BY created_at').all(garageId) as Row[]).map(toVehicle);
    const tasks = (
      db
        .prepare(
          `SELECT t.* FROM maintenance_tasks t JOIN vehicles v ON v.id = t.vehicle_id
           WHERE v.garage_id = ? ORDER BY t.created_at`,
        )
        .all(garageId) as Row[]
    ).map(toTask);
    const links = db
      .prepare(
        `SELECT st.service_id, st.task_id FROM service_tasks st
         JOIN services s ON s.id = st.service_id JOIN vehicles v ON v.id = s.vehicle_id
         WHERE v.garage_id = ?`,
      )
      .all(garageId) as Row[];
    const taskIdsByService = new Map<string, string[]>();
    for (const l of links) taskIdsByService.set(l.service_id, [...(taskIdsByService.get(l.service_id) ?? []), l.task_id]);
    const services: Service[] = (
      db
        .prepare(
          `SELECT s.* FROM services s JOIN vehicles v ON v.id = s.vehicle_id
           WHERE v.garage_id = ? ORDER BY s.date, s.odometer`,
        )
        .all(garageId) as Row[]
    ).map((r) => ({
      id: r.id,
      vehicleId: r.vehicle_id,
      date: r.date,
      odometer: r.odometer,
      notes: r.notes,
      taskIds: taskIdsByService.get(r.id) ?? [],
    }));
    const readings = (
      db
        .prepare(
          `SELECT r.* FROM odometer_readings r JOIN vehicles v ON v.id = r.vehicle_id
           WHERE v.garage_id = ? ORDER BY r.date, r.odometer`,
        )
        .all(garageId) as Row[]
    ).map(toReading);
    return { vehicles, tasks, services, readings };
  }

  app.onError((error, c) => {
    if (error instanceof HttpError) return c.json({ error: error.message }, error.status);
    console.error(error);
    return c.json({ error: 'Internal error' }, 500);
  });

  app.get('/api/health', (c) => c.json({ ok: true }));

  app.get('/api/snapshot', (c) => c.json(snapshot()));

  // --- Vehicles ---

  app.post('/api/vehicles', async (c) => {
    const v = await parse(c, vehicleInput);
    const id = randomUUID();
    db.prepare(
      `INSERT INTO vehicles (id, garage_id, kind, name, make, model, year, registration)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, garageId, v.kind, v.name, v.make, v.model, v.year, v.registration);
    return c.json(toVehicle(vehicleOrThrow(id)), 201);
  });

  app.put('/api/vehicles/:id', async (c) => {
    const id = c.req.param('id');
    vehicleOrThrow(id);
    const v = await parse(c, vehicleInput);
    db.prepare('UPDATE vehicles SET kind = ?, name = ?, make = ?, model = ?, year = ?, registration = ? WHERE id = ?').run(
      v.kind,
      v.name,
      v.make,
      v.model,
      v.year,
      v.registration,
      id,
    );
    return c.json(toVehicle(vehicleOrThrow(id)));
  });

  app.post('/api/vehicles/:id/sell', async (c) => {
    const id = c.req.param('id');
    vehicleOrThrow(id);
    const s = await parse(c, sellInput);
    db.prepare(`UPDATE vehicles SET status = 'sold', sold_date = ?, sold_odometer = ?, sold_price = ? WHERE id = ?`).run(
      s.date,
      s.odometer,
      s.price,
      id,
    );
    return c.json(toVehicle(vehicleOrThrow(id)));
  });

  app.post('/api/vehicles/:id/unsell', (c) => {
    const id = c.req.param('id');
    vehicleOrThrow(id);
    db.prepare(`UPDATE vehicles SET status = 'owned', sold_date = NULL, sold_odometer = NULL, sold_price = NULL WHERE id = ?`).run(id);
    return c.json(toVehicle(vehicleOrThrow(id)));
  });

  // --- Maintenance Tasks ---

  app.post('/api/vehicles/:id/tasks', async (c) => {
    const vehicleId = c.req.param('id');
    vehicleOrThrow(vehicleId);
    const t = await parse(c, taskInput);
    const id = randomUUID();
    db.prepare(
      `INSERT INTO maintenance_tasks
         (id, vehicle_id, name, interval_km, interval_months, official_interval_km, official_interval_months, baseline_date, baseline_odometer)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      vehicleId,
      t.name,
      t.intervalKm,
      t.intervalMonths,
      t.officialIntervalKm,
      t.officialIntervalMonths,
      t.baselineDate,
      t.baselineOdometer,
    );
    return c.json(toTask(taskOrThrow(id)), 201);
  });

  app.post('/api/vehicles/:id/copy-tasks', async (c) => {
    const vehicleId = c.req.param('id');
    vehicleOrThrow(vehicleId);
    const { fromVehicleId } = await parse(c, copyTasksInput);
    vehicleOrThrow(fromVehicleId);
    if (fromVehicleId === vehicleId) throw new HttpError(422, 'Cannot copy a Vehicle onto itself');
    const source = db.prepare('SELECT * FROM maintenance_tasks WHERE vehicle_id = ? ORDER BY created_at').all(fromVehicleId) as Row[];
    const insert = db.prepare(
      `INSERT INTO maintenance_tasks (id, vehicle_id, name, interval_km, interval_months, official_interval_km, official_interval_months)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    // History is not copied: the copies start with no baseline, since they were never done on this Vehicle.
    transaction(() => {
      for (const t of source) {
        insert.run(randomUUID(), vehicleId, t.name, t.interval_km, t.interval_months, t.official_interval_km, t.official_interval_months);
      }
    });
    return c.json({ copied: source.length }, 201);
  });

  app.put('/api/tasks/:id', async (c) => {
    const id = c.req.param('id');
    taskOrThrow(id);
    const t = await parse(c, taskInput);
    db.prepare(
      `UPDATE maintenance_tasks SET name = ?, interval_km = ?, interval_months = ?, official_interval_km = ?,
         official_interval_months = ?, baseline_date = ?, baseline_odometer = ?
       WHERE id = ?`,
    ).run(t.name, t.intervalKm, t.intervalMonths, t.officialIntervalKm, t.officialIntervalMonths, t.baselineDate, t.baselineOdometer, id);
    return c.json(toTask(taskOrThrow(id)));
  });

  app.delete('/api/tasks/:id', (c) => {
    const id = c.req.param('id');
    taskOrThrow(id);
    const used = db.prepare('SELECT COUNT(*) AS n FROM service_tasks WHERE task_id = ?').get(id) as { n: number };
    if (used.n > 0) throw new HttpError(409, 'This Maintenance Task appears in logged Services and cannot be deleted');
    db.prepare('DELETE FROM maintenance_tasks WHERE id = ?').run(id);
    return c.body(null, 204);
  });

  // --- Services (offline-capable: idempotent PUT with client id) ---

  app.put('/api/services/:id', async (c) => {
    const s = await parse(c, serviceInput);
    if (s.id !== c.req.param('id')) throw new HttpError(400, 'Id mismatch');
    vehicleOrThrow(s.vehicleId);
    const existing = db.prepare('SELECT vehicle_id FROM services WHERE id = ?').get(s.id) as Row | undefined;
    if (existing && existing.vehicle_id !== s.vehicleId) throw new HttpError(409, 'Service belongs to another Vehicle');
    const taskIds = [...new Set(s.taskIds)];
    for (const taskId of taskIds) {
      const task = db.prepare('SELECT vehicle_id FROM maintenance_tasks WHERE id = ?').get(taskId) as Row | undefined;
      if (!task || task.vehicle_id !== s.vehicleId) throw new HttpError(422, 'A Maintenance Task in this Service no longer exists');
    }
    transaction(() => {
      db.prepare(
        `INSERT INTO services (id, vehicle_id, date, odometer, notes) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET date = excluded.date, odometer = excluded.odometer, notes = excluded.notes`,
      ).run(s.id, s.vehicleId, s.date, s.odometer, s.notes);
      db.prepare('DELETE FROM service_tasks WHERE service_id = ?').run(s.id);
      const link = db.prepare('INSERT INTO service_tasks (service_id, task_id) VALUES (?, ?)');
      for (const taskId of taskIds) link.run(s.id, taskId);
    });
    return c.json({ ...s, taskIds });
  });

  app.delete('/api/services/:id', (c) => {
    const id = c.req.param('id');
    const row = db
      .prepare('SELECT s.id FROM services s JOIN vehicles v ON v.id = s.vehicle_id WHERE s.id = ? AND v.garage_id = ?')
      .get(id, garageId);
    if (!row) throw new HttpError(404, 'Service not found');
    db.prepare('DELETE FROM services WHERE id = ?').run(id);
    return c.body(null, 204);
  });

  // --- Odometer Readings (offline-capable) ---

  app.put('/api/odometer-readings/:id', async (c) => {
    const r = await parse(c, odometerReadingInput);
    if (r.id !== c.req.param('id')) throw new HttpError(400, 'Id mismatch');
    vehicleOrThrow(r.vehicleId);
    const existing = db.prepare('SELECT vehicle_id FROM odometer_readings WHERE id = ?').get(r.id) as Row | undefined;
    if (existing && existing.vehicle_id !== r.vehicleId) throw new HttpError(409, 'Reading belongs to another Vehicle');
    db.prepare(
      `INSERT INTO odometer_readings (id, vehicle_id, date, odometer) VALUES (?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET date = excluded.date, odometer = excluded.odometer`,
    ).run(r.id, r.vehicleId, r.date, r.odometer);
    return c.json(r);
  });

  app.delete('/api/odometer-readings/:id', (c) => {
    const id = c.req.param('id');
    const row = db
      .prepare('SELECT r.id FROM odometer_readings r JOIN vehicles v ON v.id = r.vehicle_id WHERE r.id = ? AND v.garage_id = ?')
      .get(id, garageId);
    if (!row) throw new HttpError(404, 'Odometer Reading not found');
    db.prepare('DELETE FROM odometer_readings WHERE id = ?').run(id);
    return c.body(null, 204);
  });

  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

  return app;
}
