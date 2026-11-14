import { describe, expect, it } from 'vitest';
import { buyStates, latestPurchase } from './purchases.ts';
import type { ConsumableType, MaintenanceTask, NotionPurchase, RefTask, Snapshot, ItemSpec } from './types.ts';

const oil: ConsumableType = { id: 'ct-oil', name: 'Huile moteur', category: null, family: 'fluid', notes: null, notionId: 'n-ct-oil' };
const filter: ConsumableType = { id: 'ct-filter', name: 'Filtre', category: null, family: 'part', notes: null, notionId: 'n-ct-filter' };

const line = (id: string, overrides: Partial<ItemSpec> = {}): ItemSpec => ({
  id,
  vehicleId: 'v1',
  name: id,
  typeId: 'ct-oil',
  specification: null,
  oemRef: null,
  capacity: null,
  quantity: null,
  compatibleProductIds: [],
  chosenProductId: null,
  confirmation: null,
  notionId: `n-${id}`,
  ...overrides,
});

const achat = (id: string, article: string, date: string, overrides: Partial<NotionPurchase> = {}): NotionPurchase => ({
  id,
  notionId: `n-${id}`,
  date,
  articleNotionId: `n-${article}`,
  productId: null,
  quantity: null,
  price: null,
  shop: null,
  ...overrides,
});

const ref = (id: string, consumableTypeIds: string[], action: RefTask['action'] = 'replace'): RefTask => ({
  id,
  name: id,
  action,
  applicableIf: [],
  defaultKm: 6000,
  defaultMonths: 12,
  consumableTypeIds,
  componentTypeIds: [],
  toolIds: [],
  instructions: null,
  notionId: `n-${id}`,
});

const task = (id: string, refTaskId: string | null): MaintenanceTask => ({
  id,
  vehicleId: 'v1',
  name: id,
  nameFr: null,
  action: 'replace',
  intervalKm: 6000,
  intervalMonths: 12,
  baselineDate: null,
  baselineOdometer: null,
  notes: null,
  category: null,
  switchedOff: false,
  refTaskId,
  notionPlanId: null,
});

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    vehicles: [],
    tasks: [task('t-oil', 'rt-oil'), task('t-oil-b', 'rt-oil-b'), task('t-check', 'rt-check'), task('t-own', null)],
    services: [],
    readings: [],
    fillups: [],
    specLines: [],
    vehicleParts: [],
    documents: [],
    catalogue: [],
    refTasks: [ref('rt-oil', ['ct-oil', 'ct-filter']), ref('rt-oil-b', ['ct-oil']), ref('rt-check', ['ct-oil'], 'inspect')],
    componentTypes: [],
    consumableTypes: [oil, filter],
    products: [],
    tools: [],
    itemSpecs: [line('vc-oil'), line('vc-filter', { typeId: 'ct-filter' })],
    componentSpecs: [],
    notionPurchases: [],
    notion: null,
    ...overrides,
  };
}

