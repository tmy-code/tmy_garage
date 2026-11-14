import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PlanRow, PurchaseRow, ReferencePull, RefTaskRow, ToolRow } from '../notion/reference.ts';
import { createApp, readSnapshot } from './app.ts';
import { openDatabase } from './db.ts';
import { applyPull } from './notion-apply.ts';

type Row = Record<string, any>;

let db: DatabaseSync;

beforeEach(() => {
  db = openDatabase(':memory:');
  db.exec(`INSERT INTO vehicles (id, garage_id, kind, name) VALUES ('bike', 'default', 'motorcycle', 'Moto test'), ('car', 'default', 'car', 'Auto test')`);
});

afterEach(() => db.close());

function emptyPull(overrides: Partial<ReferencePull> = {}): ReferencePull {
  const empty = () => ({ rows: [], complete: true, warnings: [] });
  return {
    tasks: empty(),
    componentTypes: empty(),
    consumableTypes: empty(),
    products: empty(),
    tools: empty(),
    plans: empty(),
    itemSpecs: empty(),
    componentSpecs: empty(),
    purchases: empty(),
    skippedPlanNotionIds: [],
    equipment: { bike: [], car: [] },
    vehiclePageIds: {},
    vehicleWarnings: [],
    vocabularies: {},
    ...overrides,
  };
}

function refTask(notionId: string, name: string, overrides: Partial<RefTaskRow> = {}): RefTaskRow {
  return {
    notionId,
    name,
    action: 'replace',
    applicableIf: [],
    defaultKm: 6000,
    defaultMonths: 12,
    consumableTypeNotionIds: [],
    componentTypeNotionIds: [],
    toolNotionIds: [],
    instructions: null,
    category: null,
    ...overrides,
  };
}

function plan(notionId: string, vehicleAppId: string, taskNotionId: string, overrides: Partial<PlanRow> = {}): PlanRow {
  return { notionId, name: 'Plan', vehicleAppId, taskNotionId, intervalKm: null, intervalMonths: null, lastKm: null, lastDate: null, notes: null, ...overrides };
}

function tool(notionId: string): ToolRow {
  return { notionId, name: `Outil ${notionId}`, kind: null, size: null, owned: true, price: null, notes: null };
}

const pull = (rows: { tasks?: RefTaskRow[]; plans?: PlanRow[]; tools?: ToolRow[]; equipment?: Record<string, string[]>; skipped?: string[] }) =>
  emptyPull({
    tasks: { rows: rows.tasks ?? [], complete: true, warnings: [] },
    plans: { rows: rows.plans ?? [], complete: true, warnings: [] },
    tools: { rows: rows.tools ?? [], complete: true, warnings: [] },
    skippedPlanNotionIds: rows.skipped ?? [],
    ...(rows.equipment ? { equipment: rows.equipment } : {}),
  });

const apply = (p: ReferencePull) => applyPull(db, 'default', p, readSnapshot(db));
const tasksOf = (vehicleId: string) => db.prepare('SELECT * FROM maintenance_tasks WHERE vehicle_id = ? ORDER BY name').all(vehicleId) as Row[];

