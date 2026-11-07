import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { ZodType } from 'zod';
import {
  catalogueChangeInput,
  copyTasksInput,
  addStandardSpecsInput,
  vehiclePartInput,
  purchaseInput,
  mergeTaskInput,
  documentInput,
  documentOwner,
  odometerReadingInput,
  ownPartInput,
  sellInput,
  garagePageInput,
  serviceInput,
  taskInput,
  vehicleInput,
  specLineInput,
} from '../shared/schemas.ts';
import type {
  GarageDocument,
  MaintenanceTask,
  OdometerReading,
  PartUsed,
  Purchase,
  VehiclePart,
  Service,
  Snapshot,
  Vehicle,
  SpecLine,
} from '../shared/types.ts';
import { BUILT_IN_CATALOGUE, Catalogue, tidyConditions, type Build, type Conditions } from '../shared/catalogue.ts';
import { starterSpecs } from '../shared/spec-templates.ts';
import { buildOfRow, catalogueEntries } from './catalogue-rows.ts';
import type { VehicleInput, VehicleKind } from '../shared/schemas.ts';
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
  name: r.name,
  make: r.make,
  model: r.model,
  year: r.year,
  vin: r.vin,
  firstRegistrationDate: r.first_registration_date,
  purchaseDate: r.purchase_date,
  ...buildOfRow(r),
  status: r.status,
  onGaragePage: r.on_garage_page === 1,
  soldDate: r.sold_date,
  soldOdometer: r.sold_odometer,
  soldPrice: r.sold_price,
});

const toTask = (r: Row): MaintenanceTask => ({
  id: r.id,
  vehicleId: r.vehicle_id,
  name: r.name,
  nameFr: r.name_fr,
  intervalKm: r.interval_km,
  intervalMonths: r.interval_months,
  action: r.action,
  baselineDate: r.baseline_date,
  baselineOdometer: r.baseline_odometer,
  notes: r.notes,
  category: r.category,
  switchedOff: r.switched_off === 1,
  templateCode: r.template_code,
});

const toReading = (r: Row): OdometerReading => ({ id: r.id, vehicleId: r.vehicle_id, date: r.date, odometer: r.odometer });

const toSpecLine = (r: Row): SpecLine => ({
  id: r.id,
  vehicleId: r.vehicle_id,
  label: r.label,
  value: r.value,
  oem: r.oem,
  group: r.spec_group,
  category: r.category,
  sort: r.sort,
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
  description: r.description,
  partNumber: r.part_number,
  quantity: r.quantity,
  unit: r.unit,
  price: r.price,
  partId: r.part_id,
});

const toVehiclePart = (r: Row): VehiclePart => ({
  id: r.id,
  vehicleId: r.vehicle_id,
  name: r.name,
  partNumber: r.part_number,
  unit: r.unit,
  quantity: r.quantity,
  price: r.price,
  taskId: r.task_id,
  specLineId: r.spec_line_id,
  toBuy: r.to_buy === 1,
  notes: r.notes,
});

const toPurchase = (r: Row): Purchase => ({
  id: r.id,
  partId: r.part_id,
  vehicleId: r.vehicle_id,
  date: r.date,
  quantity: r.quantity,
  totalPaid: r.total_paid,
  shop: r.shop,
  deliveryFees: r.delivery_fees,
  notes: r.notes,
});

