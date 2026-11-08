import { describe, expect, it } from 'vitest';
import { addMonths, daysBetween } from './dates.ts';
import { computeDue, effectiveInterval, estimateOdometerAt, estimateUsage, pointsOf, usageOf, vehicleDue, type Usage } from './due.ts';
import type { MaintenanceTask, Service, Snapshot } from './types.ts';

function task(overrides: Partial<MaintenanceTask> = {}): MaintenanceTask {
  return {
    id: 'oil',
    vehicleId: 'bike',
    name: 'Engine oil and filter change',
    nameFr: null,
    intervalKm: 6000,
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

function service(date: string, odometer: number, taskIds = ['oil']): Service {
  return { id: `s-${date}`, vehicleId: 'bike', date, odometer, taskIds, notes: null, kind: 'maintenance', title: null, category: null, performedBy: 'diy', totalCost: null, partsUsed: [] };
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
    const snapshot = { tasks: [coolant], services, readings: [], fillups: [], inspections: [], partSpecs: [] } as unknown as Snapshot;
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

  it('takes distance and time as given, and the earlier of the two decides', () => {
    const t = task({ intervalKm: 19_200, intervalMonths: 12 });
    expect(effectiveInterval(t)).toEqual({ km: 19_200, months: 12 });
    const due = computeDue(t, services, usage, '2026-01-01');
    expect(due.dueOdometer).toBe(29_200);
    expect(due.timeDueDate).toBe('2027-01-01');
  });

  it('is Due Soon once a tenth of the interval is left, by distance or by time', () => {
    // Done at 10 000 km on 2025-09-01 with a 10 000 km interval: due at 20 000 km.
    const byKm = task({ intervalKm: 10_000, intervalMonths: null });
    const done = [service('2025-09-01', 10_000)];
    const at = (odometer: number) => estimateUsage([{ date: '2026-01-01', odometer }]);
    expect(computeDue(byKm, done, at(18_900), '2026-01-01').status).toBe('ok');
    expect(computeDue(byKm, done, at(19_000), '2026-01-01').status).toBe('dueSoon');
    expect(computeDue(byKm, done, at(20_001), '2026-01-01').status).toBe('overdue');
    // A 12-month interval is 365 days: Due Soon in the last 36 days.
    const byTime = task({ intervalKm: null, intervalMonths: 12 });
    const yearAgo = [service('2025-01-01', 5000)];
    expect(computeDue(byTime, yearAgo, noUsage, '2025-11-25').status).toBe('ok');
    expect(computeDue(byTime, yearAgo, noUsage, '2025-11-30').status).toBe('dueSoon');
    expect(computeDue(byTime, yearAgo, noUsage, '2026-01-02').status).toBe('overdue');
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
      specLines: [],
      vehicleParts: [],
      fillups: [],
      purchases: [],
      documents: [],
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

  it('pauses a Task the owner switched off, last of all, keeping when it was last done', () => {
    const snapshot: Snapshot = {
      vehicles: [],
      tasks: [task({ id: 'oil' }), task({ id: 'chain', switchedOff: true })],
      services: [service('2025-09-01', 15_000, ['oil', 'chain'])],
      readings: [],
      specLines: [],
      vehicleParts: [],
      fillups: [],
      purchases: [],
      documents: [],
      catalogue: [],
    };
    const { due } = vehicleDue(snapshot, 'bike', '2026-10-01');
    expect(due.map((d) => [d.taskId, d.status])).toEqual([
      ['oil', 'overdue'],
      ['chain', 'paused'],
    ]);
    expect(due[1]).toMatchObject({ lastDone: { date: '2025-09-01' }, dueDate: null });
  });
});

describe('estimateOdometerAt', () => {
  const points = [
    { date: '2026-01-01', odometer: 10_000 },
    { date: '2026-03-02', odometer: 12_000 },
  ];
  it('is null without any logged value', () => {
    expect(estimateOdometerAt([], '2026-01-01')).toBeNull();
  });
  it('interpolates between two logged values', () => {
    expect(estimateOdometerAt(points, '2026-01-31')).toBe(11_000);
  });
  it('goes back at the overall rate before the first value, never below zero', () => {
    expect(estimateOdometerAt(points, '2025-12-02')).toBe(9_000);
    expect(estimateOdometerAt([{ date: '2026-01-01', odometer: 100 }, { date: '2026-03-02', odometer: 12_000 }], '2025-06-01')).toBe(0);
  });
  it('goes forward at the recent rate after the last value', () => {
    expect(estimateOdometerAt(points, '2026-04-01')).toBe(13_000);
  });
});

describe('pointsOf and usageOf with fill-ups', () => {
  const fillup = (id: string, vehicleId: string, date: string, odometer: number | null) => ({ id, vehicleId, date, odometer, litres: 40, totalPaid: 68, fullTank: true, notes: null });
  const snapshot: Snapshot = {
    vehicles: [],
    tasks: [],
    services: [service('2026-01-01', 10_000)],
    readings: [{ id: 'r1', vehicleId: 'bike', date: '2026-02-01', odometer: 11_000 }],
    specLines: [],
    vehicleParts: [],
    fillups: [fillup('f1', 'bike', '2026-03-01', 12_000), fillup('f2', 'bike', '2026-03-05', null), fillup('f3', 'other', '2026-03-09', 99_999)],
    purchases: [],
    documents: [],
    catalogue: [],
  };

  it('includes the fill-ups of the vehicle with a distance, and skips the others', () => {
    expect(pointsOf(snapshot, 'bike')).toEqual([
      { date: '2026-02-01', odometer: 11_000 },
      { date: '2026-01-01', odometer: 10_000 },
      { date: '2026-03-01', odometer: 12_000 },
    ]);
  });

  it('leaves out the record being edited, whichever kind it is', () => {
    expect(pointsOf(snapshot, 'bike', 'f1')).toHaveLength(2);
    expect(pointsOf(snapshot, 'bike', 'r1')).toHaveLength(2);
    expect(pointsOf(snapshot, 'bike', 's-2026-01-01')).toHaveLength(2);
  });

  it('gives the latest value and a rate from fill-ups alone', () => {
    const only: Snapshot = { ...snapshot, services: [], readings: [], fillups: [fillup('a', 'bike', '2026-01-01', 10_000), fillup('b', 'bike', '2026-01-31', 11_500)] };
    const usage = usageOf(only, 'bike');
    expect(usage.latest).toEqual({ date: '2026-01-31', odometer: 11_500 });
    expect(usage.kmPerDay).toBeCloseTo(50, 10);
  });
});
