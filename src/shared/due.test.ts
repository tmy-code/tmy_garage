import { describe, expect, it } from 'vitest';
import { addMonths, daysBetween } from './dates.ts';
import { computeDue, effectiveInterval, estimateUsage, vehicleDue, type Usage } from './due.ts';
import type { MaintenanceTask, Service, Snapshot } from './types.ts';

function task(overrides: Partial<MaintenanceTask> = {}): MaintenanceTask {
  return {
    id: 'oil',
    vehicleId: 'bike',
    name: 'Engine oil and filter change',
    nameFr: null,
    intervalKm: 6000,
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

function service(date: string, odometer: number, taskIds = ['oil']): Service {
  return { id: `s-${date}`, vehicleId: 'bike', date, odometer, taskIds, notes: null, partsUsed: [] };
}

const noUsage: Usage = { latest: null, kmPerDay: null };

describe('dates', () => {
  it('clamps month addition to the end of the month', () => {
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-10-24', 12)).toBe('2027-10-24');
  });

  it('counts days across DST changes', () => {
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
  });
});

describe('estimateUsage', () => {
  it('returns nothing without readings', () => {
    expect(estimateUsage([])).toEqual(noUsage);
  });

  it('measures the recent rate, keeping the latest logged value rather than guessing today’s', () => {
    const usage = estimateUsage([
      { date: '2026-09-01', odometer: 10_000 },
      { date: '2026-10-01', odometer: 10_900 },
    ]);
    expect(usage.kmPerDay).toBe(30);
    expect(usage.latest).toEqual({ date: '2026-10-01', odometer: 10_900 });
  });

  it('ignores old riding seasons outside the window', () => {
    const usage = estimateUsage([
      { date: '2025-01-01', odometer: 0 },
      { date: '2025-02-01', odometer: 9_000 }, // heavy use long ago
      { date: '2026-06-01', odometer: 9_100 },
      { date: '2026-07-01', odometer: 9_400 },
    ]);
    expect(usage.kmPerDay).toBe(10); // 300 km in June, not the early heavy use or the long gap
  });

  it('falls back to the reading before the window when the window is too short', () => {
    const usage = estimateUsage([
      { date: '2025-10-01', odometer: 8_000 },
      { date: '2026-07-01', odometer: 9_400 },
    ]);
    expect(usage.kmPerDay).toBeCloseTo(1_400 / daysBetween('2025-10-01', '2026-07-01'));
  });

  it('has no rate when readings are too close together', () => {
    const usage = estimateUsage([
      { date: '2026-10-01', odometer: 10_000 },
      { date: '2026-10-05', odometer: 10_400 },
    ]);
    expect(usage.kmPerDay).toBeNull();
    expect(usage.latest?.odometer).toBe(10_400);
  });

  it('refuses a negative rate from a typo', () => {
    const usage = estimateUsage([
      { date: '2026-01-01', odometer: 20_000 },
      { date: '2026-06-01', odometer: 2_000 },
    ]);
    expect(usage.kmPerDay).toBeNull();
  });
});

describe('computeDue', () => {
  it('is unknown when never done and no baseline', () => {
    expect(computeDue(task(), [], noUsage, '2026-10-24').status).toBe('unknown');
  });

  it('takes the time-based due date when riding is slow', () => {
    const services = [service('2026-04-01', 18_000)];
    const usage = estimateUsage([
      { date: '2026-04-01', odometer: 18_000 },
      { date: '2026-10-01', odometer: 19_830 },
    ]);
    const due = computeDue(task(), services, usage, '2026-10-01');
    expect(due.timeDueDate).toBe('2027-04-01');
    expect(due.dueOdometer).toBe(24_000);
    expect(due.dueDate).toBe('2027-04-01'); // 10 km/day reaches 24,000 km well after April
    expect(due.status).toBe('ok');
  });

  it('takes the projected distance date when riding is heavy', () => {
    const services = [service('2026-04-01', 18_000)];
    const usage = estimateUsage([
      { date: '2026-04-01', odometer: 18_000 },
      { date: '2026-05-01', odometer: 21_000 },
    ]);
    const due = computeDue(task(), services, usage, '2026-05-01');
    expect(usage.kmPerDay).toBe(100);
    expect(due.distanceDueDate).toBe('2026-05-31');
    expect(due.dueDate).toBe('2026-05-31');
    expect(due.kmRemaining).toBe(3_000);
    expect(due.status).toBe('ok');
  });

  it('is due soon within 10% of the distance interval', () => {
    const services = [service('2026-04-01', 18_000)];
    const usage = estimateUsage([
      { date: '2026-04-01', odometer: 18_000 },
      { date: '2026-05-01', odometer: 23_500 },
    ]);
    expect(computeDue(task(), services, usage, '2026-05-01').status).toBe('dueSoon');
  });

  it('is overdue on distance only once a logged odometer value passes the due point', () => {
    const services = [service('2026-04-01', 18_000)];
    const logged = [
      { date: '2026-04-01', odometer: 18_000 },
      { date: '2026-05-01', odometer: 23_500 },
    ];
    // Two weeks on, the rate would put it past 24 000 km, but nothing logged says so.
    const due = computeDue(task(), services, estimateUsage(logged), '2026-05-15');
    expect(due.kmRemaining).toBe(500);
    expect(due.status).toBe('dueSoon');
    const passed = estimateUsage([...logged, { date: '2026-05-15', odometer: 24_100 }]);
    expect(computeDue(task(), services, passed, '2026-05-15').status).toBe('overdue');
  });

  it('is overdue after the time-based due date even without riding', () => {
    const services = [service('2025-01-10', 18_000)];
    const usage = estimateUsage([{ date: '2025-01-10', odometer: 18_000 }]);
    expect(computeDue(task(), services, usage, '2026-02-01').status).toBe('overdue');
  });

  it('uses the most recent Service including the task', () => {
    const services = [service('2025-04-01', 12_000), service('2026-04-01', 18_000), service('2026-06-01', 19_000, ['chain'])];
    const due = computeDue(task(), services, noUsage, '2026-06-01');
    expect(due.lastDone).toEqual({ date: '2026-04-01', odometer: 18_000, source: 'service' });
  });

  it('leaves a Service logged without an odometer out of the distance, keeping its date', () => {
    const coolant = task({ id: 'coolant', intervalKm: null, intervalMonths: 36 });
    const services: Service[] = [service('2026-01-01', 10_000), { ...service('2026-07-14', 0, ['coolant']), odometer: null }];
    const snapshot = { tasks: [coolant], services, readings: [], inspections: [], partSpecs: [] } as unknown as Snapshot;
    const { usage, due } = vehicleDue(snapshot, 'bike', '2026-08-01');
    expect(usage.latest).toEqual({ date: '2026-01-01', odometer: 10_000 });
    expect(due[0]).toMatchObject({ lastDone: { date: '2026-07-14', odometer: null }, timeDueDate: '2029-07-14', status: 'ok' });
  });

  it('falls back to the baseline until a Service is logged', () => {
    const t = task({ baselineDate: '2026-03-15', baselineOdometer: 17_500 });
    expect(computeDue(t, [], noUsage, '2026-04-01').lastDone).toEqual({ date: '2026-03-15', odometer: 17_500, source: 'baseline' });
    expect(computeDue(t, [service('2026-05-01', 18_000)], noUsage, '2026-05-01').lastDone?.source).toBe('service');
  });

  it('handles distance-only and time-only intervals', () => {
    const services = [service('2026-01-01', 10_000)];
    const usage = estimateUsage([{ date: '2026-01-01', odometer: 10_000 }]);
    const distanceOnly = computeDue(task({ intervalMonths: null }), services, usage, '2026-01-01');
    expect(distanceOnly.timeDueDate).toBeNull();
    expect(distanceOnly.dueOdometer).toBe(16_000);
    expect(distanceOnly.distanceDueDate).toBeNull(); // no rate yet
    const timeOnly = computeDue(task({ intervalKm: null, intervalMonths: 24 }), services, usage, '2026-01-01');
    expect(timeOnly.dueDate).toBe('2028-01-01');
    expect(timeOnly.dueOdometer).toBeNull();
  });
});

describe('Official Interval', () => {
  const services = [service('2026-01-01', 10_000)];
  const usage = estimateUsage([{ date: '2026-01-01', odometer: 10_000 }]);

  it('applies the stricter interval for distance and time separately', () => {
    // Air filter: yours "1 year", official "19 200 km or 2 years" → 19 200 km or 1 year.
    const t = task({ intervalKm: null, intervalMonths: 12, officialIntervalKm: 19_200, officialIntervalMonths: 24 });
    expect(effectiveInterval(t)).toEqual({ km: 19_200, months: 12 });
    const due = computeDue(t, services, usage, '2026-01-01');
    expect(due.dueOdometer).toBe(29_200);
    expect(due.timeDueDate).toBe('2027-01-01');
  });

  it('keeps your interval when it is stricter than the official one', () => {
    const t = task({ intervalKm: 10_000, intervalMonths: 12, officialIntervalKm: 30_000, officialIntervalMonths: 24 });
    expect(effectiveInterval(t)).toEqual({ km: 10_000, months: 12 });
  });

  it('uses the official interval when it is stricter', () => {
    const t = task({ intervalKm: 48_000, intervalMonths: null, officialIntervalKm: 38_400 });
    expect(computeDue(t, services, usage, '2026-01-01').dueOdometer).toBe(48_400);
  });
});

describe('vehicleDue', () => {
  it('sorts the most urgent tasks first and merges readings with Services', () => {
    const snapshot: Snapshot = {
      vehicles: [],
      tasks: [
        task({ id: 'oil' }),
        task({ id: 'brake-fluid', intervalKm: null, intervalMonths: 24 }),
        task({ id: 'new', intervalMonths: 6 }),
      ],
      services: [service('2025-09-01', 15_000, ['oil', 'brake-fluid'])],
      readings: [{ id: 'r1', vehicleId: 'bike', date: '2026-10-01', odometer: 21_500 }],
      vehicleSpecs: [],
      partSpecs: [],
      positions: [],
      inspections: [],
      modifications: [],
      documents: [],
      drivers: [],
      policies: [],
      claims: [],
      quotes: [],
      catalogue: [],
    };
    const { usage, due } = vehicleDue(snapshot, 'bike', '2026-10-01');
    expect(usage.latest?.odometer).toBe(21_500);
    expect(due.map((d) => [d.taskId, d.status])).toEqual([
      ['oil', 'overdue'],
      ['brake-fluid', 'ok'],
      ['new', 'unknown'],
    ]);
  });

  it('pauses a Task whose part is not on the vehicle, last of all, keeping when it was last done', () => {
    const spec = (id: string, notFitted: boolean) => ({
      id,
      vehicleId: 'bike',
      standardPart: id === 'oil-spec' ? ('moto_engine_oil' as const) : ('moto_chain' as const),
      notFitted,
      name: id,
      nameFr: null,
      characteristics: null,
      oemReference: null,
      partNumbers: null,
      unit: 'piece' as const,
    });
    const snapshot: Snapshot = {
      vehicles: [],
      tasks: [task({ id: 'oil', standardPart: 'moto_engine_oil' }), task({ id: 'chain', standardPart: 'moto_chain' }), task({ id: 'belt', standardPart: 'moto_drive_belt' })],
      services: [service('2025-09-01', 15_000, ['oil', 'chain'])],
      readings: [],
      vehicleSpecs: [],
      partSpecs: [spec('oil-spec', false), spec('chain-spec', true)],
      positions: [],
      inspections: [],
      modifications: [],
      documents: [],
      drivers: [],
      policies: [],
      claims: [],
      quotes: [],
      catalogue: [],
    };
    const { due } = vehicleDue(snapshot, 'bike', '2026-10-01');
    // The chain is set aside; the vehicle does not list a drive belt at all.
    expect(due.map((d) => [d.taskId, d.status])).toEqual([
      ['oil', 'overdue'],
      ['chain', 'paused'],
      ['belt', 'paused'],
    ]);
    expect(due[1]).toMatchObject({ lastDone: { date: '2025-09-01' }, dueDate: null });
  });
});
