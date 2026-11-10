import { describe, expect, it } from 'vitest';
import { messagesFor } from '../client/i18n.ts';
import type { Snapshot, Vehicle } from '../shared/types.ts';
import { normalizeSnapshot } from '../shared/workshop.ts';
import { ITEMS, REFERENCE_DBS, VEHICLES, notionType } from './databases.ts';
import { ensureDatabases, fetchReference, pushAll, type NotionClient } from './engine.ts';

// A fake Notion workspace: databases with their columns and pages, and a record of every write. No network, no real ids.

interface FakeDb {
  id: string;
  title: string;
  properties: Record<string, string>;
  pages: any[];
}

interface Write {
  method: string;
  path: string;
  body: any;
}

function fakeWorkspace(databases: FakeDb[]) {
  const writes: Write[] = [];
  const dataSource = (id: string) => databases.find((d) => `ds-${d.id}` === id)!;
  const client: NotionClient = {
    async call(method: string, path: string, body?: unknown) {
      if (method === 'GET') {
        const database = path.match(/^\/databases\/(.+)$/);
        if (database) return { data_sources: [{ id: `ds-${database[1]}` }] };
        const source = path.match(/^\/data_sources\/(.+)$/);
        if (source) return { properties: Object.fromEntries(Object.entries(dataSource(source[1]!).properties).map(([name, type]) => [name, { type }])) };
        throw new Error(`Unexpected GET ${path}`);
      }
      writes.push({ method, path, body });
      if (path === '/databases') {
        const id = `db-created-${databases.length}`;
        const schema = (body as any).initial_data_source.properties as Record<string, object>;
        databases.push({ id, title: (body as any).title[0].text.content, properties: Object.fromEntries(Object.entries(schema).map(([name, s]) => [name, Object.keys(s)[0]!])), pages: [] });
        return { id, data_sources: [{ id: `ds-${id}` }] };
      }
      if (path === '/pages') return { id: `page-created-${writes.length}` };
      return {};
    },
    async all(method: string, path: string) {
      if (method === 'GET') {
        return databases.map((d) => ({ type: 'child_database', id: d.id, child_database: { title: d.title } }));
      }
      const source = path.match(/^\/data_sources\/(.+)\/query$/);
      return dataSource(source![1]!).pages;
    },
  } as unknown as NotionClient;
  return { client, writes };
}

const rich = (s: string) => ({ type: 'rich_text', rich_text: [{ plain_text: s }] });

/** The columns of an app-managed database as Notion would have them. */
const columnsOf = (db: typeof VEHICLES | typeof ITEMS) => Object.fromEntries(db.columns.map((c) => [c.name, notionType(c.type)]));

const handMade = REFERENCE_DBS.map((d): FakeDb => {
  const properties = Object.fromEntries([...d.required, ...d.optional].map((c) => [c.name, c.types[0]!]));
  return { id: `db-${d.key}`, title: d.title, properties, pages: [] };
});

function vehicle(): Vehicle {
  return {
    id: 'bike',
    kind: 'motorcycle',
    name: 'Moto test',
    make: 'Exemple',
    model: 'Test',
    year: 2020,
    vin: 'VF1TESTVIN0000001',
    firstRegistrationDate: null,
    purchaseDate: null,
    fuel: 'petrol',
    transmission: 'manual',
    drivetrain: null,
    distribution: null,
    cooling: 'liquid',
    finalDrive: 'chain',
    cylinders: 2,
    hasHydraulicClutch: false,
    hasTurbo: false,
    hasDirectInjection: false,
    hasStartStop: false,
    hasAdblue: false,
    hasAc: false,
    hasAirSuspension: false,
    status: 'owned',
    onGaragePage: true,
    soldDate: null,
    soldOdometer: null,
    soldPrice: null,
    equipment: ['ABS'],
  };
}

const snapshot = (): Snapshot =>
  normalizeSnapshot({
    vehicles: [vehicle()],
    tasks: [],
    services: [],
    readings: [],
    vehicleParts: [{ id: 'p1', vehicleId: 'bike', name: 'Huile test', partNumber: 'REF-1', unit: 'litre', quantity: 3, price: null, taskId: null, specLineId: 's1', toBuy: true, notes: 'Boutique' }],
    specLines: [{ id: 's1', vehicleId: 'bike', label: 'Huile', value: '10W-40', oem: null, group: 'fluids', category: 'engine', sort: 0 }],
  } as unknown as Snapshot);

