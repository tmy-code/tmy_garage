import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import type { DatabaseSync } from 'node:sqlite';
import type { FitmentPosition, MaintenanceTask, PartSpec, Snapshot, Vehicle, VehicleSpec } from '../shared/types.ts';
import { createApp } from './app.ts';
import { openDatabase } from './db.ts';

let db: DatabaseSync;
let app: Hono;

function call(method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function createVehicle(name = 'Test bike'): Promise<Vehicle> {
  const res = await call('POST', '/api/vehicles', { kind: 'motorcycle', name });
  expect(res.status).toBe(201);
  return res.json();
}

async function createTask(vehicleId: string, overrides: object = {}): Promise<MaintenanceTask> {
  const res = await call('POST', `/api/vehicles/${vehicleId}/tasks`, {
    name: 'Oil change',
    intervalKm: 6000,
    intervalMonths: 12,
    ...overrides,
  });
  expect(res.status).toBe(201);
  return res.json();
}

async function snapshot(): Promise<Snapshot> {
  return (await call('GET', '/api/snapshot')).json();
}

beforeEach(() => {
  db = openDatabase(':memory:');
  app = createApp(db);
});

afterEach(() => db.close());

describe('vehicles and tasks', () => {
  it('creates a vehicle with tasks and returns them in the snapshot', async () => {
    const bike = await createVehicle();
    await createTask(bike.id);
    const s = await snapshot();
    expect(s.vehicles).toHaveLength(1);
    expect(s.vehicles[0]).toMatchObject({ kind: 'motorcycle', name: 'Test bike', status: 'owned' });
    expect(s.tasks[0]).toMatchObject({ vehicleId: bike.id, intervalKm: 6000, intervalMonths: 12 });
  });

  it('rejects a task without any interval', async () => {
    const bike = await createVehicle();
    const res = await call('POST', `/api/vehicles/${bike.id}/tasks`, { name: 'Wash', intervalKm: null, intervalMonths: null });
    expect(res.status).toBe(422);
  });

  it('copies tasks between vehicles without their history', async () => {
    const a = await createVehicle('A');
    const b = await createVehicle('B');
    await createTask(a.id, { baselineDate: '2026-01-01', baselineOdometer: 1000 });
    await createTask(a.id, { name: 'Chain kit', intervalKm: 20000, intervalMonths: null });
    const res = await call('POST', `/api/vehicles/${b.id}/copy-tasks`, { fromVehicleId: a.id });
    expect(await res.json()).toEqual({ copied: 2 });
    const copies = (await snapshot()).tasks.filter((t) => t.vehicleId === b.id);
    expect(copies.map((t) => t.name)).toEqual(['Oil change', 'Chain kit']);
    expect(copies[0]).toMatchObject({ baselineDate: null, baselineOdometer: null });
  });

  it('stores, updates and copies the Official Interval', async () => {
    const a = await createVehicle('A');
    const b = await createVehicle('B');
    const task = await createTask(a.id, { intervalKm: 10000, intervalMonths: 12, officialIntervalKm: 30000, officialIntervalMonths: 24 });
    expect(task).toMatchObject({ officialIntervalKm: 30000, officialIntervalMonths: 24 });
    await call('PUT', `/api/tasks/${task.id}`, { name: 'Oil change', intervalKm: 10000, intervalMonths: 12, officialIntervalKm: 25000 });
    await call('POST', `/api/vehicles/${b.id}/copy-tasks`, { fromVehicleId: a.id });
    const tasks = (await snapshot()).tasks;
    expect(tasks.map((t) => [t.vehicleId, t.officialIntervalKm, t.officialIntervalMonths])).toEqual([
      [a.id, 25000, null],
      [b.id, 25000, null],
    ]);
  });

  it('marks a vehicle as sold and keeps its history', async () => {
    const bike = await createVehicle();
    const res = await call('POST', `/api/vehicles/${bike.id}/sell`, { date: '2028-05-01', odometer: 40000, price: 4500 });
    expect(await res.json()).toMatchObject({ status: 'sold', soldDate: '2028-05-01', soldOdometer: 40000, soldPrice: 4500 });
  });

  it('refuses to delete a task that appears in a Service', async () => {
    const bike = await createVehicle();
    const task = await createTask(bike.id);
    await call('PUT', '/api/services/svc-00001', {
      id: 'svc-00001',
      vehicleId: bike.id,
      date: '2026-10-01',
      odometer: 100,
      taskIds: [task.id],
    });
    expect((await call('DELETE', `/api/tasks/${task.id}`)).status).toBe(409);
  });
});

describe('services and readings (replayed by the offline send queue)', () => {
  it('is idempotent: replaying the same PUT stores one Service', async () => {
    const bike = await createVehicle();
    const task = await createTask(bike.id);
    const body = { id: 'svc-00001', vehicleId: bike.id, date: '2026-10-01', odometer: 18000, taskIds: [task.id], notes: 'Motul 7100' };
    expect((await call('PUT', '/api/services/svc-00001', body)).status).toBe(200);
    expect((await call('PUT', '/api/services/svc-00001', body)).status).toBe(200);
    const s = await snapshot();
    expect(s.services).toEqual([{ ...body, partsUsed: [] }]);
  });

  it('updates a Service and its tasks on a later PUT', async () => {
    const bike = await createVehicle();
    const oil = await createTask(bike.id);
    const chain = await createTask(bike.id, { name: 'Chain' });
    const body = { id: 'svc-00001', vehicleId: bike.id, date: '2026-10-01', odometer: 18000, taskIds: [oil.id] };
    await call('PUT', '/api/services/svc-00001', body);
    await call('PUT', '/api/services/svc-00001', { ...body, odometer: 18010, taskIds: [oil.id, chain.id] });
    const [service] = (await snapshot()).services;
    expect(service).toMatchObject({ odometer: 18010 });
    expect(service!.taskIds.sort()).toEqual([oil.id, chain.id].sort());
  });

  it('rejects a Service referencing a task of another vehicle', async () => {
    const a = await createVehicle('A');
    const b = await createVehicle('B');
    const task = await createTask(b.id);
    const res = await call('PUT', '/api/services/svc-00001', {
      id: 'svc-00001',
      vehicleId: a.id,
      date: '2026-10-01',
      odometer: 1,
      taskIds: [task.id],
    });
    expect(res.status).toBe(422);
  });

  it('rejects a Service with no tasks', async () => {
    const bike = await createVehicle();
    const res = await call('PUT', '/api/services/svc-00001', {
      id: 'svc-00001',
      vehicleId: bike.id,
      date: '2026-10-01',
      odometer: 1,
      taskIds: [],
    });
    expect(res.status).toBe(422);
  });

  it('stores Odometer Readings idempotently', async () => {
    const bike = await createVehicle();
    const body = { id: 'odo-00001', vehicleId: bike.id, date: '2026-10-20', odometer: 18500 };
    await call('PUT', '/api/odometer-readings/odo-00001', body);
    await call('PUT', '/api/odometer-readings/odo-00001', body);
    expect((await snapshot()).readings).toEqual([body]);
  });

  it('returns 404 for an unknown vehicle', async () => {
    const res = await call('PUT', '/api/odometer-readings/odo-00001', {
      id: 'odo-00001',
      vehicleId: 'nope',
      date: '2026-10-20',
      odometer: 1,
    });
    expect(res.status).toBe(404);
  });
});

describe('workshop data', () => {
  async function created<T>(path: string, body: object): Promise<T> {
    const res = await call('POST', path, body);
    expect(res.status).toBe(201);
    return res.json();
  }

  it('stores Vehicle Specs, Part Specs and positions, and lists them in the snapshot', async () => {
    const bike = await createVehicle();
    const torque = await created<VehicleSpec>(`/api/vehicles/${bike.id}/specs`, { kind: 'torque', name: 'Drain plug', value: '30 Nm' });
    await call('PUT', `/api/specs/${torque.id}`, { kind: 'torque', name: 'Drain plug', value: '30 Nm', notes: 'New washer' });
    await created(`/api/vehicles/${bike.id}/part-specs`, { name: 'Engine oil', characteristics: '10W-40 JASO MA2', unit: 'litre' });
    await created(`/api/vehicles/${bike.id}/positions`, { name: 'Rear tyre' });
    const s = await snapshot();
    expect(s.vehicleSpecs).toEqual([
      { id: torque.id, vehicleId: bike.id, kind: 'torque', name: 'Drain plug', value: '30 Nm', notes: 'New washer' },
    ]);
    expect(s.partSpecs[0]).toMatchObject({ name: 'Engine oil', characteristics: '10W-40 JASO MA2', partNumbers: null, unit: 'litre' });
    expect(s.positions[0]).toMatchObject({ name: 'Rear tyre' });
  });

  it('saves a Task’s workshop card as a whole', async () => {
    const bike = await createVehicle();
    const task = await createTask(bike.id);
    const oil = await created<PartSpec>(`/api/vehicles/${bike.id}/part-specs`, { name: 'Engine oil', unit: 'litre' });
    const filter = await created<PartSpec>(`/api/vehicles/${bike.id}/part-specs`, {
      name: 'Oil filter',
      partNumbers: 'HF204',
      unit: 'piece',
    });
    const plug = await created<VehicleSpec>(`/api/vehicles/${bike.id}/specs`, { kind: 'torque', name: 'Drain plug', value: '30 Nm' });
    const card = {
      workshopNotes: 'Warm the engine first.',
      requiredParts: [
        { partSpecId: oil.id, quantity: 3.2 },
        { partSpecId: filter.id, quantity: 1 },
      ],
      tools: ['17 mm socket', 'Torque wrench'],
      specIds: [plug.id],
    };
    expect((await call('PUT', `/api/tasks/${task.id}/workshop`, card)).status).toBe(200);
    expect((await snapshot()).tasks[0]).toMatchObject(card);

    await call('PUT', `/api/tasks/${task.id}/workshop`, {
      workshopNotes: null,
      requiredParts: [{ partSpecId: filter.id, quantity: 1 }],
      tools: [],
      specIds: [],
    });
    expect((await snapshot()).tasks[0]).toMatchObject({
      workshopNotes: null,
      requiredParts: [{ partSpecId: filter.id, quantity: 1 }],
      tools: [],
      specIds: [],
    });

    // Deleting a Part Spec removes it from the Tasks that required it.
    await call('DELETE', `/api/part-specs/${filter.id}`);
    expect((await snapshot()).tasks[0]!.requiredParts).toEqual([]);
  });

  it('refuses workshop links to another vehicle’s data', async () => {
    const a = await createVehicle('A');
    const b = await createVehicle('B');
    const task = await createTask(a.id);
    const other = await created<PartSpec>(`/api/vehicles/${b.id}/part-specs`, { name: 'Engine oil', unit: 'litre' });
    const res = await call('PUT', `/api/tasks/${task.id}/workshop`, {
      requiredParts: [{ partSpecId: other.id, quantity: 1 }],
      tools: [],
      specIds: [],
    });
    expect(res.status).toBe(422);
  });

  it('stores Parts Used with a Service, and keeps them when their Part Spec is deleted', async () => {
    const bike = await createVehicle();
    const task = await createTask(bike.id);
    const tyre = await created<PartSpec>(`/api/vehicles/${bike.id}/part-specs`, {
      name: 'Rear tyre',
      characteristics: '180/55 ZR17',
      unit: 'piece',
    });
    const rear = await created<FitmentPosition>(`/api/vehicles/${bike.id}/positions`, { name: 'Rear tyre' });
    const part = {
      partSpecId: tyre.id,
      positionId: rear.id,
      description: 'Michelin Road 6',
      partNumber: null,
      quantity: 1,
      unit: 'piece',
      price: 160,
      supplier: null,
    };
    const body = {
      id: 'svc-00001',
      vehicleId: bike.id,
      date: '2026-10-01',
      odometer: 18000,
      taskIds: [task.id],
      notes: null,
      partsUsed: [part],
    };
    await call('PUT', '/api/services/svc-00001', body);
    await call('PUT', '/api/services/svc-00001', body);
    expect((await snapshot()).services[0]!.partsUsed).toEqual([part]);

    expect((await call('DELETE', `/api/positions/${rear.id}`)).status).toBe(409);
    await call('DELETE', `/api/part-specs/${tyre.id}`);
    expect((await snapshot()).services[0]!.partsUsed).toEqual([{ ...part, partSpecId: null }]);
  });

  it('accepts a Service queued before Parts Used existed, and drops links to deleted data', async () => {
    const bike = await createVehicle();
    const task = await createTask(bike.id);
    const old = { id: 'svc-00001', vehicleId: bike.id, date: '2026-10-01', odometer: 1, taskIds: [task.id] };
    expect((await call('PUT', '/api/services/svc-00001', old)).status).toBe(200);
    const stale = { ...old, partsUsed: [{ partSpecId: 'gone', positionId: 'gone', description: 'Oil', quantity: 1, unit: 'litre' }] };
    expect((await call('PUT', '/api/services/svc-00001', stale)).status).toBe(200);
    expect((await snapshot()).services[0]!.partsUsed[0]).toMatchObject({ partSpecId: null, positionId: null, description: 'Oil' });
  });

  it('deletes a Task’s workshop data with the Task', async () => {
    const bike = await createVehicle();
    const task = await createTask(bike.id);
    await call('PUT', `/api/tasks/${task.id}/workshop`, { tools: ['Hex key'], requiredParts: [], specIds: [] });
    expect((await call('DELETE', `/api/tasks/${task.id}`)).status).toBe(204);
    expect(db.prepare('SELECT COUNT(*) AS n FROM required_tools').get()).toEqual({ n: 0 });
  });
});

describe('garage isolation', () => {
  it('never shows another Garage’s vehicles', async () => {
    db.prepare(`INSERT INTO garages (id, name) VALUES ('friend', 'Friend')`).run();
    const friendApp = createApp(db, 'friend');
    await createVehicle('Mine');
    const res = await friendApp.request('/api/snapshot');
    expect((await res.json()).vehicles).toEqual([]);
  });
});

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
    // Recreate a database as the first release left it: schema version 1, without the Official Interval or workshop data.
    const old = openDatabase(path);
    old.exec(`INSERT INTO vehicles (id, garage_id, kind, name) VALUES ('v1', 'default', 'car', 'Old car')`);
    old.exec(`INSERT INTO maintenance_tasks (id, vehicle_id, name, interval_km) VALUES ('t1', 'v1', 'Oil', 10000)`);
    old.exec('ALTER TABLE maintenance_tasks DROP COLUMN official_interval_km');
    old.exec('ALTER TABLE maintenance_tasks DROP COLUMN official_interval_months');
    old.exec('ALTER TABLE maintenance_tasks DROP COLUMN workshop_notes');
    for (const table of [
      'parts_used',
      'task_specs',
      'required_tools',
      'required_parts',
      'fitment_positions',
      'part_specs',
      'vehicle_specs',
    ]) {
      old.exec(`DROP TABLE ${table}`);
    }
    old.exec('PRAGMA user_version = 1');
    old.close();

    const migrated = openDatabase(path, join(dir, 'backups'));
    const backups = readdirSync(join(dir, 'backups'));
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/^garage-v1-.*\.sqlite$/);
    const task = migrated.prepare('SELECT * FROM maintenance_tasks').get() as Record<string, unknown>;
    expect(task).toMatchObject({ id: 't1', interval_km: 10000, official_interval_km: null });
    migrated.close();
  });
});
