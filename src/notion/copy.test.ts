import { describe, expect, it } from 'vitest';
import { messagesFor } from '../shared/messages.ts';
import type { MaintenanceTask, Snapshot, SpecLine, Vehicle, VehiclePart } from '../shared/types.ts';
import { buildCopy, buildSummary } from './copy.ts';

const TODAY = '2026-11-01';
const fr = messagesFor('fr');

function vehicle(id: string, overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id,
    kind: 'motorcycle',
    name: `Moto ${id}`,
    make: 'Marque Exemple',
    model: 'Modèle Exemple',
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
    cylinders: 4,
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
    soldPrice: 4000,
    equipment: [],
    ...overrides,
  };
}

function spec(id: string, vehicleId: string, group: SpecLine['group']): SpecLine {
  return { id, vehicleId, label: `Ligne ${id}`, value: '10W-40, 3.2 L', oem: null, group, category: 'engine', sort: 0 };
}

function part(id: string, vehicleId: string, overrides: Partial<VehiclePart> = {}): VehiclePart {
  return {
    id,
    vehicleId,
    name: 'Huile Exemple 10W-40',
    partNumber: 'REF-000',
    unit: 'litre',
    quantity: 3.2,
    price: null,
    taskId: null,
    itemSpecId: null,
    specLineId: null,
    notes: 'Boutique Exemple',
    ...overrides,
  };
}

const oilChange: MaintenanceTask = {
  id: 't1',
  vehicleId: 'v1',
  name: 'Change engine oil',
  nameFr: 'Vidange moteur',
  action: 'replace',
  intervalKm: null,
  intervalMonths: 12,
  baselineDate: '2026-01-15',
  baselineOdometer: null,
  notes: null,
  category: 'engine',
  switchedOff: false,
};

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    vehicles: [vehicle('v1'), vehicle('v2', { ownership: 'sold' })],
    tasks: [oilChange],
    services: [],
    readings: [
      { id: 'r1', vehicleId: 'v1', date: '2026-08-01', odometer: 10_000 },
      { id: 'r2', vehicleId: 'v1', date: '2026-10-01', odometer: 11_000 },
    ],
    specLines: [spec('s1', 'v1', 'fluids'), spec('s2', 'v1', 'torque'), spec('s3', 'v2', 'parts')],
    vehicleParts: [part('p1', 'v1', { taskId: 't1', specLineId: 's1' }), part('p2', 'v1', { specLineId: 's2' }), part('p3', 'v2')],
    fillups: [],
    documents: [],
    catalogue: [],
    refTasks: [], componentTypes: [], consumableTypes: [], products: [], tools: [], itemSpecs: [], componentSpecs: [], notionPurchases: [], notion: null,
    ...overrides,
  };
}

describe('buildCopy', () => {
  it('copies owned Vehicles only, with their mileage and no identifying details', () => {
    const { vehicles } = buildCopy(snapshot(), TODAY, fr);
    expect(vehicles).toHaveLength(1);
    const [v] = vehicles;
    expect(v).toMatchObject({ appId: 'v1', kind: 'Moto', odometer: 11_000, odometerDate: '2026-10-01', copiedOn: TODAY });
    expect(v!.kmPerDay).toBeCloseTo(16.4, 1);
    expect(JSON.stringify(vehicles)).not.toContain('VF1TESTVIN');
    expect(JSON.stringify(vehicles)).not.toContain('4000');
  });

  it('no longer copies spec lines: the Caractéristiques database is frozen', () => {
    const copy = buildCopy(snapshot(), TODAY, fr);
    expect('specs' in copy).toBe(false);
    expect(JSON.stringify(copy)).not.toContain('Ligne s1');
  });

  it('no longer copies the Articles: the copy is Vehicles only (ADR 0008)', () => {
    expect(buildCopy(snapshot(), TODAY, fr)).not.toHaveProperty('items');
  });

  it('never copies notes or shops', () => {
    const text = JSON.stringify(buildCopy(snapshot(), TODAY, fr));
    expect(text).not.toContain('Boutique');
  });
});

describe('buildSummary', () => {
  it('lists the Build in French', () => {
    expect(buildSummary(vehicle('v1', { hasHydraulicClutch: true }), fr)).toBe(
      'Essence · Manuelle · Transmission finale : Chaîne · Refroidissement : Liquide · 4 cylindres · Embrayage hydraulique',
    );
  });
});
