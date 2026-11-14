import type { DatabaseSync } from 'node:sqlite';
import type { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NotionError } from '../notion/api.ts';
import { fakeNotion, referenceDatabases, relationValue, richValue, selectValue, titleValue, vehiclesDatabase, numberValue, type FakeDb, type FakeWrite } from '../notion/fake-notion.ts';
import type { ComponentSpec, ItemSpec, Snapshot } from '../shared/types.ts';
import { createApp } from './app.ts';
import { openDatabase } from './db.ts';
import { createNotionSync, type NotionSyncService } from './notion-sync.ts';

const TOKEN = 'secret-test-token-0002';

let db: DatabaseSync;
let app: Hono;
let sync: NotionSyncService;
let workspace: ReturnType<typeof fakeNotion>;

const call = (method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const snapshot = async (): Promise<Snapshot> => (await call('GET', '/api/snapshot')).json();
const dbOf = (id: string): FakeDb => workspace.databases.find((d) => d.id === id)!;

/** Owned vehicles with a page in the fake Véhicules database, plus a type, a product and a component type from Notion. */
function start(options: { failWrite?: (write: FakeWrite) => Error | undefined } = {}) {
  workspace = fakeNotion([...referenceDatabases(), vehiclesDatabase([['page-bike', 'bike'], ['page-car', 'car']])], options);
  sync = createNotionSync({ db, garageId: 'default', token: TOKEN, parentPageId: 'parent', apiFactory: () => workspace.client });
  app = createApp(db, undefined, { notionSync: sync });
}

beforeEach(() => {
  db = openDatabase(':memory:');
  db.exec(`
    INSERT INTO vehicles (id, garage_id, kind, name, notion_page_id) VALUES ('bike', 'default', 'motorcycle', 'Moto test', 'page-bike'), ('car', 'default', 'car', 'Voiture test', 'page-car');
    INSERT INTO vehicles (id, garage_id, kind, name, notion_page_id, ownership) VALUES ('sold', 'default', 'car', 'Vendue', NULL, 'sold');
    INSERT INTO vehicles (id, garage_id, kind, name) VALUES ('nopage', 'default', 'car', 'Sans page');
    INSERT INTO consumable_types (id, garage_id, notion_id, name) VALUES ('ct-oil', 'default', 'page-type-oil', 'Huile moteur');
    INSERT INTO products (id, garage_id, notion_id, name, type_id) VALUES ('prod-1', 'default', 'page-product-1', 'Huile Exemple', 'ct-oil');
    INSERT INTO ref_component_types (id, garage_id, notion_id, name) VALUES ('comp-1', 'default', 'page-comp-1', 'Bouchon');
  `);
  start();
});

afterEach(() => db.close());

const itemBody = { name: 'Huile moteur', typeId: 'ct-oil', specification: '10W-40', capacity: '3,2 L', quantity: 3.2, chosenProductId: 'prod-1', confirmation: 'to_confirm' };

describe('Item Specs: Notion first', () => {
  it('creates the page in Notion and stores the page Notion returned', async () => {
    const res = await call('POST', '/api/notion/vehicles/bike/item-specs', itemBody);
    expect(res.status).toBe(201);
    const created = (await res.json()) as ItemSpec;
    expect(created).toMatchObject({ vehicleId: 'bike', name: 'Huile moteur', typeId: 'ct-oil', specification: '10W-40', capacity: '3,2 L', quantity: 3.2, chosenProductId: 'prod-1', confirmation: 'to_confirm', notionId: 'page-new-1' });
    expect(workspace.writes).toHaveLength(1);
    expect(workspace.writes[0]).toMatchObject({ method: 'POST', path: '/pages' });
    expect(workspace.writes[0]!.body.properties['Véhicule']).toEqual({ relation: [{ id: 'page-bike' }] });
    expect((await snapshot()).itemSpecs.map((s) => s.id)).toEqual([created.id]);
  });

  it('writes only the changed columns on an edit, and nothing when nothing changed', async () => {
    const created = (await (await call('POST', '/api/notion/vehicles/bike/item-specs', itemBody)).json()) as ItemSpec;
    const none = await call('PUT', `/api/notion/item-specs/${created.id}`, itemBody);
    expect(none.status).toBe(200);
    expect(workspace.writes).toHaveLength(1);
    const res = await call('PUT', `/api/notion/item-specs/${created.id}`, { ...itemBody, specification: '5W-30', confirmation: 'confirmed' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: created.id, specification: '5W-30', confirmation: 'confirmed' });
    const patch = workspace.writes.at(-1)!;
    expect(patch).toMatchObject({ method: 'PATCH', path: `/pages/${created.notionId}` });
    expect(Object.keys(patch.body.properties).sort()).toEqual(['Spécification', 'Statut']);
  });

  it('sends a deleted page to the Notion trash and hides the row', async () => {
    const created = (await (await call('POST', '/api/notion/vehicles/bike/item-specs', itemBody)).json()) as ItemSpec;
    expect((await call('DELETE', `/api/notion/item-specs/${created.id}`)).status).toBe(204);
    expect(workspace.writes.at(-1)).toMatchObject({ method: 'PATCH', body: { in_trash: true } });
    expect((await snapshot()).itemSpecs).toEqual([]);
    expect(db.prepare('SELECT notion_removed FROM vehicle_consumables WHERE id = ?').get(created.id)).toEqual({ notion_removed: 1 });
    expect((await call('PUT', `/api/notion/item-specs/${created.id}`, itemBody)).status).toBe(404);
  });

  it('detaches this vehicle from a page that covers several, and keeps the other vehicle’s row', async () => {
    dbOf('db-itemSpecs').pages.push({
      id: 'page-shared',
      in_trash: false,
      properties: {
        Désignation: titleValue('Huile moteur'),
        Véhicule: relationValue('page-bike', 'page-car'),
        Type: relationValue('page-type-oil'),
        Spécification: richValue('10W-40'),
        'Réf. OEM': richValue(''),
        Capacité: richValue(''),
        Quantité: numberValue(null),
        'Produit retenu': relationValue(),
        'Produits compatibles': relationValue(),
        Statut: selectValue(null),
      },
    });
    await call('POST', '/api/notion/sync'); // the pull reads the shared page for both vehicles
    const rows = (await snapshot()).itemSpecs.filter((s) => s.notionId === 'page-shared');
    expect(rows.map((r) => r.vehicleId).sort()).toEqual(['bike', 'car']);
    const bikeRow = rows.find((r) => r.vehicleId === 'bike')!;
    expect((await call('DELETE', `/api/notion/item-specs/${bikeRow.id}`)).status).toBe(204);
    expect(workspace.writes.at(-1)!.body).toEqual({ properties: { Véhicule: { relation: [{ id: 'page-car' }] } } });
    expect(dbOf('db-itemSpecs').pages[0].in_trash).toBe(false);
    expect((await snapshot()).itemSpecs.filter((s) => s.notionId === 'page-shared').map((r) => r.vehicleId)).toEqual(['car']);
  });
});

describe('refusals', () => {
  it('answers 409 notion_busy while a sync or another edit runs, and writes nothing', async () => {
    let release!: () => void;
    const holding = sync.exclusive(() => new Promise<void>((resolve) => (release = resolve)));
    const res = await call('POST', '/api/notion/vehicles/bike/item-specs', itemBody);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'notion_busy' });
    release();
    await holding;
    expect(workspace.writes).toEqual([]);
    expect((await call('POST', '/api/notion/vehicles/bike/item-specs', itemBody)).status).toBe(201);
  });

  it('answers 409 for a vehicle with no Notion page, and for a sold one', async () => {
    for (const id of ['nopage', 'sold']) {
      const res = await call('POST', `/api/notion/vehicles/${id}/item-specs`, itemBody);
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: 'vehicle_not_in_notion' });
    }
    expect((await call('POST', '/api/notion/vehicles/nope/item-specs', itemBody)).status).toBe(404);
    expect(workspace.writes).toEqual([]);
  });

  it('answers 422 for a type or a product the app does not know, before writing', async () => {
    expect((await call('POST', '/api/notion/vehicles/bike/item-specs', { ...itemBody, typeId: 'nope' })).status).toBe(422);
    expect((await call('POST', '/api/notion/vehicles/bike/item-specs', { ...itemBody, chosenProductId: 'nope' })).status).toBe(422);
    expect((await call('POST', '/api/notion/vehicles/bike/item-specs', { name: '' })).status).toBe(422);
    expect(workspace.writes).toEqual([]);
  });

  it('answers 409 notion_incomplete when the database lacks a column the edit needs', async () => {
    delete dbOf('db-itemSpecs').properties['Capacité'];
    const res = await call('POST', '/api/notion/vehicles/bike/item-specs', itemBody);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'notion_incomplete' });
    expect(workspace.writes).toEqual([]);
  });

  it('answers 502 when Notion refuses, changes nothing here, and never shows the token', async () => {
    start({ failWrite: () => new NotionError(400, `Notion POST /pages failed (400): bad request for ${TOKEN}`) });
    const res = await call('POST', '/api/notion/vehicles/bike/item-specs', itemBody);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe('notion_failed');
    expect(body.error).not.toContain(TOKEN);
    expect(body.error).toContain('***');
    expect(db.prepare('SELECT count(*) AS n FROM vehicle_consumables').get()).toEqual({ n: 0 });
    // The lock is released: a later edit works.
    start();
    expect((await call('POST', '/api/notion/vehicles/bike/item-specs', itemBody)).status).toBe(201);
  });
});

