import { describe, expect, it } from 'vitest';
import { applicableRefTasks, requiredConsumables, resolveInterval, torqueSpecs } from './applicability.ts';
import type { MaintenanceTask, RefTask, Snapshot } from './types.ts';

function ref(id: string, overrides: Partial<RefTask> = {}): RefTask {
  return {
    id,
    name: `Tâche ${id}`,
    action: 'replace',
    applicableIf: [],
    defaultKm: 10_000,
    defaultMonths: 12,
    consumableTypeIds: [],
    componentTypeIds: [],
    toolIds: [],
    instructions: null,
    notionId: `notion-${id}`,
    ...overrides,
  };
}

function task(id: string, refTaskId: string | null, overrides: Partial<MaintenanceTask> = {}): MaintenanceTask {
  return {
    id,
    vehicleId: 'v1',
    name: id,
    nameFr: null,
    action: 'replace',
    intervalKm: 10_000,
    intervalMonths: 12,
    baselineDate: null,
    baselineOdometer: null,
    notes: null,
    category: null,
    switchedOff: false,
    refTaskId,
    notionPlanId: null,
    ...overrides,
  };
}

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    vehicles: [],
    tasks: [],
    services: [],
    readings: [],
    fillups: [],
    specLines: [],
    vehicleParts: [],
    documents: [],
    catalogue: [],
    refTasks: [],
    componentTypes: [],
    consumableTypes: [],
    products: [],
    tools: [],
    itemSpecs: [],
    componentSpecs: [],
    notionPurchases: [],
    notion: null,
    ...overrides,
  };
}

describe('applicableRefTasks', () => {
  const tasks = [
    ref('all'),
    ref('chain', { applicableIf: ['Transmission chaîne'] }),
    ref('both', { applicableIf: ['Transmission chaîne', 'Refroidissement liquide'] }),
  ];

  it('applies a task when every tag of "Applicable si" is in the equipment', () => {
    const ids = (equipment: string[]) => applicableRefTasks(tasks, equipment).map((r) => r.id);
    expect(ids(['Transmission chaîne'])).toEqual(['all', 'chain']);
    expect(ids(['Transmission chaîne', 'Refroidissement liquide', 'ABS'])).toEqual(['all', 'chain', 'both']);
    expect(ids(['Refroidissement liquide'])).toEqual(['all']);
  });

  it('compares tags without case or accents', () => {
    expect(applicableRefTasks(tasks, ['transmission CHAINE']).map((r) => r.id)).toEqual(['all', 'chain']);
  });

  it('applies a task with an empty "Applicable si" to every vehicle, even without equipment', () => {
    expect(applicableRefTasks(tasks, []).map((r) => r.id)).toEqual(['all']);
  });
});

describe('resolveInterval', () => {
  const t = ref('x', { defaultKm: 6000, defaultMonths: 12 });

  it('takes the default without a plan', () => {
    expect(resolveInterval(t, null)).toEqual({ intervalKm: 6000, intervalMonths: 12 });
  });

  it("takes the plan's override for each interval that has one, else the default", () => {
    expect(resolveInterval(t, { intervalKm: 4000, intervalMonths: null })).toEqual({ intervalKm: 4000, intervalMonths: 12 });
    expect(resolveInterval(t, { intervalKm: null, intervalMonths: 6 })).toEqual({ intervalKm: 6000, intervalMonths: 6 });
  });
});

