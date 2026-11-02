import { describe, expect, it } from 'vitest';
import type { MaintenanceTask, PartUsed, Service, Snapshot } from './types.ts';
import { BUILT_IN_CATALOGUE } from './catalogue.ts';
import type { DueInfo } from './due.ts';
import { fitments, groupByCategory, normalizeSnapshot, positionsOf, shoppingList } from './workshop.ts';

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
    requiredParts: [],
    tools: [],
    specIds: [],
    ...overrides,
  };
}

function part(overrides: Partial<PartUsed>): PartUsed {
  return {
    partSpecId: null,
    positionId: null,
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
  positions: [{ id: 'rear', vehicleId: 'bike', standardPart: 'moto_tire_rear', name: 'moto_tire_rear' }],
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

describe('fitments', () => {
  it('derives what is fitted from the most recent Part Used at each position', () => {
    const snapshot: Snapshot = {
      ...base,
      services: [
        service('s1', '2024-04-01', 10_000, ['tyre'], [part({ positionId: 'rear', description: 'Pilot Road 4' })]),
        service(
          's2',
          '2026-05-02',
          21_340,
          ['tyre'],
          [part({ positionId: 'rear', description: 'Road 6' }), part({ description: 'Valve' })],
        ),
      ],
    };
    const [rear] = fitments(snapshot, bike);
    expect(rear!.current).toMatchObject({ date: '2026-05-02', odometer: 21_340, label: 'Road 6' });
    expect(rear!.previous.map((p) => p.label)).toEqual(['Pilot Road 4']);
  });

  it('counts a Modification at a position as fitted until it is removed', () => {
    const exhaust = {
      id: 'm',
      vehicleId: 'bike',
      name: 'Slip-on exhaust',
      fittedDate: '2025-06-01',
      fittedOdometer: 15_000,
      removedDate: null,
      positionId: 'rear',
      declaredToInsurer: true,
      notes: null,
    };
    const snapshot: Snapshot = {
      ...base,
      services: [service('s1', '2024-04-01', 10_000, ['tyre'], [part({ positionId: 'rear', description: 'Stock' })])],
      modifications: [exhaust],
    };
    expect(fitments(snapshot, bike)[0]!.current).toMatchObject({ label: 'Slip-on exhaust', modification: { id: 'm' } });
    const removed = { ...snapshot, modifications: [{ ...exhaust, removedDate: '2026-01-01' }] };
    const [rear] = fitments(removed, bike);
    expect(rear!.current?.label).toBe('Stock');
    expect(rear!.previous.map((p) => p.label)).toEqual(['Slip-on exhaust']);
  });

  it('shows an empty position when nothing was fitted yet', () => {
    expect(fitments(base, bike)).toEqual([{ position: base.positions[0], current: null, previous: [] }]);
  });

  it('lists Standard Part positions in catalogue order, then older free-named ones', () => {
    const snapshot: Snapshot = {
      ...base,
      positions: [
        { id: 'old', vehicleId: 'bike', standardPart: null, name: 'Top box' },
        ...base.positions,
        { id: 'chain', vehicleId: 'bike', standardPart: 'moto_chain', name: 'moto_chain' },
      ],
    };
    expect(positionsOf(snapshot, bike).map((p) => p.id)).toEqual(['rear', 'chain', 'old']);
  });

  it('hides the position of a part marked as not on the vehicle, unless something was fitted there', () => {
    const notFitted = { ...base.partSpecs[1]!, id: 'tyre-spec', standardPart: 'moto_tire_rear' as const, notFitted: true };
    const hidden: Snapshot = { ...base, partSpecs: [...base.partSpecs, notFitted] };
    expect(positionsOf(hidden, bike)).toEqual([]);
    const used: Snapshot = { ...hidden, services: [service('s1', '2024-04-01', 10_000, ['tyre'], [part({ positionId: 'rear' })])] };
    expect(positionsOf(used, bike).map((p) => p.id)).toEqual(['rear']);
  });
});

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
  it('groups Tasks by their part’s category or the one picked, in screen order, keeping their order and setting paused ones apart', () => {
    const due = (taskId: string, status: DueInfo['status'] = 'ok') => ({ taskId, status }) as DueInfo;
    const tasks = new Map(
      [
        task({ id: 'pads', standardPart: 'moto_brake_pads_front', category: 'body' }),
        task({ id: 'lube', name: 'Chain lube', category: 'drivetrain' }),
        task({ id: 'oil', standardPart: 'moto_engine_oil' }),
        task({ id: 'wash', name: 'Wash' }),
        task({ id: 'chain', standardPart: 'moto_chain' }),
        task({ id: 'belt', standardPart: 'moto_drive_belt' }),
      ].map((t) => [t.id, t]),
    );
    const groups = groupByCategory([due('chain', 'overdue'), due('wash'), due('pads'), due('belt', 'paused'), due('lube'), due('oil')], tasks, BUILT_IN_CATALOGUE);
    expect(groups.groups.map((g) => [g.category, g.due.map((d) => d.taskId)])).toEqual([
      ['engine', ['oil']],
      ['drivetrain', ['chain', 'lube']],
      ['brakes', ['pads']],
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
    expect([s.vehicleSpecs, s.partSpecs, s.positions]).toEqual([[], [], []]);
  });
});
