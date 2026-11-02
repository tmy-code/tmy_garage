import { describe, expect, it } from 'vitest';
import type { MaintenanceTask, PartUsed, Service, Snapshot } from './types.ts';
import { BUILT_IN_CATALOGUE } from './catalogue.ts';
import type { DueInfo } from './due.ts';
import { groupByCategory, normalizeSnapshot, shoppingList } from './workshop.ts';

function task(overrides: Partial<MaintenanceTask>): MaintenanceTask {
  return {
    id: 'oil',
    vehicleId: 'bike',
    name: 'Engine oil',
    nameFr: null,
    intervalKm: null,
    intervalMonths: 12,
    officialIntervalKm: null,
    officialIntervalMonths: null,
    baselineDate: null,
    baselineOdometer: null,
    workshopNotes: null,
    standardPart: null,
    category: null,
    switchedOff: false,
    requiredParts: [],
    tools: [],
    specIds: [],
    ...overrides,
  };
}

function part(overrides: Partial<PartUsed>): PartUsed {
  return {
    partSpecId: null,
    description: 'Part',
    partNumber: null,
    quantity: 1,
    unit: 'piece',
    price: null,
    supplier: null,
    ...overrides,
  };
}

function service(id: string, date: string, odometer: number, taskIds: string[], partsUsed: PartUsed[]): Service {
  return { id, vehicleId: 'bike', date, odometer, taskIds, notes: null, partsUsed };
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
      registration: null,
      firstRegistration: null,
      vin: null,
      version: null,
      fiscalPower: null,
      nationalType: null,
      purchaseDate: null,
      overnightParking: null,
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
      status: 'owned',
      onGaragePage: true,
      soldDate: null,
      soldOdometer: null,
      soldPrice: null,
    },
  ],
  tasks: [],
  services: [],
  readings: [],
  vehicleSpecs: [],
  partSpecs: [
    {
      id: 'oil-spec',
      vehicleId: 'bike',
      standardPart: 'moto_engine_oil',
      notFitted: false,
      name: 'Engine oil',
      nameFr: null,
      characteristics: '10W-40',
      oemReference: null,
      partNumbers: null,
      unit: 'litre',
    },
    {
      id: 'filter-spec',
      vehicleId: 'bike',
      standardPart: 'moto_oil_filter',
      notFitted: false,
      name: 'Oil filter',
      nameFr: null,
      characteristics: null,
      oemReference: null,
      partNumbers: 'HF204',
      unit: 'piece',
    },
  ],
  inspections: [],
  modifications: [],
  documents: [],
  drivers: [],
  policies: [],
  claims: [],
  quotes: [],
  catalogue: [],
};

const bike = base.vehicles[0]!;

describe('shoppingList', () => {
  const oilChange = task({
    id: 'oil',
    requiredParts: [
      { partSpecId: 'oil-spec', quantity: 3.2 },
      { partSpecId: 'filter-spec', quantity: 1 },
    ],
  });

  it('lists the Required Parts of Tasks coming due, with what was used last time', () => {
    const snapshot: Snapshot = {
      ...base,
      tasks: [oilChange, task({ id: 'chain', name: 'Chain lube', intervalMonths: 1 }), task({ id: 'later', intervalMonths: 60 })],
      services: [
        service(
          's1',
          '2025-11-01',
          15_000,
          ['oil', 'chain', 'later'],
          [part({ partSpecId: 'oil-spec', description: 'Motul 7100', quantity: 4, unit: 'litre' })],
        ),
      ],
    };
    const [bike] = shoppingList(snapshot, '2026-10-01');
    expect(bike!.items.map((i) => [i.partSpec.id, i.quantity, i.lastUsed?.part.description ?? null])).toEqual([
      ['oil-spec', 3.2, 'Motul 7100'],
      ['filter-spec', 1, null],
    ]);
    expect(bike!.tasksWithoutParts.map((t) => t.id)).toEqual(['chain']);
  });

  it('adds up a Part Spec needed by several Tasks, and skips sold vehicles', () => {
    const snapshot: Snapshot = {
      ...base,
      tasks: [oilChange, task({ id: 'top-up', name: 'Oil top-up', requiredParts: [{ partSpecId: 'oil-spec', quantity: 0.5 }] })],
    };
    expect(shoppingList(snapshot, '2026-10-01')).toEqual([]);
    const withHistory = { ...snapshot, services: [service('s1', '2025-11-01', 15_000, ['oil', 'top-up'], [])] };
    expect(shoppingList(withHistory, '2026-10-01')[0]!.items[0]).toMatchObject({ partSpec: { id: 'oil-spec' }, quantity: 3.7 });
    const sold = { ...withHistory, vehicles: [{ ...base.vehicles[0]!, status: 'sold' as const }] };
    expect(shoppingList(sold, '2026-10-01')).toEqual([]);
  });

  it('leaves the total to check when a Task does not say how much, and skips paused Tasks', () => {
    const unsure = task({ id: 'top-up', standardPart: 'moto_engine_oil', requiredParts: [{ partSpecId: 'oil-spec', quantity: null }] });
    const snapshot: Snapshot = { ...base, tasks: [oilChange, unsure], services: [service('s1', '2025-11-01', 15_000, ['oil', 'top-up'], [])] };
    expect(shoppingList(snapshot, '2026-10-01')[0]!.items[0]).toMatchObject({ partSpec: { id: 'oil-spec' }, quantity: null });
    // With its part set aside, the Task is paused and needs nothing.
    const setAside = { ...snapshot, tasks: [unsure], partSpecs: base.partSpecs.map((p) => ({ ...p, notFitted: true })) };
    expect(shoppingList(setAside, '2026-10-01')).toEqual([]);
  });
});

describe('groupByCategory', () => {
  it('groups Tasks by the category picked, else their part’s, in screen order, keeping their order and setting paused ones apart', () => {
    const due = (taskId: string, status: DueInfo['status'] = 'ok') => ({ taskId, status }) as DueInfo;
    const tasks = new Map(
      [
        task({ id: 'pads', standardPart: 'moto_brake_pads_front', category: 'chassis' }),
        task({ id: 'lube', name: 'Chain lube', category: 'transmission' }),
        task({ id: 'oil', standardPart: 'moto_engine_oil' }),
        task({ id: 'wash', name: 'Wash' }),
        task({ id: 'chain', standardPart: 'moto_chain' }),
        task({ id: 'belt', standardPart: 'moto_drive_belt' }),
      ].map((t) => [t.id, t]),
    );
    const groups = groupByCategory([due('chain', 'overdue'), due('wash'), due('pads'), due('belt', 'paused'), due('lube'), due('oil')], tasks, BUILT_IN_CATALOGUE);
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
  it('fills in what an offline copy saved before workshop data lacks', () => {
    const old = { vehicles: [], tasks: [{ id: 't' }], services: [{ id: 's' }], readings: [] } as unknown as Snapshot;
    const s = normalizeSnapshot(old);
    expect(s.tasks[0]).toMatchObject({ workshopNotes: null, standardPart: null, category: null, requiredParts: [], tools: [], specIds: [] });
    expect(s.services[0]!.partsUsed).toEqual([]);
    expect([s.vehicleSpecs, s.partSpecs]).toEqual([[], []]);
  });
});
