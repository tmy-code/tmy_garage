import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  VehicleItem,
  Vehicle,
} from '../shared/types.ts';
import { createApp } from './app.ts';
import { db, app, call, BIKE, CAR, createVehicle, createTask, snapshot, setApp, setupGarage } from './test-helpers.ts';

setupGarage();

describe('spec lines and the plan templates', () => {
  /** A Spec Line as the earlier releases left it: no route writes them any more. */
  const specLine = (vehicleId: string, id: string, label: string, group = 'fluids') =>
    db.prepare('INSERT INTO spec_lines (id, vehicle_id, label, value, spec_group, sort) VALUES (?, ?, ?, ?, ?, 0)').run(id, vehicleId, label, '10W-40, 3.2 L', group);

  it('lists the Spec Lines not moved to Notion, read-only: the routes that wrote them are gone', async () => {
    const bike = await createVehicle();
    specLine(bike.id, 'line-1', 'Engine oil');
    specLine(bike.id, 'line-2', 'Drain plug', 'torque');
    expect((await snapshot()).specLines.map((l) => l.id)).toEqual(['line-1', 'line-2']);
    expect((await call('POST', `/api/vehicles/${bike.id}/specs`, { label: 'X', value: 'x', group: 'fluids' })).status).toBe(404);
    expect((await call('PUT', '/api/specs/line-1', { label: 'X', value: 'x', group: 'fluids' })).status).toBe(404);
    expect((await call('DELETE', '/api/specs/line-1')).status).toBe(404);
    expect((await call('POST', `/api/vehicles/${bike.id}/add-standard-specs`, { lang: 'fr' })).status).toBe(404);
    // A line moved to Notion leaves the snapshot; the row stays for tracing.
    db.prepare("INSERT INTO spec_line_moves (spec_line_id, target, notion_id, created_page) VALUES ('line-1', 'item_spec', 'page-item-1', 1)").run();
    expect((await snapshot()).specLines.map((l) => l.id)).toEqual(['line-2']);
    expect(db.prepare('SELECT count(*) AS n FROM spec_lines').get()).toEqual({ n: 2 });
  });

  it('answers the Item Specs and Component Specs routes with 503 when Notion is not set up', async () => {
    const bike = await createVehicle();
    const item = { name: 'Huile moteur' };
    const component = { label: 'Bouchon de vidange', value: '25' };
    expect((await call('POST', `/api/notion/vehicles/${bike.id}/item-specs`, item)).status).toBe(503);
    expect((await call('PUT', '/api/notion/item-specs/x', item)).status).toBe(503);
    expect((await call('DELETE', '/api/notion/item-specs/x')).status).toBe(503);
    expect((await call('POST', `/api/notion/vehicles/${bike.id}/component-specs`, component)).status).toBe(503);
    expect((await call('PUT', '/api/notion/component-specs/x', component)).status).toBe(503);
    expect((await call('DELETE', '/api/notion/component-specs/x')).status).toBe(503);
    expect((await call('POST', '/api/notion/spec-migration?dryRun=1')).status).toBe(503);
    const refused = await call('POST', `/api/notion/vehicles/${bike.id}/item-specs`, item);
    expect(await refused.json()).toMatchObject({ code: 'notion_off' });
  });

  it('gives every new car and motorcycle a monthly tyre pressure check that replaces no part', async () => {
    for (const [base, code] of [[CAR, 'tyre_pressure'], [BIKE, 'moto_tyre_pressure']] as const) {
      const v = (await (await call('POST', '/api/vehicles', { ...base, name: `Pressure ${code}` })).json()) as Vehicle;
      const task = (await snapshot()).tasks.find((t) => t.vehicleId === v.id && t.templateCode === code);
      expect(task, code).toBeDefined();
      expect(task).toMatchObject({ name: 'Check and adjust tyre pressure', action: 'adjust', category: 'chassis', intervalKm: null, intervalMonths: 1 });
    }
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
      componentsUsed: [{ partSpecId: 'gone', itemId: 'gone-part-id', description: 'Motul 7100 10W-40', quantity: 3, unit: 'litre', price: 40, supplier: 'Shop' }],
    });
    expect(res.status).toBe(200);
    expect((await snapshot()).services[0]!.componentsUsed).toEqual([{ description: 'Motul 7100 10W-40', partNumber: null, quantity: 3, unit: 'litre', price: 40, itemId: null }]);
  });

  it('keeps a Vehicle’s parts list: add, edit, refuse a twin, delete', async () => {
    const bike = await createVehicle();
    const task = await createTask(bike.id);
    const part = (await (await call('POST', `/api/vehicles/${bike.id}/items`, { name: 'Motul 7100 10W-40', unit: 'litre', quantity: 3.2, price: 12.5, taskId: task.id })).json()) as VehicleItem;
    expect(part).toMatchObject({ name: 'Motul 7100 10W-40', unit: 'litre', quantity: 3.2, price: 12.5, taskId: task.id, partNumber: null });
    expect((await call('POST', `/api/vehicles/${bike.id}/items`, { name: 'motul 7100 10w-40', unit: 'litre', quantity: 1 })).status).toBe(409);
    expect((await call('POST', `/api/vehicles/${bike.id}/items`, { name: 'x', unit: 'litre', quantity: 1, taskId: 'nope' })).status).toBe(422);
    await call('PUT', `/api/items/${part.id}`, { name: 'Motul 7100 10W-40', partNumber: 'REF-1', unit: 'litre', quantity: 3.5, price: null });
    expect((await snapshot()).vehicleItems).toEqual([{ ...part, partNumber: 'REF-1', quantity: 3.5, price: null, taskId: null }]);
    expect((await call('DELETE', `/api/items/${part.id}`)).status).toBe(204);
    expect((await snapshot()).vehicleItems).toEqual([]);
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
      componentsUsed: [{ description: 'Mann HU 7008 z', partNumber: 'HU 7008 z', quantity: 1, unit: 'piece', price: 9.9, itemId: 'part-0000001', remember: true, consumableTypeId: 'type-1', productId: 'product-1' }],
    };
    expect((await call('PUT', '/api/services/svc-00010', body)).status).toBe(200);
    expect((await call('PUT', '/api/services/svc-00010', body)).status).toBe(200);
    const parts = (await snapshot()).vehicleItems;
    expect(parts).toEqual([{ id: 'part-0000001', vehicleId: bike.id, name: 'Mann HU 7008 z', partNumber: 'HU 7008 z', unit: 'piece', quantity: 1, price: 9.9, taskId: task.id, itemSpecId: null, specLineId: null, notes: null }]);
    expect((await snapshot()).services[0]!.componentsUsed[0]).toMatchObject({ itemId: 'part-0000001', price: 9.9 });
    expect(db.prepare('SELECT consumable_type_id, product_id FROM service_items WHERE service_id = ?').all('svc-00010')).toEqual([{ consumable_type_id: 'type-1', product_id: 'product-1' }]);
    await call('DELETE', '/api/items/part-0000001');
    const kept = (await snapshot()).services.find((x) => x.id === 'svc-00010')!.componentsUsed[0]!;
    expect(kept).toMatchObject({ description: 'Mann HU 7008 z', itemId: null, price: 9.9 });
  });

  it('still reads the partId of a Service queued on a phone before the rename', async () => {
    const bike = await createVehicle();
    const task = await createTask(bike.id);
    const res = await call('PUT', '/api/services/svc-00020', {
      id: 'svc-00020',
      vehicleId: bike.id,
      date: '2026-10-01',
      odometer: 18000,
      taskIds: [task.id],
      componentsUsed: [{ description: 'Mann HU 7008 z', quantity: 1, unit: 'piece', partId: 'part-0000009', remember: true }],
    });
    expect(res.status).toBe(200);
    const snap = await snapshot();
    expect(snap.vehicleItems.map((i) => i.id)).toEqual(['part-0000009']);
    expect(snap.services[0]!.componentsUsed[0]).toMatchObject({ itemId: 'part-0000009' });
  });

  it('still reads the partsUsed of a Service queued on an API 4 phone', async () => {
    const bike = await createVehicle();
    const task = await createTask(bike.id);
    const res = await call('PUT', '/api/services/svc-00021', {
      id: 'svc-00021',
      vehicleId: bike.id,
      date: '2026-10-01',
      odometer: 18000,
      taskIds: [task.id],
      partsUsed: [{ description: 'Mann HU 7008 z', quantity: 1, unit: 'piece', itemId: 'part-0000010', remember: true }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty('partsUsed');
    const service = (await snapshot()).services[0]!;
    expect(service.componentsUsed[0]).toMatchObject({ description: 'Mann HU 7008 z', itemId: 'part-0000010' });
    expect(service).not.toHaveProperty('partsUsed');
  });

  it('prefers componentsUsed when both keys are sent', async () => {
    const bike = await createVehicle();
    const task = await createTask(bike.id);
    const res = await call('PUT', '/api/services/svc-00022', {
      id: 'svc-00022',
      vehicleId: bike.id,
      date: '2026-10-01',
      odometer: 18000,
      taskIds: [task.id],
      componentsUsed: [{ description: 'New key', quantity: 1, unit: 'piece' }],
      partsUsed: [{ description: 'Old key', quantity: 2, unit: 'piece' }],
    });
    expect(res.status).toBe(200);
    const lines = (await snapshot()).services[0]!.componentsUsed;
    expect(lines.map((l) => l.description)).toEqual(['New key']);
  });
});

describe('the Parts section', () => {
  let uploads: string;
  beforeEach(() => {
    uploads = mkdtempSync(join(tmpdir(), 'garage-uploads-'));
    setApp(createApp(db, undefined, { uploadsDir: uploads }));
  });
  afterEach(() => rmSync(uploads, { recursive: true, force: true }));

  async function createPart(vehicleId: string, body: object = {}): Promise<VehicleItem> {
    const res = await call('POST', `/api/vehicles/${vehicleId}/items`, { name: 'Motul 7100 10W-40', unit: 'litre', quantity: 5, ...body });
    expect(res.status).toBe(201);
    return res.json();
  }

  it('keeps notes, and accepts and ignores a "toBuy" sent by an old app', async () => {
    const bike = await createVehicle();
    const res = await call('POST', `/api/vehicles/${bike.id}/items`, { name: 'Motul 7100 10W-40', unit: 'litre', quantity: 5, toBuy: true, notes: 'See https://example.test/oil' });
    expect(res.status).toBe(201);
    const part = (await res.json()) as VehicleItem;
    expect(part).toMatchObject({ notes: 'See https://example.test/oil' });
    expect(part).not.toHaveProperty('toBuy');
    expect(db.prepare('SELECT to_buy FROM vehicle_items WHERE id = ?').get(part.id)).toEqual({ to_buy: 0 });
    const put = await call('PUT', `/api/items/${part.id}`, { name: 'Motul 7100 10W-40', unit: 'litre', quantity: 5, toBuy: true, notes: 'Cheaper elsewhere' });
    expect(put.status).toBe(200);
    const stored = (await snapshot()).vehicleItems[0]!;
    expect(stored).toMatchObject({ notes: 'Cheaper elsewhere' });
    expect(stored).not.toHaveProperty('toBuy');
  });

  /** An Item Spec as the Notion pull stores it (the table keeps its old name, vehicle_consumables). */
  function itemSpec(vehicleId: string, id: string, name = 'Huile moteur', removed = 0) {
    db.prepare("INSERT INTO vehicle_consumables (id, garage_id, vehicle_id, notion_id, name, notion_removed) VALUES (?, 'default', ?, ?, ?, ?)").run(id, vehicleId, `page-${id}`, name, removed);
  }

  it('links an item to an Item Spec of its own Vehicle, keeps the link when editing without it, and empties it when asked', async () => {
    const bike = await createVehicle();
    const other = await createVehicle('Other bike');
    itemSpec(bike.id, 'spec-own');
    itemSpec(other.id, 'spec-foreign');
    itemSpec(bike.id, 'spec-hidden', 'Gone', 1);
    const body = { name: 'x', unit: 'litre', quantity: 1 };
    expect((await call('POST', `/api/vehicles/${bike.id}/items`, { ...body, itemSpecId: 'spec-foreign' })).status).toBe(422);
    expect((await call('POST', `/api/vehicles/${bike.id}/items`, { ...body, itemSpecId: 'nope' })).status).toBe(422);
    expect((await call('POST', `/api/vehicles/${bike.id}/items`, { ...body, itemSpecId: 'spec-hidden' })).status).toBe(422);
    const part = await createPart(bike.id, { itemSpecId: 'spec-own' });
    expect(part.itemSpecId).toBe('spec-own');
    // Editing without the field keeps the link; null removes it.
    await call('PUT', `/api/items/${part.id}`, { name: part.name, unit: 'litre', quantity: 5 });
    expect((await snapshot()).vehicleItems[0]!.itemSpecId).toBe('spec-own');
    await call('PUT', `/api/items/${part.id}`, { name: part.name, unit: 'litre', quantity: 5, itemSpecId: null });
    expect((await snapshot()).vehicleItems[0]!.itemSpecId).toBeNull();
    // An old app's specLineId is stripped, never written.
    await call('PUT', `/api/items/${part.id}`, { name: part.name, unit: 'litre', quantity: 5, specLineId: 'line-1' });
    expect(db.prepare('SELECT spec_line_id FROM vehicle_items WHERE id = ?').get(part.id)).toEqual({ spec_line_id: null });
  });

  it('puts the Item Specs in the snapshot under itemSpecs, hiding the ones Notion no longer has', async () => {
    const bike = await createVehicle();
    itemSpec(bike.id, 'spec-a');
    itemSpec(bike.id, 'spec-b', 'Gone', 1);
    const s = (await snapshot()) as unknown as Record<string, any>;
    expect(s.itemSpecs.map((x: { id: string }) => x.id)).toEqual(['spec-a']);
    expect(s).not.toHaveProperty('vehicleConsumables');
  });

  it('no longer has purchase routes or the CSV: they answer 404', async () => {
    const bike = await createVehicle();
    const part = await createPart(bike.id);
    const body = { date: '2026-11-02', quantity: 5, totalPaid: 40 };
    expect((await call('POST', `/api/parts/${part.id}/purchases`, body)).status).toBe(404);
    expect((await call('PUT', '/api/purchases/p1', body)).status).toBe(404);
    expect((await call('DELETE', '/api/purchases/p1')).status).toBe(404);
    expect((await call('GET', '/api/purchases.csv')).status).toBe(404);
    expect(await snapshot()).not.toHaveProperty('purchases');
  });

  it('refuses a new Document that belongs to a purchase', async () => {
    const form = new FormData();
    form.set('file', new File(['%PDF-1.4 test'], 'receipt.pdf', { type: 'application/pdf' }));
    form.set('ownerKind', 'purchase');
    form.set('ownerId', 'x');
    form.set('type', 'invoice');
    expect((await app.request('/api/documents', { method: 'POST', body: form })).status).toBe(422);
  });

  it('deletes a part with a legacy purchase row: the row goes, the receipt file stays on disk', async () => {
    const bike = await createVehicle();
    const part = await createPart(bike.id);
    db.prepare(`INSERT INTO purchases (id, part_id, vehicle_id, date, quantity, total_paid) VALUES ('legacy-p1', ?, ?, '2026-11-02', 5, 40)`).run(part.id, bike.id);
    db.exec(`INSERT INTO documents (id, garage_id, vehicle_id, owner_kind, owner_id, type, file_name, content_type, size)
             VALUES ('legacy-doc-1', 'default', '${bike.id}', 'purchase', 'legacy-p1', 'invoice', 'receipt.pdf', 'application/pdf', 13)`);
    writeFileSync(join(uploads, 'legacy-doc-1'), '%PDF-1.4 test');
    expect((await call('DELETE', `/api/items/${part.id}`)).status).toBe(204);
    expect(db.prepare('SELECT count(*) AS n FROM purchases').get()).toEqual({ n: 0 });
    expect(existsSync(join(uploads, 'legacy-doc-1'))).toBe(true);
    // The receipt is not in the snapshot: nothing in the app can reach it.
    expect((await snapshot()).documents).toEqual([]);
    expect(readdirSync(uploads)).toHaveLength(1);
  });

  it('does not mark anything when a Service uses a listed part', async () => {
    const bike = await createVehicle();
    const task = await createTask(bike.id);
    const part = await createPart(bike.id);
    const body = {
      id: 'svc-00020',
      vehicleId: bike.id,
      date: '2026-11-04',
      odometer: 18500,
      taskIds: [task.id],
      componentsUsed: [{ description: part.name, quantity: 5, unit: 'litre', itemId: part.id }],
    };
    expect((await call('PUT', '/api/services/svc-00020', body)).status).toBe(200);
    const after = await snapshot();
    expect(after.vehicleItems[0]).not.toHaveProperty('toBuy');
    expect(after.services[0]!.componentsUsed[0]).toMatchObject({ itemId: part.id });
  });
});
