import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { ZodType } from 'zod';
import {
  copyTasksInput,
  documentInput,
  documentOwner,
  inspectionInput,
  modificationInput,
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
  GarageDocument,
  MaintenanceTask,
  Modification,
  TechnicalInspection,
  OdometerReading,
  PartSpec,
  PartUsed,
  Service,
  Snapshot,
  Vehicle,
  VehicleSpec,
} from '../shared/types.ts';
import { STANDARD_PARTS } from '../shared/catalogue.ts';
import type { VehicleKind } from '../shared/schemas.ts';
import { DEFAULT_GARAGE_ID } from './db.ts';

type ErrorStatus = 400 | 404 | 409 | 413 | 415 | 422 | 503;

class HttpError extends Error {
  readonly status: ErrorStatus;
  constructor(status: ErrorStatus, message: string) {
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
  firstRegistration: r.first_registration,
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

const toVehicleSpec = (r: Row): VehicleSpec => ({
  id: r.id,
  vehicleId: r.vehicle_id,
  kind: r.kind,
  name: r.name,
  value: r.value,
  notes: r.notes,
});

const toPartSpec = (r: Row): PartSpec => ({
  id: r.id,
  vehicleId: r.vehicle_id,
  standardPart: r.standard_part,
  name: r.name,
  characteristics: r.characteristics,
  partNumbers: r.part_numbers,
  unit: r.unit,
  notFitted: r.not_fitted === 1,
});

const toPosition = (r: Row): FitmentPosition => ({ id: r.id, vehicleId: r.vehicle_id, name: r.name });

const toModification = (r: Row): Modification => ({
  id: r.id,
  vehicleId: r.vehicle_id,
  name: r.name,
  fittedDate: r.fitted_date,
  fittedOdometer: r.fitted_odometer,
  removedDate: r.removed_date,
  positionId: r.position_id,
  declaredToInsurer: r.declared_to_insurer === 1,
  notes: r.notes,
});

const toDocument = (r: Row): GarageDocument => ({
  id: r.id,
  vehicleId: r.vehicle_id,
  ownerKind: r.owner_kind,
  ownerId: r.owner_id,
  type: r.type,
  title: r.title,
  issueDate: r.issue_date,
  expiryDate: r.expiry_date,
  fileName: r.file_name,
  contentType: r.content_type,
  size: r.size,
});

/** Files a Document may be: what a phone camera or a scanner produces. */
const DOCUMENT_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

export interface AppOptions {
  /** Where Document files are kept; uploads are refused when not set. */
  uploadsDir?: string;
}

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
export function createApp(db: DatabaseSync, garageId: string = DEFAULT_GARAGE_ID, { uploadsDir }: AppOptions = {}): Hono {
  const app = new Hono();
  if (uploadsDir) mkdirSync(uploadsDir, { recursive: true });

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
    const tasks = db
      .prepare(
        `SELECT t.* FROM maintenance_tasks t JOIN vehicles v ON v.id = t.vehicle_id
           WHERE v.garage_id = ? ORDER BY t.created_at`,
      )
      .all(garageId) as Row[];
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
      inspections: ownedRows('technical_inspections').map((r) => toInspection(r)),
      modifications: ownedRows('modifications').map(toModification),
      documents: ownedRows('documents').map(toDocument),
    };
  }

  function toInspection(r: Row): TechnicalInspection {
    const defects = db.prepare('SELECT * FROM inspection_defects WHERE inspection_id = ? ORDER BY sort').all(r.id) as Row[];
    return {
      id: r.id,
      vehicleId: r.vehicle_id,
      date: r.date,
      odometer: r.odometer,
      centre: r.centre,
      result: r.result,
      nextDueDate: r.next_due_date,
      notes: r.notes,
      defects: defects.map((d) => ({ description: d.description, severity: d.severity, fixedServiceId: d.fixed_service_id })),
    };
  }

  /** Removes the Documents attached to something being deleted, files included. */
  function deleteDocumentsOf(ownerKind: string, ownerId: string) {
    const docs = db.prepare('SELECT id FROM documents WHERE owner_kind = ? AND owner_id = ?').all(ownerKind, ownerId) as Row[];
    db.prepare('DELETE FROM documents WHERE owner_kind = ? AND owner_id = ?').run(ownerKind, ownerId);
    if (uploadsDir) for (const d of docs) rmSync(join(uploadsDir, d.id), { force: true });
  }

