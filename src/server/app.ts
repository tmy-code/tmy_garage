import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { Hono, type Context } from 'hono';
import type { ZodType } from 'zod';
import {
  copyTasksInput,
  odometerReadingInput,
  partSpecInput,
  positionInput,
  sellInput,
  serviceInput,
  taskInput,
  vehicleInput,
  vehicleSpecInput,
  workshopInput,
} from '../shared/schemas.ts';
import type {
  FitmentPosition,
  MaintenanceTask,
  OdometerReading,
  PartSpec,
  PartUsed,
  Service,
  Snapshot,
  Vehicle,
  VehicleSpec,
} from '../shared/types.ts';
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

type Workshop = Pick<MaintenanceTask, 'requiredParts' | 'tools' | 'specIds'>;
const noWorkshop = (): Workshop => ({ requiredParts: [], tools: [], specIds: [] });

const toTask = (r: Row, w: Workshop = noWorkshop()): MaintenanceTask => ({
  id: r.id,
  vehicleId: r.vehicle_id,
  name: r.name,
  intervalKm: r.interval_km,
  intervalMonths: r.interval_months,
  officialIntervalKm: r.official_interval_km,
  officialIntervalMonths: r.official_interval_months,
  baselineDate: r.baseline_date,
  baselineOdometer: r.baseline_odometer,
  workshopNotes: r.workshop_notes,
  ...w,
});

const toReading = (r: Row): OdometerReading => ({ id: r.id, vehicleId: r.vehicle_id, date: r.date, odometer: r.odometer });

const toVehicleSpec = (r: Row): VehicleSpec => ({ id: r.id, vehicleId: r.vehicle_id, kind: r.kind, name: r.name, value: r.value, notes: r.notes });

const toPartSpec = (r: Row): PartSpec => ({
  id: r.id,
  vehicleId: r.vehicle_id,
  name: r.name,
  characteristics: r.characteristics,
  partNumbers: r.part_numbers,
  unit: r.unit,
});

const toPosition = (r: Row): FitmentPosition => ({ id: r.id, vehicleId: r.vehicle_id, name: r.name });

const toPartUsed = (r: Row): PartUsed => ({
  partSpecId: r.part_spec_id,
  positionId: r.position_id,
  description: r.description,
  partNumber: r.part_number,
  quantity: r.quantity,
  unit: r.unit,
  price: r.price,
  supplier: r.supplier,
});

