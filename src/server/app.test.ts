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
import { STANDARD_PARTS } from '../shared/catalogue.ts';
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
    expect(s.partSpecs.find((p) => p.standardPart === null)).toMatchObject({
      name: 'Engine oil',
      characteristics: '10W-40 JASO MA2',
      partNumbers: null,
      unit: 'litre',
    });
    expect(s.positions[0]).toMatchObject({ name: 'Rear tyre' });
  });

  it('lists the Standard Parts of its kind on every vehicle', async () => {
    const bike = await createVehicle();
    const car = (await (await call('POST', '/api/vehicles', { kind: 'car', name: 'Test car' })).json()) as Vehicle;
    const parts = (await snapshot()).partSpecs;
    const of = (v: Vehicle) => parts.filter((p) => p.vehicleId === v.id).map((p) => p.standardPart);
    expect(of(bike)).toEqual(STANDARD_PARTS.motorcycle.map(([key]) => key));
    expect(of(car)).toEqual(expect.arrayContaining(['timingBeltKit', 'timingChainKit', 'cabinFilter']));
    expect(parts.find((p) => p.vehicleId === bike.id && p.standardPart === 'engineOil')).toMatchObject({ unit: 'litre', notFitted: false });
  });

  it('edits only the Part Spec of a Standard Part, and never deletes it', async () => {
    const bike = await createVehicle();
    const filter = (await snapshot()).partSpecs.find((p) => p.standardPart === 'oilFilter')!;
    await call('PUT', `/api/part-specs/${filter.id}`, { name: 'Renamed', partNumbers: 'HF204', unit: 'litre' });
    const chain = (await snapshot()).partSpecs.find((p) => p.vehicleId === bike.id && p.standardPart === 'chainKit')!;
    await call('PUT', `/api/part-specs/${chain.id}`, { name: chain.name, unit: chain.unit, notFitted: true });
    const parts = (await snapshot()).partSpecs;
    expect(parts.find((p) => p.id === filter.id)).toMatchObject({ name: 'oilFilter', partNumbers: 'HF204', unit: 'piece' });
    expect(parts.find((p) => p.id === chain.id)!.notFitted).toBe(true);
    expect((await call('DELETE', `/api/part-specs/${filter.id}`)).status).toBe(409);
  });

  it('adds the Standard Parts to vehicles created before they existed', async () => {
    db.exec(`INSERT INTO vehicles (id, garage_id, kind, name) VALUES ('old', 'default', 'car', 'Old car')`);
    const later = createApp(db);
    const parts = (await (await later.request('/api/snapshot')).json()) as Snapshot;
    expect(parts.partSpecs.filter((p) => p.vehicleId === 'old')).toHaveLength(STANDARD_PARTS.car.length);
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

describe('technical inspections and modifications', () => {
  it('stores a vehicle’s first registration date', async () => {
    const res = await call('POST', '/api/vehicles', { kind: 'car', name: 'Car', firstRegistration: '2011-03-04' });
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
    const position = (await (await call('POST', `/api/vehicles/${bike.id}/positions`, { name: 'Exhaust' })).json()) as FitmentPosition;
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
      kind: 'motorcycle',
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
});