/** One cell of a CSV file (separated by semicolons, as French spreadsheets expect): quoted when it holds a semicolon, a quote or a line break. */
function csvCell(value: string | number | null): string {
  if (value === null) return '';
  const text = String(value);
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

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

function garageReader(db: DatabaseSync, garageId: string) {
  /** Rows of a table whose vehicle_id belongs to this Garage, optionally narrowed by an extra condition. */
  function ownedRows(table: string, where = '1', ...params: (string | number)[]): Row[] {
    return db
      .prepare(
        `SELECT x.* FROM ${table} x JOIN vehicles v ON v.id = x.vehicle_id
         WHERE v.garage_id = ? AND ${where} ORDER BY x.created_at`,
      )
      .all(garageId, ...params) as Row[];
  }

  function snapshot(): Snapshot {
    const vehicles = (db.prepare('SELECT * FROM vehicles WHERE garage_id = ? ORDER BY created_at').all(garageId) as Row[]).map(toVehicle);
    const tasks = db
      .prepare(
        `SELECT t.* FROM maintenance_tasks t JOIN vehicles v ON v.id = t.vehicle_id
           WHERE v.garage_id = ? ORDER BY t.created_at`,
      )
      .all(garageId) as Row[];
    const taskList = tasks.map(toTask);
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
          `SELECT p.* FROM service_items p JOIN services s ON s.id = p.service_id JOIN vehicles v ON v.id = s.vehicle_id
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
      kind: r.kind,
      title: r.title,
      category: r.category,
      performedBy: r.performed_by,
      totalCost: r.total_cost,
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
      specLines: ownedRows('spec_lines').map(toSpecLine),
      vehicleParts: ownedRows('vehicle_parts').map(toVehiclePart),
      purchases: ownedRows('purchases').map(toPurchase),
      documents: (db.prepare("SELECT * FROM documents WHERE garage_id = ? AND owner_kind IN ('vehicle', 'service', 'purchase') ORDER BY created_at").all(garageId) as Row[]).map(toDocument),
      catalogue: catalogueEntries(db, garageId),
    };
  }

  return { ownedRows, snapshot };
}

/** Everything in one Garage, as the app downloads it. */
export function readSnapshot(db: DatabaseSync, garageId: string = DEFAULT_GARAGE_ID): Snapshot {
  return garageReader(db, garageId).snapshot();
}

/**
 * The HTTP API. Every query is scoped to one Garage; until users exist, that is the default Garage.
 * Services and Odometer Readings are written with PUT and a client-generated id, so the phone's
 * offline send queue can safely replay them.
 */
export function createApp(db: DatabaseSync, garageId: string = DEFAULT_GARAGE_ID, { uploadsDir }: AppOptions = {}): Hono {
  const app = new Hono();
  const { ownedRows, snapshot } = garageReader(db, garageId);
  if (uploadsDir) mkdirSync(uploadsDir, { recursive: true });
  // The built-in parts with the owner's changes; read again whenever those change.
  let catalogue = new Catalogue(catalogueEntries(db, garageId));

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

  function ownedRowOrThrow(table: string, id: string, what: string): Row {
    const row = ownedRows(table, 'x.id = ?', id)[0];
    if (!row) throw new HttpError(404, `${what} not found`);
    return row;
  }

  function loadTask(id: string): MaintenanceTask {
    return toTask(taskOrThrow(id));
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

  function documentOrThrow(id: string): Row {
    const row = db.prepare('SELECT * FROM documents WHERE id = ? AND garage_id = ?').get(id, garageId) as Row | undefined;
    if (!row) throw new HttpError(404, 'Document not found');
    return row;
  }

  /** Removes the Documents attached to something being deleted, files included. */
  function deleteDocumentsOf(ownerKind: string, ownerId: string) {
    const docs = db.prepare('SELECT id FROM documents WHERE owner_kind = ? AND owner_id = ?').all(ownerKind, ownerId) as Row[];
    db.prepare('DELETE FROM documents WHERE owner_kind = ? AND owner_id = ?').run(ownerKind, ownerId);
    if (uploadsDir) for (const d of docs) rmSync(join(uploadsDir, d.id), { force: true });
  }

  /**
   * Gives a Vehicle the Tasks of the plan templates that fit its Build, at the template's interval. Every Task it
   * creates is tagged with its template, so running this again never doubles one, whatever the owner renamed it. A
   * Task without a tag that is named like the template ("Engine oil" for the oil change) is taken as that template's
   * Task and tagged. Only a new Vehicle gets this by itself: after that the plan is the owner's.
   */
  function seedTasks(vehicleId: string, build: Build): number {
    const tasks = db.prepare('SELECT id, name, name_fr, template_code FROM maintenance_tasks WHERE vehicle_id = ?').all(vehicleId) as Row[];
    const tagged = new Set(tasks.map((t) => t.template_code).filter((code) => code !== null));
    const untagged = tasks.filter((t) => t.template_code === null);
    const insert = db.prepare(
      'INSERT INTO maintenance_tasks (id, vehicle_id, name, name_fr, interval_km, interval_months, category, action, template_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    let added = 0;
    for (const s of catalogue.starterTasks(build)) {
      if (tagged.has(s.code)) continue;
      const known = new Set([s.name, s.nameFr, ...s.sameAs].map(looseName));
      const same = untagged.find((t) => known.has(looseName(t.name)) || known.has(looseName(t.name_fr)));
      if (same) {
        db.prepare('UPDATE maintenance_tasks SET template_code = ? WHERE id = ?').run(s.code, same.id);
        untagged.splice(untagged.indexOf(same), 1);
        continue;
      }
      insert.run(randomUUID(), vehicleId, s.name, s.nameFr, s.intervalKm, s.intervalMonths, s.category, s.action, s.code);
      added++;
    }
    return added;
  }

  /** A name compared loosely: case, accents and spacing aside. */
  function looseName(name: string | null): string {
    return (name ?? '')
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  app.onError((error, c) => {
    if (error instanceof HttpError) return c.json({ error: error.message }, error.status);
    console.error(error);
    return c.json({ error: 'Internal error' }, 500);
  });

  app.get('/api/health', (c) => c.json({ ok: true }));

  app.get('/api/snapshot', (c) => c.json(snapshot()));

  // --- Vehicles ---

  const vehicleValues = (v: VehicleInput) =>
    [
      v.kind,
      v.name,
      v.make,
      v.model,
      v.year,
      v.vin,
      v.firstRegistrationDate,
      v.purchaseDate,
      v.fuel,
      v.transmission,
      v.drivetrain,
      v.distribution,
      v.cooling,
      v.finalDrive,
      v.cylinders,
      v.hasHydraulicClutch ? 1 : 0,
      v.hasTurbo ? 1 : 0,
      v.hasDirectInjection ? 1 : 0,
      v.hasStartStop ? 1 : 0,
      v.hasAdblue ? 1 : 0,
      v.hasAc ? 1 : 0,
      v.hasAirSuspension ? 1 : 0,
    ] as const;

  const BUILD_COLUMNS = `fuel, transmission, drivetrain, distribution, cooling, final_drive, cylinders, has_hydraulic_clutch,
         has_turbo, has_direct_injection, has_start_stop, has_adblue, has_ac, has_air_suspension`;

  app.post('/api/vehicles', async (c) => {
    const v = await parse(c, vehicleInput);
    const id = randomUUID();
    transaction(() => {
      db.prepare(
        `INSERT INTO vehicles (id, garage_id, kind, name, make, model, year, vin, first_registration_date, purchase_date, ${BUILD_COLUMNS})
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, garageId, ...vehicleValues(v));
      // A new Vehicle starts with the plan templates that fit its Build; after that the plan is its own.
      seedTasks(id, v);
    });
    return c.json(toVehicle(vehicleOrThrow(id)), 201);
  });

  app.put('/api/vehicles/:id', async (c) => {
    const id = c.req.param('id');
    vehicleOrThrow(id);
    const v = await parse(c, vehicleInput);
    transaction(() => {
      db.prepare(
        `UPDATE vehicles SET kind = ?, name = ?, make = ?, model = ?, year = COALESCE(?, year), vin = ?,
           first_registration_date = ?, purchase_date = ?,
           fuel = ?, transmission = ?, drivetrain = ?, distribution = ?, cooling = ?, final_drive = ?, cylinders = ?,
           has_hydraulic_clutch = ?, has_turbo = ?, has_direct_injection = ?, has_start_stop = ?, has_adblue = ?, has_ac = ?,
           has_air_suspension = ?
         WHERE id = ?`,
      ).run(...vehicleValues(v), id);
    });
    return c.json(toVehicle(vehicleOrThrow(id)));
  });

  app.post('/api/vehicles/:id/sell', async (c) => {
    const id = c.req.param('id');
    vehicleOrThrow(id);
    const s = await parse(c, sellInput);
    // A sold Vehicle leaves the garage page, unless the user puts it back there.
    db.prepare(`UPDATE vehicles SET status = 'sold', on_garage_page = 0, sold_date = ?, sold_odometer = ?, sold_price = ? WHERE id = ?`).run(
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
    transaction(() => {
      db.prepare(
        `UPDATE vehicles SET status = 'owned', on_garage_page = 1, sold_date = NULL, sold_odometer = NULL, sold_price = NULL WHERE id = ?`,
      ).run(id);
    });
    return c.json(toVehicle(vehicleOrThrow(id)));
  });

  app.put('/api/vehicles/:id/garage-page', async (c) => {
    const id = c.req.param('id');
    vehicleOrThrow(id);
    const { shown } = await parse(c, garagePageInput);
    db.prepare('UPDATE vehicles SET on_garage_page = ? WHERE id = ?').run(shown ? 1 : 0, id);
    return c.json(toVehicle(vehicleOrThrow(id)));
  });

  // --- Maintenance Tasks: the Vehicle's own plan ---

  app.post('/api/vehicles/:id/tasks', async (c) => {
    const vehicleId = c.req.param('id');
    vehicleOrThrow(vehicleId);
    const t = await parse(c, taskInput);
    const id = randomUUID();
    db.prepare(
      `INSERT INTO maintenance_tasks
         (id, vehicle_id, name, name_fr, action, interval_km, interval_months, baseline_date, baseline_odometer, category, notes, switched_off)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, vehicleId, t.name, t.nameFr, t.action, t.intervalKm, t.intervalMonths, t.baselineDate, t.baselineOdometer, t.category, t.notes, t.switchedOff ? 1 : 0);
    return c.json(loadTask(id), 201);
  });

  /** Gives a Vehicle the plan templates that fit its Build and it has no Task named like yet. */
  app.post('/api/vehicles/:id/add-from-templates', (c) => {
    const vehicleId = c.req.param('id');
    const build = buildOfRow(vehicleOrThrow(vehicleId));
    return c.json({ added: transaction(() => seedTasks(vehicleId, build)) }, 201);
  });

  app.post('/api/vehicles/:id/copy-tasks', async (c) => {
    const vehicleId = c.req.param('id');
    vehicleOrThrow(vehicleId);
    const { fromVehicleId } = await parse(c, copyTasksInput);
    vehicleOrThrow(fromVehicleId);
    if (fromVehicleId === vehicleId) throw new HttpError(422, 'Cannot copy a Vehicle onto itself');
    const source = db.prepare('SELECT * FROM maintenance_tasks WHERE vehicle_id = ? ORDER BY created_at, rowid').all(fromVehicleId) as Row[];
    const existing = db.prepare('SELECT name, name_fr, template_code FROM maintenance_tasks WHERE vehicle_id = ?').all(vehicleId) as Row[];
    const names = new Set(existing.flatMap((t) => [looseName(t.name), looseName(t.name_fr)]));
    const codes = new Set(existing.map((t) => t.template_code).filter((code) => code !== null));
    const insert = db.prepare(
      `INSERT INTO maintenance_tasks (id, vehicle_id, name, name_fr, action, interval_km, interval_months, category, notes, switched_off, template_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    // History is not copied: the copies start with no baseline, since they were never done on this Vehicle. A Task
    // this Vehicle already has by name keeps its own Interval.
    let copied = 0;
    transaction(() => {
      for (const t of source) {
        if (names.has(looseName(t.name)) || (t.template_code !== null && codes.has(t.template_code))) continue;
        insert.run(randomUUID(), vehicleId, t.name, t.name_fr, t.action, t.interval_km, t.interval_months, t.category, t.notes, t.switched_off, t.template_code);
        copied++;
      }
    });
    return c.json({ copied }, 201);
  });

  app.put('/api/tasks/:id', async (c) => {
    const id = c.req.param('id');
    taskOrThrow(id);
    const t = await parse(c, taskInput);
    db.prepare(
      `UPDATE maintenance_tasks SET name = ?, name_fr = ?, action = ?, interval_km = ?, interval_months = ?, baseline_date = ?,
         baseline_odometer = ?, category = ?, notes = ?, switched_off = ?
       WHERE id = ?`,
    ).run(t.name, t.nameFr, t.action, t.intervalKm, t.intervalMonths, t.baselineDate, t.baselineOdometer, t.category, t.notes, t.switchedOff ? 1 : 0, id);
    return c.json(loadTask(id));
  });

  /**
   * Folds a duplicate Task into the one to keep: its Services now count for the kept Task, which keeps its own name and
   * Interval, takes the more recent baseline and gets the duplicate's notes added. The duplicate is then deleted.
   */
  app.post('/api/tasks/:id/merge', async (c) => {
    const id = c.req.param('id');
    const duplicate = taskOrThrow(id);
    const { intoTaskId } = await parse(c, mergeTaskInput);
    if (intoTaskId === id) throw new HttpError(422, 'Cannot merge a Task into itself');
    const kept = taskOrThrow(intoTaskId);
    if (kept.vehicle_id !== duplicate.vehicle_id) throw new HttpError(422, 'Tasks can only be merged within one Vehicle');
    transaction(() => {
      // A Service that lists both Tasks keeps the kept one only.
      db.prepare('UPDATE OR IGNORE service_tasks SET task_id = ? WHERE task_id = ?').run(intoTaskId, id);
      db.prepare('DELETE FROM service_tasks WHERE task_id = ?').run(id);
      db.prepare('UPDATE vehicle_parts SET task_id = ? WHERE task_id = ?').run(intoTaskId, id);
      if (duplicate.baseline_date && (!kept.baseline_date || duplicate.baseline_date > kept.baseline_date)) {
        db.prepare('UPDATE maintenance_tasks SET baseline_date = ?, baseline_odometer = ? WHERE id = ?').run(
          duplicate.baseline_date,
          duplicate.baseline_odometer,
          intoTaskId,
        );
      }
      const notes = [kept.notes, duplicate.notes].filter((n, i, all) => n && all.indexOf(n) === i).join('\n\n');
      db.prepare('UPDATE maintenance_tasks SET notes = ? WHERE id = ?').run(notes || null, intoTaskId);
      db.prepare('DELETE FROM maintenance_tasks WHERE id = ?').run(id);
      // The kept Task stands for the template too, so adding templates again does not bring the duplicate back.
      if (kept.template_code === null && duplicate.template_code !== null) {
        db.prepare('UPDATE maintenance_tasks SET template_code = ? WHERE id = ?').run(duplicate.template_code, intoTaskId);
      }
    });
    return c.json(loadTask(intoTaskId));
  });

  app.delete('/api/tasks/:id', (c) => {
    const id = c.req.param('id');
    taskOrThrow(id);
    const used = db.prepare('SELECT COUNT(*) AS n FROM service_tasks WHERE task_id = ?').get(id) as { n: number };
    if (used.n > 0) throw new HttpError(409, 'This Maintenance Task appears in logged Services and cannot be deleted');
    db.prepare('DELETE FROM maintenance_tasks WHERE id = ?').run(id);
    return c.body(null, 204);
  });

  // --- The plan templates (Settings) ---

  /** A change of the templates only matters to Vehicles added afterwards: the plan of an existing one is its own. */
  function catalogueChanged() {
    catalogue = new Catalogue(catalogueEntries(db, garageId));
  }

  function tidyOrThrow(kind: VehicleKind, conditions: Record<string, string[]>): Conditions {
    const tidy = tidyConditions(kind, conditions as Conditions);
    if (Object.values(tidy).some((values) => values.length === 0)) throw new HttpError(422, 'Tick at least one value for each detail');
    return tidy;
  }

  app.post('/api/catalogue', async (c) => {
    const p = await parse(c, ownPartInput);
    const code = `own_${randomUUID()}`;
    transaction(() => {
      db.prepare(
        `INSERT INTO catalogue_parts (garage_id, code, kind, name, name_fr, category, interval_km, interval_months, conditions, action)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(garageId, code, p.kind, p.name, p.nameFr, p.category, p.intervalKm, p.intervalMonths, JSON.stringify(tidyOrThrow(p.kind, p.conditions)), p.action);
      catalogueChanged();
    });
    return c.json({ code }, 201);
  });

  app.put('/api/catalogue/:code', async (c) => {
    const code = c.req.param('code');
    const part = catalogue.known(code);
    if (!part) throw new HttpError(404, 'Template not found');
    if (part.builtIn) {
      const p = await parse(c, catalogueChangeInput);
      const conditions = tidyOrThrow(part.kind, p.conditions);
      const builtIn = BUILT_IN_CATALOGUE.known(code)!;
      const original = tidyConditions(part.kind, builtIn.conditions);
      const kept = JSON.stringify(conditions) === JSON.stringify(original) ? null : JSON.stringify(conditions);
      // What is left out of the request stays as it is: the owner's Interval if they set one, else the built-in one.
      const intervalKm = p.intervalKm === undefined && p.intervalMonths === undefined ? part.intervalKm : (p.intervalKm ?? null);
      const intervalMonths = p.intervalKm === undefined && p.intervalMonths === undefined ? part.intervalMonths : (p.intervalMonths ?? null);
      const sameInterval = intervalKm === builtIn.intervalKm && intervalMonths === builtIn.intervalMonths;
      // Only what differs from the built-in task is kept as the owner's.
      const builtInName = builtIn.task?.en ?? builtIn.en;
      const name = builtIn.task && p.name && p.name !== builtInName ? p.name : null;
      const nameFr = builtIn.task && p.nameFr && p.nameFr !== builtIn.task.fr ? p.nameFr : null;
      const category = p.category && p.category !== BUILT_IN_CATALOGUE.known(code)!.category ? p.category : null;
      const builtInAction = BUILT_IN_CATALOGUE.known(code)!.action;
      const action = p.action && p.action !== builtInAction ? p.action : null;
      transaction(() => {
        // A template set just as it is built in is no change at all.
        if (kept === null && !p.removed && sameInterval && !name && !nameFr && !category && !action) {
          db.prepare('DELETE FROM catalogue_parts WHERE garage_id = ? AND code = ?').run(garageId, code);
        } else {
          db.prepare(
            `INSERT INTO catalogue_parts (garage_id, code, conditions, removed, interval_set, interval_km, interval_months, name, name_fr, category, action)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (garage_id, code) DO UPDATE SET conditions = excluded.conditions,
               removed = excluded.removed, interval_set = excluded.interval_set, interval_km = excluded.interval_km,
               interval_months = excluded.interval_months, name = excluded.name, name_fr = excluded.name_fr,
               category = excluded.category, action = excluded.action`,
          ).run(garageId, code, kept, p.removed ? 1 : 0, sameInterval ? 0 : 1, sameInterval ? null : intervalKm, sameInterval ? null : intervalMonths, name, nameFr, category, action);
        }
        catalogueChanged();
      });
    } else {
      const p = await parse(c, ownPartInput);
      transaction(() => {
        // Its kind stays: a Vehicle's plan is made of templates of its own kind.
        db.prepare(
          `UPDATE catalogue_parts SET name = ?, name_fr = ?, category = ?, interval_km = ?, interval_months = ?, conditions = ?, action = ?
           WHERE garage_id = ? AND code = ?`,
        ).run(p.name, p.nameFr, p.category, p.intervalKm, p.intervalMonths, JSON.stringify(tidyOrThrow(part.kind, p.conditions)), p.action, garageId, code);
        catalogueChanged();
      });
    }
    return c.json({ code });
  });

  // A built-in template goes back to how it is built in; a template of the owner's is deleted.
  app.delete('/api/catalogue/:code', (c) => {
    const code = c.req.param('code');
    if (!catalogue.known(code)) throw new HttpError(404, 'Template not found');
    transaction(() => {
      db.prepare('DELETE FROM catalogue_parts WHERE garage_id = ? AND code = ?').run(garageId, code);
      catalogueChanged();
    });
    return c.body(null, 204);
  });

  // --- Spec lines of the Vehicle Profile (desk work, online only) ---

  function saveSpecLine(run: () => void) {
    try {
      run();
    } catch (error) {
      if ((error as Error).message?.includes('UNIQUE')) throw new HttpError(409, 'This label is already listed for this vehicle');
      throw error;
    }
  }

  app.post('/api/vehicles/:id/specs', async (c) => {
    const vehicleId = c.req.param('id');
    vehicleOrThrow(vehicleId);
    const s = await parse(c, specLineInput);
    const id = randomUUID();
    const next = (db.prepare('SELECT coalesce(max(sort), -1) + 1 AS n FROM spec_lines WHERE vehicle_id = ? AND spec_group = ?').get(vehicleId, s.group) as Row).n;
    saveSpecLine(() => db.prepare('INSERT INTO spec_lines (id, vehicle_id, label, value, oem, spec_group, category, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, vehicleId, s.label, s.value, s.oem, s.group, s.category, next));
    return c.json(toSpecLine(ownedRowOrThrow('spec_lines', id, 'Spec line')), 201);
  });

  app.put('/api/specs/:id', async (c) => {
    const id = c.req.param('id');
    const row = ownedRowOrThrow('spec_lines', id, 'Spec line');
    const s = await parse(c, specLineInput);
    saveSpecLine(() => {
      if (s.group === row.spec_group) db.prepare('UPDATE spec_lines SET label = ?, value = ?, oem = ?, category = ? WHERE id = ?').run(s.label, s.value, s.oem, s.category, id);
      else {
        const next = (db.prepare('SELECT coalesce(max(sort), -1) + 1 AS n FROM spec_lines WHERE vehicle_id = ? AND spec_group = ?').get(row.vehicle_id, s.group) as Row).n;
        db.prepare('UPDATE spec_lines SET label = ?, value = ?, oem = ?, spec_group = ?, category = ?, sort = ? WHERE id = ?').run(s.label, s.value, s.oem, s.group, s.category, next, id);
      }
    });
    return c.json(toSpecLine(ownedRowOrThrow('spec_lines', id, 'Spec line')));
  });

  /**
   * Gives a Vehicle the usual spec lines for its Build, each with its value still empty, in the owner's language. A
   * line already there is left alone: one carrying the template's code, or an untagged one labelled like it (which is
   * then tagged), so running this again never doubles a line.
   */
  app.post('/api/vehicles/:id/add-standard-specs', async (c) => {
    const vehicleId = c.req.param('id');
    const build = buildOfRow(vehicleOrThrow(vehicleId));
    const { lang } = await parse(c, addStandardSpecsInput);
    const added = transaction(() => {
      const lines = db.prepare('SELECT id, label, template_code FROM spec_lines WHERE vehicle_id = ?').all(vehicleId) as Row[];
      const tagged = new Set(lines.map((l) => l.template_code).filter((code) => code !== null));
      const untagged = lines.filter((l) => l.template_code === null);
      const labels = new Set(lines.map((l) => looseName(l.label)));
      const nextSort = db.prepare('SELECT coalesce(max(sort), -1) + 1 AS n FROM spec_lines WHERE vehicle_id = ? AND spec_group = ?');
      const insert = db.prepare("INSERT INTO spec_lines (id, vehicle_id, label, value, spec_group, category, sort, template_code) VALUES (?, ?, ?, '', ?, ?, ?, ?)");
      let count = 0;
      for (const s of starterSpecs(build)) {
        if (tagged.has(s.code)) continue;
        const known = new Set([s.label, s.labelFr].map(looseName));
        const same = untagged.find((l) => known.has(looseName(l.label)));
        if (same) {
          db.prepare('UPDATE spec_lines SET template_code = ? WHERE id = ?').run(s.code, same.id);
          untagged.splice(untagged.indexOf(same), 1);
          continue;
        }
        const label = lang === 'fr' ? s.labelFr : s.label;
        if (labels.has(looseName(label))) continue;
        insert.run(randomUUID(), vehicleId, label, s.group, s.category === 'other' ? null : s.category, (nextSort.get(vehicleId, s.group) as Row).n, s.code);
        count++;
      }
      return count;
    });
    return c.json({ added }, 201);
  });

  app.delete('/api/specs/:id', (c) => {
    const id = c.req.param('id');
    ownedRowOrThrow('spec_lines', id, 'Spec line');
    db.prepare('DELETE FROM spec_lines WHERE id = ?').run(id);
    return c.body(null, 204);
  });

  // --- The parts list of a Vehicle (desk work, online only; Services read it from the snapshot) ---

  /** The part already on this Vehicle's list with this name and part number, ignoring case and accents. */
  function samePart(vehicleId: string, name: string, partNumber: string | null, exceptId = ''): Row | undefined {
    const rows = db.prepare('SELECT * FROM vehicle_parts WHERE vehicle_id = ? AND id <> ?').all(vehicleId, exceptId) as Row[];
    return rows.find((r) => looseName(r.name) === looseName(name) && looseName(r.part_number) === looseName(partNumber));
  }

  function checkPartTask(vehicleId: string, taskId: string | null) {
    if (taskId === null) return;
    const task = db.prepare('SELECT vehicle_id FROM maintenance_tasks WHERE id = ?').get(taskId) as Row | undefined;
    if (!task || task.vehicle_id !== vehicleId) throw new HttpError(422, 'That task is not on this vehicle');
  }

  /** The Spec Line an item is for must be one of the same Vehicle. */
  function checkPartSpecLine(vehicleId: string, specLineId: string | null | undefined) {
    if (specLineId === null || specLineId === undefined) return;
    const line = db.prepare('SELECT vehicle_id FROM spec_lines WHERE id = ?').get(specLineId) as Row | undefined;
    if (!line || line.vehicle_id !== vehicleId) throw new HttpError(422, 'That spec line is not on this vehicle');
  }

  app.post('/api/vehicles/:id/parts', async (c) => {
    const vehicleId = c.req.param('id');
    vehicleOrThrow(vehicleId);
    const p = await parse(c, vehiclePartInput);
    checkPartTask(vehicleId, p.taskId);
    checkPartSpecLine(vehicleId, p.specLineId);
    if (samePart(vehicleId, p.name, p.partNumber)) throw new HttpError(409, 'This part is already on the list');
    const id = randomUUID();
    db.prepare('INSERT INTO vehicle_parts (id, vehicle_id, name, part_number, unit, quantity, price, task_id, spec_line_id, to_buy, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      id, vehicleId, p.name, p.partNumber, p.unit, p.quantity, p.price, p.taskId, p.specLineId ?? null, p.toBuy ? 1 : 0, p.notes,
    );
    return c.json(toVehiclePart(ownedRowOrThrow('vehicle_parts', id, 'Part')), 201);
  });

  app.put('/api/parts/:id', async (c) => {
    const id = c.req.param('id');
    const row = ownedRowOrThrow('vehicle_parts', id, 'Part');
    const p = await parse(c, vehiclePartInput);
    checkPartTask(row.vehicle_id, p.taskId);
    checkPartSpecLine(row.vehicle_id, p.specLineId);
    if (samePart(row.vehicle_id, p.name, p.partNumber, id)) throw new HttpError(409, 'This part is already on the list');
    const toBuy = p.toBuy === undefined ? row.to_buy : p.toBuy ? 1 : 0;
    const specLineId = p.specLineId === undefined ? row.spec_line_id : p.specLineId;
    db.prepare('UPDATE vehicle_parts SET name = ?, part_number = ?, unit = ?, quantity = ?, price = ?, task_id = ?, spec_line_id = ?, to_buy = ?, notes = ? WHERE id = ?').run(
      p.name, p.partNumber, p.unit, p.quantity, p.price, p.taskId, specLineId, toBuy, p.notes, id,
    );
    return c.json(toVehiclePart(ownedRowOrThrow('vehicle_parts', id, 'Part')));
  });

  app.delete('/api/parts/:id', (c) => {
    const id = c.req.param('id');
    ownedRowOrThrow('vehicle_parts', id, 'Part');
    transaction(() => {
      // The purchase log goes with the part, and so do the receipts attached to it.
      for (const purchase of db.prepare('SELECT id FROM purchases WHERE part_id = ?').all(id) as Row[]) deleteDocumentsOf('purchase', purchase.id);
      db.prepare('DELETE FROM vehicle_parts WHERE id = ?').run(id);
    });
    return c.body(null, 204);
  });

  // --- The purchase log of a part (desk work, online only). Recording one makes the part Bought. ---

  app.post('/api/parts/:id/purchases', async (c) => {
    const part = ownedRowOrThrow('vehicle_parts', c.req.param('id'), 'Part');
    const p = await parse(c, purchaseInput);
    const id = randomUUID();
    transaction(() => {
      db.prepare('INSERT INTO purchases (id, part_id, vehicle_id, date, quantity, total_paid, shop, delivery_fees, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        id, part.id, part.vehicle_id, p.date, p.quantity, p.totalPaid, p.shop, p.deliveryFees, p.notes,
      );
      db.prepare('UPDATE vehicle_parts SET to_buy = 0 WHERE id = ?').run(part.id);
    });
    return c.json(toPurchase(ownedRowOrThrow('purchases', id, 'Purchase')), 201);
  });

  app.put('/api/purchases/:id', async (c) => {
    const id = c.req.param('id');
    ownedRowOrThrow('purchases', id, 'Purchase');
    const p = await parse(c, purchaseInput);
    db.prepare('UPDATE purchases SET date = ?, quantity = ?, total_paid = ?, shop = ?, delivery_fees = ?, notes = ? WHERE id = ?').run(
      p.date, p.quantity, p.totalPaid, p.shop, p.deliveryFees, p.notes, id,
    );
    return c.json(toPurchase(ownedRowOrThrow('purchases', id, 'Purchase')));
  });

  app.delete('/api/purchases/:id', (c) => {
    const id = c.req.param('id');
    ownedRowOrThrow('purchases', id, 'Purchase');
    transaction(() => {
      deleteDocumentsOf('purchase', id);
      db.prepare('DELETE FROM purchases WHERE id = ?').run(id);
    });
    return c.body(null, 204);
  });

  /** Every purchase of the Garage as a spreadsheet file, for analysis outside the app. The price per unit is worked out here. */
  app.get('/api/purchases.csv', (c) => {
    const rows = db
      .prepare(
        `SELECT pu.*, p.name AS part_name, p.part_number, p.unit, v.name AS vehicle_name
         FROM purchases pu JOIN vehicle_parts p ON p.id = pu.part_id JOIN vehicles v ON v.id = pu.vehicle_id
         WHERE v.garage_id = ? ORDER BY pu.date, v.name, p.name`,
      )
      .all(garageId) as Row[];
    const lines = [
      ['vehicle', 'part', 'part_number', 'unit', 'date', 'quantity', 'total_paid', 'price_per_unit', 'delivery_fees', 'shop', 'notes'].join(';'),
      ...rows.map((r) =>
        [
          r.vehicle_name,
          r.part_name,
          r.part_number,
          r.unit,
          r.date,
          r.quantity,
          r.total_paid,
          r.quantity > 0 ? Math.round((r.total_paid / r.quantity) * 10000) / 10000 : null,
          r.delivery_fees,
          r.shop,
          r.notes,
        ]
          .map(csvCell)
          .join(';'),
      ),
    ];
    // The byte order mark lets Excel read accents correctly.
    return c.body(`﻿${lines.join('\r\n')}\r\n`, 200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="purchases.csv"',
    });
  });

  // --- Documents: details in the database, files in uploadsDir under their id ---

  /** The Vehicle a Document's owner belongs to, checking the owner is in this Garage. */
  function ownerVehicle(ownerKind: string, ownerId: string): string {
    if (ownerKind === 'vehicle') return vehicleOrThrow(ownerId).id;
    const table = ownerKind === 'service' ? 'services' : ownerKind === 'purchase' ? 'purchases' : null;
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
        `INSERT INTO documents (id, garage_id, vehicle_id, owner_kind, owner_id, type, title, issue_date, expiry_date, file_name, content_type, size)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        garageId,
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
      return c.json(toDocument(documentOrThrow(id)), 201);
    },
  );

  app.put('/api/documents/:id', async (c) => {
    const id = c.req.param('id');
    documentOrThrow(id);
    const d = await parse(c, documentInput);
    db.prepare('UPDATE documents SET type = ?, title = ?, issue_date = ?, expiry_date = ? WHERE id = ?').run(
      d.type,
      d.title,
      d.issueDate,
      d.expiryDate,
      id,
    );
    return c.json(toDocument(documentOrThrow(id)));
  });

  app.get('/api/documents/:id/file', async (c) => {
    const row = documentOrThrow(c.req.param('id'));
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
    const row = documentOrThrow(c.req.param('id'));
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
    // A Task that always comes with another (the fork seals with the fork oil) counts that one as done too.
    for (const taskId of [...taskIds]) {
      const { template_code } = db.prepare('SELECT template_code FROM maintenance_tasks WHERE id = ?').get(taskId) as Row;
      const included = template_code === null ? null : catalogue.includedWith(template_code);
      if (included === null) continue;
      const other = db.prepare('SELECT id FROM maintenance_tasks WHERE vehicle_id = ? AND template_code = ?').get(s.vehicleId, included) as Row | undefined;
      if (other && !taskIds.includes(other.id)) taskIds.push(other.id);
    }
    const partsUsed = s.partsUsed;
    transaction(() => {
      db.prepare(
        `INSERT INTO services (id, vehicle_id, date, odometer, notes, performed_by, total_cost, kind, title, category)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET date = excluded.date, odometer = excluded.odometer, notes = excluded.notes,
           performed_by = excluded.performed_by, total_cost = excluded.total_cost, kind = excluded.kind, title = excluded.title,
           category = excluded.category`,
      ).run(s.id, s.vehicleId, s.date, s.odometer, s.notes, s.performedBy, s.totalCost, s.kind, s.kind === 'repair' ? s.title : null, s.kind === 'repair' ? s.category : null);
      db.prepare('DELETE FROM service_tasks WHERE service_id = ?').run(s.id);
      const link = db.prepare('INSERT INTO service_tasks (service_id, task_id) VALUES (?, ?)');
      for (const taskId of taskIds) link.run(s.id, taskId);
      db.prepare('DELETE FROM service_items WHERE service_id = ?').run(s.id);
      const part = db.prepare('INSERT INTO service_items (service_id, sort, description, part_number, quantity, unit, price, part_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      // A part to keep goes on the Vehicle's list (once, whatever the replays), tied to the Service's Task when it has just one.
      const keep = db.prepare('INSERT OR IGNORE INTO vehicle_parts (id, vehicle_id, name, part_number, unit, quantity, price, task_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      const listed = db.prepare('SELECT id FROM vehicle_parts WHERE id = ? AND vehicle_id = ?');
      const oneTask = new Set(s.taskIds).size === 1 ? s.taskIds[0]! : null;
      const linked = partsUsed.map((p) => {
        let partId = p.partId;
        if (p.remember && partId !== null) {
          const twin = samePart(s.vehicleId, p.description, p.partNumber, partId);
          if (twin) partId = twin.id;
          else keep.run(partId, s.vehicleId, p.description, p.partNumber, p.unit, p.quantity, p.price, oneTask);
        }
        // A link to a part that is gone, or on another Vehicle, is dropped: the Service keeps its copy.
        return { ...p, remember: false, partId: partId !== null && listed.get(partId, s.vehicleId) ? partId : null };
      });
      linked.forEach((p, i) => part.run(s.id, i, p.description, p.partNumber, p.quantity, p.unit, p.price, p.partId));
      // Using a part that was still to buy means it was bought: no Purchase is invented, so it shows "no purchase recorded".
      const bought = db.prepare('UPDATE vehicle_parts SET to_buy = 0 WHERE id = ? AND vehicle_id = ?');
      for (const p of linked) if (p.partId !== null) bought.run(p.partId, s.vehicleId);
      partsUsed.splice(0, partsUsed.length, ...linked);
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