describe('requiredConsumables', () => {
  const base = snapshot({
    refTasks: [ref('oil', { consumableTypeIds: ['c-oil'] }), ref('check', { action: 'inspect', consumableTypeIds: ['c-oil'] }), ref('none')],
    tasks: [task('t-oil', 'oil'), task('t-check', 'check', { action: 'inspect' }), task('t-none', 'none'), task('t-own', null)],
    consumableTypes: [{ id: 'c-oil', name: 'Huile moteur', category: null, family: 'fluid', notes: null, notionId: 'n1' }],
    products: [
      { id: 'p-a', typeId: 'c-oil', name: 'Huile A', brand: null, reference: null, supplier: null, price: null, notes: null, notionId: 'np-a' },
      { id: 'p-b', typeId: 'c-oil', name: 'Huile B', brand: null, reference: null, supplier: null, price: null, notes: null, notionId: 'np-b' },
      { id: 'p-c', typeId: 'c-oil', name: 'Huile C', brand: null, reference: null, supplier: null, price: null, notes: null, notionId: 'np-c' },
      { id: 'p-z', typeId: 'c-other', name: 'Autre', brand: null, reference: null, supplier: null, price: null, notes: null, notionId: 'np-z' },
    ],
    itemSpecs: [
      {
        id: 'vc1',
        vehicleId: 'v1',
        name: 'Huile moteur',
        typeId: 'c-oil',
        specification: '10W-40',
        oemRef: null,
        capacity: '3 L',
        quantity: 3,
        compatibleProductIds: ['p-b', 'p-c'],
        chosenProductId: 'p-c',
        confirmation: 'confirmed',
        notionId: 'nvc1',
      },
    ],
  });

  it('lists the type with its rows and specification, products ordered chosen, compatible, then others of the type', () => {
    const [need] = requiredConsumables(base, 'v1', 't-oil');
    expect(need!.type.id).toBe('c-oil');
    expect(need!.rows.map((r) => r.id)).toEqual(['vc1']);
    expect(need!.spec).toBe('10W-40');
    expect(need!.products.map((p) => p.id)).toEqual(['p-c', 'p-b', 'p-a']);
  });

  it('gives nothing for an inspection, a task needing no type, or a task not linked to the catalogue', () => {
    expect(requiredConsumables(base, 'v1', 't-check')).toEqual([]);
    expect(requiredConsumables(base, 'v1', 't-none')).toEqual([]);
    expect(requiredConsumables(base, 'v1', 't-own')).toEqual([]);
    expect(requiredConsumables(base, 'v1', 'missing')).toEqual([]);
  });

  it('still lists the type, with the products of the type, when the vehicle has no row for it', () => {
    const [need] = requiredConsumables(base, 'v2', 't-oil');
    expect(need!.rows).toEqual([]);
    expect(need!.spec).toBeNull();
    expect(need!.products.map((p) => p.id)).toEqual(['p-a', 'p-b', 'p-c']);
  });
});

describe('torqueSpecs', () => {
  const spec = (id: string, overrides: object) => ({
    id,
    vehicleId: 'v1',
    label: id,
    componentTypeId: 'comp-plug',
    category: null,
    value: '25',
    unit: null,
    source: null,
    confirmation: null,
    notionId: `n-${id}`,
    ...overrides,
  });
  const s = snapshot({
    refTasks: [ref('oil', { componentTypeIds: ['comp-plug', 'comp-gone'] })],
    tasks: [task('t-oil', 'oil')],
    componentTypes: [
      { id: 'comp-plug', name: 'Bouchon de vidange', category: null, notes: null, notionId: 'nc1' },
      { id: 'comp-other', name: 'Autre', category: null, notes: null, notionId: 'nc2' },
    ],
    componentSpecs: [
      spec('torque', { unit: 'N·m' }),
      spec('torque-by-category', { category: 'Couple de serrage', unit: null }),
      spec('size', { unit: 'mm' }),
      spec('other-vehicle', { vehicleId: 'v2', unit: 'N·m' }),
      spec('other-component', { componentTypeId: 'comp-other', unit: 'N·m' }),
    ],
  });

  it("lists the torque values of the task's components for this vehicle only", () => {
    expect(torqueSpecs(s, 'v1', 't-oil').map((x) => [x.component.id, x.spec.id])).toEqual([
      ['comp-plug', 'torque'],
      ['comp-plug', 'torque-by-category'],
    ]);
  });

  it('gives nothing for a task not linked to the catalogue', () => {
    expect(torqueSpecs({ ...s, tasks: [task('t-oil', null)] }, 'v1', 't-oil')).toEqual([]);
  });
});
