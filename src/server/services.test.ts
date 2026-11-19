import { describe, expect, it } from 'vitest';
import type {
  Snapshot,
  Vehicle,
} from '../shared/types.ts';
import { createApp } from './app.ts';
import { db, call, createVehicle, createTask, snapshot, setupGarage } from './test-helpers.ts';

setupGarage();

describe('services and readings (replayed by the offline send queue)', () => {
  it('is idempotent: replaying the same PUT stores one Service', async () => {
    const bike = await createVehicle();
    const task = await createTask(bike.id);
    const body = { id: 'svc-00001', vehicleId: bike.id, date: '2026-10-01', odometer: 18000, taskIds: [task.id], notes: 'Motul 7100' };
    expect((await call('PUT', '/api/services/svc-00001', body)).status).toBe(200);
    expect((await call('PUT', '/api/services/svc-00001', body)).status).toBe(200);
    const s = await snapshot();
    expect(s.services).toEqual([{ ...body, kind: 'maintenance', title: null, category: null, performedBy: 'diy', totalCost: null, componentsUsed: [] }]);
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

  it('answers 409 when the Service id belongs to another Vehicle', async () => {
    const a = await createVehicle('A');
    const b = await createVehicle('B');
    const taskA = await createTask(a.id);
    const taskB = await createTask(b.id);
    const body = { id: 'svc-00001', date: '2026-10-01', odometer: 1 };
    expect((await call('PUT', '/api/services/svc-00001', { ...body, vehicleId: a.id, taskIds: [taskA.id] })).status).toBe(200);
    expect((await call('PUT', '/api/services/svc-00001', { ...body, vehicleId: b.id, taskIds: [taskB.id] })).status).toBe(409);
  });

  it('answers 422 when a Task that counts distance is ticked without an odometer', async () => {
    const bike = await createVehicle();
    const task = await createTask(bike.id, { name: 'Chain', intervalKm: 10000 });
    const res = await call('PUT', '/api/services/svc-00001', { id: 'svc-00001', vehicleId: bike.id, date: '2026-10-01', taskIds: [task.id] });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'odometer: The odometer is needed when a ticked Task counts distance' });
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

describe('fuel log (replayed by the offline send queue)', () => {
  const fillupBody = (vehicleId: string, overrides: object = {}) => ({
    id: 'fill-00001',
    vehicleId,
    date: '2026-10-20',
    odometer: 18_500,
    litres: 42.1,
    totalPaid: 71.2,
    fullTank: true,
    notes: null,
    ...overrides,
  });

  it('creates a Fill-up, and replaying the same id updates the one row', async () => {
    const bike = await createVehicle();
    const body = fillupBody(bike.id);
    expect((await call('PUT', '/api/fillups/fill-00001', body)).status).toBe(200);
    expect((await snapshot()).fillups).toEqual([body]);
    await call('PUT', '/api/fillups/fill-00001', body);
    expect((await snapshot()).fillups).toHaveLength(1);
    const changed = fillupBody(bike.id, { litres: 40, totalPaid: 68, fullTank: false, odometer: null, notes: 'Motorway' });
    expect((await call('PUT', '/api/fillups/fill-00001', changed)).status).toBe(200);
    expect((await snapshot()).fillups).toEqual([changed]);
  });

  it('refuses figures that look like typos', async () => {
    const bike = await createVehicle();
    for (const overrides of [{ litres: 0 }, { litres: 500, totalPaid: 800 }, { litres: 40, totalPaid: 2000 }, { date: '20/10/2026' }]) {
      expect((await call('PUT', '/api/fillups/fill-00001', fillupBody(bike.id, overrides))).status).toBe(422);
    }
    expect((await snapshot()).fillups).toEqual([]);
  });

  it('says what is wrong with the price per litre', async () => {
    const bike = await createVehicle();
    const res = await call('PUT', '/api/fillups/fill-00001', fillupBody(bike.id, { litres: 40, totalPaid: 2000 }));
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toContain('price per litre');
  });

  it('refuses an id that does not match the address', async () => {
    const bike = await createVehicle();
    expect((await call('PUT', '/api/fillups/fill-00002', fillupBody(bike.id))).status).toBe(400);
  });

  it('returns 404 for an unknown vehicle', async () => {
    expect((await call('PUT', '/api/fillups/fill-00001', fillupBody('nope'))).status).toBe(404);
  });

  it('refuses an id that belongs to another Vehicle', async () => {
    const first = await createVehicle('First');
    const second = await createVehicle('Second');
    await call('PUT', '/api/fillups/fill-00001', fillupBody(first.id));
    expect((await call('PUT', '/api/fillups/fill-00001', fillupBody(second.id))).status).toBe(409);
  });

  it('deletes a Fill-up, then says it is gone', async () => {
    const bike = await createVehicle();
    await call('PUT', '/api/fillups/fill-00001', fillupBody(bike.id));
    expect((await call('DELETE', '/api/fillups/fill-00001')).status).toBe(204);
    expect((await snapshot()).fillups).toEqual([]);
    expect((await call('DELETE', '/api/fillups/fill-00001')).status).toBe(404);
  });

  it('never shows or deletes another Garage Fill-ups', async () => {
    db.prepare(`INSERT INTO garages (id, name) VALUES ('friend', 'Friend')`).run();
    const friendApp = createApp(db, 'friend');
    const bike = await createVehicle('Mine');
    await call('PUT', '/api/fillups/fill-00001', fillupBody(bike.id));
    expect(((await (await friendApp.request('/api/snapshot')).json()) as Snapshot).fillups).toEqual([]);
    expect((await friendApp.request('/api/fillups/fill-00001', { method: 'DELETE' })).status).toBe(404);
    expect((await snapshot()).fillups).toHaveLength(1);
  });
});
