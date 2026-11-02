import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import type { DatabaseSync } from 'node:sqlite';
import type {
  GarageDocument,
  MaintenanceTask,
  Snapshot,
  SpecLine,
  VehiclePart,
  Vehicle,
} from '../shared/types.ts';
import { BUILT_IN_CATALOGUE, type Build } from '../shared/catalogue.ts';
import { vehicleDue } from '../shared/due.ts';
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

/** What a test motorcycle and car are built with; tests override what they look at. */
const BIKE = { kind: 'motorcycle', make: 'Exemple', model: 'Test', fuel: 'petrol', transmission: 'manual', cooling: 'liquid', finalDrive: 'chain', cylinders: 2 };
const CAR = { kind: 'car', make: 'Exemple', model: 'Test', fuel: 'petrol', transmission: 'manual', drivetrain: 'fwd', distribution: 'chain' };

/** A motorcycle without the Maintenance Tasks a new vehicle starts with, so tests see only the Tasks they add. */
async function createVehicle(name = 'Test bike'): Promise<Vehicle> {
  const res = await call('POST', '/api/vehicles', { ...BIKE, name });
  expect(res.status).toBe(201);
  const vehicle = (await res.json()) as Vehicle;
  db.prepare('DELETE FROM maintenance_tasks WHERE vehicle_id = ?').run(vehicle.id);
  return vehicle;
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

  it('flags template tasks in the snapshot and leaves hand-added ones empty', async () => {
    const car = await createVehicle('Flagged');
    await call('POST', `/api/vehicles/${car.id}/add-from-templates`);
    const hand = await createTask(car.id, { name: 'Wash by hand' });
    const tasks = (await snapshot()).tasks.filter((t) => t.vehicleId === car.id);
    expect(tasks.find((t) => t.id === hand.id)!.templateCode).toBeNull();
    expect(tasks.some((t) => t.templateCode)).toBe(true);
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

  it('stores, updates and copies a Task’s action, and defaults to replace', async () => {
    const a = await createVehicle('A');
    const b = await createVehicle('B');
    const task = await createTask(a.id, { intervalKm: 10000, intervalMonths: 12 });
    expect(task.action).toBe('replace');
    await call('PUT', `/api/tasks/${task.id}`, { name: 'Check tyre pressure', intervalMonths: 1, action: 'inspect' });
    await call('POST', `/api/vehicles/${b.id}/copy-tasks`, { fromVehicleId: a.id });
    expect((await snapshot()).tasks.map((t) => [t.vehicleId, t.action])).toEqual([
      [a.id, 'inspect'],
      [b.id, 'inspect'],
    ]);
    expect((await call('PUT', `/api/tasks/${task.id}`, { name: 'x', intervalMonths: 1, action: 'burn' })).status).toBe(422);
  });

  it('logs a repair outside the plan: a title and a category instead of Tasks, which stay optional', async () => {
    const bike = await createVehicle();
    const repair = { id: 'svc-00007', vehicleId: bike.id, date: '2026-10-01', kind: 'repair', title: 'New starter motor', category: 'electrical', totalCost: 180, performedBy: 'garage' };
    expect((await call('PUT', '/api/services/svc-00007', { ...repair, title: '' })).status).toBe(422);
    expect((await call('PUT', '/api/services/svc-00007', repair)).status).toBe(200);
    expect((await snapshot()).services[0]).toMatchObject({ kind: 'repair', title: 'New starter motor', category: 'electrical', taskIds: [], totalCost: 180 });
    // Maintenance still needs a Task, and drops a title it was sent.
    expect((await call('PUT', '/api/services/svc-00008', { id: 'svc-00008', vehicleId: bike.id, date: '2026-10-02', taskIds: [] })).status).toBe(422);
    const task = await createTask(bike.id);
    await call('PUT', '/api/services/svc-00009', { id: 'svc-00009', vehicleId: bike.id, date: '2026-10-03', odometer: 100, taskIds: [task.id], title: 'ignored' });
    expect((await snapshot()).services.find((x) => x.id === 'svc-00009')).toMatchObject({ kind: 'maintenance', title: null });
  });

  it('stores who did a Service and what it cost, and defaults to DIY with no cost', async () => {
    const bike = await createVehicle();
    const task = await createTask(bike.id);
    const body = { id: 'svc-00001', vehicleId: bike.id, date: '2026-10-01', odometer: 18000, taskIds: [task.id] };
    await call('PUT', '/api/services/svc-00001', body);
    expect((await snapshot()).services[0]).toMatchObject({ kind: 'maintenance', title: null, category: null, performedBy: 'diy', totalCost: null });
    await call('PUT', '/api/services/svc-00001', { ...body, performedBy: 'dealership', totalCost: 249.9 });
    expect((await snapshot()).services[0]).toMatchObject({ performedBy: 'dealership', totalCost: 249.9 });
    expect((await call('PUT', '/api/services/svc-00001', { ...body, performedBy: 'neighbour' })).status).toBe(422);
    expect((await call('PUT', '/api/services/svc-00001', { ...body, totalCost: -1 })).status).toBe(422);
  });

  it('stores the category picked for a Task, whether or not it replaces a part, and copies it', async () => {
    const a = await createVehicle('A');
    const b = await createVehicle('B');
    const lube = await createTask(a.id, { name: 'Chain lube', category: 'transmission' });
    expect(lube.category).toBe('transmission');
    expect((await call('POST', `/api/vehicles/${a.id}/tasks`, { name: 'X', intervalKm: 1000, category: 'garden' })).status).toBe(422);
    // The old categories are no longer accepted.
    expect((await call('POST', `/api/vehicles/${a.id}/tasks`, { name: 'X', intervalKm: 1000, category: 'drivetrain' })).status).toBe(422);
    await call('POST', `/api/vehicles/${b.id}/copy-tasks`, { fromVehicleId: a.id });
    expect((await snapshot()).tasks.find((t) => t.vehicleId === b.id)!.category).toBe('transmission');
    await call('PUT', `/api/tasks/${lube.id}`, { name: 'Chain lube', intervalKm: 1000, category: null });
    expect((await snapshot()).tasks.find((t) => t.id === lube.id)).toMatchObject({ category: null });
  });

  it('stores, updates and copies a Task’s French name', async () => {
    const a = await createVehicle('A');
    const b = await createVehicle('B');
    const task = await createTask(a.id);
    expect(task.nameFr).toBeNull();
    await call('PUT', `/api/tasks/${task.id}`, { name: 'Oil change', nameFr: ' Vidange ', intervalMonths: 12 });
    await call('POST', `/api/vehicles/${b.id}/copy-tasks`, { fromVehicleId: a.id });
    expect((await snapshot()).tasks.map((t) => t.nameFr)).toEqual(['Vidange', 'Vidange']);
  });

  it('marks a vehicle as sold and keeps its history', async () => {
    const bike = await createVehicle();
    const res = await call('POST', `/api/vehicles/${bike.id}/sell`, { date: '2028-05-01', odometer: 40000, price: 4500 });
    expect(await res.json()).toMatchObject({ status: 'sold', soldDate: '2028-05-01', soldOdometer: 40000, soldPrice: 4500 });
  });

  it('shows a vehicle on the garage page until sold, unless the user chooses otherwise', async () => {
    const bike = await createVehicle();
    expect(bike.onGaragePage).toBe(true);
    const sold = (await (await call('POST', `/api/vehicles/${bike.id}/sell`, { date: '2028-05-01' })).json()) as Vehicle;
    expect(sold.onGaragePage).toBe(false);
    const shown = await call('PUT', `/api/vehicles/${bike.id}/garage-page`, { shown: true });
    expect(await shown.json()).toMatchObject({ status: 'sold', onGaragePage: true });
    // Editing the vehicle's details keeps the choice.
    await call('PUT', `/api/vehicles/${bike.id}`, { ...BIKE, name: 'Renamed' });
    expect((await snapshot()).vehicles[0]).toMatchObject({ name: 'Renamed', onGaragePage: true });
    await call('PUT', `/api/vehicles/${bike.id}/garage-page`, { shown: false });
    const back = (await (await call('POST', `/api/vehicles/${bike.id}/unsell`)).json()) as Vehicle;
    expect(back).toMatchObject({ status: 'owned', onGaragePage: true });
    expect((await call('PUT', '/api/vehicles/nope/garage-page', { shown: true })).status).toBe(404);
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

  it('merges a duplicate Task into the one to keep, moving its Services over', async () => {
    const bike = await createVehicle();
    const other = await createVehicle('Other');
    const kept = await createTask(bike.id, { name: 'Engine oil', baselineDate: '2025-12-26', baselineOdometer: 45600 });
    const duplicate = await createTask(bike.id, { name: 'Change engine oil and filter', baselineDate: '2026-03-01', baselineOdometer: 47000, notes: 'Use 5W-30' });
    const foreign = await createTask(other.id);
    await call('PUT', '/api/services/svc-00001', { id: 'svc-00001', vehicleId: bike.id, date: '2026-03-01', odometer: 47000, taskIds: [duplicate.id] });
    await call('PUT', '/api/services/svc-00002', { id: 'svc-00002', vehicleId: bike.id, date: '2026-04-01', odometer: 48000, taskIds: [kept.id, duplicate.id] });

    expect((await call('POST', `/api/tasks/${duplicate.id}/merge`, { intoTaskId: duplicate.id })).status).toBe(422);
    expect((await call('POST', `/api/tasks/${duplicate.id}/merge`, { intoTaskId: foreign.id })).status).toBe(422);
    const res = await call('POST', `/api/tasks/${duplicate.id}/merge`, { intoTaskId: kept.id });
    expect(res.status).toBe(200);

    const { tasks, services } = await snapshot();
    expect(tasks.find((t) => t.id === duplicate.id)).toBeUndefined();
    expect(tasks.find((t) => t.id === kept.id)).toMatchObject({ name: 'Engine oil', baselineDate: '2026-03-01', baselineOdometer: 47000, notes: 'Use 5W-30' });
    expect(services.map((s) => s.taskIds)).toEqual([[kept.id], [kept.id]]);
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
    expect(s.services).toEqual([{ ...body, kind: 'maintenance', title: null, category: null, performedBy: 'diy', totalCost: null, partsUsed: [] }]);
  });

  it('stores a Service without an odometer value, for time-based tasks', async () => {
    const bike = await createVehicle();
    const coolant = await createTask(bike.id, { name: 'Coolant', intervalKm: null, intervalMonths: 36 });
    const body = { id: 'svc-00002', vehicleId: bike.id, date: '2026-07-14', taskIds: [coolant.id], notes: null };
    expect((await call('PUT', '/api/services/svc-00002', body)).status).toBe(200);
    expect((await snapshot()).services).toEqual([{ ...body, odometer: null, kind: 'maintenance', title: null, category: null, performedBy: 'diy', totalCost: null, partsUsed: [] }]);
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

describe('spec lines and the plan templates', () => {
  it('keeps a Vehicle’s spec lines by group, one label once, and lists them in the snapshot', async () => {
    const bike = await createVehicle();
    const line = (await (await call('POST', `/api/vehicles/${bike.id}/specs`, { label: 'Engine oil', value: '10W-40, 3.2 L', group: 'fluids' })).json()) as SpecLine;
    expect(line).toMatchObject({ label: 'Engine oil', group: 'fluids', sort: 0 });
    expect((await call('POST', `/api/vehicles/${bike.id}/specs`, { label: 'Engine oil', value: 'x', group: 'fluids' })).status).toBe(409);
    expect((await call('POST', `/api/vehicles/${bike.id}/specs`, { label: 'Tyre', value: 'x', group: 'wheels' })).status).toBe(422);
    await call('PUT', `/api/specs/${line.id}`, { label: 'Engine oil', value: '10W-40, 3.0 L', group: 'torque' });
    expect((await snapshot()).specLines).toEqual([{ ...line, value: '10W-40, 3.0 L', group: 'torque', sort: 0 }]);
    expect((await call('DELETE', `/api/specs/${line.id}`)).status).toBe(204);
    expect((await snapshot()).specLines).toEqual([]);
  });

  it('adds the usual spec lines for the Build with empty values, once, whatever they were renamed to', async () => {
    const bike = await createVehicle();
    const hand = (await (await call('POST', `/api/vehicles/${bike.id}/specs`, { label: 'huile moteur', value: '10W-40', group: 'fluids' })).json()) as SpecLine;
    expect(await (await call('POST', `/api/vehicles/${bike.id}/add-standard-specs`, { lang: 'fr' })).json()).toMatchObject({ added: expect.any(Number) });
    const lines = (await snapshot()).specLines.filter((l) => l.vehicleId === bike.id);
    const labels = lines.map((l) => l.label);
    expect(labels).toContain('Liquide de frein');
    expect(labels).toContain('Chaîne');
    expect(labels).not.toContain('Courroie de transmission finale');
    expect(labels.filter((l) => l.toLowerCase() === 'huile moteur')).toHaveLength(1);
    expect(lines.find((l) => l.id === hand.id)!.value).toBe('10W-40');
    expect(lines.find((l) => l.label === 'Liquide de frein')).toMatchObject({ value: '', group: 'fluids', category: 'brakes' });
    const renamed = lines.find((l) => l.label === 'Liquide de frein')!;
    await call('PUT', `/api/specs/${renamed.id}`, { label: 'DOT 4', value: 'DOT 4', group: 'fluids', category: 'brakes' });
    expect(await (await call('POST', `/api/vehicles/${bike.id}/add-standard-specs`, { lang: 'fr' })).json()).toEqual({ added: 0 });
    expect((await snapshot()).specLines.filter((l) => l.vehicleId === bike.id)).toHaveLength(lines.length);
  });

  it('chooses the usual spec lines by the Build', async () => {
    const car = (await (await call('POST', '/api/vehicles', { ...CAR, name: 'Diesel', fuel: 'diesel', distribution: 'belt', hasAc: true })).json()) as Vehicle;
    await call('POST', `/api/vehicles/${car.id}/add-standard-specs`, { lang: 'en' });
    const labels = (await snapshot()).specLines.filter((l) => l.vehicleId === car.id).map((l) => l.label);
    expect(labels).toEqual(expect.arrayContaining(['Fuel filter', 'Timing belt kit', 'A/C refrigerant', 'Gearbox oil', 'Wheel nuts']));
    expect(labels).not.toContain('Spark plugs');
    expect(labels).not.toContain('Reduction gear oil');
  });

  it('files a spec line under a category, empty meaning other, and refuses an unknown one', async () => {
    const bike = await createVehicle();
    const line = (await (await call('POST', `/api/vehicles/${bike.id}/specs`, { label: 'Spark plug', value: 'NGK CR8E', group: 'parts', category: 'engine' })).json()) as SpecLine;
    expect(line.category).toBe('engine');
    await call('PUT', `/api/specs/${line.id}`, { label: 'Spark plug', value: 'NGK CR8E', group: 'parts' });
    expect((await snapshot()).specLines[0]!.category).toBeNull();
    expect((await call('POST', `/api/vehicles/${bike.id}/specs`, { label: 'X', value: 'x', group: 'parts', category: 'garden' })).status).toBe(422);
  });

  it('gives a new vehicle the templates of its build, each with an action and category, then leaves its plan alone', async () => {
    const res = await call('POST', '/api/vehicles', { ...BIKE, name: 'Fresh' });
    const bike = (await res.json()) as Vehicle;
    const tasks = (await snapshot()).tasks.filter((t) => t.vehicleId === bike.id);
    expect(tasks.find((t) => t.name === 'Change engine oil and filter')).toMatchObject({ action: 'replace', category: 'engine', intervalKm: 8000 });
    expect(tasks.find((t) => t.name === 'Replace chain')).toBeDefined();
    expect(tasks.find((t) => t.name === 'Replace final drive belt')).toBeUndefined();
    // Editing the vehicle's build does not touch its plan.
    await call('PUT', `/api/vehicles/${bike.id}`, { ...BIKE, name: 'Fresh', finalDrive: 'belt' });
    expect((await snapshot()).tasks.filter((t) => t.vehicleId === bike.id)).toHaveLength(tasks.length);
    // Unless the owner asks for the templates again: only what is missing comes.
    const again = (await (await call('POST', `/api/vehicles/${bike.id}/add-from-templates`)).json()) as { added: number };
    expect(again.added).toBe(1);
    expect((await snapshot()).tasks.find((t) => t.vehicleId === bike.id && t.name === 'Replace final drive belt')).toBeDefined();
    expect(((await (await call('POST', `/api/vehicles/${bike.id}/add-from-templates`)).json()) as { added: number }).added).toBe(0);
  });

  it('does not add a template’s Task when the Vehicle has one named like the template’s part', async () => {
    const bike = (await (await call('POST', '/api/vehicles', { ...BIKE, name: 'Fresh' })).json()) as Vehicle;
    const oil = (await snapshot()).tasks.find((t) => t.vehicleId === bike.id && t.name === 'Change engine oil and filter')!;
    await call('DELETE', `/api/tasks/${oil.id}`);
    await call('POST', `/api/vehicles/${bike.id}/tasks`, { name: 'Engine Oil', intervalKm: 10000, intervalMonths: 12 });
    await call('POST', `/api/vehicles/${bike.id}/add-from-templates`);
    const names = (await snapshot()).tasks.filter((t) => t.vehicleId === bike.id).map((t) => t.name);
    expect(names).toContain('Engine Oil');
    expect(names).not.toContain('Change engine oil and filter');
  });

  it('never doubles a template’s Task, even once the owner renamed it', async () => {
    const bike = (await (await call('POST', '/api/vehicles', { ...BIKE, name: 'Fresh' })).json()) as Vehicle;
    const before = (await snapshot()).tasks.filter((t) => t.vehicleId === bike.id);
    const oil = before.find((t) => t.name === 'Change engine oil and filter')!;
    await call('PUT', `/api/tasks/${oil.id}`, { name: 'Vidange maison', intervalKm: 8000, intervalMonths: 12 });
    await call('POST', `/api/vehicles/${bike.id}/add-from-templates`);
    await call('POST', `/api/vehicles/${bike.id}/add-from-templates`);
    expect((await snapshot()).tasks.filter((t) => t.vehicleId === bike.id)).toHaveLength(before.length);
  });

  it('counts the fork oil as changed whenever the fork seals are, but not the other way round', async () => {
    const bike = (await (await call('POST', '/api/vehicles', { ...BIKE, name: 'Fresh' })).json()) as Vehicle;
    const tasks = (await snapshot()).tasks.filter((t) => t.vehicleId === bike.id);
    const oil = tasks.find((t) => t.name === 'Change fork oil')!;
    const seals = tasks.find((t) => t.name === 'Replace fork seals')!;
    expect(oil && seals).toBeTruthy();
    const log = (id: string, taskIds: string[]) => call('PUT', `/api/services/${id}`, { id, vehicleId: bike.id, date: '2026-10-01', odometer: 100, taskIds });
    await log('svc-00001', [oil.id]);
    await log('svc-00002', [seals.id]);
    expect((await snapshot()).services.map((s) => s.taskIds)).toEqual([[oil.id], [seals.id, oil.id]]);
  });

  it('changes a template without touching vehicles that exist, and the next vehicle gets the change', async () => {
    const before = (await (await call('POST', '/api/vehicles', { ...BIKE, name: 'Before' })).json()) as Vehicle;
    expect((await call('PUT', '/api/catalogue/moto_engine_oil', { conditions: {}, intervalKm: 5000, intervalMonths: 6 })).status).toBe(200);
    const after = (await (await call('POST', '/api/vehicles', { ...BIKE, name: 'After' })).json()) as Vehicle;
    const s = await snapshot();
    const oil = (v: Vehicle) => s.tasks.find((t) => t.vehicleId === v.id && t.name === 'Change engine oil and filter');
    expect(oil(before)).toMatchObject({ intervalKm: 8000, intervalMonths: 12 });
    expect(oil(after)).toMatchObject({ intervalKm: 5000, intervalMonths: 6 });
    expect((await call('DELETE', '/api/catalogue/moto_engine_oil')).status).toBe(204);
  });

  it('lets the owner rename a built-in template and change its category and action, for the vehicles added next', async () => {
    const put = (body: object) => call('PUT', '/api/catalogue/moto_chain', { conditions: { finalDrive: ['chain'] }, ...body });
    expect((await put({ name: 'Inspect the chain and sprockets', category: 'chassis', action: 'inspect' })).status).toBe(200);
    const bike = (await (await call('POST', '/api/vehicles', { ...BIKE, name: 'Next' })).json()) as Vehicle;
    expect((await snapshot()).tasks.find((t) => t.vehicleId === bike.id && t.name === 'Inspect the chain and sprockets')).toMatchObject({ category: 'chassis', action: 'inspect', intervalKm: 25000 });
    // Set back as built in, it is no change at all.
    expect((await put({ name: 'Replace chain', category: 'transmission', action: 'replace' })).status).toBe(200);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM catalogue_parts WHERE code = 'moto_chain'`).get()).toEqual({ n: 0 });
    const again = (await (await call('POST', '/api/vehicles', { ...BIKE, name: 'Again' })).json()) as Vehicle;
    expect((await snapshot()).tasks.find((t) => t.vehicleId === again.id && t.name === 'Replace chain')).toMatchObject({ category: 'transmission', action: 'replace' });
  });

  it('adds a template of the owner’s with an action, used by the next matching vehicle', async () => {
    const res = await call('POST', '/api/catalogue', {
      kind: 'motorcycle',
      name: 'Check the steering bearings',
      category: 'chassis',
      action: 'inspect',
      intervalKm: 20000,
      conditions: {},
    });
    expect(res.status).toBe(201);
    const bike = (await (await call('POST', '/api/vehicles', { ...BIKE, name: 'Next' })).json()) as Vehicle;
    expect((await snapshot()).tasks.find((t) => t.vehicleId === bike.id && t.name === 'Check the steering bearings')).toMatchObject({
      action: 'inspect',
      category: 'chassis',
      intervalKm: 20000,
    });
  });

  it('stores the components of a Service with the price paid, ignoring a link to a part that is gone', async () => {
    const bike = await createVehicle();
    const task = await createTask(bike.id);
    const res = await call('PUT', '/api/services/svc-00009', {
      id: 'svc-00009',
      vehicleId: bike.id,
      date: '2026-10-01',
      odometer: 18000,
      taskIds: [task.id],
      partsUsed: [{ partSpecId: 'gone', partId: 'gone-part-id', description: 'Motul 7100 10W-40', quantity: 3, unit: 'litre', price: 40, supplier: 'Shop' }],
    });
    expect(res.status).toBe(200);
    expect((await snapshot()).services[0]!.partsUsed).toEqual([{ description: 'Motul 7100 10W-40', partNumber: null, quantity: 3, unit: 'litre', price: 40, partId: null }]);
  });

  it('keeps a Vehicle’s parts list: add, edit, refuse a twin, delete', async () => {
    const bike = await createVehicle();
    const task = await createTask(bike.id);
    const part = (await (await call('POST', `/api/vehicles/${bike.id}/parts`, { name: 'Motul 7100 10W-40', unit: 'litre', quantity: 3.2, price: 12.5, taskId: task.id })).json()) as VehiclePart;
    expect(part).toMatchObject({ name: 'Motul 7100 10W-40', unit: 'litre', quantity: 3.2, price: 12.5, taskId: task.id, partNumber: null });
    expect((await call('POST', `/api/vehicles/${bike.id}/parts`, { name: 'motul 7100 10w-40', unit: 'litre', quantity: 1 })).status).toBe(409);
    expect((await call('POST', `/api/vehicles/${bike.id}/parts`, { name: 'x', unit: 'litre', quantity: 1, taskId: 'nope' })).status).toBe(422);
    await call('PUT', `/api/parts/${part.id}`, { name: 'Motul 7100 10W-40', partNumber: 'REF-1', unit: 'litre', quantity: 3.5, price: null });
    expect((await snapshot()).vehicleParts).toEqual([{ ...part, partNumber: 'REF-1', quantity: 3.5, price: null, taskId: null }]);
    expect((await call('DELETE', `/api/parts/${part.id}`)).status).toBe(204);
    expect((await snapshot()).vehicleParts).toEqual([]);
  });

  it('puts a part to remember on the list once, ties it to a single Task, and keeps old Services when it is deleted', async () => {
    const bike = await createVehicle();
    const task = await createTask(bike.id);
    const body = {
      id: 'svc-00010',
      vehicleId: bike.id,
      date: '2026-10-01',
      odometer: 18000,
      taskIds: [task.id],
      partsUsed: [{ description: 'Mann HU 7008 z', partNumber: 'HU 7008 z', quantity: 1, unit: 'piece', price: 9.9, partId: 'part-0000001', remember: true }],
    };
    expect((await call('PUT', '/api/services/svc-00010', body)).status).toBe(200);
    expect((await call('PUT', '/api/services/svc-00010', body)).status).toBe(200);
    const parts = (await snapshot()).vehicleParts;
    expect(parts).toEqual([{ id: 'part-0000001', vehicleId: bike.id, name: 'Mann HU 7008 z', partNumber: 'HU 7008 z', unit: 'piece', quantity: 1, price: 9.9, taskId: task.id }]);
    expect((await snapshot()).services[0]!.partsUsed[0]).toMatchObject({ partId: 'part-0000001', price: 9.9 });
    // The same part typed again in another Service links to the list instead of doubling it.
    await call('PUT', '/api/services/svc-00011', { ...body, id: 'svc-00011', partsUsed: [{ ...body.partsUsed[0], partId: 'part-0000002' }] });
    expect((await snapshot()).vehicleParts).toHaveLength(1);
    expect((await snapshot()).services.find((x) => x.id === 'svc-00011')!.partsUsed[0]!.partId).toBe('part-0000001');
    await call('DELETE', '/api/parts/part-0000001');
    const kept = (await snapshot()).services.find((x) => x.id === 'svc-00010')!.partsUsed[0]!;
    expect(kept).toMatchObject({ description: 'Mann HU 7008 z', partId: null, price: 9.9 });
  });
});

describe('documents', () => {
  let uploads: string;
  beforeEach(() => {
    uploads = mkdtempSync(join(tmpdir(), 'garage-uploads-'));
    app = createApp(db, undefined, { uploadsDir: uploads });
  });
  afterEach(() => rmSync(uploads, { recursive: true, force: true }));

  function upload(fields: Record<string, string>, file = new File(['%PDF-1.4 test'], 'carte grise.pdf', { type: 'application/pdf' })) {
    const form = new FormData();
    form.set('file', file);
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    return app.request('/api/documents', { method: 'POST', body: form });
  }

  it('stores a file with its details, serves it back, and deletes both', async () => {
    const car = await createVehicle('Car');
    const res = await upload({ ownerKind: 'vehicle', ownerId: car.id, type: 'registration', expiryDate: '2027-01-31' });
    expect(res.status).toBe(201);
    const doc = (await res.json()) as GarageDocument;
    expect(doc).toMatchObject({
      vehicleId: car.id,
      type: 'registration',
      fileName: 'carte grise.pdf',
      contentType: 'application/pdf',
      expiryDate: '2027-01-31',
    });
    expect((await snapshot()).documents).toEqual([doc]);

    const file = await app.request(`/api/documents/${doc.id}/file`);
    expect(file.headers.get('content-type')).toBe('application/pdf');
    expect(await file.text()).toBe('%PDF-1.4 test');

    await call('PUT', `/api/documents/${doc.id}`, { type: 'registration', title: 'Carte grise', expiryDate: null });
    expect((await snapshot()).documents[0]).toMatchObject({ title: 'Carte grise', expiryDate: null });

    expect((await call('DELETE', `/api/documents/${doc.id}`)).status).toBe(204);
    expect(readdirSync(uploads)).toEqual([]);
  });

  it('refuses files that are not PDFs or photos', async () => {
    const car = await createVehicle('Car');
    const res = await upload(
      { ownerKind: 'vehicle', ownerId: car.id, type: 'other' },
      new File(['x'], 'run.exe', { type: 'application/x-msdownload' }),
    );
    expect(res.status).toBe(415);
  });

  it('attaches to a Service and is deleted with it', async () => {
    const bike = await createVehicle();
    const task = await createTask(bike.id);
    await call('PUT', '/api/services/svc-00001', {
      id: 'svc-00001',
      vehicleId: bike.id,
      date: '2026-10-01',
      odometer: 1,
      taskIds: [task.id],
    });
    const doc = (await (await upload({ ownerKind: 'service', ownerId: 'svc-00001', type: 'invoice' })).json()) as GarageDocument;
    expect(doc.vehicleId).toBe(bike.id);
    await call('DELETE', '/api/services/svc-00001');
    expect((await snapshot()).documents).toEqual([]);
    expect(readdirSync(uploads)).toEqual([]);
  });

  it('refuses to attach to something of another Garage', async () => {
    db.prepare(`INSERT INTO garages (id, name) VALUES ('friend', 'Friend')`).run();
    const car = await createVehicle('Mine');
    const friendApp = createApp(db, 'friend', { uploadsDir: uploads });
    const form = new FormData();
    form.set('file', new File(['x'], 'a.pdf', { type: 'application/pdf' }));
    form.set('ownerKind', 'vehicle');
    form.set('ownerId', car.id);
    form.set('type', 'other');
    expect((await friendApp.request('/api/documents', { method: 'POST', body: form })).status).toBe(404);
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
    // A database as the first release left it: schema version 1, without workshop data.
    const old = openDatabase(path, undefined, 1);
    old.exec(`INSERT INTO vehicles (id, garage_id, kind, name) VALUES ('v1', 'default', 'car', 'Old car')`);
    old.exec(`INSERT INTO maintenance_tasks (id, vehicle_id, name, interval_km) VALUES ('t1', 'v1', 'Oil', 10000)`);
    old.close();

    const migrated = openDatabase(path, join(dir, 'backups'));
    const backups = readdirSync(join(dir, 'backups'));
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/^garage-v1-.*\.sqlite$/);
    const task = migrated.prepare('SELECT * FROM maintenance_tasks').get() as Record<string, unknown>;
    expect(task).toMatchObject({ id: 't1', interval_km: 10000, action: 'replace' });
    migrated.close();
  });

  it('moves Documents to their Garage when insurance arrives', () => {
    const path = join(dir, 'garage.sqlite');
    const old = openDatabase(path, undefined, 5);
    old.exec(`INSERT INTO vehicles (id, garage_id, kind, name) VALUES ('v1', 'default', 'car', 'Old car')`);
    old.exec(`INSERT INTO documents (id, vehicle_id, owner_kind, owner_id, type, file_name, content_type, size)
              VALUES ('d1', 'v1', 'vehicle', 'v1', 'registration', 'a.pdf', 'application/pdf', 3)`);
    old.close();
    const migrated = openDatabase(path);
    expect(migrated.prepare('SELECT garage_id, vehicle_id, owner_kind FROM documents').all()).toEqual([
      { garage_id: 'default', vehicle_id: 'v1', owner_kind: 'vehicle' },
    ]);
    migrated.close();
  });

  it('keeps each vehicle’s fuel when flex-fuel joins the fuels', () => {
    const path = join(dir, 'garage.sqlite');
    const old = openDatabase(path, undefined, 15);
    old.exec(`INSERT INTO vehicles (id, garage_id, kind, name, fuel) VALUES ('p', 'default', 'car', 'Petrol car', 'phev'), ('n', 'default', 'car', 'Old car', NULL)`);
    old.close();
    const migrated = openDatabase(path);
    expect(migrated.prepare('SELECT id, fuel FROM vehicles ORDER BY id').all()).toEqual([
      { id: 'n', fuel: null },
      { id: 'p', fuel: 'phev' },
    ]);
    migrated.exec(`UPDATE vehicles SET fuel = 'flexfuel' WHERE id = 'n'`);
    migrated.close();
  });

  it('keeps every Service’s odometer when it becomes optional', () => {
    const path = join(dir, 'garage.sqlite');
    const old = openDatabase(path, undefined, 16);
    old.exec(`INSERT INTO vehicles (id, garage_id, kind, name) VALUES ('v1', 'default', 'car', 'Old car')`);
    old.exec(`INSERT INTO maintenance_tasks (id, vehicle_id, name, interval_km) VALUES ('t1', 'v1', 'Oil', 10000)`);
    old.exec(`INSERT INTO services (id, vehicle_id, date, odometer) VALUES ('s1', 'v1', '2026-01-10', 20000)`);
    old.exec(`INSERT INTO service_tasks (service_id, task_id) VALUES ('s1', 't1')`);
    old.close();
    const migrated = openDatabase(path);
    expect(migrated.prepare('SELECT id, odometer FROM services').all()).toEqual([{ id: 's1', odometer: 20000 }]);
    expect(migrated.prepare('SELECT service_id, task_id FROM service_tasks').all()).toEqual([{ service_id: 's1', task_id: 't1' }]);
    migrated.exec(`INSERT INTO services (id, vehicle_id, date) VALUES ('s2', 'v1', '2026-02-01')`);
    migrated.close();
  });

  it('keeps sold vehicles off the garage page, as before, when the choice arrives', () => {
    const path = join(dir, 'garage.sqlite');
    const old = openDatabase(path, undefined, 10);
    old.exec(`INSERT INTO vehicles (id, garage_id, kind, name) VALUES ('kept', 'default', 'car', 'Kept car')`);
    old.exec(`INSERT INTO vehicles (id, garage_id, kind, name, status) VALUES ('gone', 'default', 'car', 'Sold car', 'sold')`);
    old.close();
    const migrated = openDatabase(path);
    expect(migrated.prepare('SELECT id, on_garage_page FROM vehicles ORDER BY id').all()).toEqual([
      { id: 'gone', on_garage_page: 0 },
      { id: 'kept', on_garage_page: 1 },
    ]);
    migrated.close();
  });

  it('adds the catalogue’s own intervals and switched-off tasks, and keeps no rules by build', () => {
    const path = join(dir, 'garage.sqlite');
    const old = openDatabase(path, undefined, 18);
    old.exec(`INSERT INTO vehicles (id, garage_id, kind, name) VALUES ('v1', 'default', 'car', 'Old car')`);
    old.exec(`INSERT INTO maintenance_tasks (id, vehicle_id, name, interval_km) VALUES ('t1', 'v1', 'Oil', 10000)`);
    old.exec(`INSERT INTO catalogue_parts (garage_id, code, conditions, removed) VALUES ('default', 'wipers', '{}', 1)`);
    old.close();
    const migrated = openDatabase(path);
    expect(migrated.prepare('SELECT switched_off FROM maintenance_tasks').all()).toEqual([{ switched_off: 0 }]);
    expect(migrated.prepare('SELECT code, removed, interval_set FROM catalogue_parts').all()).toEqual([{ code: 'wipers', removed: 1, interval_set: 0 }]);
    expect(migrated.prepare(`SELECT name FROM pragma_table_info('catalogue_parts') WHERE name = 'interval_rules'`).all()).toEqual([]);
    migrated.close();
  });

  it('turns what the owner changed on the car tyres template into the same change on front and rear tyres', () => {
    const path = join(dir, 'garage.sqlite');
    const latest = openDatabase(join(dir, 'latest.sqlite'));
    const version = (latest.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    latest.close();
    const old = openDatabase(path, undefined, version - 6);
    old.exec(`INSERT INTO catalogue_parts (garage_id, code, conditions, removed) VALUES ('default', 'tires', '{}', 1)`);
    old.close();
    const migrated = openDatabase(path);
    expect(migrated.prepare('SELECT code, removed FROM catalogue_parts ORDER BY code').all()).toEqual([
      { code: 'tires_front', removed: 1 },
      { code: 'tires_rear', removed: 1 },
    ]);
    migrated.close();
  });

  it('turns what the owner changed on the fork oil and seals template into the same change on each', () => {
    const path = join(dir, 'garage.sqlite');
    const latest = openDatabase(join(dir, 'latest.sqlite'));
    const version = (latest.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    latest.close();
    const old = openDatabase(path, undefined, version - 5);
    old.exec(`INSERT INTO catalogue_parts (garage_id, code, conditions, removed) VALUES ('default', 'moto_fork_oil_seals', '{}', 1)`);
    old.close();
    const migrated = openDatabase(path);
    expect(migrated.prepare('SELECT code, removed FROM catalogue_parts ORDER BY code').all()).toEqual([
      { code: 'moto_fork_oil', removed: 1 },
      { code: 'moto_fork_seals', removed: 1 },
    ]);
    migrated.close();
  });

  it('turns what the owner changed on the car shock absorbers template into the same change on front and rear', () => {
    const path = join(dir, 'garage.sqlite');
    const latest = openDatabase(join(dir, 'latest.sqlite'));
    const version = (latest.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    latest.close();
    const old = openDatabase(path, undefined, version - 4);
    old.exec(`INSERT INTO catalogue_parts (garage_id, code, conditions, removed) VALUES ('default', 'shock_absorbers', '{}', 1)`);
    old.close();
    const migrated = openDatabase(path);
    expect(migrated.prepare('SELECT code, removed FROM catalogue_parts ORDER BY code').all()).toEqual([
      { code: 'shock_absorbers_front', removed: 1 },
      { code: 'shock_absorbers_rear', removed: 1 },
    ]);
    migrated.close();
  });

  it('drops the rules by build a database may already hold', () => {
    const path = join(dir, 'garage.sqlite');
    const old = openDatabase(path, undefined, 19);
    old.exec(`INSERT INTO catalogue_parts (garage_id, code, conditions, removed) VALUES ('default', 'wipers', '{}', 1)`);
    old.close();
    const migrated = openDatabase(path);
    expect(migrated.prepare('SELECT code FROM catalogue_parts').all()).toEqual([{ code: 'wipers' }]);
    migrated.close();
  });

  it('moves the twelve categories into six, for Tasks and the owner’s own parts', () => {
    const path = join(dir, 'garage.sqlite');
    const old = openDatabase(path, undefined, 20);
    old.exec(`INSERT INTO vehicles (id, garage_id, kind, name) VALUES ('v1', 'default', 'car', 'Old car')`);
    const task = (id: string, category: string | null) =>
      old.exec(`INSERT INTO maintenance_tasks (id, vehicle_id, name, interval_km, category) VALUES ('${id}', 'v1', '${id}', 1000, ${category ? `'${category}'` : 'NULL'})`);
    for (const c of ['engine', 'ignition', 'fuel_exhaust', 'cooling', 'transmission', 'drivetrain', 'brakes', 'tires_suspension', 'electrical', 'hvac', 'body', 'other']) task(c, c);
    task('none', null);
    old.exec(`INSERT INTO catalogue_parts (garage_id, code, kind, name, unit, category, interval_km) VALUES ('default', 'own_a', 'car', 'Roof rack', 'piece', 'body', 1000)`);
    old.exec(`INSERT INTO catalogue_parts (garage_id, code, conditions, removed) VALUES ('default', 'wipers', '{}', 1)`);
    old.close();

    const migrated = openDatabase(path);
    const categories = Object.fromEntries((migrated.prepare('SELECT id, category FROM maintenance_tasks').all() as { id: string; category: string | null }[]).map((r) => [r.id, r.category]));
    expect(categories).toEqual({
      engine: 'engine', ignition: 'engine', fuel_exhaust: 'engine',
      transmission: 'transmission', drivetrain: 'transmission',
      brakes: 'brakes',
      tires_suspension: 'chassis', body: 'chassis',
      electrical: 'electrical',
      cooling: 'cooling_climate', hvac: 'cooling_climate',
      other: 'other',
      none: null,
    });
    expect(migrated.prepare('SELECT code, category FROM catalogue_parts ORDER BY code').all()).toEqual([
      { code: 'own_a', category: 'chassis' },
      { code: 'wipers', category: null },
    ]);
    expect(() => migrated.exec(`UPDATE maintenance_tasks SET category = 'hvac' WHERE id = 'none'`)).toThrow();
    migrated.close();
  });

  it('drops the fitted-parts positions, keeping every Part Used', () => {
    const path = join(dir, 'garage.sqlite');
    const old = openDatabase(path, undefined, 21);
    old.exec(`INSERT INTO vehicles (id, garage_id, kind, name) VALUES ('v1', 'default', 'car', 'Old car')`);
    old.exec(`INSERT INTO services (id, vehicle_id, date, odometer) VALUES ('s1', 'v1', '2026-01-10', 20000)`);
    old.exec(`INSERT INTO part_specs (id, vehicle_id, standard_part, name, unit) VALUES ('p1', 'v1', 'tires', 'tires', 'piece')`);
    old.exec(`INSERT INTO fitment_positions (id, vehicle_id, name, standard_part) VALUES ('tyres', 'v1', 'tires', 'tires')`);
    old.exec(`INSERT INTO parts_used (service_id, sort, part_spec_id, position_id, description, quantity, unit, price) VALUES ('s1', 0, 'p1', 'tyres', 'Michelin', 4, 'piece', 480)`);
    old.close();

    const migrated = openDatabase(path);
    expect(migrated.prepare(`SELECT name FROM sqlite_master WHERE name = 'fitment_positions'`).all()).toEqual([]);
    expect(migrated.prepare('SELECT service_id, sort, description, quantity FROM service_items').all()).toEqual([
      { service_id: 's1', sort: 0, description: 'Michelin', quantity: 4 },
    ]);
    // A Service still takes its components with it.
    migrated.exec(`DELETE FROM services WHERE id = 's1'`);
    expect(migrated.prepare('SELECT COUNT(*) AS n FROM service_items').get()).toEqual({ n: 0 });
    migrated.close();
  });

  it('drops insurance, inspections, modifications, quotes and drivers, keeping vehicles, services and Documents', async () => {
    const path = join(dir, 'garage.sqlite');
    const old = openDatabase(path, undefined, 22);
    old.exec(`INSERT INTO vehicles (id, garage_id, kind, name, registration, vin) VALUES ('v1', 'default', 'car', 'Old car', 'AA-000-AA', 'VF1TESTVIN0000001')`);
    old.exec(`INSERT INTO services (id, vehicle_id, date, odometer) VALUES ('s1', 'v1', '2026-01-10', 20000)`);
    old.exec(`INSERT INTO insurance_policies (id, garage_id, insurer, start_date) VALUES ('pol', 'default', 'Assurance Exemple', '2025-04-01')`);
    old.exec(`INSERT INTO documents (id, garage_id, vehicle_id, owner_kind, owner_id, type, file_name, content_type, size)
              VALUES ('d1', 'default', 'v1', 'service', 's1', 'invoice', 'a.pdf', 'application/pdf', 3),
                     ('d2', 'default', NULL, 'policy', 'pol', 'policySchedule', 'b.pdf', 'application/pdf', 3)`);
    old.close();

    const migrated = openDatabase(path);
    const tables = (migrated.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((t) => t.name);
    for (const gone of ['insurance_policies', 'drivers', 'quotes', 'claims', 'covers', 'policy_terms', 'technical_inspections', 'modifications']) {
      expect(tables).not.toContain(gone);
    }
    expect(migrated.prepare('SELECT id, vin FROM vehicles').all()).toEqual([{ id: 'v1', vin: 'VF1TESTVIN0000001' }]);
    expect(migrated.prepare('SELECT id FROM services').all()).toEqual([{ id: 's1' }]);
    // Both Documents stay stored; only the Service's receipt is shown.
    expect(migrated.prepare('SELECT COUNT(*) AS n FROM documents').get()).toEqual({ n: 2 });
    migrated.close();
    const reopened = openDatabase(path);
    const snap = (await (await createApp(reopened).request('/api/snapshot')).json()) as Snapshot;
    expect(snap.documents.map((d) => d.id)).toEqual(['d1']);
    reopened.close();
  });

  it('guesses a Task’s action from its name, folds the Official Interval into the Interval, and sums the prices into a Service’s cost', () => {
    const path = join(dir, 'garage.sqlite');
    const old = openDatabase(path, undefined, 23);
    old.exec(`INSERT INTO vehicles (id, garage_id, kind, name) VALUES ('v1', 'default', 'car', 'Old car')`);
    old.exec(`INSERT INTO maintenance_tasks (id, vehicle_id, name, name_fr, interval_km, interval_months, official_interval_km, official_interval_months) VALUES
      ('t1', 'v1', 'Change engine oil', NULL, 15000, 12, 10000, NULL),
      ('t2', 'v1', 'Check tyre pressure', NULL, NULL, 1, NULL, NULL),
      ('t3', 'v1', 'Nettoyer le filtre', 'Nettoyer le filtre', 20000, NULL, NULL, 24),
      ('t4', 'v1', 'Lubricate the chain', NULL, 1000, NULL, 800, NULL)`);
    old.exec(`INSERT INTO services (id, vehicle_id, date, odometer) VALUES ('s1', 'v1', '2026-01-10', 20000), ('s2', 'v1', '2026-02-10', 21000)`);
    old.exec(`INSERT INTO parts_used (service_id, sort, description, quantity, unit, price) VALUES
      ('s1', 0, 'Oil', 4, 'litre', 40), ('s1', 1, 'Filter', 1, 'piece', 12.5), ('s2', 0, 'Pads', 1, 'piece', NULL)`);
    old.close();

    const migrated = openDatabase(path);
    expect(migrated.prepare('SELECT id, action, interval_km, interval_months FROM maintenance_tasks ORDER BY id').all()).toEqual([
      { id: 't1', action: 'replace', interval_km: 10000, interval_months: 12 },
      { id: 't2', action: 'inspect', interval_km: null, interval_months: 1 },
      { id: 't3', action: 'clean', interval_km: 20000, interval_months: 24 },
      { id: 't4', action: 'adjust', interval_km: 800, interval_months: null },
    ]);
    expect(migrated.prepare('SELECT id, performed_by, total_cost FROM services ORDER BY id').all()).toEqual([
      { id: 's1', performed_by: 'diy', total_cost: 52.5 },
      { id: 's2', performed_by: 'diy', total_cost: null },
    ]);
    migrated.close();
  });

  it('converts the earlier model to the five parts: spec lines, task notes, paused tasks, components', () => {
    const path = join(dir, 'garage.sqlite');
    const old = openDatabase(path, undefined, 23);
    old.exec(`INSERT INTO vehicles (id, garage_id, kind, name, fuel, transmission, cooling, final_drive, cylinders)
              VALUES ('v1', 'default', 'motorcycle', 'Old bike', 'petrol', 'manual', 'liquid', 'chain', 2)`);
    old.exec(`INSERT INTO part_specs (id, vehicle_id, standard_part, name, unit, characteristics, part_numbers, not_fitted) VALUES
      ('p-oil', 'v1', 'moto_engine_oil', 'moto_engine_oil', 'litre', '10W-40, JASO MA2', NULL, 0),
      ('p-chain', 'v1', 'moto_chain', 'moto_chain', 'piece', NULL, 'DID 520', 0),
      ('p-belt', 'v1', 'moto_drive_belt', 'moto_drive_belt', 'piece', '', NULL, 1),
      ('p-rack', 'v1', NULL, 'Roof rack', 'piece', 'Thule', NULL, 0)`);
    old.exec(`INSERT INTO vehicle_specs (id, vehicle_id, kind, name, value, notes) VALUES ('vs1', 'v1', 'torque', 'Drain plug', '30 Nm', 'new washer')`);
    old.exec(`INSERT INTO maintenance_tasks (id, vehicle_id, name, name_fr, interval_km, interval_months, standard_part, workshop_notes) VALUES
      ('t-oil', 'v1', 'Engine oil', NULL, 8000, 12, 'moto_engine_oil', 'Warm the engine first'),
      ('t-belt', 'v1', 'Final drive belt', NULL, 60000, NULL, 'moto_drive_belt', NULL),
      ('t-own', 'v1', 'Wash', NULL, NULL, 1, NULL, NULL)`);
    old.exec(`INSERT INTO required_parts (task_id, part_spec_id, quantity, sort) VALUES ('t-oil', 'p-oil', 3.2, 0)`);
    old.exec(`INSERT INTO required_tools (task_id, sort, name) VALUES ('t-oil', 0, '17 mm socket')`);
    old.exec(`INSERT INTO task_specs (task_id, spec_id) VALUES ('t-oil', 'vs1')`);
    old.exec(`INSERT INTO services (id, vehicle_id, date, odometer) VALUES ('s1', 'v1', '2026-01-10', 20000)`);
    old.exec(`INSERT INTO parts_used (service_id, sort, part_spec_id, description, quantity, unit, price, supplier) VALUES
      ('s1', 0, 'p-oil', 'Motul 7100', 3, 'litre', 40, 'Shop')`);
    old.close();

    const migrated = openDatabase(path);
    const tables = (migrated.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((t) => t.name);
    for (const gone of ['part_specs', 'vehicle_specs', 'required_parts', 'required_tools', 'task_specs', 'parts_used']) expect(tables).not.toContain(gone);
    expect(migrated.prepare('SELECT label, value, spec_group FROM spec_lines ORDER BY spec_group, sort').all()).toEqual([
      { label: 'Engine oil', value: '10W-40, JASO MA2', spec_group: 'fluids' },
      { label: 'Chain', value: 'DID 520', spec_group: 'parts' },
      { label: 'Roof rack', value: 'Thule', spec_group: 'parts' },
      { label: 'Drain plug', value: '30 Nm (new washer)', spec_group: 'torque' },
    ]);
    const tasks = migrated.prepare('SELECT id, name, notes, switched_off, category FROM maintenance_tasks ORDER BY id').all() as Record<string, unknown>[];
    expect(tasks.find((t) => t.id === 't-oil')).toMatchObject({
      name: 'Change engine oil and filter',
      notes: 'Warm the engine first\nNeeds: Engine oil ×3.2 L\nTools: 17 mm socket\nSpecs: Drain plug: 30 Nm',
      switched_off: 0,
      category: 'engine',
    });
    // A part set aside as not on the vehicle pauses its Task; an own Task stays as it is.
    expect(tasks.find((t) => t.id === 't-belt')).toMatchObject({ switched_off: 1 });
    expect(tasks.find((t) => t.id === 't-own')).toMatchObject({ name: 'Wash', switched_off: 0, category: null });
    expect(migrated.prepare('SELECT description, quantity FROM service_items').all()).toEqual([{ description: 'Motul 7100 (Shop)', quantity: 3 }]);
    expect(migrated.prepare('SELECT total_cost FROM services').get()).toEqual({ total_cost: 40 });
    migrated.close();
  });

  it('guesses the category of the spec lines already there from their label', () => {
    const path = join(dir, 'garage.sqlite');
    const old = openDatabase(path, undefined, 25);
    old.exec(`INSERT INTO vehicles (id, garage_id, kind, name) VALUES ('v1', 'default', 'motorcycle', 'Old bike')`);
    old.exec(`INSERT INTO spec_lines (id, vehicle_id, label, value, spec_group, sort) VALUES
      ('a', 'v1', 'Engine oil', '10W-40', 'fluids', 0), ('b', 'v1', 'Front tyre', '120/70', 'parts', 0), ('c', 'v1', 'Brake fluid', 'DOT 4', 'fluids', 1),
      ('d', 'v1', 'Chain', '520', 'parts', 1), ('e', 'v1', 'Battery', '12 V', 'parts', 2), ('f', 'v1', 'Coolant', '50/50', 'fluids', 2),
      ('g', 'v1', 'Drain plug', '30 Nm', 'torque', 0), ('h', 'v1', 'Roof rack', 'Thule', 'parts', 3)`);
    old.close();
    const migrated = openDatabase(path);
    expect(migrated.prepare('SELECT id, category FROM spec_lines ORDER BY id').all()).toEqual([
      { id: 'a', category: 'engine' },
      { id: 'b', category: 'chassis' },
      { id: 'c', category: 'brakes' },
      { id: 'd', category: 'transmission' },
      { id: 'e', category: 'electrical' },
      { id: 'f', category: 'cooling_climate' },
      { id: 'g', category: null },
      { id: 'h', category: null },
    ]);
    migrated.close();
  });
});
