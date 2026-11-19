import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  GarageDocument,
  Vehicle,
} from '../shared/types.ts';
import { createApp } from './app.ts';
import { db, app, call, createVehicle, createTask, snapshot, setApp, setupGarage } from './test-helpers.ts';

setupGarage();

describe('documents', () => {
  let uploads: string;
  beforeEach(() => {
    uploads = mkdtempSync(join(tmpdir(), 'garage-uploads-'));
    setApp(createApp(db, undefined, { uploadsDir: uploads }));
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

  it('records where a Receipt was filed in Proton Drive, and where a Vehicle files them (ADR 0010)', async () => {
    const bike = await createVehicle('Bike');
    expect(bike.archiveFolder).toBeNull();
    const set = await call('PUT', `/api/vehicles/${bike.id}/archive-folder`, { folder: ' 31 Véhicules\\31.99 Test ' });
    expect(set.status).toBe(200);
    expect(await set.json()).toMatchObject({ archiveFolder: '31 Véhicules\\31.99 Test' });
    expect((await call('PUT', `/api/vehicles/${bike.id}/archive-folder`, { folder: '..\\elsewhere' })).status).toBe(422);
    expect((await call('PUT', `/api/vehicles/${bike.id}/archive-folder`, { folder: 'C:\\Users\\x' })).status).toBe(422);
    expect((await snapshot()).vehicles[0]).toMatchObject({ archiveFolder: '31 Véhicules\\31.99 Test' });

    await call('PUT', '/api/services/svc-arch', { id: 'svc-arch', vehicleId: bike.id, date: '2026-10-03', kind: 'repair', title: 'Test repair', category: 'other', performedBy: 'diy', taskIds: [] });
    const receipt = (await (await upload({ ownerKind: 'service', ownerId: 'svc-arch', type: 'invoice' })).json()) as GarageDocument;
    expect(receipt.archivePath).toBeNull();
    const filed = await call('PUT', `/api/documents/${receipt.id}/archive`, { path: '31 Véhicules/31.99 Test/Entretien/2026-10-03_TestRepair.pdf' });
    expect(filed.status).toBe(200);
    expect(await filed.json()).toMatchObject({ archivePath: '31 Véhicules/31.99 Test/Entretien/2026-10-03_TestRepair.pdf' });
    expect((await call('PUT', `/api/documents/${receipt.id}/archive`, { path: '../x.pdf' })).status).toBe(422);
    expect((await call('PUT', `/api/documents/${receipt.id}/archive`, { path: null })).status).toBe(200);

    // Only a Service's Receipt is filed; a Vehicle Document is not.
    const registration = (await (await upload({ ownerKind: 'vehicle', ownerId: bike.id, type: 'registration' })).json()) as GarageDocument;
    expect((await call('PUT', `/api/documents/${registration.id}/archive`, { path: 'a/b.pdf' })).status).toBe(422);
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
