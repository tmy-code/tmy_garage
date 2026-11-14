import { describe, expect, it } from 'vitest';
import { requiredConsumables } from './applicability.ts';
import { formFigure, markAdded, mergeNeeds, parsePlainNumber, prefillForType, prefillFromProduct, productChoices, usualQuantity } from './session-consumables.ts';
import type { ConsumableType, MaintenanceTask, Product, RefTask, Snapshot, VehicleConsumable } from './types.ts';

const product = (id: string, overrides: Partial<Product> = {}): Product => ({
  id,
  typeId: 'ct-oil',
  name: `Huile ${id}`,
  brand: 'Marque Exemple',
  reference: null,
  supplier: null,
  price: null,
  notes: null,
  notionId: `n-${id}`,
  ...overrides,
});

const oil: ConsumableType = { id: 'ct-oil', name: 'Huile moteur', category: null, family: 'fluid', notes: null, notionId: 'n-ct' };
const filter: ConsumableType = { id: 'ct-filter', name: 'Filtre', category: null, family: 'part', notes: null, notionId: 'n-cf' };

const row = (overrides: Partial<VehicleConsumable> = {}): VehicleConsumable => ({
  id: 'vc1',
  vehicleId: 'v1',
  name: 'Huile moteur',
  typeId: 'ct-oil',
  specification: '10W-40',
  oemRef: null,
  capacity: null,
  quantity: null,
  compatibleProductIds: [],
  chosenProductId: null,
  confirmation: null,
  notionId: 'n-vc1',
  ...overrides,
});

const ref = (id: string, overrides: Partial<RefTask> = {}): RefTask => ({
  id,
  name: id,
  action: 'replace',
  applicableIf: [],
  defaultKm: 6000,
  defaultMonths: 12,
  consumableTypeIds: [],
  componentTypeIds: [],
  toolIds: [],
  instructions: null,
  notionId: `n-${id}`,
  ...overrides,
});

const task = (id: string, refTaskId: string | null, action: MaintenanceTask['action'] = 'replace'): MaintenanceTask => ({
  id,
  vehicleId: 'v1',
  name: id,
  nameFr: null,
  action,
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
    tasks: [task('t-oil', 'rt-oil'), task('t-check', 'rt-check', 'inspect'), task('t-none', 'rt-none'), task('t-own', null)],
    services: [],
    readings: [],
    fillups: [],
    specLines: [],
    vehicleParts: [],
    documents: [],
    catalogue: [],
    refTasks: [ref('rt-oil', { consumableTypeIds: ['ct-oil', 'ct-filter'] }), ref('rt-check', { action: 'inspect', consumableTypeIds: ['ct-oil'] }), ref('rt-none')],
    componentTypes: [],
    consumableTypes: [oil, filter],
    products: [product('p-a'), product('p-b'), product('p-c'), product('p-f', { typeId: 'ct-filter' })],
    tools: [],
    vehicleConsumables: [row({ chosenProductId: 'p-c', compatibleProductIds: ['p-b', 'p-c'] })],
    componentSpecs: [],
    notionPurchases: [],
    notion: null,
    ...overrides,
  };
}

describe('required consumables of a session task', () => {
  const s = snapshot();

  it('lists one block per required type for a replacement, with the vehicle sheet where there is one', () => {
    const needs = requiredConsumables(s, 'v1', 't-oil');
    expect(needs.map((n) => n.type.id)).toEqual(['ct-oil', 'ct-filter']);
    expect(needs[0]!.rows.map((r) => r.id)).toEqual(['vc1']);
    expect(needs[1]!.rows).toEqual([]);
  });

  it('gives nothing for an inspection, a task that needs nothing, or a task of the app', () => {
    expect(requiredConsumables(s, 'v1', 't-check')).toEqual([]);
    expect(requiredConsumables(s, 'v1', 't-none')).toEqual([]);
    expect(requiredConsumables(s, 'v1', 't-own')).toEqual([]);
  });

  it('shows no sheet, but still the products of the type, for a vehicle with no row', () => {
    const [need] = requiredConsumables(s, 'v2', 't-oil');
    expect(need!.rows).toEqual([]);
    expect(productChoices(need!).map((c) => [c.product.id, c.group])).toEqual([['p-a', 'other'], ['p-b', 'other'], ['p-c', 'other']]);
  });
});

describe('productChoices', () => {
  it('puts the vehicle’s chosen product first, then the compatible ones, then the other products of the type', () => {
    const [need] = requiredConsumables(snapshot(), 'v1', 't-oil');
    expect(productChoices(need!).map((c) => [c.product.id, c.group])).toEqual([
      ['p-c', 'chosen'],
      ['p-b', 'compatible'],
      ['p-a', 'other'],
    ]);
  });

  it('does not offer the products of another type', () => {
    const [, need] = requiredConsumables(snapshot(), 'v1', 't-oil');
    expect(productChoices(need!).map((c) => c.product.id)).toEqual(['p-f']);
  });
});

describe('parsePlainNumber', () => {
  it('accepts a number written alone, with a point or a comma', () => {
    expect(parsePlainNumber('3')).toBe(3);
    expect(parsePlainNumber(' 3.2 ')).toBe(3.2);
    expect(parsePlainNumber('3,2')).toBe(3.2);
    expect(parsePlainNumber(4)).toBe(4);
  });

  it('refuses anything with a unit or words', () => {
    for (const text of ['3 L', '3,2 litres', 'au besoin', '', '1/2', '-1', null, undefined]) expect(parsePlainNumber(text)).toBeNull();
    expect(parsePlainNumber(Number.NaN)).toBeNull();
  });
});

