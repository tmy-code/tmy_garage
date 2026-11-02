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
  documentInput,
  documentOwner,
  odometerReadingInput,
  ownPartInput,
  pushEndpointInput,
  pushSubscriptionInput,
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
  Service,
  Snapshot,
  Vehicle,
  SpecLine,
} from '../shared/types.ts';
import { BUILT_IN_CATALOGUE, Catalogue, tidyConditions, type Build, type Conditions } from '../shared/catalogue.ts';
import { buildOfRow, catalogueEntries } from './catalogue-rows.ts';
import type { VehicleInput, VehicleKind } from '../shared/schemas.ts';
import { todayIso } from '../shared/dates.ts';
import { DEFAULT_GARAGE_ID } from './db.ts';
import type { PushSender } from './push.ts';
import { sendReminders, testMessage } from './reminders.ts';

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
});

const toReading = (r: Row): OdometerReading => ({ id: r.id, vehicleId: r.vehicle_id, date: r.date, odometer: r.odometer });

const toSpecLine = (r: Row): SpecLine => ({
  id: r.id,
  vehicleId: r.vehicle_id,
  label: r.label,
  value: r.value,
  group: r.spec_group,
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
  /** Sends Reminders to subscribed devices; the Reminders API answers 503 when not set. */
  push?: PushSender;
}

const toPartUsed = (r: Row): PartUsed => ({
  description: r.description,
  partNumber: r.part_number,
  quantity: r.quantity,
  unit: r.unit,
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
      documents: (db.prepare("SELECT * FROM documents WHERE garage_id = ? AND owner_kind IN ('vehicle', 'service') ORDER BY created_at").all(garageId) as Row[]).map(toDocument),
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
export function createApp(db: DatabaseSync, garageId: string = DEFAULT_GARAGE_ID, { uploadsDir, push }: AppOptions = {}): Hono {
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
   * Gives a Vehicle the Tasks of the plan templates that fit its Build, at the template's interval. Tasks it already
   * has (by name) are left alone, so this can be run again after the Build changed. Only a new Vehicle gets this by
   * itself: after that the plan is the owner's.
   */
  function seedTasks(vehicleId: string, build: Build): number {
    const names = new Set((db.prepare('SELECT name, name_fr FROM maintenance_tasks WHERE vehicle_id = ?').all(vehicleId) as Row[]).flatMap((t) => [looseName(t.name), looseName(t.name_fr)]));
    const insert = db.prepare(
      'INSERT INTO maintenance_tasks (id, vehicle_id, name, name_fr, interval_km, interval_months, category, action) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    let added = 0;
    for (const s of catalogue.starterTasks(build)) {
      if (names.has(looseName(s.name)) || names.has(looseName(s.nameFr))) continue;
      insert.run(randomUUID(), vehicleId, s.name, s.nameFr, s.intervalKm, s.intervalMonths, s.category, s.action);
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
        `INSERT INTO vehicles (id, garage_id, kind, name, make, model, year, vin, ${BUILD_COLUMNS})
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        `UPDATE vehicles SET kind = ?, name = ?, make = ?, model = ?, year = ?, vin = ?,
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
    const names = new Set((db.prepare('SELECT name, name_fr FROM maintenance_tasks WHERE vehicle_id = ?').all(vehicleId) as Row[]).flatMap((t) => [looseName(t.name), looseName(t.name_fr)]));
    const insert = db.prepare(
      `INSERT INTO maintenance_tasks (id, vehicle_id, name, name_fr, action, interval_km, interval_months, category, notes, switched_off)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    // History is not copied: the copies start with no baseline, since they were never done on this Vehicle. A Task
    // this Vehicle already has by name keeps its own Interval.
    let copied = 0;
    transaction(() => {
      for (const t of source) {
        if (names.has(looseName(t.name))) continue;
        insert.run(randomUUID(), vehicleId, t.name, t.name_fr, t.action, t.interval_km, t.interval_months, t.category, t.notes, t.switched_off);
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
      transaction(() => {
        // A template set just as it is built in is no change at all.
        if (kept === null && !p.removed && sameInterval) {
          db.prepare('DELETE FROM catalogue_parts WHERE garage_id = ? AND code = ?').run(garageId, code);
        } else {
          db.prepare(
            `INSERT INTO catalogue_parts (garage_id, code, conditions, removed, interval_set, interval_km, interval_months)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (garage_id, code) DO UPDATE SET conditions = excluded.conditions,
               removed = excluded.removed, interval_set = excluded.interval_set, interval_km = excluded.interval_km,
               interval_months = excluded.interval_months`,
          ).run(garageId, code, kept, p.removed ? 1 : 0, sameInterval ? 0 : 1, sameInterval ? null : intervalKm, sameInterval ? null : intervalMonths);
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
    saveSpecLine(() => db.prepare('INSERT INTO spec_lines (id, vehicle_id, label, value, spec_group, sort) VALUES (?, ?, ?, ?, ?, ?)').run(id, vehicleId, s.label, s.value, s.group, next));
    return c.json(toSpecLine(ownedRowOrThrow('spec_lines', id, 'Spec line')), 201);
  });

  app.put('/api/specs/:id', async (c) => {
    const id = c.req.param('id');
    const row = ownedRowOrThrow('spec_lines', id, 'Spec line');
    const s = await parse(c, specLineInput);
    saveSpecLine(() => {
      if (s.group === row.spec_group) db.prepare('UPDATE spec_lines SET label = ?, value = ? WHERE id = ?').run(s.label, s.value, id);
      else {
        const next = (db.prepare('SELECT coalesce(max(sort), -1) + 1 AS n FROM spec_lines WHERE vehicle_id = ? AND spec_group = ?').get(row.vehicle_id, s.group) as Row).n;
        db.prepare('UPDATE spec_lines SET label = ?, value = ?, spec_group = ?, sort = ? WHERE id = ?').run(s.label, s.value, s.group, next, id);
      }
    });
    return c.json(toSpecLine(ownedRowOrThrow('spec_lines', id, 'Spec line')));
  });

  app.delete('/api/specs/:id', (c) => {
    const id = c.req.param('id');
    ownedRowOrThrow('spec_lines', id, 'Spec line');
    db.prepare('DELETE FROM spec_lines WHERE id = ?').run(id);
    return c.body(null, 204);
  });

  // --- Documents: details in the database, files in uploadsDir under their id ---

  /** The Vehicle a Document's owner belongs to, checking the owner is in this Garage. */
  function ownerVehicle(ownerKind: string, ownerId: string): string {
    if (ownerKind === 'vehicle') return vehicleOrThrow(ownerId).id;
    const row = ownerKind === 'service' ? ownedRows('services', 'x.id = ?', ownerId)[0] : undefined;
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
    const partsUsed = s.partsUsed;
    transaction(() => {
      db.prepare(
        `INSERT INTO services (id, vehicle_id, date, odometer, notes, performed_by, total_cost) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET date = excluded.date, odometer = excluded.odometer, notes = excluded.notes,
           performed_by = excluded.performed_by, total_cost = excluded.total_cost`,
      ).run(s.id, s.vehicleId, s.date, s.odometer, s.notes, s.performedBy, s.totalCost);
      db.prepare('DELETE FROM service_tasks WHERE service_id = ?').run(s.id);
      const link = db.prepare('INSERT INTO service_tasks (service_id, task_id) VALUES (?, ?)');
      for (const taskId of taskIds) link.run(s.id, taskId);
      db.prepare('DELETE FROM service_items WHERE service_id = ?').run(s.id);
      const part = db.prepare('INSERT INTO service_items (service_id, sort, description, part_number, quantity, unit) VALUES (?, ?, ?, ?, ?, ?)');
      partsUsed.forEach((p, i) => part.run(s.id, i, p.description, p.partNumber, p.quantity, p.unit));
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

  // --- Reminders (push notifications) ---

  function pushOrThrow(): PushSender {
    if (!push) throw new HttpError(503, 'Reminders are not set up on this server');
    return push;
  }

  app.get('/api/push', (c) => c.json({ publicKey: pushOrThrow().publicKey }));

  app.put('/api/push/subscription', async (c) => {
    const sender = pushOrThrow();
    const s = await parse(c, pushSubscriptionInput);
    const known = db.prepare('SELECT 1 FROM push_subscriptions WHERE endpoint = ? AND garage_id = ?').get(s.endpoint, garageId);
    db.prepare(
      `INSERT INTO push_subscriptions (endpoint, garage_id, p256dh, auth, lang) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (endpoint) DO UPDATE SET garage_id = excluded.garage_id, p256dh = excluded.p256dh, auth = excluded.auth, lang = excluded.lang`,
    ).run(s.endpoint, garageId, s.keys.p256dh, s.keys.auth, s.lang);
    if (!known) {
      // A new device hears straight away about what is already due, or gets a confirmation when nothing is.
      const device = { endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth };
      void sendReminders(db, sender, garageId, snapshot(), todayIso())
        .then((delivered) => (delivered === 0 ? sender.send(device, testMessage(s.lang)) : undefined))
        .catch((error) => console.error('Push notification failed', error));
    }
    return c.body(null, 204);
  });

  app.post('/api/push/unsubscribe', async (c) => {
    const { endpoint } = await parse(c, pushEndpointInput);
    db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND garage_id = ?').run(endpoint, garageId);
    return c.body(null, 204);
  });

  app.post('/api/push/test', async (c) => {
    const sender = pushOrThrow();
    const { endpoint } = await parse(c, pushEndpointInput);
    const device = db.prepare('SELECT * FROM push_subscriptions WHERE endpoint = ? AND garage_id = ?').get(endpoint, garageId) as
      Row | undefined;
    if (!device) throw new HttpError(404, 'This device is not subscribed');
    const result = await sender.send({ endpoint, p256dh: device.p256dh, auth: device.auth }, testMessage(device.lang)).catch(() => {
      throw new HttpError(503, 'The push service could not be reached');
    });
    if (result === 'gone') {
      db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
      throw new HttpError(404, 'This device is not subscribed');
    }
    return c.body(null, 204);
  });

  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

  return app;
}