describe('fetchReference', () => {
  it('reads the hand-made databases and the vehicles, and writes nothing', async () => {
    const vehicles: FakeDb = {
      id: 'db-vehicles',
      title: 'Véhicules',
      properties: columnsOf(VEHICLES),
      pages: [{ id: 'page-bike', properties: { 'ID app': rich('bike'), Équipements: { type: 'multi_select', multi_select: [{ name: 'ABS' }] } } }],
    };
    const tools = handMade.find((d) => d.id === 'db-tools')!;
    const { client, writes } = fakeWorkspace([
      vehicles,
      ...handMade.map((d) => (d === tools ? { ...d, pages: [{ id: 'tool-1', properties: { Nom: { type: 'title', title: [{ plain_text: 'Clé' }] }, Possédé: { type: 'checkbox', checkbox: true } } }] } : d)),
    ]);
    const pull = await fetchReference(client, 'parent');
    expect(writes).toEqual([]);
    expect(pull.tools.rows).toMatchObject([{ notionId: 'tool-1', name: 'Clé', owned: true }]);
    expect(pull.equipment).toEqual({ bike: ['ABS'] });
    expect(pull.tasks.complete).toBe(true);
  });

  it('marks a missing database incomplete with a warning', async () => {
    const { client } = fakeWorkspace(handMade.filter((d) => d.id !== 'db-products'));
    const pull = await fetchReference(client, 'parent');
    expect(pull.products.complete).toBe(false);
    expect(pull.products.warnings.join()).toContain('not found');
    expect(pull.tools.complete).toBe(true);
  });

  it('matches database titles with a typographic apostrophe', async () => {
    const { client } = fakeWorkspace(handMade.map((d) => ({ ...d, title: d.title.replace("'", '’') })));
    const pull = await fetchReference(client, 'parent');
    expect(pull.tasks.complete).toBe(true);
    expect(pull.plans.complete).toBe(true);
  });
});

describe('the push never marks pages removed on a doubtful snapshot', () => {
  const page = (appId: string, removed = false) => ({
    id: `page-${appId}`,
    properties: { 'ID app': rich(appId), 'Supprimé de l’app': { type: 'checkbox', checkbox: removed } },
  });
  const workspace = (vehiclePages: any[], itemPages: any[]) => {
    const vehicles: FakeDb = { id: 'db-vehicles', title: 'Véhicules', properties: columnsOf(VEHICLES), pages: vehiclePages };
    const items: FakeDb = { id: 'db-items', title: 'Articles', properties: columnsOf(ITEMS), pages: itemPages };
    return fakeWorkspace([vehicles, items]);
  };
  const ticks = (writes: Write[]) => writes.filter((w) => w.method === 'PATCH' && JSON.stringify(w.body).includes('Supprimé de l’app'));
  const run = (client: NotionClient, s: Snapshot) => pushAll(client, 'parent', s, '2026-11-01', messagesFor('fr'), () => undefined);
  const empty = (): Snapshot => normalizeSnapshot({ vehicles: [], tasks: [], services: [], readings: [] } as unknown as Snapshot);
  /** The snapshot has one vehicle (bike) and no item. */
  const oneVehicle = (): Snapshot => normalizeSnapshot({ vehicles: [vehicle()], tasks: [], services: [], readings: [] } as unknown as Snapshot);

  it('ticks nothing, and warns, when the snapshot is empty but Notion has linked pages', async () => {
    const { client, writes } = workspace([page('bike'), page('car')], [page('p1'), page('p2')]);
    const result = await run(client, empty());
    expect(ticks(writes)).toEqual([]);
    expect(result.map(([, c]) => c.removed)).toEqual([0, 0]);
    expect(result.every(([, c]) => c.warning?.includes('no page was marked'))).toBe(true);
  });

  it('ticks no article when the snapshot has no vehicles, even with other rows', async () => {
    const { client, writes } = workspace([], [page('p1')]);
    const [, items] = (await run(client, empty()))[1]!;
    expect(ticks(writes)).toEqual([]);
    expect(items.warning).toContain('no vehicles');
  });

  it('ticks nothing, and warns, when most linked pages would be ticked at once', async () => {
    const articles = ['a', 'b', 'c', 'd', 'e'].map((id) => page(id));
    const { client, writes } = workspace([page('bike')], articles);
    const s = oneVehicle();
    s.vehicleParts = [{ id: 'a', vehicleId: 'bike', name: 'a', partNumber: null, unit: 'piece', quantity: 1, price: null, taskId: null, specLineId: null, toBuy: true, notes: null }];
    const result = await run(client, s);
    expect(ticks(writes)).toEqual([]);
    expect(result[1]![1]).toMatchObject({ removed: 0, warning: expect.stringContaining('4 of 5 linked pages') });
    expect(result[0]![1].warning).toBeUndefined();
  });

  it('still ticks a single legitimate removal', async () => {
    const { client, writes } = workspace([page('bike'), page('gone-vehicle')], [page('a'), page('b'), page('c'), page('d'), page('e')]);
    const s = oneVehicle();
    s.vehicleParts = ['a', 'b', 'c', 'd'].map((id) => ({ id, vehicleId: 'bike', name: id, partNumber: null, unit: 'piece', quantity: 1, price: null, taskId: null, specLineId: null, toBuy: true, notes: null }));
    const result = await run(client, s);
    expect(ticks(writes).map((w) => w.path)).toEqual(['/pages/page-gone-vehicle', '/pages/page-e']);
    expect(result.map(([, c]) => c.removed)).toEqual([1, 1]);
    expect(result.every(([, c]) => c.warning === undefined)).toBe(true);
  });

  it('still unticks a page whose record is back', async () => {
    const { client, writes } = workspace([page('bike', true)], []);
    await run(client, oneVehicle());
    const patch = writes.find((w) => w.path === '/pages/page-bike')!;
    expect(patch.body.properties['Supprimé de l’app']).toEqual({ checkbox: false });
  });
});

