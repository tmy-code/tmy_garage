import { describe, expect, it } from 'vitest';
import type { MaintenanceTask, Snapshot } from './types.ts';
import type { DueInfo } from './due.ts';
import { groupByCategory, normalizeSnapshot } from './workshop.ts';

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
  specLines: [],
  vehicleParts: [],
  purchases: [],
  documents: [],
  catalogue: [],
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
  it('fills in what an offline copy saved before the rework lacks', () => {
    const old = { vehicles: [], tasks: [{ id: 't' }], services: [{ id: 's', partsUsed: [{ description: 'Oil', quantity: 1, unit: 'litre', price: 5 }] }], readings: [] } as unknown as Snapshot;
    const s = normalizeSnapshot(old);
    expect(s.tasks[0]).toMatchObject({ notes: null, category: null, action: 'replace', switchedOff: false });
    expect(s.services[0]).toMatchObject({ kind: 'maintenance', title: null, category: null, performedBy: 'diy', totalCost: null });
    expect(s.services[0]!.partsUsed).toEqual([{ description: 'Oil', partNumber: null, quantity: 1, unit: 'litre', price: 5, partId: null }]);
    expect(s.specLines).toEqual([]);
  });
});