/** Groups rows by a key column, keeping their order. */
function groupBy<T>(rows: Row[], key: string, map: (r: Row) => T): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const list = groups.get(r[key]);
    if (list) list.push(map(r));
    else groups.set(r[key], [map(r)]);
  }
  return groups;
}

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

  /** Rows of a table whose vehicle_id belongs to this Garage, optionally narrowed by an extra condition. */
  function ownedRows(table: string, where = '1', ...params: (string | number)[]): Row[] {
    return db
      .prepare(
        `SELECT x.* FROM ${table} x JOIN vehicles v ON v.id = x.vehicle_id
         WHERE v.garage_id = ? AND ${where} ORDER BY x.created_at`,
      )
      .all(garageId, ...params) as Row[];
  }

  function ownedRowOrThrow(table: string, id: string, what: string): Row {
    const row = ownedRows(table, 'x.id = ?', id)[0];
    if (!row) throw new HttpError(404, `${what} not found`);
    return row;
  }

  /** Workshop data of one Task, or of all this Garage's Tasks when omitted. */
  function workshops(taskId?: string): Map<string, Workshop> {
    const scope = taskId === undefined ? '' : 'AND x.task_id = ?';
    const params = taskId === undefined ? [garageId] : [garageId, taskId];
    const query = (table: string, order: string) =>
      db
        .prepare(
          `SELECT x.* FROM ${table} x JOIN maintenance_tasks t ON t.id = x.task_id JOIN vehicles v ON v.id = t.vehicle_id
           WHERE v.garage_id = ? ${scope} ORDER BY ${order}`,
        )
        .all(...params) as Row[];
    const parts = groupBy(query('required_parts', 'x.sort'), 'task_id', (r) => ({ partSpecId: r.part_spec_id, quantity: r.quantity }));
    const tools = groupBy(query('required_tools', 'x.sort'), 'task_id', (r) => r.name as string);
    const specs = groupBy(query('task_specs', 'x.rowid'), 'task_id', (r) => r.spec_id as string);
    const result = new Map<string, Workshop>();
    for (const id of new Set([...parts.keys(), ...tools.keys(), ...specs.keys()])) {
      result.set(id, { requiredParts: parts.get(id) ?? [], tools: tools.get(id) ?? [], specIds: specs.get(id) ?? [] });
    }
    return result;
  }

  function loadTask(id: string): MaintenanceTask {
    return toTask(taskOrThrow(id), workshops(id).get(id));
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
    );
    const workshopByTask = workshops();
    const taskList = tasks.map((r) => toTask(r, workshopByTask.get(r.id)));
    const links = db
      .prepare(
        `SELECT st.service_id, st.task_id FROM service_tasks st
         JOIN services s ON s.id = st.service_id JOIN vehicles v ON v.id = s.vehicle_id
         WHERE v.garage_id = ?`,
      )
      .all(garageId) as Row[];
    const taskIdsByService = new Map<string, string[]>();
    for (const l of links) taskIdsByService.set(l.service_id, [...(taskIdsByService.get(l.service_id) ?? []), l.task_id]);
    const partsByService = groupBy(
      db
        .prepare(
          `SELECT p.* FROM parts_used p JOIN services s ON s.id = p.service_id JOIN vehicles v ON v.id = s.vehicle_id
           WHERE v.garage_id = ? ORDER BY p.service_id, p.sort`,
        )
        .all(garageId) as Row[],
      'service_id',
      toPartUsed,
    );
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
      partsUsed: partsByService.get(r.id) ?? [],
    }));
    const readings = (
      db
        .prepare(
          `SELECT r.* FROM odometer_readings r JOIN vehicles v ON v.id = r.vehicle_id
           WHERE v.garage_id = ? ORDER BY r.date, r.odometer`,
        )
        .all(garageId) as Row[]
    ).map(toReading);
    return {
      vehicles,
      tasks: taskList,
      services,
      readings,
      vehicleSpecs: ownedRows('vehicle_specs').map(toVehicleSpec),
      partSpecs: ownedRows('part_specs').map(toPartSpec),
      positions: ownedRows('fitment_positions').map(toPosition),
    };
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
    return c.json(loadTask(id), 201);
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
    return c.json(loadTask(id));
  });

  app.delete('/api/tasks/:id', (c) => {
    const id = c.req.param('id');
    taskOrThrow(id);
    const used = db.prepare('SELECT COUNT(*) AS n FROM service_tasks WHERE task_id = ?').get(id) as { n: number };
    if (used.n > 0) throw new HttpError(409, 'This Maintenance Task appears in logged Services and cannot be deleted');
    db.prepare('DELETE FROM maintenance_tasks WHERE id = ?').run(id);
    return c.body(null, 204);
  });

  // --- Workshop data of a Task: replaced as a whole ---

  app.put('/api/tasks/:id/workshop', async (c) => {
    const id = c.req.param('id');
    const task = taskOrThrow(id);
    const w = await parse(c, workshopInput);
    const partSpecIds = w.requiredParts.map((p) => p.partSpecId);
    if (new Set(partSpecIds).size !== partSpecIds.length) throw new HttpError(422, 'A Part Spec is listed twice');
    for (const partSpecId of partSpecIds) {
      if (!ownedRows('part_specs', 'x.id = ? AND x.vehicle_id = ?', partSpecId, task.vehicle_id)[0]) {
        throw new HttpError(422, 'A Required Part refers to a Part Spec of another vehicle');
      }
    }
    const specIds = [...new Set(w.specIds)];
    for (const specId of specIds) {
      if (!ownedRows('vehicle_specs', 'x.id = ? AND x.vehicle_id = ?', specId, task.vehicle_id)[0]) {
        throw new HttpError(422, 'A Vehicle Spec of another vehicle cannot be linked');
      }
    }
    transaction(() => {
      db.prepare('UPDATE maintenance_tasks SET workshop_notes = ? WHERE id = ?').run(w.workshopNotes, id);
      for (const table of ['required_parts', 'required_tools', 'task_specs']) db.prepare(`DELETE FROM ${table} WHERE task_id = ?`).run(id);
      const part = db.prepare('INSERT INTO required_parts (task_id, part_spec_id, quantity, sort) VALUES (?, ?, ?, ?)');
      w.requiredParts.forEach((p, i) => part.run(id, p.partSpecId, p.quantity, i));
      const tool = db.prepare('INSERT INTO required_tools (task_id, sort, name) VALUES (?, ?, ?)');
      w.tools.forEach((name, i) => tool.run(id, i, name));
      const spec = db.prepare('INSERT INTO task_specs (task_id, spec_id) VALUES (?, ?)');
      for (const specId of specIds) spec.run(id, specId);
    });
    return c.json(loadTask(id));
  });

  // --- Vehicle Specs, Part Specs and Fitment Positions (desk work, online only) ---

  app.post('/api/vehicles/:id/specs', async (c) => {
    const vehicleId = c.req.param('id');
    vehicleOrThrow(vehicleId);
    const s = await parse(c, vehicleSpecInput);
    const id = randomUUID();
    db.prepare('INSERT INTO vehicle_specs (id, vehicle_id, kind, name, value, notes) VALUES (?, ?, ?, ?, ?, ?)').run(
      id,
      vehicleId,
      s.kind,
      s.name,
      s.value,
      s.notes,
    );
    return c.json(toVehicleSpec(ownedRowOrThrow('vehicle_specs', id, 'Vehicle Spec')), 201);
  });

  app.put('/api/specs/:id', async (c) => {
    const id = c.req.param('id');
    ownedRowOrThrow('vehicle_specs', id, 'Vehicle Spec');
    const s = await parse(c, vehicleSpecInput);
    db.prepare('UPDATE vehicle_specs SET kind = ?, name = ?, value = ?, notes = ? WHERE id = ?').run(s.kind, s.name, s.value, s.notes, id);
    return c.json(toVehicleSpec(ownedRowOrThrow('vehicle_specs', id, 'Vehicle Spec')));
  });

  app.delete('/api/specs/:id', (c) => {
    const id = c.req.param('id');
    ownedRowOrThrow('vehicle_specs', id, 'Vehicle Spec');
    db.prepare('DELETE FROM vehicle_specs WHERE id = ?').run(id);
    return c.body(null, 204);
  });

  app.post('/api/vehicles/:id/part-specs', async (c) => {
    const vehicleId = c.req.param('id');
    vehicleOrThrow(vehicleId);
    const p = await parse(c, partSpecInput);
    const id = randomUUID();
    db.prepare('INSERT INTO part_specs (id, vehicle_id, name, characteristics, part_numbers, unit) VALUES (?, ?, ?, ?, ?, ?)').run(
      id,
      vehicleId,
      p.name,
      p.characteristics,
      p.partNumbers,
      p.unit,
    );
    return c.json(toPartSpec(ownedRowOrThrow('part_specs', id, 'Part Spec')), 201);
  });

  app.put('/api/part-specs/:id', async (c) => {
    const id = c.req.param('id');
    ownedRowOrThrow('part_specs', id, 'Part Spec');
    const p = await parse(c, partSpecInput);
    db.prepare('UPDATE part_specs SET name = ?, characteristics = ?, part_numbers = ?, unit = ? WHERE id = ?').run(
      p.name,
      p.characteristics,
      p.partNumbers,
      p.unit,
      id,
    );
    return c.json(toPartSpec(ownedRowOrThrow('part_specs', id, 'Part Spec')));
  });

  // Tasks stop requiring it; Parts Used keep their own description, so history is unchanged.
  app.delete('/api/part-specs/:id', (c) => {
    const id = c.req.param('id');
    ownedRowOrThrow('part_specs', id, 'Part Spec');
    db.prepare('DELETE FROM part_specs WHERE id = ?').run(id);
    return c.body(null, 204);
  });

  app.post('/api/vehicles/:id/positions', async (c) => {
    const vehicleId = c.req.param('id');
    vehicleOrThrow(vehicleId);
    const p = await parse(c, positionInput);
    const id = randomUUID();
    db.prepare('INSERT INTO fitment_positions (id, vehicle_id, name) VALUES (?, ?, ?)').run(id, vehicleId, p.name);
    return c.json(toPosition(ownedRowOrThrow('fitment_positions', id, 'Fitment Position')), 201);
  });

  app.put('/api/positions/:id', async (c) => {
    const id = c.req.param('id');
    ownedRowOrThrow('fitment_positions', id, 'Fitment Position');
    const p = await parse(c, positionInput);
    db.prepare('UPDATE fitment_positions SET name = ? WHERE id = ?').run(p.name, id);
    return c.json(toPosition(ownedRowOrThrow('fitment_positions', id, 'Fitment Position')));
  });

  app.delete('/api/positions/:id', (c) => {
    const id = c.req.param('id');
    ownedRowOrThrow('fitment_positions', id, 'Fitment Position');
    const used = db.prepare('SELECT COUNT(*) AS n FROM parts_used WHERE position_id = ?').get(id) as { n: number };
    if (used.n > 0) throw new HttpError(409, 'Parts have been fitted at this position; rename it instead of deleting it');
    db.prepare('DELETE FROM fitment_positions WHERE id = ?').run(id);
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
    // A Service logged offline may refer to a Part Spec or position deleted since: keep the Part Used, drop the link.
    const belongs = (table: string, id: string | null) =>
      id !== null && db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND vehicle_id = ?`).get(id, s.vehicleId) !== undefined;
    const partsUsed = s.partsUsed.map((p) => ({
      ...p,
      partSpecId: belongs('part_specs', p.partSpecId) ? p.partSpecId : null,
      positionId: belongs('fitment_positions', p.positionId) ? p.positionId : null,
    }));
    transaction(() => {
      db.prepare(
        `INSERT INTO services (id, vehicle_id, date, odometer, notes) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET date = excluded.date, odometer = excluded.odometer, notes = excluded.notes`,
      ).run(s.id, s.vehicleId, s.date, s.odometer, s.notes);
      db.prepare('DELETE FROM service_tasks WHERE service_id = ?').run(s.id);
      const link = db.prepare('INSERT INTO service_tasks (service_id, task_id) VALUES (?, ?)');
      for (const taskId of taskIds) link.run(s.id, taskId);
      db.prepare('DELETE FROM parts_used WHERE service_id = ?').run(s.id);
      const part = db.prepare(
        `INSERT INTO parts_used (service_id, sort, part_spec_id, position_id, description, part_number, quantity, unit, price, supplier)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      partsUsed.forEach((p, i) =>
        part.run(s.id, i, p.partSpecId, p.positionId, p.description, p.partNumber, p.quantity, p.unit, p.price, p.supplier),
      );
    });
    return c.json({ ...s, taskIds, partsUsed });
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