describe('usualQuantity', () => {
  it('takes the first row with a quantity, else a capacity written as a bare number', () => {
    expect(usualQuantity([row({ quantity: null }), row({ id: 'x', quantity: 3.5 })])).toBe(3.5);
    expect(usualQuantity([row({ capacity: '4' })])).toBe(4);
    expect(usualQuantity([row({ capacity: '4 L' })])).toBeNull();
    expect(usualQuantity([row({ quantity: 0 })])).toBeNull();
    expect(usualQuantity([])).toBeNull();
  });
});

describe('prefillFromProduct', () => {
  it('fills the description with the product name only, its reference, the vehicle quantity, the price and the unit of its family', () => {
    const p = product('p-a', { name: 'Filtre à huile Honda 15410-MFJ-D01', brand: 'Honda', reference: '15410-MFJ-D01', price: 12.9 });
    expect(prefillFromProduct(p, oil, [row({ quantity: 3.2 })])).toEqual({
      description: 'Filtre à huile Honda 15410-MFJ-D01',
      partNumber: '15410-MFJ-D01',
      quantity: '3.2',
      unit: 'litre',
      price: '12.9',
      consumableTypeId: 'ct-oil',
      productId: 'p-a',
    });
  });

  it('leaves quantity and price empty when unknown, uses pieces for a part, and falls back to brand and reference without a name', () => {
    const p = product('p-x', { name: '', brand: 'Marque Exemple', reference: 'REF-1' });
    expect(prefillFromProduct(p, filter, [row({ quantity: null, capacity: '1 pièce' })])).toMatchObject({
      description: 'Marque Exemple REF-1',
      quantity: '',
      price: '',
      unit: 'piece',
    });
    expect(prefillFromProduct(product('p-y'), { ...oil, family: null }, [])).toMatchObject({ unit: null });
  });
});

describe('prefillForType', () => {
  it('knows the type, the unit and the usual quantity, and no product', () => {
    expect(prefillForType(oil, [row({ quantity: 3 })])).toEqual({ quantity: '3', unit: 'litre', consumableTypeId: 'ct-oil', productId: null });
  });
});

describe('mergeNeeds', () => {
  const s = snapshot({
    tasks: [task('t-oil', 'rt-oil'), task('t-filter', 'rt-filter'), task('t-check', 'rt-check', 'inspect'), task('t-own', null)],
    refTasks: [
      ref('rt-oil', { consumableTypeIds: ['ct-oil', 'ct-filter'], componentTypeIds: ['comp-plug'] }),
      ref('rt-filter', { consumableTypeIds: ['ct-filter'], componentTypeIds: ['comp-plug'] }),
      ref('rt-check', { action: 'inspect', consumableTypeIds: ['ct-oil'] }),
    ],
    componentTypes: [{ id: 'comp-plug', name: 'Bouchon', category: null, notes: null, notionId: 'n-comp' }],
    componentSpecs: [{ id: 'vs1', vehicleId: 'v1', label: 'Couple', componentTypeId: 'comp-plug', category: null, value: '25', unit: 'N·m', source: null, confirmation: null, notionId: 'n-vs' }],
  });

  it('gives one block per type, naming every ticked task that needs it, in the order of the tasks', () => {
    const merged = mergeNeeds(s, 'v1', ['t-oil', 't-filter']);
    expect(merged.map((m) => [m.type.id, m.taskIds])).toEqual([
      ['ct-oil', ['t-oil']],
      ['ct-filter', ['t-oil', 't-filter']],
    ]);
  });

  it('lists a torque value once even when two tasks share the component', () => {
    const [oilBlock, filterBlock] = mergeNeeds(s, 'v1', ['t-oil', 't-filter']);
    expect(oilBlock!.torque.map((x) => x.spec.id)).toEqual(['vs1']);
    expect(filterBlock!.torque.map((x) => x.spec.id)).toEqual(['vs1']);
  });

  it('leaves out inspections, tasks of the app and unticked tasks, and gives the ordered product choices', () => {
    const merged = mergeNeeds(s, 'v1', ['t-check', 't-own', 't-oil']);
    expect(merged.map((m) => m.type.id)).toEqual(['ct-oil', 'ct-filter']);
    expect(merged[0]!.choices.map((c) => [c.product.id, c.group])).toEqual([['p-c', 'chosen'], ['p-b', 'compatible'], ['p-a', 'other']]);
    expect(mergeNeeds(s, 'v1', [])).toEqual([]);
  });
});

describe('markAdded', () => {
  it('flags the products that already have a line, and still offers them', () => {
    const [need] = requiredConsumables(snapshot(), 'v1', 't-oil');
    const options = markAdded(productChoices(need!), ['p-b', null]);
    expect(options.map((o) => [o.product.id, o.added])).toEqual([['p-c', false], ['p-b', true], ['p-a', false]]);
  });
});

describe('formFigure', () => {
  it('writes a figure with the comma of the language', () => {
    expect(formFigure('3.2', true)).toBe('3,2');
    expect(formFigure(3.2, false)).toBe('3.2');
    expect(formFigure('12', true)).toBe('12');
  });
});
