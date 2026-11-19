import { describe, expect, it } from 'vitest';
import type {
  Vehicle,
} from '../shared/types.ts';
import { app, call, BIKE, createVehicle, createTask, snapshot, setupGarage } from './test-helpers.ts';

setupGarage();

describe('vehicles and tasks', () => {
  it('creates a vehicle with tasks and returns them in the snapshot', async () => {
    const bike = await createVehicle();
    await createTask(bike.id);
    const s = await snapshot();
    expect(s.vehicles).toHaveLength(1);
    expect(s.vehicles[0]).toMatchObject({ kind: 'motorcycle', name: 'Test bike', ownership: 'owned' });
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
    expect(await res.json()).toMatchObject({ ownership: 'sold', soldDate: '2028-05-01', soldOdometer: 40000, soldPrice: 4500 });
  });

  it('shows a vehicle on the garage page until sold, unless the user chooses otherwise', async () => {
    const bike = await createVehicle();
    expect(bike.onGaragePage).toBe(true);
    const sold = (await (await call('POST', `/api/vehicles/${bike.id}/sell`, { date: '2028-05-01' })).json()) as Vehicle;
    expect(sold.onGaragePage).toBe(false);
    const shown = await call('PUT', `/api/vehicles/${bike.id}/garage-page`, { shown: true });
    expect(await shown.json()).toMatchObject({ ownership: 'sold', onGaragePage: true });
    // Editing the vehicle's details keeps the choice.
    await call('PUT', `/api/vehicles/${bike.id}`, { ...BIKE, name: 'Renamed' });
    expect((await snapshot()).vehicles[0]).toMatchObject({ name: 'Renamed', onGaragePage: true });
    await call('PUT', `/api/vehicles/${bike.id}/garage-page`, { shown: false });
    const back = (await (await call('POST', `/api/vehicles/${bike.id}/unsell`)).json()) as Vehicle;
    expect(back).toMatchObject({ ownership: 'owned', onGaragePage: true });
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