describe('derived and explicit plans', () => {
  const catalogue = [
    refTask('rt-oil', 'Vidange'),
    refTask('rt-chain', 'Graissage chaîne', { applicableIf: ['Transmission chaîne'], defaultKm: 500, defaultMonths: null }),
    refTask('rt-belt', 'Courroie', { applicableIf: ['Transmission courroie'] }),
  ];

  it('derives a task for every applicable catalogue task without a plan, with the catalogue defaults', () => {
    const report = apply(pull({ tasks: catalogue, equipment: { bike: ['Transmission chaîne'], car: [] } }));
    expect(report.counts.maintenanceTasks.created).toBe(3);
    expect(tasksOf('bike')).toMatchObject([
      { name: 'Graissage chaîne', name_fr: 'Graissage chaîne', action: 'replace', interval_km: 500, interval_months: null, plan_auto: 1, notion_plan_id: null },
      { name: 'Vidange', interval_km: 6000, interval_months: 12, plan_auto: 1 },
    ]);
    expect(tasksOf('car').map((t) => t.name)).toEqual(['Vidange']);
    expect(JSON.parse(db.prepare("SELECT equipment FROM vehicles WHERE id = 'bike'").get()!.equipment as string)).toEqual(['Transmission chaîne']);
  });

  it('writes nothing the second time', () => {
    const p = pull({ tasks: catalogue, equipment: { bike: ['Transmission chaîne'], car: [] } });
    apply(p);
    const again = apply(p);
    expect(again.counts.maintenanceTasks).toEqual({ created: 0, updated: 0, removed: 0 });
    expect(again.counts.tasks).toEqual({ created: 0, updated: 0, removed: 0 });
    expect(tasksOf('bike')).toHaveLength(2);
  });

  it('honours an explicit plan: its override and notes, plan_auto off, linked to the page', () => {
    apply(pull({ tasks: catalogue, equipment: { bike: [], car: [] }, plans: [plan('pl-1', 'bike', 'rt-oil', { intervalKm: 4000, notes: 'Huile maison' })] }));
    expect(tasksOf('bike')).toHaveLength(1);
    expect(tasksOf('bike')[0]).toMatchObject({ interval_km: 4000, interval_months: 12, notes: 'Huile maison', plan_auto: 0, notion_plan_id: 'pl-1' });
  });

  it('turns a derived task into a plan task when its plan page appears', () => {
    const base = { tasks: catalogue, equipment: { bike: [], car: [] } };
    apply(pull(base));
    apply(pull({ ...base, plans: [plan('pl-1', 'bike', 'rt-oil', { intervalMonths: 6 })] }));
    expect(tasksOf('bike')).toHaveLength(1);
    expect(tasksOf('bike')[0]).toMatchObject({ interval_km: 6000, interval_months: 6, plan_auto: 0, notion_plan_id: 'pl-1' });
  });

  it('skips a catalogue task with no interval at all, with a warning', () => {
    const report = apply(pull({ tasks: [refTask('rt-x', 'Sans intervalle', { defaultKm: null, defaultMonths: null })] }));
    expect(tasksOf('bike')).toEqual([]);
    expect(report.warnings.join('\n')).toContain('Sans intervalle" has no interval in Notion, so it was not added');
  });

  it('keeps the old intervals, with a warning, when a linked task loses its interval in Notion', () => {
    apply(pull({ tasks: [refTask('rt-oil', 'Vidange')] }));
    const report = apply(pull({ tasks: [refTask('rt-oil', 'Vidange', { defaultKm: null, defaultMonths: null })] }));
    expect(tasksOf('bike')[0]).toMatchObject({ interval_km: 6000, interval_months: 12 });
    expect(report.warnings.join('\n')).toContain('keeps its current one');
  });

  it("files a task under the catalogue's category, and keeps the task's own when Notion has none", () => {
    apply(pull({ tasks: [refTask('rt-oil', 'Vidange', { category: 'engine' })] }));
    expect(tasksOf('bike')[0]).toMatchObject({ category: 'engine' });
    apply(pull({ tasks: [refTask('rt-oil', 'Vidange', { category: 'brakes' })] }));
    expect(tasksOf('bike')[0]).toMatchObject({ category: 'brakes' });
    apply(pull({ tasks: [refTask('rt-oil', 'Vidange')] }));
    expect(tasksOf('bike')[0]).toMatchObject({ category: 'brakes' });
  });

  it('follows the catalogue when its name and intervals change', () => {
    apply(pull({ tasks: [refTask('rt-oil', 'Vidange')] }));
    apply(pull({ tasks: [refTask('rt-oil', 'Vidange moteur', { defaultKm: 8000 })] }));
    expect(tasksOf('bike')).toHaveLength(1);
    expect(tasksOf('bike')[0]).toMatchObject({ name: 'Vidange moteur', interval_km: 8000, interval_months: 12 });
  });
});

