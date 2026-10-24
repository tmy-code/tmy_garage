import { describe, expect, it } from 'vitest';
import { addMonths, daysBetween } from './dates.ts';
import { computeDue, estimateUsage, vehicleDue, type Usage } from './due.ts';
import type { MaintenanceTask, Service, Snapshot } from './types.ts';

function task(overrides: Partial<MaintenanceTask> = {}): MaintenanceTask {
  return {
    id: 'oil',
    vehicleId: 'bike',
    name: 'Engine oil and filter change',
    intervalKm: 6000,
    intervalMonths: 12,
    baselineDate: null,
    baselineOdometer: null,
    ...overrides,
  };
}

function service(date: string, odometer: number, taskIds = ['oil']): Service {
  return { id: `s-${date}`, vehicleId: 'bike', date, odometer, taskIds, notes: null };
}

const noUsage: Usage = { latest: null, kmPerDay: null, estimatedOdometer: null };

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
    expect(estimateUsage([], '2026-10-24')).toEqual(noUsage);
  });

  it('projects today from the recent rate', () => {
    const usage = estimateUsage(
      [
        { date: '2026-09-01', odometer: 10_000 },
        { date: '2026-10-01', odometer: 10_900 },
      ],
      '2026-10-11',
    );
    expect(usage.kmPerDay).toBe(30);
    expect(usage.estimatedOdometer).toBe(11_200);
  });

  it('ignores old riding seasons outside the window', () => {
    const usage = estimateUsage(
      [
        { date: '2025-01-01', odometer: 0 },
        { date: '2025-02-01', odometer: 9_000 }, // heavy use long ago
        { date: '2026-06-01', odometer: 9_100 },
        { date: '2026-07-01', odometer: 9_400 },
      ],
      '2026-07-01',
    );
    expect(usage.kmPerDay).toBe(10); // 300 km in June, not the early heavy use or the long gap
  });

  it('falls back to the reading before the window when the window is too short', () => {
    const usage = estimateUsage(
      [
        { date: '2025-10-01', odometer: 8_000 },
        { date: '2026-07-01', odometer: 9_400 },
      ],
      '2026-07-01',
    );
    expect(usage.kmPerDay).toBeCloseTo(1_400 / daysBetween('2025-10-01', '2026-07-01'));
  });

  it('has no rate when readings are too close together', () => {
    const usage = estimateUsage(
      [
        { date: '2026-10-01', odometer: 10_000 },
        { date: '2026-10-05', odometer: 10_400 },
      ],
      '2026-10-24',
    );
    expect(usage.kmPerDay).toBeNull();
    expect(usage.estimatedOdometer).toBe(10_400);
  });

  it('refuses a negative rate from a typo', () => {
    const usage = estimateUsage(
      [
        { date: '2026-01-01', odometer: 20_000 },
        { date: '2026-06-01', odometer: 2_000 },
      ],
      '2026-06-01',
    );
    expect(usage.kmPerDay).toBeNull();
  });
});