describe('Component Specs: Notion first', () => {
  const body = { label: 'Bouchon de vidange', componentTypeId: 'comp-1', category: 'engine', value: '25', unit: 'N·m', source: 'Manuel', confirmation: null };

  it('creates, edits and deletes through Notion', async () => {
    const res = await call('POST', '/api/notion/vehicles/car/component-specs', body);
    expect(res.status).toBe(201);
    const created = (await res.json()) as ComponentSpec;
    expect(created).toMatchObject({ vehicleId: 'car', label: 'Bouchon de vidange', componentTypeId: 'comp-1', category: 'Moteur', value: '25', unit: 'N·m', source: 'Manuel' });
    expect(workspace.writes[0]!.body.properties['Valeur']).toEqual({ number: 25 });
    const edited = await call('PUT', `/api/notion/component-specs/${created.id}`, { ...body, value: '30' });
    expect(await edited.json()).toMatchObject({ value: '30' });
    expect(Object.keys(workspace.writes.at(-1)!.body.properties)).toEqual(['Valeur']);
    expect((await call('DELETE', `/api/notion/component-specs/${created.id}`)).status).toBe(204);
    expect((await snapshot()).componentSpecs).toEqual([]);
  });

  it('answers 422 value_not_number when Notion’s Valeur is a number and the text is not', async () => {
    const res = await call('POST', '/api/notion/vehicles/car/component-specs', { ...body, value: '25 Nm' });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'value_not_number' });
    expect(workspace.writes).toEqual([]);
  });
});
