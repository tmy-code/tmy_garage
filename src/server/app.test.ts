import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import type { DatabaseSync } from 'node:sqlite';
import type {
  Claim,
  Driver,
  FitmentPosition,
  GarageDocument,
  InsurancePolicy,
  MaintenanceTask,
  Modification,
  PartSpec,
  PolicyTerm,
  Quote,
  Snapshot,
  TechnicalInspection,
  Vehicle,
  VehicleSpec,
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

  it('stores the category picked for a Task replacing no part, and drops it once the Task replaces one', async () => {
    const a = await createVehicle('A');
    const b = await createVehicle('B');
    const lube = await createTask(a.id, { name: 'Chain lube', category: 'drivetrain' });
    expect(lube.category).toBe('drivetrain');
    expect((await call('POST', `/api/vehicles/${a.id}/tasks`, { name: 'X', intervalKm: 1000, category: 'garden' })).status).toBe(422);
    await call('POST', `/api/vehicles/${b.id}/copy-tasks`, { fromVehicleId: a.id });
    expect((await snapshot()).tasks.find((t) => t.vehicleId === b.id)!.category).toBe('drivetrain');
    await call('PUT', `/api/tasks/${lube.id}`, { name: 'Chain kit', intervalKm: 1000, standardPart: 'moto_chain', category: 'body' });
    expect((await snapshot()).tasks.find((t) => t.id === lube.id)).toMatchObject({ standardPart: 'moto_chain', category: null });
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

  it('stores a Service without an odometer value, for time-based tasks', async () => {
    const bike = await createVehicle();
    const coolant = await createTask(bike.id, { name: 'Coolant', intervalKm: null, intervalMonths: 36 });
    const body = { id: 'svc-00002', vehicleId: bike.id, date: '2026-07-14', taskIds: [coolant.id], notes: null };
    expect((await call('PUT', '/api/services/svc-00002', body)).status).toBe(200);
    expect((await snapshot()).services).toEqual([{ ...body, odometer: null, partsUsed: [] }]);
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
    const part = await created<PartSpec>(`/api/vehicles/${bike.id}/part-specs`, {
      name: 'Engine oil',
      characteristics: '10W-40 JASO MA2',
      unit: 'litre',
    });
    await call('PUT', `/api/part-specs/${part.id}`, {
      name: 'Engine oil',
      nameFr: 'Huile moteur',
      characteristics: '10W-40 JASO MA2',
      unit: 'litre',
    });
    const s = await snapshot();
    expect(s.vehicleSpecs).toEqual([
      { id: torque.id, vehicleId: bike.id, kind: 'torque', name: 'Drain plug', value: '30 Nm', notes: 'New washer' },
    ]);
    expect(s.partSpecs.find((p) => p.standardPart === null)).toMatchObject({
      name: 'Engine oil',
      nameFr: 'Huile moteur',
      characteristics: '10W-40 JASO MA2',
      partNumbers: null,
      unit: 'litre',
    });
    // Positions are the vehicle's fitted Standard Parts: a tyre is fitted, engine oil is not.
    const positions = s.positions.filter((p) => p.vehicleId === bike.id).map((p) => p.standardPart);
    expect(positions).toEqual(expect.arrayContaining(['moto_tire_rear', 'moto_chain', 'moto_battery']));
    expect(positions).not.toContain('moto_engine_oil');
  });

  it('gives positions only from the Standard Parts, which cannot be added, renamed or deleted by hand', async () => {
    const bike = await createVehicle();
    const rear = (await snapshot()).positions.find((p) => p.vehicleId === bike.id && p.standardPart === 'moto_tire_rear')!;
    expect((await call('POST', `/api/vehicles/${bike.id}/positions`, { name: 'Top box' })).status).toBe(404);
    expect((await call('PUT', `/api/positions/${rear.id}`, { name: 'Renamed' })).status).toBe(409);
    expect((await call('DELETE', `/api/positions/${rear.id}`)).status).toBe(409);
    // An older, free-named position is kept and can still be renamed or deleted.
    db.exec(`INSERT INTO fitment_positions (id, vehicle_id, name) VALUES ('old', '${bike.id}', 'Top box')`);
    expect((await call('PUT', '/api/positions/old', { name: 'Top case' })).status).toBe(200);
    expect((await snapshot()).positions.find((p) => p.id === 'old')).toMatchObject({ standardPart: null, name: 'Top case' });
    expect((await call('DELETE', '/api/positions/old')).status).toBe(204);
  });

  /** The Standard Parts a vehicle lists, minus those marked as not on it. */
  async function fittedParts(vehicleId: string): Promise<string[]> {
    return (await snapshot()).partSpecs.filter((p) => p.vehicleId === vehicleId && !p.notFitted).map((p) => p.standardPart!);
  }

  async function create(build: object): Promise<Vehicle> {
    const res = await call('POST', '/api/vehicles', { name: 'Test vehicle', ...build });
    expect(res.status).toBe(201);
    return res.json();
  }

  it('requires what the parts depend on, and refuses what cannot go together', async () => {
    const refused = async (build: object) => {
      const res = await call('POST', '/api/vehicles', { name: 'Test vehicle', ...build });
      expect(res.status).toBe(422);
      return ((await res.json()) as { error: string }).error;
    };
    expect(await refused({ ...CAR, drivetrain: null })).toMatch(/^drivetrain:/);
    expect(await refused({ ...CAR, make: '' })).toMatch(/^make:/);
    expect(await refused({ ...BIKE, cylinders: null })).toMatch(/^cylinders:/);
    expect(await refused({ ...BIKE, fuel: 'diesel' })).toMatch(/^fuel:/);
    expect(await refused({ ...CAR, fuel: 'hybrid', transmission: 'manual' })).toMatch(/^transmission:/);
    expect(await refused({ ...BIKE, transmission: 'e_cvt' })).toMatch(/^transmission:/);
    // What an electric vehicle always is, and options that cannot apply, are set rather than refused.
    const ev = await create({ ...CAR, fuel: 'electric', transmission: 'manual', distribution: 'belt', hasTurbo: true, hasAc: true, cooling: 'air' });
    expect(ev).toMatchObject({ transmission: 'single_speed', distribution: 'none', hasTurbo: false, hasAc: true, cooling: null });
  });

  it('lists only the parts that fit a petrol automatic car with a timing chain', async () => {
    const car = await create({ ...CAR, transmission: 'automatic', distribution: 'chain' });
    const fitted = await fittedParts(car.id);
    expect(fitted).toEqual(expect.arrayContaining(['engine_oil', 'oil_filter', 'spark_plugs', 'atf', 'battery_12v']));
    for (const gone of ['timing_belt_kit', 'clutch_kit', 'fuel_filter', 'dct_oil', 'ac_dryer', 'battery_12v_agm']) expect(fitted).not.toContain(gone);
  });

  it('lists the parts of a manual four-wheel-drive diesel with a timing belt, turbo, start-stop and A/C', async () => {
    const car = await create({ ...CAR, fuel: 'diesel', drivetrain: 'awd', distribution: 'belt', hasTurbo: true, hasStartStop: true, hasAc: true });
    const fitted = await fittedParts(car.id);
    expect(fitted).toEqual(
      expect.arrayContaining(['fuel_filter', 'clutch_kit', 'clutch_fluid', 'timing_belt_kit', 'diff_oil_rear', 'diff_oil_front', 'transfer_case_oil', 'ac_dryer', 'battery_12v_agm']),
    );
    for (const gone of ['spark_plugs', 'atf', 'battery_12v']) expect(fitted).not.toContain(gone);
  });

  it('gives a flex-fuel car the parts and options of a petrol one, and refuses it on a motorcycle', async () => {
    const car = await create({ ...CAR, fuel: 'flexfuel', distribution: 'belt', hasTurbo: true, hasDirectInjection: true });
    expect(car).toMatchObject({ fuel: 'flexfuel', hasTurbo: true, hasDirectInjection: true });
    const fitted = await fittedParts(car.id);
    expect(fitted).toEqual(expect.arrayContaining(['engine_oil', 'spark_plugs', 'timing_belt_kit', 'clutch_kit']));
    expect(fitted).not.toContain('fuel_filter');
    expect((await call('POST', '/api/vehicles', { ...BIKE, name: 'Test vehicle', fuel: 'flexfuel' })).status).toBe(422);
  });

  it('leaves out the engine parts of an electric car', async () => {
    const car = await create({ ...CAR, fuel: 'electric', drivetrain: 'awd' });
    const fitted = await fittedParts(car.id);
    expect(fitted).toEqual(expect.arrayContaining(['ev_battery_coolant', 'ev_reduction_gear_oil', 'ev_reduction_gear_oil_rear', 'cabin_filter']));
    for (const gone of ['engine_oil', 'oil_filter', 'coolant', 'spark_plugs', 'timing_belt_kit']) expect(fitted).not.toContain(gone);
  });

  it('lists the parts of an air-cooled motorcycle with a shaft drive and a hydraulic clutch', async () => {
    const bike = await create({ ...BIKE, finalDrive: 'shaft', cooling: 'air', hasHydraulicClutch: true });
    const fitted = await fittedParts(bike.id);
    expect(fitted).toEqual(expect.arrayContaining(['moto_shaft_oil', 'moto_spark_plugs', 'moto_clutch_fluid', 'moto_clutch_plates']));
    for (const gone of ['moto_chain', 'moto_sprockets', 'moto_drive_belt', 'moto_coolant']) expect(fitted).not.toContain(gone);
  });

  it('gives a motorcycle with a belt drive a drive belt position and no chain one', async () => {
    const bike = await create({ ...BIKE, finalDrive: 'belt' });
    const positions = (await snapshot()).positions.filter((p) => p.vehicleId === bike.id).map((p) => p.standardPart);
    expect(positions).toContain('moto_drive_belt');
    expect(positions).not.toContain('moto_chain');
  });

  it('starts a new vehicle with a Maintenance Task per part, at the catalogue interval', async () => {
    const car = await create({ ...CAR, hasTurbo: true });
    const tasks = (await snapshot()).tasks.filter((t) => t.vehicleId === car.id);
    // Tasks say what is to be done; oil and filter are changed together, sooner with a turbo.
    expect(tasks.find((t) => t.name === 'Change engine oil and filter')).toMatchObject({
      nameFr: 'Vidange huile moteur et filtre',
      intervalKm: 10_000,
      intervalMonths: 12,
      officialIntervalKm: null,
    });
    expect(tasks.find((t) => t.name === 'Oil filter')).toBeUndefined();
    expect(tasks.find((t) => t.name === 'Change brake fluid')).toMatchObject({ nameFr: 'Remplacer le liquide de frein', intervalKm: null, intervalMonths: 24 });
    expect(tasks.find((t) => t.name === 'Replace front brake pads')).toMatchObject({ nameFr: 'Remplacer les plaquettes avant' });
    expect(tasks.find((t) => t.name === 'Brake fluid')).toBeUndefined();
    expect(tasks).toHaveLength((await fittedParts(car.id)).length - 1);
    // Parts that fit after an edit get their Task too: four-wheel drive adds two differentials and a transfer case.
    await call('PUT', `/api/vehicles/${car.id}`, { ...CAR, name: 'Test vehicle', drivetrain: 'awd' });
    const after = (await snapshot()).tasks.filter((t) => t.vehicleId === car.id);
    expect(after).toHaveLength(tasks.length + 3);
    expect(after.map((t) => t.standardPart)).toEqual(expect.arrayContaining(['diff_oil_front', 'diff_oil_rear', 'transfer_case_oil']));
  });

  it('renames Tasks still named after their part when the server starts, and leaves the owner’s names alone', async () => {
    const car = await create(CAR);
    const sold = await create({ ...CAR, name: 'Sold car' });
    await call('POST', `/api/vehicles/${sold.id}/sell`, { date: '2026-10-01' });
    // As an earlier release left them: named after the part, and one renamed by the owner.
    db.prepare(`UPDATE maintenance_tasks SET name = 'Brake fluid', name_fr = 'Liquide de frein' WHERE standard_part = 'brake_fluid'`).run();
    db.prepare(`UPDATE maintenance_tasks SET name = 'Engine oil and filter', name_fr = 'Huile moteur et filtre' WHERE standard_part = 'engine_oil'`).run();
    db.prepare(`UPDATE maintenance_tasks SET name = 'Tyres', name_fr = 'Mes pneus d’hiver' WHERE standard_part = 'tires' AND vehicle_id = ?`).run(car.id);
    db.prepare(`UPDATE maintenance_tasks SET name = 'Winter tyres' WHERE standard_part = 'tires' AND vehicle_id = ?`).run(sold.id);

    const later = createApp(db);
    const tasks = ((await (await later.request('/api/snapshot')).json()) as Snapshot).tasks;
    const of = (vehicleId: string, code: string) => tasks.find((t) => t.vehicleId === vehicleId && t.standardPart === code)!;
    for (const id of [car.id, sold.id]) {
      expect(of(id, 'brake_fluid')).toMatchObject({ name: 'Change brake fluid', nameFr: 'Remplacer le liquide de frein' });
      expect(of(id, 'engine_oil')).toMatchObject({ name: 'Change engine oil and filter', nameFr: 'Vidange huile moteur et filtre' });
    }
    // A French name the owner wrote stays; a name they changed stays.
    expect(of(car.id, 'tires')).toMatchObject({ name: 'Replace tyres', nameFr: 'Mes pneus d’hiver' });
    expect(of(sold.id, 'tires')).toMatchObject({ name: 'Winter tyres' });
  });

  it('keeps an Interval following the build until the owner sets their own', async () => {
    const car = await create(CAR);
    const tasks = async () => (await snapshot()).tasks.filter((t) => t.vehicleId === car.id);
    const oil = (await tasks()).find((t) => t.standardPart === 'engine_oil')!;
    const pads = (await tasks()).find((t) => t.standardPart === 'brake_pads_front')!;
    const edit = (task: MaintenanceTask, intervalKm: number) =>
      call('PUT', `/api/tasks/${task.id}`, { name: task.name, nameFr: task.nameFr, intervalKm, intervalMonths: task.intervalMonths, standardPart: task.standardPart });
    await edit(pads, 30_000);
    // A turbo shortens the oil change; the owner's own pads interval stays.
    await call('PUT', `/api/vehicles/${car.id}`, { ...CAR, name: 'Test vehicle', hasTurbo: true });
    expect((await tasks()).find((t) => t.id === oil.id)!.intervalKm).toBe(10_000);
    expect((await tasks()).find((t) => t.id === pads.id)!.intervalKm).toBe(30_000);
    // Set back to the default, it follows the build again.
    await edit(pads, 40_000);
    await edit(oil, 8_000);
    await call('PUT', `/api/vehicles/${car.id}`, { ...CAR, name: 'Test vehicle' });
    expect((await tasks()).find((t) => t.id === oil.id)!.intervalKm).toBe(8_000);
    expect((await tasks()).find((t) => t.id === pads.id)!.intervalKm).toBe(40_000);
  });

  it('keeps a part’s only Task on the schedule, and gives a copied Interval to the Task already there', async () => {
    const car = await create(CAR);
    const other = await create(CAR);
    const oil = (await snapshot()).tasks.find((t) => t.vehicleId === car.id && t.standardPart === 'engine_oil')!;
    expect((await call('DELETE', `/api/tasks/${oil.id}`)).status).toBe(409);
    expect((await call('PUT', `/api/tasks/${oil.id}`, { name: 'Oil', intervalKm: 5000, standardPart: null })).status).toBe(409);
    await call('PUT', `/api/tasks/${oil.id}`, { name: 'Oil', intervalKm: 5000, standardPart: 'engine_oil' });
    const before = (await snapshot()).tasks.filter((t) => t.vehicleId === other.id).length;
    await call('POST', `/api/vehicles/${other.id}/copy-tasks`, { fromVehicleId: car.id });
    const copied = (await snapshot()).tasks.filter((t) => t.vehicleId === other.id);
    expect(copied).toHaveLength(before);
    expect(copied.find((t) => t.standardPart === 'engine_oil')).toMatchObject({ name: 'Oil', intervalKm: 5000 });
    // A part set aside no longer keeps its Task: it can go.
    await call('PUT', `/api/vehicles/${car.id}`, { ...CAR, name: 'Test vehicle', transmission: 'automatic' });
    const clutch = (await snapshot()).tasks.find((t) => t.vehicleId === car.id && t.standardPart === 'clutch_kit')!;
    expect((await call('DELETE', `/api/tasks/${clutch.id}`)).status).toBe(204);
  });

  it('links each starter task to its part, needing it and what goes with it, quantity to fill in', async () => {
    const car = await create(CAR);
    const s = await snapshot();
    const spec = (key: string) => s.partSpecs.find((p) => p.vehicleId === car.id && p.standardPart === key)!.id;
    const oil = s.tasks.find((t) => t.vehicleId === car.id && t.standardPart === 'engine_oil')!;
    expect(oil.requiredParts).toEqual([
      { partSpecId: spec('engine_oil'), quantity: null },
      { partSpecId: spec('oil_filter'), quantity: null },
    ]);
    expect(s.tasks.find((t) => t.standardPart === 'brake_fluid')!.requiredParts).toEqual([{ partSpecId: spec('brake_fluid'), quantity: null }]);
  });

  it('pauses a task while its part is not on the vehicle', async () => {
    const car = await create(CAR);
    const clutch = (await snapshot()).tasks.find((t) => t.vehicleId === car.id && t.standardPart === 'clutch_kit')!;
    const status = async () => vehicleDue(await snapshot(), car.id, '2026-11-01').due.find((d) => d.taskId === clutch.id)!.status;
    expect(await status()).not.toBe('paused');
    // A starter task's Required Part, with no quantity, does not keep the part on the vehicle.
    await call('PUT', `/api/vehicles/${car.id}`, { ...CAR, name: 'Test vehicle', transmission: 'automatic' });
    expect(await status()).toBe('paused');
    await call('PUT', `/api/vehicles/${car.id}`, { ...CAR, name: 'Test vehicle' });
    expect(await status()).not.toBe('paused');
  });

  it('links a task only to one of its vehicle’s Standard Parts, and copies the link where the other vehicle has it', async () => {
    const bike = await createVehicle('Bike');
    expect((await call('POST', `/api/vehicles/${bike.id}/tasks`, { name: 'Pads', intervalKm: 20000, standardPart: 'brake_pads_front' })).status).toBe(422);
    const chain = await createTask(bike.id, { name: 'Chain kit', standardPart: 'moto_chain' });
    expect(chain.standardPart).toBe('moto_chain');
    const other = await createVehicle('Other bike');
    db.prepare(`DELETE FROM part_specs WHERE vehicle_id = ? AND standard_part = 'moto_chain'`).run(other.id);
    await call('POST', `/api/vehicles/${other.id}/copy-tasks`, { fromVehicleId: bike.id });
    expect((await snapshot()).tasks.find((t) => t.vehicleId === other.id)!.standardPart).toBeNull();
    // With a second Task for the chain, this one can be unlinked.
    await createTask(bike.id, { name: 'Chain check', standardPart: 'moto_chain' });
    expect((await call('PUT', `/api/tasks/${chain.id}`, { name: 'Chain kit', intervalKm: 20000, standardPart: null })).status).toBe(200);
    expect((await snapshot()).tasks.find((t) => t.id === chain.id)!.standardPart).toBeNull();
  });

  it('updates the parts when the build changes, keeping filled-in parts and the user’s own choices', async () => {
    const car = await create(CAR);
    const parts = async () => (await snapshot()).partSpecs.filter((p) => p.vehicleId === car.id);
    const part = async (key: string) => (await parts()).find((p) => p.standardPart === key)!;
    const clutch = await part('clutch_kit');
    await call('PUT', `/api/part-specs/${clutch.id}`, { name: 'x', unit: 'piece', characteristics: 'Sachs 3000 951' });
    const cabin = await part('cabin_filter');
    await call('PUT', `/api/part-specs/${cabin.id}`, { name: 'x', unit: 'piece', notFitted: true });

    const change = { ...CAR, name: 'Test vehicle', transmission: 'automatic', distribution: 'belt' };
    expect((await call('PUT', `/api/vehicles/${car.id}`, change)).status).toBe(200);

    expect((await part('timing_belt_kit')).notFitted).toBe(false);
    expect((await part('atf')).notFitted).toBe(false);
    expect((await part('clutch_fluid')).notFitted).toBe(true);
    // The clutch kit has a spec filled in, so it is kept (the screens flag it) rather than lost.
    expect(await part('clutch_kit')).toMatchObject({ notFitted: false, characteristics: 'Sachs 3000 951' });
    // Its fit did not change, so the user's own "not on this vehicle" stands.
    expect((await part('cabin_filter')).notFitted).toBe(true);

    await call('PUT', `/api/vehicles/${car.id}`, { ...change, transmission: 'manual' });
    expect((await part('atf')).notFitted).toBe(true);
    expect((await part('clutch_fluid')).notFitted).toBe(false);
  });

  it('edits only the Part Spec of a Standard Part, and never deletes it', async () => {
    const bike = await createVehicle();
    const filter = (await snapshot()).partSpecs.find((p) => p.standardPart === 'moto_oil_filter')!;
    await call('PUT', `/api/part-specs/${filter.id}`, {
      name: 'Renamed',
      oemReference: '15410-MFJ-D01',
      partNumbers: 'HF204',
      unit: 'litre',
    });
    const chain = (await snapshot()).partSpecs.find((p) => p.vehicleId === bike.id && p.standardPart === 'moto_chain')!;
    await call('PUT', `/api/part-specs/${chain.id}`, { name: chain.name, unit: chain.unit, notFitted: true });
    const parts = (await snapshot()).partSpecs;
    expect(parts.find((p) => p.id === filter.id)).toMatchObject({
      name: 'moto_oil_filter',
      oemReference: '15410-MFJ-D01',
      partNumbers: 'HF204',
      unit: 'piece',
    });
    expect(parts.find((p) => p.id === chain.id)!.notFitted).toBe(true);
    expect((await call('DELETE', `/api/part-specs/${filter.id}`)).status).toBe(409);
  });

  it('gives a vehicle whose build was never filled in the parts every vehicle of its kind has', async () => {
    db.exec(`INSERT INTO vehicles (id, garage_id, kind, name) VALUES ('old', 'default', 'car', 'Old car')`);
    const later = createApp(db);
    const s = (await (await later.request('/api/snapshot')).json()) as Snapshot;
    const old = s.vehicles.find((v) => v.id === 'old')!;
    const expected = BUILT_IN_CATALOGUE.partsOf('car').filter((p) => BUILT_IN_CATALOGUE.fits(old as Build, p.code)).map((p) => p.code);
    expect(s.partSpecs.filter((p) => p.vehicleId === 'old').map((p) => p.standardPart)).toEqual(expected);
    // Details not filled in never match, so nothing that depends on them is listed.
    expect(expected).toEqual(expect.arrayContaining(['tires', 'brake_pads_front', 'engine_oil']));
    expect(expected).not.toContain('timing_belt_kit');
    expect(s.positions.filter((p) => p.vehicleId === 'old').map((p) => p.standardPart)).toEqual(expect.arrayContaining(['tires', 'oil_filter']));
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
    const rear = (await snapshot()).positions.find((p) => p.vehicleId === bike.id && p.standardPart === 'moto_tire_rear')!;
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

    await call('DELETE', `/api/part-specs/${tyre.id}`);
    expect((await snapshot()).services[0]!.partsUsed).toEqual([{ ...part, partSpecId: null }]);
  });

  it('fits a Part Used for a Standard Part at that part’s position when none was chosen', async () => {
    const bike = await createVehicle();
    const task = await createTask(bike.id);
    const s = await snapshot();
    const chainSpec = s.partSpecs.find((p) => p.vehicleId === bike.id && p.standardPart === 'moto_chain')!;
    const chain = s.positions.find((p) => p.vehicleId === bike.id && p.standardPart === 'moto_chain')!;
    await call('PUT', '/api/services/svc-00001', {
      id: 'svc-00001',
      vehicleId: bike.id,
      date: '2026-10-01',
      odometer: 18000,
      taskIds: [task.id],
      partsUsed: [{ partSpecId: chainSpec.id, positionId: null, description: 'DID 520 kit', quantity: 1, unit: 'piece' }],
    });
    expect((await snapshot()).services[0]!.partsUsed[0]).toMatchObject({ partSpecId: chainSpec.id, positionId: chain.id });
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

describe('technical inspections and modifications', () => {
  it('stores a vehicle’s first registration date', async () => {
    const res = await call('POST', '/api/vehicles', { ...CAR, name: 'Car', firstRegistration: '2011-03-04' });
    expect(await res.json()).toMatchObject({ firstRegistration: '2011-03-04' });
  });

  it('stores an inspection with its defects, closing one by a Service of the same vehicle only', async () => {
    const car = await createVehicle('Car');
    const other = await createVehicle('Other');
    const task = await createTask(car.id);
    const otherTask = await createTask(other.id);
    await call('PUT', '/api/services/svc-00001', {
      id: 'svc-00001',
      vehicleId: car.id,
      date: '2026-10-10',
      odometer: 1000,
      taskIds: [task.id],
    });
    await call('PUT', '/api/services/svc-00002', {
      id: 'svc-00002',
      vehicleId: other.id,
      date: '2026-10-10',
      odometer: 1,
      taskIds: [otherTask.id],
    });
    const body = {
      date: '2026-10-01',
      odometer: 990,
      centre: 'Centre Exemple',
      result: 'majorDefects',
      nextDueDate: null,
      defects: [
        { description: 'Worn front pads', severity: 'major', fixedServiceId: 'svc-00001' },
        { description: 'Number plate light', severity: 'minor', fixedServiceId: 'svc-00002' },
      ],
    };
    const res = await call('POST', `/api/vehicles/${car.id}/inspections`, body);
    expect(res.status).toBe(201);
    const saved = (await res.json()) as TechnicalInspection;
    expect(saved.defects.map((d) => d.fixedServiceId)).toEqual(['svc-00001', null]);

    await call('PUT', `/api/inspections/${saved.id}`, { ...body, result: 'passed', nextDueDate: '2028-10-01', defects: [] });
    expect((await snapshot()).inspections).toEqual([{ ...saved, result: 'passed', nextDueDate: '2028-10-01', notes: null, defects: [] }]);
  });

  it('stores Modifications, and keeps a position in use from being deleted', async () => {
    const bike = await createVehicle();
    // An older, free-named position: those of Standard Parts can never be deleted anyway.
    db.exec(`INSERT INTO fitment_positions (id, vehicle_id, name) VALUES ('exhaust', '${bike.id}', 'Exhaust')`);
    const position = { id: 'exhaust' };
    const body = {
      name: 'Slip-on exhaust',
      fittedDate: '2026-05-01',
      fittedOdometer: 12_000,
      positionId: position.id,
      declaredToInsurer: true,
    };
    const mod = (await (await call('POST', `/api/vehicles/${bike.id}/modifications`, body)).json()) as Modification;
    expect(mod).toMatchObject({ ...body, removedDate: null, notes: null });
    expect((await call('DELETE', `/api/positions/${position.id}`)).status).toBe(409);
    await call('PUT', `/api/modifications/${mod.id}`, { ...body, removedDate: '2026-09-01', declaredToInsurer: false });
    expect((await snapshot()).modifications[0]).toMatchObject({ removedDate: '2026-09-01', declaredToInsurer: false });
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

  it('attaches to a Policy, which belongs to no single Vehicle', async () => {
    const policy = (await (
      await call('POST', '/api/policies', { insurer: 'Assurance Exemple', startDate: '2025-04-01', driverIds: [] })
    ).json()) as InsurancePolicy;
    const res = await upload({ ownerKind: 'policy', ownerId: policy.id, type: 'claimsStatement' });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ vehicleId: null, ownerKind: 'policy', type: 'claimsStatement' });
    await call('DELETE', `/api/policies/${policy.id}`);
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

describe('insurance', () => {
  async function createPolicy(body: object = {}): Promise<InsurancePolicy> {
    const res = await call('POST', '/api/policies', { insurer: 'Assurance Exemple', startDate: '2025-04-01', driverIds: [], ...body });
    expect(res.status).toBe(201);
    return res.json();
  }

  it('keeps registration certificate facts on the Vehicle', async () => {
    const bike = await createVehicle();
    const res = await call('PUT', `/api/vehicles/${bike.id}`, {
      ...BIKE,
      name: 'Test bike',
      vin: 'VF1TESTVIN0000001',
      fiscalPower: 7,
      nationalType: 'MTT2',
      overnightParking: 'closedGarage',
    });
    expect(await res.json()).toMatchObject({
      vin: 'VF1TESTVIN0000001',
      fiscalPower: 7,
      nationalType: 'MTT2',
      overnightParking: 'closedGarage',
    });
  });

  it('records a Policy with its Drivers, Terms and one Cover per Vehicle', async () => {
    const car = await createVehicle('Car');
    const bike = await createVehicle('Bike');
    const driver = (await (await call('POST', '/api/drivers', { name: 'Test Driver', carLicenceDate: '2010-05-01' })).json()) as Driver;
    const policy = await createPolicy({ driverIds: [driver.id] });
    expect(policy).toMatchObject({ insurer: 'Assurance Exemple', driverIds: [driver.id], terms: [] });

    const termBody = {
      startDate: '2026-04-01',
      endDate: '2027-04-01',
      covers: [
        { vehicleId: car.id, level: 'comprehensive', excess: 300, premium: 620.5, crm: 0.5 },
        { vehicleId: bike.id, level: 'thirdParty', premium: 280, crm: 0.68, guarantees: 'Rider gear' },
      ],
    };
    const res = await call('POST', `/api/policies/${policy.id}/terms`, termBody);
    expect(res.status).toBe(201);
    const term = (await res.json()) as PolicyTerm;
    expect(term.covers.map((c) => [c.vehicleId, c.level, c.premium, c.crm])).toEqual([
      [car.id, 'comprehensive', 620.5, 0.5],
      [bike.id, 'thirdParty', 280, 0.68],
    ]);

    // Editing keeps each Vehicle's Cover id, so its Documents stay attached; dropping a Vehicle drops its Cover.
    const carCover = term.covers[0]!.id;
    const edited = (await (
      await call('PUT', `/api/terms/${term.id}`, { ...termBody, covers: [{ ...termBody.covers[0], premium: 600 }] })
    ).json()) as PolicyTerm;
    expect(edited.covers).toEqual([expect.objectContaining({ id: carCover, premium: 600 })]);
    expect((await snapshot()).policies[0]!.terms).toHaveLength(1);
  });

  it('refuses a Term that ends before it starts or covers a Vehicle twice', async () => {
    const car = await createVehicle('Car');
    const policy = await createPolicy();
    const covers = [{ vehicleId: car.id, level: 'thirdParty' }];
    expect(
      (await call('POST', `/api/policies/${policy.id}/terms`, { startDate: '2026-04-01', endDate: '2026-04-01', covers })).status,
    ).toBe(422);
    expect(
      (
        await call('POST', `/api/policies/${policy.id}/terms`, {
          startDate: '2026-04-01',
          endDate: '2027-04-01',
          covers: [...covers, ...covers],
        })
      ).status,
    ).toBe(422);
  });

  it('records Claims and Quotes, and deletes a Policy with its Terms and Claims', async () => {
    const car = await createVehicle('Car');
    const policy = await createPolicy();
    const claim = (await (
      await call('POST', `/api/policies/${policy.id}/claims`, {
        vehicleId: car.id,
        date: '2025-11-02',
        responsibility: 'notAtFault',
        amount: 850,
        description: 'Rear-ended at a junction',
      })
    ).json()) as Claim;
    expect(claim).toMatchObject({ policyId: policy.id, vehicleId: car.id, driverId: null, amount: 850 });
    await call('PUT', `/api/claims/${claim.id}`, { ...claim, responsibility: 'partlyAtFault' });
    expect((await snapshot()).claims[0]!.responsibility).toBe('partlyAtFault');

    const quote = (await (
      await call('POST', `/api/vehicles/${car.id}/quotes`, {
        insurer: 'Assurance Exemple',
        date: '2026-10-20',
        level: 'thirdParty',
        premium: 310,
      })
    ).json()) as Quote;
    expect(quote).toMatchObject({ vehicleId: car.id, premium: 310, validUntil: null });

    expect((await call('DELETE', `/api/policies/${policy.id}`)).status).toBe(204);
    const after = await snapshot();
    expect(after.policies).toEqual([]);
    expect(after.claims).toEqual([]);
    expect(after.quotes).toHaveLength(1);
  });

  it('keeps another Garage’s Policies and Drivers out of reach', async () => {
    db.prepare(`INSERT INTO garages (id, name) VALUES ('friend', 'Friend')`).run();
    const policy = await createPolicy();
    const friendApp = createApp(db, 'friend');
    expect((await (await friendApp.request('/api/snapshot')).json()).policies).toEqual([]);
    expect((await friendApp.request(`/api/policies/${policy.id}`, { method: 'DELETE' })).status).toBe(404);
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

describe('the parts catalogue in Settings', () => {
  const FUELS = ['petrol', 'flexfuel', 'hybrid', 'phev', 'diesel'];

  async function createCar(build: object = {}): Promise<Vehicle> {
    const res = await call('POST', '/api/vehicles', { ...CAR, name: 'Test car', ...build });
    expect(res.status).toBe(201);
    return res.json();
  }

  const specOf = async (vehicleId: string, code: string) =>
    (await snapshot()).partSpecs.find((p) => p.vehicleId === vehicleId && p.standardPart === code);
  const taskOf = async (vehicleId: string, code: string) =>
    (await snapshot()).tasks.find((t) => t.vehicleId === vehicleId && t.standardPart === code);
  const statusOf = async (vehicleId: string, code: string) => {
    const s = await snapshot();
    const task = s.tasks.find((t) => t.vehicleId === vehicleId && t.standardPart === code)!;
    return vehicleDue(s, vehicleId, '2026-11-01').due.find((d) => d.taskId === task.id)!.status;
  };

  it('applies changed conditions to existing vehicles right away, and goes back to the built-in version', async () => {
    const diesel = await createCar({ fuel: 'diesel' });
    expect(await specOf(diesel.id, 'spark_plugs')).toBeUndefined();

    expect((await call('PUT', '/api/catalogue/spark_plugs', { conditions: { fuel: FUELS } })).status).toBe(200);
    expect(await specOf(diesel.id, 'spark_plugs')).toMatchObject({ notFitted: false });
    expect((await taskOf(diesel.id, 'spark_plugs'))!.requiredParts).toHaveLength(1);
    // A new vehicle follows the changed conditions too.
    const other = await createCar({ fuel: 'diesel' });
    expect(await specOf(other.id, 'spark_plugs')).toBeDefined();

    expect((await call('DELETE', '/api/catalogue/spark_plugs')).status).toBe(204);
    expect((await snapshot()).catalogue).toEqual([]);
    expect(await specOf(diesel.id, 'spark_plugs')).toMatchObject({ notFitted: true });
    expect(await statusOf(diesel.id, 'spark_plugs')).toBe('paused');
  });

  it('takes a part off the list, keeping it on a vehicle where it was filled in', async () => {
    const empty = await createCar();
    const filled = await createCar();
    const spec = (await specOf(filled.id, 'wipers'))!;
    await call('PUT', `/api/part-specs/${spec.id}`, { name: spec.name, unit: spec.unit, characteristics: 'Bosch A 000' });

    expect((await call('PUT', '/api/catalogue/wipers', { conditions: {}, removed: true })).status).toBe(200);
    expect(await specOf(empty.id, 'wipers')).toMatchObject({ notFitted: true });
    expect(await statusOf(empty.id, 'wipers')).toBe('paused');
    expect(await specOf(filled.id, 'wipers')).toMatchObject({ notFitted: false, characteristics: 'Bosch A 000' });
    const later = await createCar();
    expect(await specOf(later.id, 'wipers')).toBeUndefined();

    await call('DELETE', '/api/catalogue/wipers');
    expect(await specOf(empty.id, 'wipers')).toMatchObject({ notFitted: false });
    expect(await statusOf(empty.id, 'wipers')).not.toBe('paused');
  });

  it('leaves the owner’s own “not on this vehicle” alone when a change does not alter whether the part fits', async () => {
    const car = await createCar();
    const spec = (await specOf(car.id, 'cabin_filter'))!;
    await call('PUT', `/api/part-specs/${spec.id}`, { name: spec.name, unit: spec.unit, notFitted: true });
    await call('PUT', '/api/catalogue/cabin_filter', { conditions: {}, characteristics: 'Pollen filter' });
    expect(await specOf(car.id, 'cabin_filter')).toMatchObject({ notFitted: true });
  });

  it('spreads default details where nothing else was written, without counting them as filled in', async () => {
    const empty = await createCar();
    const written = await createCar();
    const spec = (await specOf(written.id, 'engine_oil'))!;
    await call('PUT', `/api/part-specs/${spec.id}`, { name: spec.name, unit: spec.unit, characteristics: '0W-20' });

    const condition = { fuel: FUELS };
    await call('PUT', '/api/catalogue/engine_oil', { conditions: condition, characteristics: '5W-30' });
    expect((await specOf(empty.id, 'engine_oil'))!.characteristics).toBe('5W-30');
    expect((await specOf(written.id, 'engine_oil'))!.characteristics).toBe('0W-20');
    expect((await specOf((await createCar()).id, 'engine_oil'))!.characteristics).toBe('5W-30');

    await call('PUT', '/api/catalogue/engine_oil', { conditions: condition, characteristics: '5W-40' });
    expect((await specOf(empty.id, 'engine_oil'))!.characteristics).toBe('5W-40');
    expect((await specOf(written.id, 'engine_oil'))!.characteristics).toBe('0W-20');

    // The default alone does not keep the part on a vehicle it no longer fits.
    await call('PUT', `/api/vehicles/${empty.id}`, { ...CAR, name: 'Test car', fuel: 'electric' });
    expect(await specOf(empty.id, 'engine_oil')).toMatchObject({ notFitted: true });
  });

  it('adds a part of the owner’s to matching vehicles, with its position and Task, and renames it', async () => {
    const petrol = await createCar();
    const diesel = await createCar({ fuel: 'diesel' });
    const res = await call('POST', '/api/catalogue', {
      kind: 'car',
      name: 'Particle filter',
      nameFr: 'Filtre à particules',
      unit: 'piece',
      category: 'fuel_exhaust',
      intervalKm: 150000,
      conditions: { fuel: ['diesel'] },
      characteristics: 'Original type',
    });
    expect(res.status).toBe(201);
    const { code } = (await res.json()) as { code: string };
    expect(code).toMatch(/^own_/);

    expect(await specOf(petrol.id, code)).toBeUndefined();
    expect(await specOf(diesel.id, code)).toMatchObject({ name: 'Particle filter', nameFr: 'Filtre à particules', characteristics: 'Original type', unit: 'piece' });
    expect((await snapshot()).positions.find((p) => p.vehicleId === diesel.id && p.standardPart === code)).toBeDefined();
    expect(await taskOf(diesel.id, code)).toMatchObject({ name: 'Particle filter', nameFr: 'Filtre à particules', intervalKm: 150000 });

    const body = { kind: 'car', name: 'DPF', unit: 'piece', category: 'fuel_exhaust', intervalKm: 100000, conditions: { fuel: ['diesel'] } };
    expect((await call('PUT', `/api/catalogue/${code}`, body)).status).toBe(200);
    expect(await specOf(diesel.id, code)).toMatchObject({ name: 'DPF' });
    // The Task's Interval was never set by the owner, so it follows; its name follows too.
    expect(await taskOf(diesel.id, code)).toMatchObject({ name: 'DPF', intervalKm: 100000 });
  });

  it('deletes a part of the owner’s: what was never used goes, what was used stays under its name', async () => {
    const unused = await createCar();
    const used = await createCar();
    const res = await call('POST', '/api/catalogue', { kind: 'car', name: 'Roof rack', unit: 'piece', category: 'body', intervalMonths: 60, conditions: {} });
    const { code } = (await res.json()) as { code: string };
    const usedSpec = (await specOf(used.id, code))!;
    const usedTask = (await taskOf(used.id, code))!;
    const position = (await snapshot()).positions.find((p) => p.vehicleId === used.id && p.standardPart === code)!;
    await call('PUT', '/api/services/svc-00003', {
      id: 'svc-00003',
      vehicleId: used.id,
      date: '2026-10-01',
      taskIds: [usedTask.id],
      partsUsed: [{ partSpecId: usedSpec.id, positionId: position.id, description: 'Thule', quantity: 1, unit: 'piece' }],
    });

    expect((await call('DELETE', `/api/catalogue/${code}`)).status).toBe(204);
    const s = await snapshot();
    expect(s.partSpecs.some((p) => p.vehicleId === unused.id && p.name === 'Roof rack')).toBe(false);
    expect(s.tasks.some((t) => t.vehicleId === unused.id && t.name === 'Roof rack')).toBe(false);
    expect(s.partSpecs.find((p) => p.id === usedSpec.id)).toMatchObject({ standardPart: null, name: 'Roof rack', notFitted: false });
    expect(s.tasks.find((t) => t.id === usedTask.id)).toMatchObject({ standardPart: null, category: 'body' });
    expect(s.positions.find((p) => p.id === position.id)).toMatchObject({ standardPart: null, name: 'Roof rack' });
  });

  it('refuses a detail with nothing ticked and an unknown part, and keeps a part set as built in as no change', async () => {
    expect((await call('PUT', '/api/catalogue/wipers', { conditions: { fuel: [] } })).status).toBe(422);
    expect((await call('PUT', '/api/catalogue/wipers', { conditions: { fuel: ['steam'] } })).status).toBe(422);
    expect((await call('PUT', '/api/catalogue/nothing', { conditions: {} })).status).toBe(404);
    expect((await call('DELETE', '/api/catalogue/nothing')).status).toBe(404);
    expect((await call('POST', '/api/catalogue', { kind: 'car', name: 'X', unit: 'piece', category: 'body', conditions: {} })).status).toBe(422);
    expect((await call('PUT', '/api/catalogue/timing_belt_kit', { conditions: { distribution: ['belt'] } })).status).toBe(200);
    expect((await snapshot()).catalogue).toEqual([]);
  });

  it('keeps one Garage’s catalogue from another’s', async () => {
    await call('PUT', '/api/catalogue/wipers', { conditions: {}, removed: true });
    db.exec(`INSERT INTO garages (id, name) VALUES ('other', 'Other')`);
    const other = createApp(db, 'other');
    expect(((await (await other.request('/api/snapshot')).json()) as Snapshot).catalogue).toEqual([]);
  });

  it('keeps the changes when the server starts again', async () => {
    const car = await createCar();
    await call('PUT', '/api/catalogue/wipers', { conditions: {}, removed: true });
    const later = createApp(db);
    const s = (await (await later.request('/api/snapshot')).json()) as Snapshot;
    expect(s.catalogue).toMatchObject([{ code: 'wipers', own: null, removed: true }]);
    expect(s.partSpecs.find((p) => p.vehicleId === car.id && p.standardPart === 'wipers')).toMatchObject({ notFitted: true });
  });
});

describe('the maintenance task list in Settings', () => {
  const FUELS = ['petrol', 'flexfuel', 'hybrid', 'phev', 'diesel'];

  async function createCar(build: object = {}): Promise<Vehicle> {
    const res = await call('POST', '/api/vehicles', { ...CAR, name: 'Test car', ...build });
    expect(res.status).toBe(201);
    return res.json();
  }
  async function createBike(build: object = {}): Promise<Vehicle> {
    const res = await call('POST', '/api/vehicles', { ...BIKE, name: 'Test bike', ...build });
    expect(res.status).toBe(201);
    return res.json();
  }

  const taskOf = async (vehicleId: string, code: string) =>
    (await snapshot()).tasks.find((t) => t.vehicleId === vehicleId && t.standardPart === code);
  const statusOf = async (vehicleId: string, code: string) => {
    const s = await snapshot();
    const task = s.tasks.find((t) => t.vehicleId === vehicleId && t.standardPart === code)!;
    return vehicleDue(s, vehicleId, '2026-11-01').due.find((d) => d.taskId === task.id)!.status;
  };

  it('changes a built-in task’s Interval on every vehicle that kept the built-in one, and goes back to the built-in version', async () => {
    const followed = await createCar();
    const own = await createCar();
    const ownTask = (await taskOf(own.id, 'cabin_filter'))!;
    await call('PUT', `/api/tasks/${ownTask.id}`, { name: ownTask.name, intervalKm: 9000, intervalMonths: 6, standardPart: 'cabin_filter' });

    const res = await call('PUT', '/api/catalogue/cabin_filter', { conditions: {}, intervalKm: 20000, intervalMonths: 18 });
    expect(res.status).toBe(200);
    expect(await taskOf(followed.id, 'cabin_filter')).toMatchObject({ intervalKm: 20000, intervalMonths: 18 });
    // The owner’s own Interval on a vehicle stays.
    expect(await taskOf(own.id, 'cabin_filter')).toMatchObject({ intervalKm: 9000, intervalMonths: 6 });
    // A new vehicle starts with the changed one.
    expect(await taskOf((await createCar()).id, 'cabin_filter')).toMatchObject({ intervalKm: 20000, intervalMonths: 18 });
    expect((await snapshot()).catalogue).toMatchObject([{ code: 'cabin_filter', interval: { intervalKm: 20000, intervalMonths: 18 } }]);

    expect((await call('DELETE', '/api/catalogue/cabin_filter')).status).toBe(204);
    expect(await taskOf(followed.id, 'cabin_filter')).toMatchObject({ intervalKm: 15000, intervalMonths: 12 });
    expect((await snapshot()).catalogue).toEqual([]);
  });

  it('gives a distance only, or a duration only, and refuses neither', async () => {
    await call('PUT', '/api/catalogue/cabin_filter', { conditions: {}, intervalKm: null, intervalMonths: 24 });
    expect((await taskOf((await createCar()).id, 'cabin_filter'))).toMatchObject({ intervalKm: null, intervalMonths: 24 });
    expect((await call('PUT', '/api/catalogue/cabin_filter', { conditions: {}, intervalKm: null, intervalMonths: null })).status).toBe(422);
  });

  it('applies the first Interval rule a build matches, else the default', async () => {
    const petrol = await createCar();
    const diesel = await createCar({ fuel: 'diesel' });
    const turbo = await createCar({ hasTurbo: true });
    // The built-in rule: a turbo shortens the engine oil's distance.
    expect(await taskOf(petrol.id, 'engine_oil')).toMatchObject({ intervalKm: 15000 });
    expect(await taskOf(turbo.id, 'engine_oil')).toMatchObject({ intervalKm: 10000 });
    expect(BUILT_IN_CATALOGUE.known('engine_oil')!.rules).toMatchObject([{ conditions: { hasTurbo: ['true'] }, intervalKm: 10000 }]);

    const rules = [
      { conditions: { fuel: ['diesel'] }, intervalKm: 12000, intervalMonths: 12 },
      { conditions: { hasTurbo: ['true'] }, intervalKm: 9000, intervalMonths: 12 },
    ];
    expect((await call('PUT', '/api/catalogue/engine_oil', { conditions: { fuel: FUELS }, rules })).status).toBe(200);
    expect(await taskOf(diesel.id, 'engine_oil')).toMatchObject({ intervalKm: 12000 });
    expect(await taskOf(turbo.id, 'engine_oil')).toMatchObject({ intervalKm: 9000 });
    expect(await taskOf(petrol.id, 'engine_oil')).toMatchObject({ intervalKm: 15000 });

    // Taking the rules away, the turbo included, leaves the default for everyone.
    await call('PUT', '/api/catalogue/engine_oil', { conditions: { fuel: FUELS }, rules: [] });
    expect(await taskOf(turbo.id, 'engine_oil')).toMatchObject({ intervalKm: 15000 });
    // A change that leaves the rules out keeps the ones the owner set.
    await call('PUT', '/api/catalogue/engine_oil', { conditions: { fuel: FUELS }, characteristics: '5W-30' });
    expect(await taskOf(turbo.id, 'engine_oil')).toMatchObject({ intervalKm: 15000 });
    await call('DELETE', '/api/catalogue/engine_oil');
    expect(await taskOf(turbo.id, 'engine_oil')).toMatchObject({ intervalKm: 10000 });
    expect((await snapshot()).catalogue).toEqual([]);
  });

  it('refuses a rule without a condition or without an Interval', async () => {
    const noCondition = [{ conditions: {}, intervalKm: 5000, intervalMonths: null }];
    const noInterval = [{ conditions: { fuel: ['diesel'] }, intervalKm: null, intervalMonths: null }];
    // Every value ticked says nothing: it would only repeat the default.
    const everything = [{ conditions: { fuel: FUELS.concat('electric') }, intervalKm: 5000, intervalMonths: null }];
    for (const rules of [noCondition, noInterval, everything]) {
      expect((await call('PUT', '/api/catalogue/cabin_filter', { conditions: {}, rules })).status).toBe(422);
    }
  });

  it('adds a check of the owner’s to matching vehicles as a Task with no part, and pauses it when the build no longer matches', async () => {
    const chain = await createBike();
    const belt = await createBike({ finalDrive: 'belt' });
    const res = await call('POST', '/api/catalogue', {
      kind: 'motorcycle',
      name: 'Chain lubrication',
      nameFr: 'Graissage de la chaîne',
      category: 'drivetrain',
      intervalKm: 1000,
      conditions: { finalDrive: ['chain'] },
    });
    expect(res.status).toBe(201);
    const { code } = (await res.json()) as { code: string };

    const s = await snapshot();
    expect(await taskOf(chain.id, code)).toMatchObject({ name: 'Chain lubrication', nameFr: 'Graissage de la chaîne', intervalKm: 1000, requiredParts: [] });
    expect(await taskOf(belt.id, code)).toBeUndefined();
    // A check has no Part Spec and no Fitment Position.
    expect(s.partSpecs.some((p) => p.standardPart === code)).toBe(false);
    expect(s.positions.some((p) => p.standardPart === code)).toBe(false);
    expect(await statusOf(chain.id, code)).not.toBe('paused');

    // The build changes: the check stays, paused; changed back, it is due again.
    await call('PUT', `/api/vehicles/${chain.id}`, { ...BIKE, name: 'Test bike', finalDrive: 'belt' });
    expect(await taskOf(chain.id, code)).toBeDefined();
    expect(await statusOf(chain.id, code)).toBe('paused');
    await call('PUT', `/api/vehicles/${chain.id}`, { ...BIKE, name: 'Test bike' });
    expect(await statusOf(chain.id, code)).not.toBe('paused');
  });

  it('switches a check off on one vehicle, and keeps the other vehicles’', async () => {
    const one = await createBike();
    const other = await createBike();
    const { code } = (await (
      await call('POST', '/api/catalogue', { kind: 'motorcycle', name: 'Valve clearance', category: 'engine', intervalKm: 24000, conditions: {} })
    ).json()) as { code: string };
    const task = (await taskOf(one.id, code))!;
    // The Task is the vehicle’s only one for the check, so it cannot be deleted: it is switched off instead.
    expect((await call('DELETE', `/api/tasks/${task.id}`)).status).toBe(409);
    const body = { name: task.name, intervalKm: 24000, standardPart: code, switchedOff: true };
    expect((await call('PUT', `/api/tasks/${task.id}`, body)).status).toBe(200);
    expect(await statusOf(one.id, code)).toBe('paused');
    expect(await statusOf(other.id, code)).not.toBe('paused');
    // A change in the list does not bring it back.
    await call('PUT', `/api/catalogue/${code}`, { kind: 'motorcycle', name: 'Valve clearance check', category: 'engine', intervalKm: 20000, conditions: {} });
    expect(await statusOf(one.id, code)).toBe('paused');
    expect(await taskOf(other.id, code)).toMatchObject({ name: 'Valve clearance check', intervalKm: 20000 });
  });

  it('does not turn a check into a part or a part into a check', async () => {
    const check = (await (await call('POST', '/api/catalogue', { kind: 'car', name: 'Alignment', category: 'tires_suspension', intervalMonths: 24, conditions: {} })).json()) as { code: string };
    const part = (await (await call('POST', '/api/catalogue', { kind: 'car', name: 'Roof rack', unit: 'piece', category: 'body', intervalMonths: 60, conditions: {} })).json()) as { code: string };
    const body = { kind: 'car', name: 'X', category: 'body', intervalMonths: 12, conditions: {} };
    expect((await call('PUT', `/api/catalogue/${check.code}`, { ...body, unit: 'piece' })).status).toBe(422);
    expect((await call('PUT', `/api/catalogue/${part.code}`, body)).status).toBe(422);
    expect((await call('PUT', `/api/catalogue/${part.code}`, { ...body, unit: 'litre' })).status).toBe(200);
  });

  it('deletes a check: a Task with no history goes, one used in a Service stays under its name', async () => {
    const unused = await createBike();
    const used = await createBike();
    const { code } = (await (
      await call('POST', '/api/catalogue', { kind: 'motorcycle', name: 'Fork check', category: 'tires_suspension', intervalMonths: 12, conditions: {} })
    ).json()) as { code: string };
    const usedTask = (await taskOf(used.id, code))!;
    await call('PUT', '/api/services/svc-00004', { id: 'svc-00004', vehicleId: used.id, date: '2026-10-01', odometer: 1000, taskIds: [usedTask.id], partsUsed: [] });

    expect((await call('DELETE', `/api/catalogue/${code}`)).status).toBe(204);
    const s = await snapshot();
    expect(s.tasks.some((t) => t.vehicleId === unused.id && t.name === 'Fork check')).toBe(false);
    expect(s.tasks.find((t) => t.id === usedTask.id)).toMatchObject({ standardPart: null, category: 'tires_suspension' });
  });

  it('applies a new or changed check to vehicles added earlier, the sold ones excepted', async () => {
    const earlier = await createBike();
    const sold = await createBike();
    await call('POST', `/api/vehicles/${sold.id}/sell`, { date: '2026-10-01' });
    const { code } = (await (
      await call('POST', '/api/catalogue', { kind: 'motorcycle', name: 'Brake check', category: 'brakes', intervalMonths: 6, conditions: {} })
    ).json()) as { code: string };
    expect(await taskOf(earlier.id, code)).toMatchObject({ intervalMonths: 6 });
    expect(await taskOf(sold.id, code)).toBeUndefined();
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
    // A database as the first release left it: schema version 1, without the Official Interval or workshop data.
    const old = openDatabase(path, undefined, 1);
    old.exec(`INSERT INTO vehicles (id, garage_id, kind, name) VALUES ('v1', 'default', 'car', 'Old car')`);
    old.exec(`INSERT INTO maintenance_tasks (id, vehicle_id, name, interval_km) VALUES ('t1', 'v1', 'Oil', 10000)`);
    old.close();

    const migrated = openDatabase(path, join(dir, 'backups'));
    const backups = readdirSync(join(dir, 'backups'));
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/^garage-v1-.*\.sqlite$/);
    const task = migrated.prepare('SELECT * FROM maintenance_tasks').get() as Record<string, unknown>;
    expect(task).toMatchObject({ id: 't1', interval_km: 10000, official_interval_km: null });
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

  it('moves Standard Parts to the parts catalogue, keeping what was filled in or used', async () => {
    const path = join(dir, 'garage.sqlite');
    const old = openDatabase(path, undefined, 11);
    old.exec(`INSERT INTO vehicles (id, garage_id, kind, name, fuel, gearbox, timing) VALUES ('v1', 'default', 'car', 'Old car', 'diesel', 'manual', 'belt')`);
    old.exec(`INSERT INTO part_specs (id, vehicle_id, standard_part, name, unit, characteristics) VALUES
      ('oil', 'v1', 'engineOil', 'engineOil', 'litre', '5W-30'),
      ('glow', 'v1', 'glowPlugs', 'glowPlugs', 'piece', 'Bosch 0 250 000 000'),
      ('chain', 'v1', 'timingChainKit', 'timingChainKit', 'piece', NULL),
      ('tyres', 'v1', 'frontTyres', 'frontTyres', 'piece', NULL),
      ('plugs', 'v1', 'sparkPlugs', 'sparkPlugs', 'piece', NULL)`);
    old.exec(`INSERT INTO fitment_positions (id, vehicle_id, name, standard_part) VALUES
      ('front', 'v1', 'frontTyres', 'frontTyres'), ('rear', 'v1', 'rearTyres', 'rearTyres'), ('belt', 'v1', 'timingChainKit', 'timingChainKit')`);
    old.exec(`INSERT INTO modifications (id, vehicle_id, name, fitted_date, position_id) VALUES ('m1', 'v1', 'Wider tyres', '2025-01-01', 'rear')`);
    old.close();

    const migrated = openDatabase(path);
    const later = createApp(migrated);
    const s = (await (await later.request('/api/snapshot')).json()) as Snapshot;
    expect(s.vehicles[0]).toMatchObject({ fuel: 'diesel', transmission: 'manual', distribution: 'belt', drivetrain: null });
    const spec = (id: string) => s.partSpecs.find((p) => p.id === id);
    expect(spec('oil')).toMatchObject({ standardPart: 'engine_oil', characteristics: '5W-30', notFitted: false });
    expect(spec('tyres')).toMatchObject({ standardPart: 'tires' });
    // No equivalent among the parts to replace: kept under its own name when filled in, dropped when empty.
    expect(spec('glow')).toMatchObject({ standardPart: null, name: 'Glow plugs', nameFr: 'Bougies de préchauffage', characteristics: 'Bosch 0 250 000 000' });
    expect(spec('chain')).toBeUndefined();
    // A petrol part on a diesel is set aside.
    expect(spec('plugs')).toMatchObject({ standardPart: 'spark_plugs', notFitted: true });
    const position = (id: string) => s.positions.find((p) => p.id === id);
    expect(position('front')).toMatchObject({ standardPart: 'tires' });
    expect(position('rear')).toMatchObject({ standardPart: null, name: 'Rear tyres' });
    expect(position('belt')).toBeUndefined();
    expect(migrated.prepare('SELECT COUNT(*) AS n FROM part_catalogue_moves').get()).toEqual({ n: 0 });
    migrated.close();
  });

  it('keeps Required Parts and leaves Tasks unlinked when Tasks get their part', () => {
    const path = join(dir, 'garage.sqlite');
    const old = openDatabase(path, undefined, 12);
    old.exec(`INSERT INTO vehicles (id, garage_id, kind, name) VALUES ('v1', 'default', 'car', 'Old car')`);
    old.exec(`INSERT INTO maintenance_tasks (id, vehicle_id, name, interval_km) VALUES ('t1', 'v1', 'Oil', 10000)`);
    old.exec(`INSERT INTO part_specs (id, vehicle_id, name, unit) VALUES ('p1', 'v1', 'Oil', 'litre')`);
    old.exec(`INSERT INTO required_parts (task_id, part_spec_id, quantity, sort) VALUES ('t1', 'p1', 4.5, 0)`);
    old.close();
    const migrated = openDatabase(path);
    expect(migrated.prepare('SELECT standard_part FROM maintenance_tasks').get()).toEqual({ standard_part: null });
    expect(migrated.prepare('SELECT task_id, part_spec_id, quantity FROM required_parts').all()).toEqual([
      { task_id: 't1', part_spec_id: 'p1', quantity: 4.5 },
    ]);
    migrated.close();
  });

  it('puts owned vehicles on their schedule, adopting Tasks named like schedule Tasks, and sold ones once owned again', async () => {
    const path = join(dir, 'garage.sqlite');
    const old = openDatabase(path, undefined, 13);
    const build = `'Exemple', 'Test', 'petrol', 'manual', 'fwd', 'chain'`;
    old.exec(`INSERT INTO vehicles (id, garage_id, kind, name, make, model, fuel, transmission, drivetrain, distribution) VALUES
      ('car', 'default', 'car', 'Old car', ${build})`);
    old.exec(`INSERT INTO vehicles (id, garage_id, kind, name, make, model, fuel, transmission, drivetrain, distribution, status) VALUES
      ('sold', 'default', 'car', 'Sold car', ${build}, 'sold')`);
    old.exec(`INSERT INTO maintenance_tasks (id, vehicle_id, name, interval_km, interval_months) VALUES
      ('oil', 'car', '  huile MOTEUR et filtre ', 6000, 12), ('own', 'car', 'Vidange boîte', 60000, NULL), ('sold-oil', 'sold', 'Engine oil and filter', 15000, 12)`);
    old.exec(`INSERT INTO services (id, vehicle_id, date, odometer) VALUES ('s1', 'car', '2026-01-10', 20000)`);
    old.exec(`INSERT INTO service_tasks (service_id, task_id) VALUES ('s1', 'oil')`);
    old.close();

    const migrated = openDatabase(path);
    const later = createApp(migrated);
    const tasks = async (vehicleId: string) =>
      ((await (await later.request('/api/snapshot')).json()) as Snapshot).tasks.filter((t) => t.vehicleId === vehicleId);
    const car = await tasks('car');
    // The owner's oil Task became the schedule's, keeping its own Interval and history; no second oil Task.
    expect(car.filter((t) => t.standardPart === 'engine_oil').map((t) => [t.id, t.intervalKm])).toEqual([['oil', 6000]]);
    expect(car.find((t) => t.id === 'own')!.standardPart).toBeNull();
    expect(car.find((t) => t.standardPart === 'clutch_kit')).toBeDefined();
    expect(await tasks('sold')).toHaveLength(1);
    await later.request('/api/vehicles/sold/unsell', { method: 'POST' });
    expect((await tasks('sold')).filter((t) => t.standardPart === 'engine_oil').map((t) => t.id)).toEqual(['sold-oil']);
    expect(migrated.prepare('SELECT COUNT(*) AS n FROM schedule_moves').get()).toEqual({ n: 0 });
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

  it('adds interval rules and switched-off tasks without touching what is kept', () => {
    const path = join(dir, 'garage.sqlite');
    const old = openDatabase(path, undefined, 18);
    old.exec(`INSERT INTO vehicles (id, garage_id, kind, name) VALUES ('v1', 'default', 'car', 'Old car')`);
    old.exec(`INSERT INTO maintenance_tasks (id, vehicle_id, name, interval_km) VALUES ('t1', 'v1', 'Oil', 10000)`);
    old.exec(`INSERT INTO catalogue_parts (garage_id, code, conditions, removed) VALUES ('default', 'wipers', '{}', 1)`);
    old.close();
    const migrated = openDatabase(path);
    expect(migrated.prepare('SELECT switched_off FROM maintenance_tasks').all()).toEqual([{ switched_off: 0 }]);
    expect(migrated.prepare('SELECT code, removed, interval_set, interval_rules FROM catalogue_parts').all()).toEqual([
      { code: 'wipers', removed: 1, interval_set: 0, interval_rules: null },
    ]);
    migrated.close();
  });
});