describe('latestPurchase', () => {
  const lines = [line('vc-oil')];

  it('returns an Achat dated after the last-done date', () => {
    expect(latestPurchase([achat('a1', 'vc-oil', '2026-06-01', { productId: 'p1', shop: 'Boutique Exemple' })], lines, '2026-05-01')).toEqual({ date: '2026-06-01', productId: 'p1', shop: 'Boutique Exemple' });
  });

  it('does not count an Achat on the same day, or before', () => {
    expect(latestPurchase([achat('a1', 'vc-oil', '2026-05-01')], lines, '2026-05-01')).toBeNull();
    expect(latestPurchase([achat('a1', 'vc-oil', '2026-04-30')], lines, '2026-05-01')).toBeNull();
  });

  it('counts any Achat when the task was never done', () => {
    const list = [achat('a1', 'vc-oil', '2020-01-01'), achat('a2', 'vc-oil', '2021-01-01')];
    expect(latestPurchase(list, lines, null)).toMatchObject({ date: '2021-01-01' });
  });

  it('takes the latest Achat over two lines of the same type, with its product and shop', () => {
    const two = [line('vc-oil'), line('vc-oil-2')];
    const list = [achat('a1', 'vc-oil', '2026-06-01', { productId: 'p1', shop: 'A' }), achat('a2', 'vc-oil-2', '2026-07-01', { productId: 'p2', shop: 'B' })];
    expect(latestPurchase(list, two, '2026-05-01')).toEqual({ date: '2026-07-01', productId: 'p2', shop: 'B' });
  });

  it('keeps the later one in the list on a tie', () => {
    const list = [achat('a1', 'vc-oil', '2026-06-01', { shop: 'first' }), achat('a2', 'vc-oil', '2026-06-01', { shop: 'second' })];
    expect(latestPurchase(list, lines, null)).toMatchObject({ shop: 'second' });
  });

  it('ignores the Achats of another article', () => {
    expect(latestPurchase([achat('a1', 'vc-other', '2026-06-01')], lines, null)).toBeNull();
  });

  it('gives nothing without lines', () => {
    expect(latestPurchase([achat('a1', 'vc-oil', '2026-06-01')], [], null)).toBeNull();
  });
});

describe('buyStates', () => {
  it('says, per required type, whether it was bought since the task was last done', () => {
    const s = snapshot({ notionPurchases: [achat('a1', 'vc-oil', '2026-06-01', { shop: 'Boutique Exemple' })] });
    const states = buyStates(s, 'v1', [{ taskId: 't-oil', lastDone: '2026-05-01' }]);
    expect(states.map((x) => [x.type.id, x.tracked, x.bought?.date ?? null])).toEqual([
      ['ct-oil', true, '2026-06-01'],
      ['ct-filter', true, null],
    ]);
  });

  it('is not tracked for a type the vehicle has no line for', () => {
    const s = snapshot({ itemSpecs: [line('vc-oil')] });
    const states = buyStates(s, 'v1', [{ taskId: 't-oil', lastDone: null }]);
    expect(states.find((x) => x.type.id === 'ct-filter')).toMatchObject({ tracked: false, bought: null });
  });

  it('keeps the lines of another vehicle apart', () => {
    const s = snapshot({ itemSpecs: [line('vc-oil', { vehicleId: 'v2' })], notionPurchases: [achat('a1', 'vc-oil', '2026-06-01')] });
    expect(buyStates(s, 'v1', [{ taskId: 't-oil-b', lastDone: null }])).toMatchObject([{ type: { id: 'ct-oil' }, tracked: false, bought: null }]);
  });

  it('gives one entry per type for several tasks, with the strictest date', () => {
    const s = snapshot({ notionPurchases: [achat('a1', 'vc-oil', '2026-03-01')] });
    const tasks = [
      { taskId: 't-oil', lastDone: '2026-01-01' },
      { taskId: 't-oil-b', lastDone: '2026-05-01' },
    ];
    const states = buyStates(s, 'v1', tasks);
    expect(states.map((x) => x.type.id)).toEqual(['ct-oil', 'ct-filter']);
    // The Achat is after the first task's date but before the second's: still to buy.
    expect(states[0]!.bought).toBeNull();
    expect(buyStates(s, 'v1', [tasks[0]!])[0]!.bought).toMatchObject({ date: '2026-03-01' });
  });

  it('uses the one known date when another task was never done', () => {
    const s = snapshot({ notionPurchases: [achat('a1', 'vc-oil', '2026-03-01')] });
    const states = buyStates(s, 'v1', [
      { taskId: 't-oil', lastDone: null },
      { taskId: 't-oil-b', lastDone: '2026-05-01' },
    ]);
    expect(states[0]!.bought).toBeNull();
  });

  it('gives nothing for an inspection or a task not linked to the catalogue', () => {
    const s = snapshot({ notionPurchases: [achat('a1', 'vc-oil', '2026-06-01')] });
    expect(buyStates(s, 'v1', [{ taskId: 't-check', lastDone: null }, { taskId: 't-own', lastDone: null }])).toEqual([]);
  });
});
