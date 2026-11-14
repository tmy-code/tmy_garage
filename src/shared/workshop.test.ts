import { describe, expect, it } from 'vitest';
import type { MaintenanceTask, Snapshot } from './types.ts';
import type { DueInfo } from './due.ts';
import { groupByCategory, itemSpecText, normalizeSnapshot, refKey } from './workshop.ts';

function task(overrides: Partial<MaintenanceTask>): MaintenanceTask {
  return {
    id: 'oil',
    vehicleId: 'bike',
    name: 'Engine oil',
    nameFr: null,
    intervalKm: null,
    intervalMonths: 12,
    action: 'replace',
    baselineDate: null,
    baselineOdometer: null,
    notes: null,
    category: null,
    switchedOff: false,
    ...overrides,
  };
}

const base: Snapshot = {
  vehicles: [
    {
      id: 'bike',
      kind: 'motorcycle',
      name: 'Bike',
      make: null,
      model: null,
      year: null,
      vin: null,
      firstRegistrationDate: null,
      purchaseDate: null,
      fuel: null,
      transmission: null,
      drivetrain: null,
      distribution: null,
      cooling: null,
      finalDrive: null,
      cylinders: null,
      hasHydraulicClutch: false,
      hasTurbo: false,
      hasDirectInjection: false,
      hasStartStop: false,
      hasAdblue: false,
      hasAc: false,
      hasAirSuspension: false,
      ownership: 'owned',
      onGaragePage: true,
      soldDate: null,
      soldOdometer: null,
      soldPrice: null,
      equipment: [],
    },
  ],
  tasks: [],
  services: [],
  readings: [],
  specLines: [],
  vehicleParts: [],
  fillups: [],
  documents: [],
  catalogue: [],
  refTasks: [], componentTypes: [], consumableTypes: [], products: [], tools: [], itemSpecs: [], componentSpecs: [], notionPurchases: [], notion: null,
};

describe('groupByCategory', () => {
  it('groups Tasks by the category picked, else other, in screen order, keeping their order and setting paused ones apart', () => {
    const due = (taskId: string, status: DueInfo['status'] = 'ok') => ({ taskId, status }) as DueInfo;
    const tasks = new Map(
      [
        task({ id: 'pads', category: 'chassis' }),
        task({ id: 'lube', name: 'Chain lube', category: 'transmission' }),
        task({ id: 'oil', category: 'engine' }),
        task({ id: 'wash', name: 'Wash' }),
        task({ id: 'chain', category: 'transmission' }),
        task({ id: 'belt', category: 'transmission' }),
      ].map((t) => [t.id, t]),
    );
    const groups = groupByCategory([due('chain', 'overdue'), due('wash'), due('pads'), due('belt', 'paused'), due('lube'), due('oil')], tasks);
    expect(groups.groups.map((g) => [g.category, g.due.map((d) => d.taskId)])).toEqual([
      ['engine', ['oil']],
      ['transmission', ['chain', 'lube']],
      ['chassis', ['pads']],
      ['other', ['wash']],
    ]);
    expect(groups.paused.map((d) => d.taskId)).toEqual(['belt']);
  });
});

