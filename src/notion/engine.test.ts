import { describe, expect, it } from 'vitest';
import { messagesFor } from '../shared/messages.ts';
import type { Snapshot, Vehicle } from '../shared/types.ts';
import { normalizeSnapshot } from '../shared/workshop.ts';
import { INTERVENTIONS, ITEMS, REFERENCE_DBS, SESSIONS, USED, VEHICLES, notionType } from './databases.ts';
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

function fakeWorkspace(initial: FakeDb[]) {
  const databases = [...initial];
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
      if (path === '/pages') return { id: `${(body as any)?.parent?.data_source_id === 'ds-db-plans' ? 'plan' : 'page'}-created-${writes.length}` };
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
const columnsOf = (db: { columns: { name: string; type: Parameters<typeof notionType>[0] }[] }) => Object.fromEntries(db.columns.map((c) => [c.name, notionType(c.type)]));

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
    expect(result.databases.map(([, c]) => c.removed)).toEqual([0, 0, 0, 0, 0]);
    expect(result.databases.slice(0, 2).every(([, c]) => c.warning?.includes('no page was marked'))).toBe(true);
  });

  it('ticks no article when the snapshot has no vehicles, even with other rows', async () => {
    const { client, writes } = workspace([], [page('p1')]);
    const [, items] = (await run(client, empty())).databases[1]!;
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
    expect(result.databases[1]![1]).toMatchObject({ removed: 0, warning: expect.stringContaining('4 of 5 linked pages') });
    expect(result.databases[0]![1].warning).toBeUndefined();
  });

  it('still ticks a single legitimate removal', async () => {
    const { client, writes } = workspace([page('bike'), page('gone-vehicle')], [page('a'), page('b'), page('c'), page('d'), page('e')]);
    const s = oneVehicle();
    s.vehicleParts = ['a', 'b', 'c', 'd'].map((id) => ({ id, vehicleId: 'bike', name: id, partNumber: null, unit: 'piece', quantity: 1, price: null, taskId: null, specLineId: null, toBuy: true, notes: null }));
    const result = await run(client, s);
    expect(ticks(writes).map((w) => w.path)).toEqual(['/pages/page-gone-vehicle', '/pages/page-e']);
    expect(result.databases.slice(0, 2).map(([, c]) => c.removed)).toEqual([1, 1]);
    expect(result.databases.every(([, c]) => c.warning === undefined)).toBe(true);
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
  const journalDbs = (): FakeDb[] => [SESSIONS, INTERVENTIONS, USED].map((db) => ({ id: `db-${db.key}`, title: db.title, properties: columnsOf(db), pages: [] }));
  const itemsDb = (): FakeDb => ({ id: 'db-items', title: 'Articles', properties: { ...columnsOf(ITEMS), Caractéristique: 'relation' }, pages: [] });

  it('never writes Équipements, nor anything to the hand-made databases', async () => {
    const { client, writes } = fakeWorkspace([vehiclesDb(), itemsDb(), ...journalDbs(), ...handMade]);
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

  it('creates only the app’s own databases when they are missing, never a hand-made database', async () => {
    const { client, writes } = fakeWorkspace(handMade);
    await ensureDatabases(client, 'parent', () => undefined);
    const created = writes.filter((w) => w.method === 'POST' && w.path === '/databases').map((w) => w.body.title[0].text.content);
    expect(created).toEqual(['Véhicules', 'Articles', 'Séances', 'Interventions', 'Consommables utilisés']);
    const equipment = writes[0]!.body.initial_data_source.properties['Équipements'];
    expect(equipment).toEqual({ multi_select: { options: [] } });
    expect(writes.some((w) => w.path.includes('db-tasks') || w.path.includes('ds-db-tasks'))).toBe(false);
  });

  it('adds a missing column to an app database without touching an existing one', async () => {
    const vehicles = vehiclesDb();
    delete vehicles.properties['JDex'];
    const { client, writes } = fakeWorkspace([vehicles, itemsDb()]);
    await ensureDatabases(client, 'parent', () => undefined);
    const patches = writes.filter((w) => w.method === 'PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({ method: 'PATCH', path: '/data_sources/ds-db-vehicles', body: { properties: { JDex: { rich_text: {} } } } });
  });
});

describe('plans, "Dernier fait" and the journal', () => {
  const ALLOWED_PLAN_COLUMNS = ['Plan', 'Véhicule', 'Tâche'];
  const LAST_COLUMNS = ['Dernier fait (km)', 'Dernier fait (date)'];
  const handMadeSources = new Set(handMade.map((d) => `ds-${d.id}`));

  const refTask = { id: 'rt1', name: 'Vidange', action: 'replace', applicableIf: [], defaultKm: 6000, defaultMonths: 12, consumableTypeIds: ['ct1'], componentTypeIds: [], toolIds: [], instructions: null, notionId: 'n-rt1' };
  const task = (overrides: object = {}) => ({
    id: 't1',
    vehicleId: 'bike',
    name: 'Vidange',
    nameFr: 'Vidange',
    action: 'replace',
    intervalKm: 6000,
    intervalMonths: 12,
    baselineDate: '2026-01-10',
    baselineOdometer: 5000,
    notes: 'TASK-NOTE-SECRET',
    category: null,
    switchedOff: false,
    refTaskId: 'rt1',
    notionPlanId: null,
    ...overrides,
  });
  const snap = (overrides: object = {}): Snapshot =>
    normalizeSnapshot({
      vehicles: [vehicle()],
      tasks: [task()],
      services: [],
      readings: [],
      refTasks: [refTask],
      consumableTypes: [{ id: 'ct1', name: 'Huile', category: null, family: 'fluid', notes: null, notionId: 'n-ct1' }],
      products: [{ id: 'pr1', typeId: 'ct1', name: 'Huile test', brand: null, reference: null, supplier: null, price: null, notes: null, notionId: 'n-pr1' }],
      ...overrides,
    } as unknown as Snapshot);

  const vehiclesDb = (): FakeDb => ({ id: 'db-vehicles', title: 'Véhicules', properties: columnsOf(VEHICLES), pages: [{ id: 'page-bike', properties: { 'ID app': rich('bike') } }] });
  const itemsDb = (): FakeDb => ({ id: 'db-items', title: 'Articles', properties: columnsOf(ITEMS), pages: [] });
  const journalDbs = (pages: Partial<Record<string, any[]>> = {}): FakeDb[] =>
    [SESSIONS, INTERVENTIONS, USED].map((db) => ({ id: `db-${db.key}`, title: db.title, properties: columnsOf(db), pages: pages[db.key] ?? [] }));
  const plansDb = (pages: any[] = [], properties: Record<string, string> = {}): FakeDb => {
    const base = handMade.find((d) => d.id === 'db-plans')!;
    return { ...base, properties: { ...base.properties, ...properties }, pages };
  };
  const planPage = (id: string, extra: Record<string, unknown> = {}, vehicles = ['page-bike']) => ({
    id,
    properties: {
      Plan: { type: 'title', title: [{ plain_text: 'Plan du propriétaire' }] },
      Véhicule: { type: 'relation', relation: vehicles.map((v) => ({ id: v })) },
      Tâche: { type: 'relation', relation: [{ id: 'n-rt1' }] },
      ...extra,
    },
  });
  const world = (plans: FakeDb | null, journal: FakeDb[] = journalDbs()) =>
    fakeWorkspace([vehiclesDb(), itemsDb(), ...journal, ...(plans ? [plans] : []), ...handMade.filter((d) => d.id !== 'db-plans')]);
  const run = (client: NotionClient, s: Snapshot, options = {}) => pushAll(client, 'parent', s, '2026-11-01', messagesFor('fr'), () => undefined, options);

  /** Every recorded write that reaches one of the owner's hand-made databases. */
  const handMadeWrites = (writes: Write[]) =>
    writes.filter(
      (w) =>
        [...handMadeSources].some((ds) => w.path.includes(ds)) ||
        (w.method === 'POST' && w.path === '/pages' && handMadeSources.has(w.body?.parent?.data_source_id)) ||
        w.path.startsWith('/pages/plan-'),
    );
  /** The only writes allowed there: a new plan page with its three fields, or the two "Dernier fait" columns of a plan page. */
  function expectOnlyAllowedWrites(writes: Write[]) {
    for (const w of handMadeWrites(writes)) {
      if (w.method === 'POST') {
        expect(w.path).toBe('/pages');
        expect(w.body.parent.data_source_id).toBe('ds-db-plans');
        expect(Object.keys(w.body.properties).sort()).toEqual([...ALLOWED_PLAN_COLUMNS].sort());
      } else {
        expect(w.method).toBe('PATCH');
        expect(w.path).toMatch(/^\/pages\/plan-/);
        expect(Object.keys(w.body.properties).every((k) => LAST_COLUMNS.includes(k))).toBe(true);
      }
    }
  }

  describe('plan pages', () => {
    it('creates one for a task that has none, with exactly the title, the vehicle and the task', async () => {
      const { client, writes } = world(plansDb());
      const created: [string, string][] = [];
      const result = await run(client, snap(), { onPlanCreated: (taskId: string, pageId: string) => created.push([taskId, pageId]) });
      const posts = writes.filter((w) => w.method === 'POST' && w.body?.parent?.data_source_id === 'ds-db-plans');
      expect(posts).toHaveLength(1);
      expect(Object.keys(posts[0]!.body.properties).sort()).toEqual(['Plan', 'Tâche', 'Véhicule']);
      expect(posts[0]!.body.properties.Véhicule).toEqual({ relation: [{ id: 'page-bike' }] });
      expect(posts[0]!.body.properties.Tâche).toEqual({ relation: [{ id: 'n-rt1' }] });
      expect(posts[0]!.body.properties.Plan.title[0].text.content).toBe('Vidange · Moto test');
      expect(result.createdPlans).toEqual([{ taskId: 't1', pageId: 'plan-created-' + (writes.indexOf(posts[0]!) + 1) }]);
      expect(created).toEqual([['t1', result.createdPlans[0]!.pageId]]);
      // The new page also gets the last time the task was done (its baseline), as the two allowed columns.
      const patch = writes.find((w) => w.method === 'PATCH' && w.path === `/pages/${result.createdPlans[0]!.pageId}`)!;
      expect(patch.body.properties).toEqual({ 'Dernier fait (km)': { number: 5000 }, 'Dernier fait (date)': { date: { start: '2026-01-10' } } });
      expectOnlyAllowedWrites(writes);
    });

    it('creates nothing when the task already has its plan page', async () => {
      const page = planPage('plan-1', { 'Dernier fait (km)': { type: 'number', number: 5000 }, 'Dernier fait (date)': { type: 'date', date: { start: '2026-01-10' } } });
      const { client, writes } = world(plansDb([page]));
      const result = await run(client, snap({ tasks: [task({ notionPlanId: 'plan-1' })] }));
      expect(handMadeWrites(writes)).toEqual([]);
      expect(result.createdPlans).toEqual([]);
    });

    it('does not duplicate a page the owner made, nor one a crashed run left before its id was kept', async () => {
      const { client, writes } = world(plansDb([planPage('plan-owner')]));
      const result = await run(client, snap());
      expect(writes.filter((w) => w.method === 'POST' && w.body?.parent?.data_source_id === 'ds-db-plans')).toEqual([]);
      expect(result.createdPlans).toEqual([]);
    });

    it('does not recreate a plan page the owner archived, nor make one for a task that was unlinked', async () => {
      // The archived page is not in the database query. Its task still points at it, or was unlinked (and paused) by the pull.
      const archived = world(plansDb());
      const a = await run(archived.client, snap({ tasks: [task({ notionPlanId: 'plan-gone' })] }));
      expect(a.createdPlans).toEqual([]);
      expect(handMadeWrites(archived.writes)).toEqual([]);

      // The pull pauses such a task and the next one links it again by name: it is paused, so it still gets no page.
      const paused = world(plansDb());
      expect((await run(paused.client, snap({ tasks: [task({ switchedOff: true })] }))).createdPlans).toEqual([]);
      expect(handMadeWrites(paused.writes)).toEqual([]);

      const unlinked = world(plansDb());
      const b = await run(unlinked.client, snap({ tasks: [task({ refTaskId: null, switchedOff: true })] }));
      expect(b.createdPlans).toEqual([]);
      expect(handMadeWrites(unlinked.writes)).toEqual([]);
    });

    it('makes none for a task of a sold vehicle, and warns when the Plans database is missing', async () => {
      const noPage = world(plansDb());
      const other = snap({ vehicles: [vehicle(), { ...vehicle(), id: 'car', name: 'Auto test', status: 'sold' as const }], tasks: [task({ vehicleId: 'car' })] });
      expect((await run(noPage.client, other)).createdPlans).toEqual([]);

      const missing = world(null);
      const result = await run(missing.client, snap());
      expect(result.warnings.join()).toContain('the database was not found');
      expect(handMadeWrites(missing.writes)).toEqual([]);
    });

    it('creates none, with a warning, when the Plans database lacks Plan, Véhicule or Tâche', async () => {
      const { client, writes } = world(plansDb([], { Tâche: 'rich_text' }));
      const result = await run(client, snap());
      expect(writes.filter((w) => w.method === 'POST' && w.body?.parent?.data_source_id === 'ds-db-plans')).toEqual([]);
      expect(result.warnings.join()).toContain('are needed to create plan pages');
    });
  });

  describe('"Dernier fait"', () => {
    const withValues = (km: number | null, start: string | null) =>
      planPage('plan-1', { 'Dernier fait (km)': { type: 'number', number: km }, 'Dernier fait (date)': { type: 'date', date: start ? { start } : null } });
    const linked = () => snap({ tasks: [task({ notionPlanId: 'plan-1' })] });

    it('is written when empty, and only the value that differs afterwards', async () => {
      const empty = world(plansDb([withValues(null, null)]));
      await run(empty.client, linked());
      expect(empty.writes.find((w) => w.path === '/pages/plan-1')!.body.properties).toEqual({
        'Dernier fait (km)': { number: 5000 },
        'Dernier fait (date)': { date: { start: '2026-01-10' } },
      });

      const sameKm = world(plansDb([withValues(5000, '2026-01-01')]));
      await run(sameKm.client, linked());
      expect(sameKm.writes.find((w) => w.path === '/pages/plan-1')!.body.properties).toEqual({ 'Dernier fait (date)': { date: { start: '2026-01-10' } } });

      const sameDate = world(plansDb([withValues(4000, '2026-01-10T00:00:00.000+01:00')]));
      await run(sameDate.client, linked());
      expect(sameDate.writes.find((w) => w.path === '/pages/plan-1')!.body.properties).toEqual({ 'Dernier fait (km)': { number: 5000 } });
    });

    it('is not written when it already matches', async () => {
      const { client, writes } = world(plansDb([withValues(5000, '2026-01-10')]));
      await run(client, linked());
      expect(handMadeWrites(writes)).toEqual([]);
    });

    it('is not written, with a warning, when a column is missing or of the wrong type', async () => {
      const { client, writes } = world(plansDb([withValues(null, null)], { 'Dernier fait (km)': 'rich_text' }));
      const result = await run(client, linked());
      expect(handMadeWrites(writes)).toEqual([]);
      expect(result.warnings.join()).toContain('"Dernier fait (km)" (number) and "Dernier fait (date)" (date) are needed');
    });

    it('is not written, with a warning, on a plan page that covers several vehicles', async () => {
      const page = planPage('plan-1', {}, ['page-bike', 'page-other']);
      const { client, writes } = world(plansDb([page]));
      const result = await run(client, linked());
      expect(handMadeWrites(writes)).toEqual([]);
      expect(result.warnings.join()).toContain('covers several vehicles');
    });
  });

  describe('the journal', () => {
    const service = (id: string, overrides: object = {}) => ({
      id,
      vehicleId: 'bike',
      date: '2026-09-01',
      odometer: 12_000,
      taskIds: ['t1'],
      notes: 'SERVICE-NOTE-SECRET',
      kind: 'maintenance',
      title: null,
      category: null,
      performedBy: 'diy',
      totalCost: 4242,
      partsUsed: [{ description: 'Huile test', partNumber: 'PN-SECRET', quantity: 3, unit: 'litre', price: 12.5, consumableTypeId: 'ct1', productId: 'pr1' }],
      ...overrides,
    });
    const withService = () => snap({ tasks: [task({ notionPlanId: 'plan-1' })], services: [service('s1')] });

    it('creates a session, an intervention and a line, related to the pages already held, with no private detail', async () => {
      const { client, writes } = world(plansDb([planPage('plan-1')]));
      await run(client, withService());
      const pageIn = (ds: string) => writes.find((w) => w.method === 'POST' && w.body?.parent?.data_source_id === ds)!.body.properties;
      const session = pageIn('ds-db-sessions');
      expect(session.Véhicule).toEqual({ relation: [{ id: 'page-bike' }] });
      expect(session.Km).toEqual({ number: 12_000 });
      expect(session['Réalisé par']).toEqual({ select: { name: 'Moi-même' } });
      expect(session.Type).toEqual({ select: { name: 'Entretien' } });
      const intervention = pageIn('ds-db-interventions');
      expect(intervention.Tâche).toEqual({ relation: [{ id: 'n-rt1' }] });
      expect(intervention.Plan).toEqual({ relation: [{ id: 'plan-1' }] });
      expect(intervention.Action).toEqual({ select: { name: 'Remplacement' } });
      expect(intervention.Séance.relation).toHaveLength(1);
      const line = pageIn('ds-db-used');
      expect(line['Type de consommable']).toEqual({ relation: [{ id: 'n-ct1' }] });
      expect(line['Produit utilisé']).toEqual({ relation: [{ id: 'n-pr1' }] });
      expect(line.Quantité).toEqual({ number: 3 });
      expect(line['Prix unitaire']).toEqual({ number: 12.5 });
      expect(line.Intervention.relation).toHaveLength(1);
      for (const secret of ['SERVICE-NOTE-SECRET', 'PN-SECRET', 'TASK-NOTE-SECRET', 'VF1TESTVIN', '4242']) expect(JSON.stringify(writes)).not.toContain(secret);
      expectOnlyAllowedWrites(writes);
    });

    it('leaves a relation empty when the task, plan or product has no Notion id', async () => {
      const { client, writes } = world(plansDb());
      await run(client, snap({ tasks: [task({ refTaskId: null })], services: [service('s1', { partsUsed: [{ description: 'Chiffon', partNumber: null, quantity: 1, unit: 'piece', price: null }] })] }));
      const pageIn = (ds: string) => writes.find((w) => w.method === 'POST' && w.body?.parent?.data_source_id === ds)!.body.properties;
      expect(pageIn('ds-db-interventions').Tâche).toEqual({ relation: [] });
      expect(pageIn('ds-db-interventions').Plan).toEqual({ relation: [] });
      expect(pageIn('ds-db-used')['Produit utilisé']).toEqual({ relation: [] });
      expect(pageIn('ds-db-used').Désignation.rich_text[0].text.content).toBe('Chiffon');
    });

    it('creates the relation columns that point at the owner’s databases only when those exist', async () => {
      const { client, writes } = fakeWorkspace([vehiclesDb(), itemsDb()]);
      await ensureDatabases(client, 'parent', () => undefined);
      const interventions = writes.find((w) => w.method === 'POST' && w.path === '/databases' && w.body.title[0].text.content === 'Interventions')!;
      expect(Object.keys(interventions.body.initial_data_source.properties)).toEqual(['Intervention', 'Séance', 'Action', 'ID app', 'Supprimé de l’app']);
    });

    it('applies the removal guard: nothing is ticked on an empty snapshot, a mass removal, or a snapshot with no vehicles', async () => {
      const pages = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id: `page-s-${id}`, properties: { 'ID app': rich(`s-${id}`), 'Supprimé de l’app': { type: 'checkbox', checkbox: false } } }));
      const ticks = (writes: Write[]) => writes.filter((w) => w.method === 'PATCH' && JSON.stringify(w.body).includes('"Supprimé de l’app":{"checkbox":true}'));

      const empty = world(plansDb(), journalDbs({ sessions: pages }));
      const a = await run(empty.client, snap());
      expect(ticks(empty.writes)).toEqual([]);
      expect(a.databases.find(([title]) => title === 'Séances')![1].warning).toContain('no page was marked');

      const mass = world(plansDb(), journalDbs({ sessions: pages }));
      const b = await run(mass.client, snap({ services: [service('s-a')] }));
      expect(ticks(mass.writes)).toEqual([]);
      expect(b.databases.find(([title]) => title === 'Séances')![1].warning).toContain('4 of 5 linked pages');

      const none = world(plansDb(), journalDbs({ sessions: pages }));
      const c = await run(none.client, snap({ vehicles: [], tasks: [] }));
      expect(ticks(none.writes)).toEqual([]);
      expect(c.databases.find(([title]) => title === 'Séances')![1].warning).toContain('no vehicles');
    });

    it('still ticks a single legitimate removal, and unticks a page whose record is back', async () => {
      const page = (id: string, removed: boolean) => ({ id: `page-${id}`, properties: { 'ID app': rich(id), 'Supprimé de l’app': { type: 'checkbox', checkbox: removed } } });
      const { client, writes } = world(plansDb(), journalDbs({ sessions: [page('s1', true), page('s-old', false)] }));
      await run(client, snap({ services: [service('s1')] }));
      const checks = writes.filter((w) => w.method === 'PATCH' && JSON.stringify(w.body).includes('Supprimé de l’app'));
      expect(checks.find((w) => w.path === '/pages/page-s-old')!.body.properties['Supprimé de l’app']).toEqual({ checkbox: true });
      expect(checks.find((w) => w.path === '/pages/page-s1')!.body.properties['Supprimé de l’app']).toEqual({ checkbox: false });
    });
  });

  it('writes and reads nothing on a dry run', async () => {
    const calls: string[] = [];
    const { client } = world(plansDb());
    const spy = { call: async (...args: Parameters<NotionClient['call']>) => (calls.push(`${args[0]} ${args[1]}`), client.call(...args)), all: async (...args: Parameters<NotionClient['all']>) => (calls.push(`${args[0]} ${args[1]}`), client.all(...args)) } as NotionClient;
    const result = await run(spy, withServiceSnap(), { dryRun: true });
    expect(calls).toEqual([]);
    expect(result).toEqual({ databases: [], createdPlans: [], warnings: [] });
  });

  function withServiceSnap() {
    return snap();
  }

  it('never writes anything but the allowed fields into the hand-made databases, whatever the run', async () => {
    const scenarios: [FakeDb | null, Snapshot][] = [
      [plansDb(), snap()],
      [plansDb([planPage('plan-1')]), snap({ tasks: [task({ notionPlanId: 'plan-1' })] })],
      [plansDb([planPage('plan-1', {}, ['page-bike', 'page-x'])]), snap({ tasks: [task({ notionPlanId: 'plan-1' })] })],
      [null, snap()],
    ];
    for (const [plans, s] of scenarios) {
      const { client, writes } = world(plans);
      await run(client, s);
      expectOnlyAllowedWrites(writes);
      // No column is ever created, renamed or removed in a hand-made database.
      expect(writes.filter((w) => w.path.startsWith('/data_sources/ds-db-') && handMadeSources.has(w.path.replace('/data_sources/', '')))).toEqual([]);
    }
  });
});
