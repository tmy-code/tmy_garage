import { describe, expect, it } from 'vitest';
import { messagesFor } from '../client/i18n.ts';
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
    status: 'owned',
    onGaragePage: true,
    soldDate: null,
    soldOdometer: null,
    soldPrice: 4000,
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
    specLineId: null,
    toBuy: true,
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
    vehicles: [vehicle('v1'), vehicle('v2', { status: 'sold' })],
    tasks: [oilChange],
    services: [],
    readings: [
      { id: 'r1', vehicleId: 'v1', date: '2026-08-01', odometer: 10_000 },
      { id: 'r2', vehicleId: 'v1', date: '2026-10-01', odometer: 11_000 },
    ],
    specLines: [spec('s1', 'v1', 'fluids'), spec('s2', 'v1', 'torque'), spec('s3', 'v2', 'parts')],
    vehicleParts: [part('p1', 'v1', { taskId: 't1', specLineId: 's1' }), part('p2', 'v1', { specLineId: 's2' }), part('p3', 'v2')],
    purchases: [
      { id: 'b1', partId: 'p1', vehicleId: 'v1', date: '2026-01-10', quantity: 4, totalPaid: 40, shop: 'Boutique A', deliveryFees: 5, notes: null },
      { id: 'b2', partId: 'p1', vehicleId: 'v1', date: '2026-06-10', quantity: 3, totalPaid: 31, shop: null, deliveryFees: null, notes: null },
    ],
    documents: [],
    catalogue: [],
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

  it('copies Fluids and Parts specs of owned Vehicles, not torque or a sold Vehicle', () => {
    const { specs } = buildCopy(snapshot(), TODAY, fr);
    expect(specs.map((s) => s.appId)).toEqual(['s1']);
    expect(specs[0]).toMatchObject({ group: 'Fluides', category: 'Moteur' });
  });

  it('copies every item of owned Vehicles with its last price per unit and Due Date', () => {
    const { items } = buildCopy(snapshot(), TODAY, fr);
    expect(items.map((i) => i.appId)).toEqual(['p1', 'p2']);
    const [oil, other] = items;
    expect(oil).toMatchObject({
      specAppId: 's1',
      unit: 'litre',
      state: 'À acheter',
      lastUnitPrice: 10.33,
      task: 'Vidange moteur',
      dueDate: '2027-01-15',
      dueStatus: 'Dans les temps',
    });
    // Its Spec Line is torque, which is not copied, so there is nothing to link to.
    expect(other).toMatchObject({ specAppId: null, lastUnitPrice: null, task: null, dueDate: null });
  });

  it('never copies notes, shops or delivery fees', () => {
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