describe('normalizeSnapshot', () => {
  it('gives an offline copy saved before the fuel log an empty list of fill-ups, and fills in a fill-up default', () => {
    const old = { vehicles: [], tasks: [], services: [], readings: [] } as unknown as Snapshot;
    expect(normalizeSnapshot(old).fillups).toEqual([]);
    const partial = { ...old, fillups: [{ id: 'f1', vehicleId: 'v1', date: '2026-01-01', litres: 40, totalPaid: 68 }] } as unknown as Snapshot;
    expect(normalizeSnapshot(partial).fillups[0]).toMatchObject({ odometer: null, notes: null, fullTank: true });
  });

  it('fills in what an offline copy saved before the rework lacks', () => {
    const old = { vehicles: [], tasks: [{ id: 't' }], services: [{ id: 's', partsUsed: [{ description: 'Oil', quantity: 1, unit: 'litre', price: 5 }] }], readings: [] } as unknown as Snapshot;
    const s = normalizeSnapshot(old);
    expect(s.tasks[0]).toMatchObject({ notes: null, category: null, action: 'replace', switchedOff: false });
    expect(s.services[0]).toMatchObject({ kind: 'maintenance', title: null, category: null, performedBy: 'diy', totalCost: null });
    expect(s.services[0]!.partsUsed).toEqual([{ description: 'Oil', partNumber: null, quantity: 1, unit: 'litre', price: 5, partId: null }]);
    expect(s.specLines).toEqual([]);
  });

  it('fills in the Notion referentials, equipment and status that an offline copy saved before the Notion sync lacks', () => {
    const old = { vehicles: [{ id: 'v', ownership: 'owned' }], tasks: [{ id: 't' }], services: [], readings: [] } as unknown as Snapshot;
    const s = normalizeSnapshot(old);
    expect(s.vehicles[0]!.equipment).toEqual([]);
    expect(s.tasks[0]).toMatchObject({ refTaskId: null, notionPlanId: null });
    for (const key of ['refTasks', 'componentTypes', 'consumableTypes', 'products', 'tools', 'itemSpecs', 'componentSpecs', 'notionPurchases'] as const) expect(s[key]).toEqual([]);
    expect(s.notion).toBeNull();
  });

  it('reads the old names of an older snapshot as the glossary terms', () => {
    const old = {
      vehicles: [{ id: 'v', status: 'sold' }],
      vehicleConsumables: [{ id: 'c', status: 'to_confirm' }],
      vehicleSpecs: [{ id: 's', status: 'confirmed' }, { id: 's2', status: null }],
      tasks: [],
      services: [],
      readings: [],
    } as unknown as Snapshot;
    const s = normalizeSnapshot(old) as unknown as Record<string, any>;
    expect(s.vehicles[0]).toMatchObject({ ownership: 'sold', onGaragePage: false });
    expect(s.vehicles[0]).not.toHaveProperty('status');
    expect(s.itemSpecs[0]).toMatchObject({ confirmation: 'to_confirm' });
    expect(s.itemSpecs[0]).not.toHaveProperty('status');
    expect(s.componentSpecs).toMatchObject([{ id: 's', confirmation: 'confirmed' }, { id: 's2', confirmation: null }]);
    expect(s.componentSpecs[0]).not.toHaveProperty('status');
    expect(s).not.toHaveProperty('vehicleSpecs');
    expect(s).not.toHaveProperty('vehicleConsumables');
  });

  it('gives a Vehicle Item no Item Spec when an older copy has none, and keeps the one it has', () => {
    const old = { vehicles: [], tasks: [], services: [], readings: [], vehicleParts: [{ id: 'p1', name: 'Huile' }, { id: 'p2', name: 'Filtre', itemSpecId: 'spec-1' }] } as unknown as Snapshot;
    expect(normalizeSnapshot(old).vehicleParts.map((p) => p.itemSpecId)).toEqual([null, 'spec-1']);
  });

  it('lets a snapshot with the new names pass through', () => {
    const fresh = {
      vehicles: [{ id: 'v', ownership: 'sold', onGaragePage: true }],
      itemSpecs: [{ id: 'c', confirmation: 'confirmed' }],
      componentSpecs: [{ id: 's', confirmation: 'to_confirm' }],
      tasks: [],
      services: [],
      readings: [],
    } as unknown as Snapshot;
    const s = normalizeSnapshot(fresh);
    expect(s.vehicles[0]).toMatchObject({ ownership: 'sold', onGaragePage: true });
    expect(s.itemSpecs[0]).toMatchObject({ confirmation: 'confirmed' });
    expect(s.componentSpecs).toMatchObject([{ id: 's', confirmation: 'to_confirm' }]);
  });

  it('keeps the consumable type and product of a part used when they are there', () => {
    const queued = { vehicles: [], tasks: [], services: [{ id: 's', partsUsed: [{ description: 'Oil', quantity: 1, unit: 'litre', consumableTypeId: 'c1', productId: 'p1' }] }], readings: [] } as unknown as Snapshot;
    expect(normalizeSnapshot(queued).services[0]!.partsUsed[0]).toMatchObject({ consumableTypeId: 'c1', productId: 'p1' });
  });
});

describe('itemSpecText', () => {
  it('says the name with its specification and capacity, or the name alone', () => {
    expect(itemSpecText({ name: 'Huile moteur', specification: '10W-40', capacity: '3,2 L' })).toBe('Huile moteur: 10W-40, 3,2 L');
    expect(itemSpecText({ name: 'Huile moteur', specification: null, capacity: '3,2 L' })).toBe('Huile moteur: 3,2 L');
    expect(itemSpecText({ name: 'Huile moteur', specification: ' ', capacity: null })).toBe('Huile moteur');
  });
});

describe('refKey', () => {
  it('ignores case, accents and spacing', () => {
    expect(refKey('  À  Confirmer ')).toBe('a confirmer');
    expect(refKey(null)).toBe('');
  });
});