  /** Gives a Vehicle the Standard Parts of its kind it does not list yet, so each only needs its Part Spec filled in. */
  function ensureStandardParts(vehicleId: string, kind: VehicleKind) {
    const existing = new Set(
      (db.prepare('SELECT standard_part FROM part_specs WHERE vehicle_id = ? AND standard_part IS NOT NULL').all(vehicleId) as Row[]).map(
        (r) => r.standard_part as string,
      ),
    );
    const insert = db.prepare('INSERT INTO part_specs (id, vehicle_id, standard_part, name, unit) VALUES (?, ?, ?, ?, ?)');
    for (const [key, unit] of STANDARD_PARTS[kind]) {
      if (!existing.has(key)) insert.run(randomUUID(), vehicleId, key, key, unit);
    }
  }

  // Vehicles added before Standard Parts existed, or after the catalogue grew, get the missing ones.
  transaction(() => {
    for (const v of db.prepare('SELECT id, kind FROM vehicles WHERE garage_id = ?').all(garageId) as Row[])
      ensureStandardParts(v.id, v.kind);
  });

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
      `INSERT INTO vehicles (id, garage_id, kind, name, make, model, year, registration, first_registration)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, garageId, v.kind, v.name, v.make, v.model, v.year, v.registration, v.firstRegistration);
    ensureStandardParts(id, v.kind);
    return c.json(toVehicle(vehicleOrThrow(id)), 201);
  });

  app.put('/api/vehicles/:id', async (c) => {
    const id = c.req.param('id');
    vehicleOrThrow(id);
    const v = await parse(c, vehicleInput);
    db.prepare(
      'UPDATE vehicles SET kind = ?, name = ?, make = ?, model = ?, year = ?, registration = ?, first_registration = ? WHERE id = ?',
    ).run(v.kind, v.name, v.make, v.model, v.year, v.registration, v.firstRegistration, id);
    ensureStandardParts(id, v.kind);
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
    const row = ownedRowOrThrow('part_specs', id, 'Part Spec');
    const p = await parse(c, partSpecInput);
    if (row.standard_part) {
      // A Standard Part's name and unit come from the catalogue: only its Part Spec is edited.
      db.prepare('UPDATE part_specs SET characteristics = ?, part_numbers = ?, not_fitted = ? WHERE id = ?').run(
        p.characteristics,
        p.partNumbers,
        p.notFitted ? 1 : 0,
        id,
      );
    } else {
      db.prepare('UPDATE part_specs SET name = ?, characteristics = ?, part_numbers = ?, unit = ? WHERE id = ?').run(
        p.name,
        p.characteristics,
        p.partNumbers,
        p.unit,
        id,
      );
    }
    return c.json(toPartSpec(ownedRowOrThrow('part_specs', id, 'Part Spec')));
  });

  // Tasks stop requiring it; Parts Used keep their own description, so history is unchanged.
  app.delete('/api/part-specs/:id', (c) => {
    const id = c.req.param('id');
    const row = ownedRowOrThrow('part_specs', id, 'Part Spec');
    if (row.standard_part) throw new HttpError(409, 'A Standard Part cannot be deleted; mark it as not on this vehicle instead');
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
    const used = db
      .prepare(
        'SELECT (SELECT COUNT(*) FROM parts_used WHERE position_id = ?) + (SELECT COUNT(*) FROM modifications WHERE position_id = ?) AS n',
      )
      .get(id, id) as { n: number };
    if (used.n > 0) throw new HttpError(409, 'Parts have been fitted at this position; rename it instead of deleting it');
    db.prepare('DELETE FROM fitment_positions WHERE id = ?').run(id);
    return c.body(null, 204);
  });

  // --- Technical Inspections (desk work, online only) ---

  function saveInspection(id: string, vehicleId: string, body: Awaited<ReturnType<typeof inspectionInput.parse>>, isNew: boolean) {
    // A defect can only be closed by a Service of the same Vehicle.
    const serviceOf = (serviceId: string | null) =>
      serviceId !== null && db.prepare('SELECT 1 FROM services WHERE id = ? AND vehicle_id = ?').get(serviceId, vehicleId) !== undefined
        ? serviceId
        : null;
    transaction(() => {
      if (isNew) {
        db.prepare(
          `INSERT INTO technical_inspections (id, vehicle_id, date, odometer, centre, result, next_due_date, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(id, vehicleId, body.date, body.odometer, body.centre, body.result, body.nextDueDate, body.notes);
      } else {
        db.prepare(
          'UPDATE technical_inspections SET date = ?, odometer = ?, centre = ?, result = ?, next_due_date = ?, notes = ? WHERE id = ?',
        ).run(body.date, body.odometer, body.centre, body.result, body.nextDueDate, body.notes, id);
      }
      db.prepare('DELETE FROM inspection_defects WHERE inspection_id = ?').run(id);
      const defect = db.prepare(
        'INSERT INTO inspection_defects (inspection_id, sort, description, severity, fixed_service_id) VALUES (?, ?, ?, ?, ?)',
      );
      body.defects.forEach((d, i) => defect.run(id, i, d.description, d.severity, serviceOf(d.fixedServiceId)));
    });
  }

  app.post('/api/vehicles/:id/inspections', async (c) => {
    const vehicleId = c.req.param('id');
    vehicleOrThrow(vehicleId);
    const body = await parse(c, inspectionInput);
    const id = randomUUID();
    saveInspection(id, vehicleId, body, true);
    return c.json(toInspection(ownedRowOrThrow('technical_inspections', id, 'Technical Inspection')), 201);
  });

  app.put('/api/inspections/:id', async (c) => {
    const id = c.req.param('id');
    const row = ownedRowOrThrow('technical_inspections', id, 'Technical Inspection');
    const body = await parse(c, inspectionInput);
    saveInspection(id, row.vehicle_id, body, false);
    return c.json(toInspection(ownedRowOrThrow('technical_inspections', id, 'Technical Inspection')));
  });

  app.delete('/api/inspections/:id', (c) => {
    const id = c.req.param('id');
    ownedRowOrThrow('technical_inspections', id, 'Technical Inspection');
    transaction(() => {
      deleteDocumentsOf('inspection', id);
      db.prepare('DELETE FROM technical_inspections WHERE id = ?').run(id);
    });
    return c.body(null, 204);
  });

  // --- Modifications (desk work, online only) ---

  function checkedPosition(positionId: string | null, vehicleId: string): string | null {
    if (positionId === null) return null;
    if (!ownedRows('fitment_positions', 'x.id = ? AND x.vehicle_id = ?', positionId, vehicleId)[0]) {
      throw new HttpError(422, 'The Fitment Position belongs to another vehicle');
    }
    return positionId;
  }

  app.post('/api/vehicles/:id/modifications', async (c) => {
    const vehicleId = c.req.param('id');
    vehicleOrThrow(vehicleId);
    const m = await parse(c, modificationInput);
    const id = randomUUID();
    db.prepare(
      `INSERT INTO modifications (id, vehicle_id, name, fitted_date, fitted_odometer, removed_date, position_id, declared_to_insurer, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      vehicleId,
      m.name,
      m.fittedDate,
      m.fittedOdometer,
      m.removedDate,
      checkedPosition(m.positionId, vehicleId),
      m.declaredToInsurer ? 1 : 0,
      m.notes,
    );
    return c.json(toModification(ownedRowOrThrow('modifications', id, 'Modification')), 201);
  });

  app.put('/api/modifications/:id', async (c) => {
    const id = c.req.param('id');
    const row = ownedRowOrThrow('modifications', id, 'Modification');
    const m = await parse(c, modificationInput);
    db.prepare(
      `UPDATE modifications SET name = ?, fitted_date = ?, fitted_odometer = ?, removed_date = ?, position_id = ?,
         declared_to_insurer = ?, notes = ? WHERE id = ?`,
    ).run(
      m.name,
      m.fittedDate,
      m.fittedOdometer,
      m.removedDate,
      checkedPosition(m.positionId, row.vehicle_id),
      m.declaredToInsurer ? 1 : 0,
      m.notes,
      id,
    );
    return c.json(toModification(ownedRowOrThrow('modifications', id, 'Modification')));
  });

  app.delete('/api/modifications/:id', (c) => {
    const id = c.req.param('id');
    ownedRowOrThrow('modifications', id, 'Modification');
    transaction(() => {
      deleteDocumentsOf('modification', id);
      db.prepare('DELETE FROM modifications WHERE id = ?').run(id);
    });
    return c.body(null, 204);
  });

  // --- Documents: details in the database, files in uploadsDir under their id ---

  /** The Vehicle a Document's owner belongs to, checking the owner is in this Garage. */
  function ownerVehicle(ownerKind: string, ownerId: string): string {
    const table = { vehicle: 'vehicles', service: 'services', modification: 'modifications', inspection: 'technical_inspections' }[
      ownerKind
    ];
    if (ownerKind === 'vehicle') return vehicleOrThrow(ownerId).id;
    const row = table ? ownedRows(table, 'x.id = ?', ownerId)[0] : undefined;
    if (!row) throw new HttpError(404, 'What this Document is attached to was not found');
    return row.vehicle_id;
  }

  function validated<T>(schema: ZodType<T, any, any>, value: unknown): T {
    const result = schema.safeParse(value);
    if (!result.success) {
      const issue = result.error.issues[0]!;
      throw new HttpError(422, `${issue.path.join('.') || 'body'}: ${issue.message}`);
    }
    return result.data;
  }

  app.post(
    '/api/documents',
    bodyLimit({
      maxSize: MAX_DOCUMENT_BYTES + 64 * 1024,
      onError: () => {
        throw new HttpError(413, 'The file is larger than 25 MB');
      },
    }),
    async (c) => {
      if (!uploadsDir) throw new HttpError(503, 'Document storage is not configured');
      const form = await c.req.parseBody();
      const file = form.file;
      if (!(file instanceof File)) throw new HttpError(400, 'No file was sent');
      if (!DOCUMENT_TYPES.has(file.type)) throw new HttpError(415, 'Only PDF files and photos can be stored');
      if (file.size > MAX_DOCUMENT_BYTES) throw new HttpError(413, 'The file is larger than 25 MB');
      const owner = validated(documentOwner, form);
      const details = validated(documentInput, { ...form, file: undefined });
      const vehicleId = ownerVehicle(owner.ownerKind, owner.ownerId);
      const id = randomUUID();
      await writeFile(join(uploadsDir, id), Buffer.from(await file.arrayBuffer()));
      db.prepare(
        `INSERT INTO documents (id, vehicle_id, owner_kind, owner_id, type, title, issue_date, expiry_date, file_name, content_type, size)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        vehicleId,
        owner.ownerKind,
        owner.ownerId,
        details.type,
        details.title,
        details.issueDate,
        details.expiryDate,
        file.name.slice(0, 200) || 'document',
        file.type,
        file.size,
      );
      return c.json(toDocument(ownedRowOrThrow('documents', id, 'Document')), 201);
    },
  );

  app.put('/api/documents/:id', async (c) => {
    const id = c.req.param('id');
    ownedRowOrThrow('documents', id, 'Document');
    const d = await parse(c, documentInput);
    db.prepare('UPDATE documents SET type = ?, title = ?, issue_date = ?, expiry_date = ? WHERE id = ?').run(
      d.type,
      d.title,
      d.issueDate,
      d.expiryDate,
      id,
    );
    return c.json(toDocument(ownedRowOrThrow('documents', id, 'Document')));
  });

  app.get('/api/documents/:id/file', async (c) => {
    const row = ownedRowOrThrow('documents', c.req.param('id'), 'Document');
    if (!uploadsDir) throw new HttpError(503, 'Document storage is not configured');
    const data = await readFile(join(uploadsDir, row.id)).catch(() => {
      throw new HttpError(404, 'The file of this Document is missing');
    });
    return c.body(new Uint8Array(data), 200, {
      'content-type': row.content_type,
      'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(row.file_name)}`,
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, max-age=3600',
    });
  });

  app.delete('/api/documents/:id', (c) => {
    const row = ownedRowOrThrow('documents', c.req.param('id'), 'Document');
    db.prepare('DELETE FROM documents WHERE id = ?').run(row.id);
    if (uploadsDir) rmSync(join(uploadsDir, row.id), { force: true });
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
    transaction(() => {
      deleteDocumentsOf('service', id);
      db.prepare('DELETE FROM services WHERE id = ?').run(id);
    });
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