describe('adoption', () => {
  const addTask = (id: string, name: string, km: number | null, months: number | null, extra = '') =>
    db.exec(`INSERT INTO maintenance_tasks (id, vehicle_id, name, interval_km, interval_months, baseline_date ${extra ? ', category' : ''}) VALUES ('${id}', 'bike', '${name}', ${km}, ${months}, '2026-01-01' ${extra ? `, '${extra}'` : ''})`);

  it('links an unlinked task with the same normalised name instead of duplicating it, keeping its baseline and category', () => {
    addTask('t-own', ' vidange ', 5000, 24, 'engine');
    addTask('t-wash', 'Lavage', null, 1);
    apply(pull({ tasks: [refTask('rt-oil', 'Vidange')] }));
    const bike = tasksOf('bike');
    expect(bike.map((t) => t.name)).toEqual(['Lavage', 'Vidange']);
    expect(bike.find((t) => t.id === 't-own')).toMatchObject({
      ref_task_id: db.prepare('SELECT id FROM ref_tasks').get()!.id,
      interval_km: 6000,
      interval_months: 12,
      plan_auto: 1,
      baseline_date: '2026-01-01',
      category: 'engine',
    });
    // Any other unlinked task is left alone.
    expect(bike.find((t) => t.id === 't-wash')).toMatchObject({ ref_task_id: null, interval_months: 1 });
  });

  it("replaces the app's intervals only with Notion values that are not empty", () => {
    addTask('t-own', 'Vidange', 5000, null);
    apply(pull({ tasks: [refTask('rt-oil', 'Vidange', { defaultKm: null, defaultMonths: 12 })] }));
    expect(tasksOf('bike')[0]).toMatchObject({ interval_km: 5000, interval_months: 12 });
  });

  it('gives identical intervals when the catalogue copies the standard ones', () => {
    addTask('t-own', 'Vidange', 6000, 12);
    const report = apply(pull({ tasks: [refTask('rt-oil', 'Vidange')] }));
    expect(tasksOf('bike')[0]).toMatchObject({ interval_km: 6000, interval_months: 12 });
    expect(tasksOf('bike')).toHaveLength(1);
    expect(report.counts.maintenanceTasks.created).toBe(1);
    expect(tasksOf('car')).toHaveLength(1);
  });
});

describe('pausing', () => {
  const base = { tasks: [refTask('rt-oil', 'Vidange')], equipment: { bike: [], car: [] } };

  it('unlinks and pauses a task whose plan page vanished, never recreating it', () => {
    apply(pull({ ...base, plans: [plan('pl-1', 'bike', 'rt-oil')] }));
    expect(tasksOf('bike')[0]).toMatchObject({ plan_auto: 0, switched_off: 0 });
    const id = tasksOf('bike')[0]!.id;

    const report = apply(pull(base));
    expect(report.pausedTasks).toBe(1);
    expect(tasksOf('bike')).toHaveLength(1);
    expect(tasksOf('bike')[0]).toMatchObject({ id, ref_task_id: null, notion_plan_id: null, switched_off: 1 });

    // A later sync does not bring back a second task or switch the paused one on.
    apply(pull(base));
    expect(tasksOf('bike')).toHaveLength(1);
    expect(tasksOf('bike')[0]).toMatchObject({ id, switched_off: 1 });
  });

  it('keeps the task of a plan that exists but could not be used, instead of pausing it', () => {
    apply(pull({ ...base, plans: [plan('pl-1', 'bike', 'rt-oil')] }));
    const report = apply(pull({ ...base, skipped: ['pl-1'] }));
    expect(report.pausedTasks).toBe(0);
    expect(tasksOf('bike')[0]).toMatchObject({ switched_off: 0, notion_plan_id: 'pl-1' });
  });

  it('pauses a task that no longer applies to the vehicle, keeping its history', () => {
    const tasks = [refTask('rt-chain', 'Graissage chaîne', { applicableIf: ['Transmission chaîne'] })];
    apply(pull({ tasks, equipment: { bike: ['Transmission chaîne'], car: [] } }));
    const id = tasksOf('bike')[0]!.id;
    db.exec(`INSERT INTO services (id, vehicle_id, date) VALUES ('s1', 'bike', '2026-02-01'); INSERT INTO service_tasks (service_id, task_id) VALUES ('s1', '${id}')`);

    const report = apply(pull({ tasks, equipment: { bike: ['Transmission courroie'], car: [] } }));
    expect(report.pausedTasks).toBe(1);
    expect(tasksOf('bike')[0]).toMatchObject({ id, ref_task_id: null, switched_off: 1 });
    expect(db.prepare('SELECT count(*) AS n FROM service_tasks WHERE task_id = ?').get(id)).toEqual({ n: 1 });
  });

  it('warns about a vehicle with no equipment', () => {
    const report = apply(pull({ ...base, equipment: { bike: [], car: ['ABS'] } }));
    expect(report.warnings.join('\n')).toContain('Vehicle "Moto test" has no equipment in Notion');
    expect(report.warnings.join('\n')).not.toContain('Auto test');
  });
});