describe('computeDue', () => {
  it('is unknown when never done and no baseline', () => {
    expect(computeDue(task(), [], noUsage, '2026-10-24').status).toBe('unknown');
  });

  it('takes the time-based due date when riding is slow', () => {
    const services = [service('2026-04-01', 18_000)];
    const usage = estimateUsage([{ date: '2026-04-01', odometer: 18_000 }, { date: '2026-10-01', odometer: 19_830 }], '2026-10-01');
    const due = computeDue(task(), services, usage, '2026-10-01');
    expect(due.timeDueDate).toBe('2027-04-01');
    expect(due.dueOdometer).toBe(24_000);
    expect(due.dueDate).toBe('2027-04-01'); // 10 km/day reaches 24,000 km well after April
    expect(due.status).toBe('ok');
  });

  it('takes the projected distance date when riding is heavy', () => {
    const services = [service('2026-04-01', 18_000)];
    const usage = estimateUsage([{ date: '2026-04-01', odometer: 18_000 }, { date: '2026-05-01', odometer: 21_000 }], '2026-05-01');
    const due = computeDue(task(), services, usage, '2026-05-01');
    expect(usage.kmPerDay).toBe(100);
    expect(due.distanceDueDate).toBe('2026-05-31');
    expect(due.dueDate).toBe('2026-05-31');
    expect(due.kmRemaining).toBe(3_000);
    expect(due.status).toBe('ok');
  });

  it('is due soon within 10% of the distance interval', () => {
    const services = [service('2026-04-01', 18_000)];
    const usage = estimateUsage([{ date: '2026-04-01', odometer: 18_000 }, { date: '2026-05-01', odometer: 23_500 }], '2026-05-01');
    expect(computeDue(task(), services, usage, '2026-05-01').status).toBe('dueSoon');
  });

  it('is overdue once the projected odometer passes the due point', () => {
    const services = [service('2026-04-01', 18_000)];
    const usage = estimateUsage([{ date: '2026-04-01', odometer: 18_000 }, { date: '2026-05-01', odometer: 23_500 }], '2026-05-15');
    const due = computeDue(task(), services, usage, '2026-05-15');
    expect(usage.estimatedOdometer).toBe(26_067);
    expect(due.status).toBe('overdue');
  });

  it('is overdue after the time-based due date even without riding', () => {
    const services = [service('2025-01-10', 18_000)];
    const usage = estimateUsage([{ date: '2025-01-10', odometer: 18_000 }], '2026-02-01');
    expect(computeDue(task(), services, usage, '2026-02-01').status).toBe('overdue');
  });

  it('uses the most recent Service including the task', () => {
    const services = [service('2025-04-01', 12_000), service('2026-04-01', 18_000), service('2026-06-01', 19_000, ['chain'])];
    const due = computeDue(task(), services, noUsage, '2026-06-01');
    expect(due.lastDone).toEqual({ date: '2026-04-01', odometer: 18_000, source: 'service' });
  });

  it('falls back to the baseline until a Service is logged', () => {
    const t = task({ baselineDate: '2026-03-15', baselineOdometer: 17_500 });
    expect(computeDue(t, [], noUsage, '2026-04-01').lastDone).toEqual({ date: '2026-03-15', odometer: 17_500, source: 'baseline' });
    expect(computeDue(t, [service('2026-05-01', 18_000)], noUsage, '2026-05-01').lastDone?.source).toBe('service');
  });

  it('handles distance-only and time-only intervals', () => {
    const services = [service('2026-01-01', 10_000)];
    const usage = estimateUsage([{ date: '2026-01-01', odometer: 10_000 }], '2026-01-01');
    const distanceOnly = computeDue(task({ intervalMonths: null }), services, usage, '2026-01-01');
    expect(distanceOnly.timeDueDate).toBeNull();
    expect(distanceOnly.dueOdometer).toBe(16_000);
    expect(distanceOnly.distanceDueDate).toBeNull(); // no rate yet
    const timeOnly = computeDue(task({ intervalKm: null, intervalMonths: 24 }), services, usage, '2026-01-01');
    expect(timeOnly.dueDate).toBe('2028-01-01');
    expect(timeOnly.dueOdometer).toBeNull();
  });
});

describe('vehicleDue', () => {
  it('sorts the most urgent tasks first and merges readings with Services', () => {
    const snapshot: Snapshot = {
      vehicles: [],
      tasks: [task({ id: 'oil' }), task({ id: 'brake-fluid', intervalKm: null, intervalMonths: 24 }), task({ id: 'new', intervalMonths: 6 })],
      services: [service('2025-09-01', 15_000, ['oil', 'brake-fluid'])],
      readings: [{ id: 'r1', vehicleId: 'bike', date: '2026-10-01', odometer: 21_500 }],
    };
    const { usage, due } = vehicleDue(snapshot, 'bike', '2026-10-01');
    expect(usage.latest?.odometer).toBe(21_500);
    expect(due.map((d) => [d.taskId, d.status])).toEqual([
      ['oil', 'overdue'],
      ['brake-fluid', 'ok'],
      ['new', 'unknown'],
    ]);
  });
});
