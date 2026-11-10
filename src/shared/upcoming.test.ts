import { describe, expect, it } from 'vitest';
import type { MaintenanceTask, OdometerReading, Snapshot, Vehicle } from './types.ts';
import { upcoming, UPCOMING_PREVIEW } from './upcoming.ts';

const TODAY = '2026-11-01';

function vehicle(id: string, overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id,
    kind: 'car',
    name: id,
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
    equipment: [],
    ...overrides,
  };
}

/** A time-based Task last done on `baselineDate`. */
function task(id: string, vehicleId: string, baselineDate: string | null, intervalMonths = 12): MaintenanceTask {
  return {
    id,
    vehicleId,
    name: id,
    nameFr: null,
    intervalKm: null,
    intervalMonths,
    action: 'replace',
    baselineDate,
    baselineOdometer: null,
    notes: null,
    category: null,
    switchedOff: false,
  };
}

function reading(vehicleId: string, date = TODAY): OdometerReading {
  return { id: `r-${vehicleId}`, vehicleId, date, odometer: 10_000 };
}

function snapshot(vehicles: Vehicle[], tasks: MaintenanceTask[], readings: OdometerReading[]): Snapshot {
  return {
    vehicles,
    tasks,
    services: [],
    readings,
    specLines: [],
    vehicleParts: [],
    fillups: [],
    purchases: [],
    documents: [],
    catalogue: [],
    refTasks: [], componentTypes: [], consumableTypes: [], products: [], tools: [], vehicleConsumables: [], vehicleSpecs: [], notion: null,
  };
}

const ids = (items: ReturnType<typeof upcoming>) => items.map((i) => (i.kind === 'task' ? i.due.taskId : `${i.kind}:${i.vehicleId}`));

describe('upcoming', () => {
  it('lists urgent Tasks of every owned Vehicle first, most urgent on top', () => {
    const s = snapshot(
      [vehicle('car'), vehicle('bike', { kind: 'motorcycle' })],
      [task('car-soon', 'car', '2025-11-20'), task('bike-overdue', 'bike', '2025-09-01'), task('car-later', 'car', '2026-06-01')],
      [reading('car'), reading('bike')],
    );
    expect(ids(upcoming(s, TODAY))).toEqual(['bike-overdue', 'car-soon', 'car-later']);
  });

  it(`keeps only the next ${UPCOMING_PREVIEW} Tasks that are fine for now`, () => {
    const later = ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01'].map((d, i) =>
      task(`t${i}`, 'car', d),
    );
    const s = snapshot([vehicle('car')], [...later].reverse(), [reading('car')]);
    expect(ids(upcoming(s, TODAY))).toEqual(['t0', 't1', 't2', 't3', 't4']);
  });

  it('leaves out Tasks due more than a year away, never recorded, or on a sold Vehicle', () => {
    const s = snapshot(
      [vehicle('car'), vehicle('old', { status: 'sold' })],
      [task('far', 'car', '2026-01-01', 48), task('never', 'car', null), task('sold-overdue', 'old', '2024-01-01')],
      [reading('car')],
    );
    expect(upcoming(s, TODAY)).toEqual([]);
  });

  it('ends with a reminder for each Vehicle whose odometer reading is missing or stale', () => {
    const s = snapshot(
      [vehicle('car'), vehicle('bike'), vehicle('van')],
      [task('car-overdue', 'car', '2025-01-01')],
      [reading('car', '2026-09-01'), reading('bike')],
    );
    const items = upcoming(s, TODAY);
    expect(ids(items)).toEqual(['car-overdue', 'reading:car', 'reading:van']);
    expect(items.filter((i) => i.kind === 'reading').map((i) => i.kind === 'reading' && i.daysSince)).toEqual([61, null]);
  });
});