describe('removal and its guards', () => {
  const visible = () => (db.prepare('SELECT count(*) AS n FROM tools WHERE notion_removed = 0').get() as { n: number }).n;
  const five = ['a', 'b', 'c', 'd', 'e'].map(tool);

  it('hides rows gone from Notion, and shows them again when they come back', () => {
    apply(pull({ tools: five }));
    expect(visible()).toBe(5);
    const report = apply(pull({ tools: five.slice(0, 4) }));
    expect(report.counts.tools).toEqual({ created: 0, updated: 0, removed: 1 });
    expect(visible()).toBe(4);
    expect(readSnapshot(db).tools).toHaveLength(4);
    expect(db.prepare('SELECT count(*) AS n FROM tools').get()).toEqual({ n: 5 });

    const back = apply(pull({ tools: five }));
    expect(back.counts.tools.updated).toBe(1);
    expect(visible()).toBe(5);
  });

  it('removes nothing when Notion returned no rows while rows are linked', () => {
    apply(pull({ tools: five }));
    const report = apply(pull({ tools: [] }));
    expect(visible()).toBe(5);
    expect(report.counts.tools.removed).toBe(0);
    expect(report.warnings.join('\n')).toContain('Notion returned no rows but 5 are linked');
  });

  it('removes nothing when more than max(3, half) of the linked rows would go', () => {
    apply(pull({ tools: five }));
    const report = apply(pull({ tools: five.slice(0, 1) }));
    expect(visible()).toBe(5);
    expect(report.warnings.join('\n')).toContain('4 of 5 rows are gone from Notion');
  });

  it('does not remove from a database that could not be read completely', () => {
    apply(pull({ tools: five }));
    const incomplete = pull({ tools: [] });
    incomplete.tools.complete = false;
    apply(incomplete);
    expect(visible()).toBe(5);
  });

  it('resolves the relations between referentials to the app ids', () => {
    const p = pull({ tasks: [refTask('rt-oil', 'Vidange', { toolNotionIds: ['a', 'missing'], consumableTypeNotionIds: ['ct-1'] })], tools: five.slice(0, 2) });
    p.consumableTypes.rows.push({ notionId: 'ct-1', name: 'Huile', category: null, family: 'fluid', notes: null });
    const report = apply(p);
    const [ref] = readSnapshot(db).refTasks;
    const toolIds = readSnapshot(db).tools.filter((t) => t.notionId === 'a').map((t) => t.id);
    expect(ref!.toolIds).toEqual(toolIds);
    expect(ref!.consumableTypeIds).toHaveLength(1);
    expect(report.warnings.join('\n')).toContain('a linked item is not in Notion');
  });
});

describe('all or nothing', () => {
  it('changes nothing when the pull fails halfway', () => {
    // Two plan pages claiming the same Notion id cannot both be stored: the second write fails.
    const p = pull({
      tasks: [refTask('rt-oil', 'Vidange')],
      tools: [tool('a')],
      plans: [plan('pl-same', 'bike', 'rt-oil'), plan('pl-same', 'car', 'rt-oil')],
      equipment: { bike: ['ABS'], car: [] },
    });
    expect(() => apply(p)).toThrow();
    expect(db.prepare('SELECT count(*) AS n FROM ref_tasks').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT count(*) AS n FROM tools').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT count(*) AS n FROM maintenance_tasks').get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT equipment FROM vehicles WHERE id = 'bike'").get()).toEqual({ equipment: '[]' });
    // The transaction is closed again: a later pull works.
    expect(() => apply(pull({ tools: [tool('a')] }))).not.toThrow();
  });
});

