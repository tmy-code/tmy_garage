import { describe, expect, it } from 'vitest';
import type { MaintenanceTask, PartUsed, Service, Snapshot } from './types.ts';
import { fitments, normalizeSnapshot, shoppingList } from './workshop.ts';

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
      status: 'owned',
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
      standardPart: 'engineOil',
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
      standardPart: 'oilFilter',
      notFitted: false,
      name: 'Oil filter',
      nameFr: null,
      characteristics: null,
      oemReference: null,
      partNumbers: 'HF204',
      unit: 'piece',
    },
  ],
  positions: [{ id: 'rear', vehicleId: 'bike', name: 'Rear tyre' }],
  inspections: [],
  modifications: [],
  documents: [],
  drivers: [],
  policies: [],
  claims: [],
  quotes: [],
};

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
    const [rear] = fitments(snapshot, 'bike');
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
    expect(fitments(snapshot, 'bike')[0]!.current).toMatchObject({ label: 'Slip-on exhaust', modification: { id: 'm' } });
    const removed = { ...snapshot, modifications: [{ ...exhaust, removedDate: '2026-01-01' }] };
    const [rear] = fitments(removed, 'bike');
    expect(rear!.current?.label).toBe('Stock');
    expect(rear!.previous.map((p) => p.label)).toEqual(['Slip-on exhaust']);
  });

  it('shows an empty position when nothing was fitted yet', () => {
    expect(fitments(base, 'bike')).toEqual([{ position: base.positions[0], current: null, previous: [] }]);
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
});

describe('normalizeSnapshot', () => {
  it('fills in what an offline copy saved before workshop data lacks', () => {
    const old = { vehicles: [], tasks: [{ id: 't' }], services: [{ id: 's' }], readings: [] } as unknown as Snapshot;
    const s = normalizeSnapshot(old);
    expect(s.tasks[0]).toMatchObject({ workshopNotes: null, requiredParts: [], tools: [], specIds: [] });
    expect(s.services[0]!.partsUsed).toEqual([]);
    expect([s.vehicleSpecs, s.partSpecs, s.positions]).toEqual([[], [], []]);
  });
});