describe('pushAll and ensureDatabases', () => {
  const vehiclesDb = (): FakeDb => ({
    id: 'db-vehicles',
    title: 'Véhicules',
    properties: columnsOf(VEHICLES),
    pages: [{ id: 'page-bike', properties: { 'ID app': rich('bike'), Nom: { type: 'title', title: [{ plain_text: 'Ancien nom' }] }, Équipements: { type: 'multi_select', multi_select: [{ name: 'ABS' }] } } }],
  });
  const itemsDb = (): FakeDb => ({ id: 'db-items', title: 'Articles', properties: { ...columnsOf(ITEMS), Caractéristique: 'relation' }, pages: [] });

  it('never writes Équipements, nor anything to the hand-made databases', async () => {
    const { client, writes } = fakeWorkspace([vehiclesDb(), itemsDb(), ...handMade]);
    await pushAll(client, 'parent', snapshot(), '2026-11-01', messagesFor('fr'), () => undefined);
    expect(writes.length).toBeGreaterThan(0);
    expect(JSON.stringify(writes)).not.toContain('Équipements');
    for (const d of handMade) {
      expect(writes.filter((w) => w.path.includes(d.id) || w.path.includes(`ds-${d.id}`))).toEqual([]);
      expect(JSON.stringify(writes.filter((w) => w.method === 'POST' && w.path === '/databases'))).not.toContain(d.title);
    }
    // Only the app's pages are written: one update of the vehicle, one new item.
    expect(writes.map((w) => `${w.method} ${w.path}`)).toEqual(['PATCH /pages/page-bike', expect.stringMatching(/^POST \/pages$/)]);
  });

  it('writes the app columns of Articles without the Caractéristique relation', async () => {
    const { client, writes } = fakeWorkspace([vehiclesDb(), itemsDb()]);
    await pushAll(client, 'parent', snapshot(), '2026-11-01', messagesFor('fr'), () => undefined);
    const created = writes.find((w) => w.method === 'POST' && w.path === '/pages')!;
    expect(Object.keys(created.body.properties)).toContain('Article');
    expect(Object.keys(created.body.properties)).not.toContain('Caractéristique');
    expect(JSON.stringify(writes)).not.toContain('Caractéristiques');
  });

  it('creates only Véhicules and Articles when they are missing, never a hand-made database', async () => {
    const { client, writes } = fakeWorkspace(handMade);
    await ensureDatabases(client, 'parent', () => undefined);
    const created = writes.filter((w) => w.method === 'POST' && w.path === '/databases').map((w) => w.body.title[0].text.content);
    expect(created).toEqual(['Véhicules', 'Articles']);
    const equipment = writes[0]!.body.initial_data_source.properties['Équipements'];
    expect(equipment).toEqual({ multi_select: { options: [] } });
    expect(writes.some((w) => w.path.includes('db-tasks') || w.path.includes('ds-db-tasks'))).toBe(false);
  });

  it('adds a missing column to an app database without touching an existing one', async () => {
    const vehicles = vehiclesDb();
    delete vehicles.properties['JDex'];
    const { client, writes } = fakeWorkspace([vehicles, itemsDb()]);
    await ensureDatabases(client, 'parent', () => undefined);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ method: 'PATCH', path: '/data_sources/ds-db-vehicles', body: { properties: { JDex: { rich_text: {} } } } });
  });
});