describe('the built-in templates once the catalogue is active', () => {
  const bike = { kind: 'motorcycle', make: 'Exemple', model: 'Test', fuel: 'petrol', transmission: 'manual', cooling: 'liquid', finalDrive: 'chain', cylinders: 2 };
  const json = (method: string, body?: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

  it('seeds built-in templates while the catalogue is empty, and stops once it has rows', async () => {
    const app = createApp(db);
    const before = await (await app.request('/api/vehicles', json('POST', { ...bike, name: 'Avant' }))).json();
    expect(tasksOf(before.id).length).toBeGreaterThan(0);

    apply(pull({ tasks: [refTask('rt-oil', 'Vidange')] }));

    const after = await (await app.request('/api/vehicles', json('POST', { ...bike, name: 'Après' }))).json();
    expect(tasksOf(after.id)).toEqual([]);
    const res = await app.request(`/api/vehicles/${after.id}/add-from-templates`, json('POST'));
    expect(await res.json()).toMatchObject({ added: 0, skipped: 'notion_catalogue' });
    expect(tasksOf(after.id)).toEqual([]);
  });
});

describe('the owner’s Achats (read only)', () => {
  const achat = (notionId: string, overrides: Partial<PurchaseRow> = {}): PurchaseRow => ({
    notionId,
    name: `Achat ${notionId}`,
    date: '2026-05-02',
    articleNotionId: 'article-1',
    productNotionId: null,
    quantity: 3,
    price: 31.5,
    shop: 'Boutique Exemple',
    ...overrides,
  });
  const withAchats = (rows: PurchaseRow[], complete = true) => emptyPull({ purchases: { rows, complete, warnings: [] } });
  const stored = () => db.prepare('SELECT * FROM ref_purchases ORDER BY notion_id').all() as Row[];

  it('stores them, resolving the product to its app id', () => {
    const products = emptyPull({ products: { rows: [{ notionId: 'prod-n', name: 'Huile test', typeNotionId: null, brand: null, reference: null, supplier: null, price: null, notes: null }], complete: true, warnings: [] } });
    const report = apply({ ...products, purchases: { rows: [achat('a1', { productNotionId: 'prod-n' })], complete: true, warnings: [] } });
    const productId = (db.prepare('SELECT id FROM products').get() as Row).id;
    expect(report.counts.purchases).toEqual({ created: 1, updated: 0, removed: 0 });
    expect(stored()).toMatchObject([{ notion_id: 'a1', date: '2026-05-02', article_notion_id: 'article-1', product_id: productId, quantity: 3, price: 31.5, shop: 'Boutique Exemple', notion_removed: 0 }]);
  });

  it('changes nothing the second time', () => {
    const p = withAchats([achat('a1'), achat('a2', { date: '2026-06-01' })]);
    apply(p);
    expect(apply(p).counts.purchases).toEqual({ created: 0, updated: 0, removed: 0 });
    expect(stored()).toHaveLength(2);
  });

  it('leaves the rows alone when the database could not be read completely', () => {
    apply(withAchats([achat('a1')]));
    apply(withAchats([], false));
    expect(stored()).toMatchObject([{ notion_id: 'a1', notion_removed: 0 }]);
  });

  it('keeps the rows when Notion returns none', () => {
    apply(withAchats([achat('a1')]));
    const report = apply(withAchats([]));
    expect(stored()).toMatchObject([{ notion_removed: 0 }]);
    expect(report.warnings.join('\n')).toContain('Achats: Notion returned no rows');
  });

  it('hides an Achat that vanished from Notion, and keeps it out of the snapshot', () => {
    apply(withAchats([achat('a1'), achat('a2')]));
    expect(readSnapshot(db).notionPurchases.map((x) => x.notionId)).toEqual(['a1', 'a2']);
    const report = apply(withAchats([achat('a1')]));
    expect(report.counts.purchases.removed).toBe(1);
    expect(stored().map((r) => r.notion_removed)).toEqual([0, 1]);
    expect(readSnapshot(db).notionPurchases.map((x) => x.notionId)).toEqual(['a1']);
  });
});
