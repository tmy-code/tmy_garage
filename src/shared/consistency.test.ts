import { describe, expect, it } from 'vitest';
import { checkOdometer, findDuplicateService } from './consistency.ts';
import type { Service } from './types.ts';

const point = (date: string, odometer: number) => ({ date, odometer });

describe('checkOdometer', () => {
  const points = [point('2026-01-01', 10_000), point('2026-03-01', 12_000), point('2026-06-01', 15_000)];

  it('says nothing when the value fits between its neighbours', () => {
    expect(checkOdometer(points, { date: '2026-04-01', odometer: 13_000 })).toEqual({ tooLowFor: null, tooHighFor: null });
  });

  it('names the nearest earlier value that is higher', () => {
    const check = checkOdometer([point('2026-01-01', 20_000), point('2026-03-01', 12_000), point('2026-02-01', 14_000)], { date: '2026-04-01', odometer: 11_000 });
    expect(check.tooLowFor).toEqual(point('2026-03-01', 12_000));
    expect(check.tooHighFor).toBeNull();
  });

  it('names the earliest later value that is lower', () => {
    const check = checkOdometer(points, { date: '2026-02-01', odometer: 13_000 });
    expect(check.tooHighFor).toEqual(point('2026-03-01', 12_000));
    expect(check.tooLowFor).toBeNull();
  });

  it('reports both sides at once', () => {
    const check = checkOdometer([point('2026-01-01', 20_000), point('2026-06-01', 5_000)], { date: '2026-03-01', odometer: 10_000 });
    expect(check.tooLowFor).toEqual(point('2026-01-01', 20_000));
    expect(check.tooHighFor).toEqual(point('2026-06-01', 5_000));
  });

  it('accepts the same distance on another date', () => {
    expect(checkOdometer([point('2026-01-01', 10_000)], { date: '2026-02-01', odometer: 10_000 })).toEqual({ tooLowFor: null, tooHighFor: null });
    expect(checkOdometer([point('2026-03-01', 10_000)], { date: '2026-02-01', odometer: 10_000 })).toEqual({ tooLowFor: null, tooHighFor: null });
  });

  it('treats a same-day value as earlier, for the low check only', () => {
    expect(checkOdometer([point('2026-02-01', 12_000)], { date: '2026-02-01', odometer: 11_000 }).tooLowFor).toEqual(point('2026-02-01', 12_000));
    expect(checkOdometer([point('2026-02-01', 9_000)], { date: '2026-02-01', odometer: 11_000 })).toEqual({ tooLowFor: null, tooHighFor: null });
  });

  it('breaks a tie of dates by the highest distance', () => {
    const check = checkOdometer([point('2026-02-01', 12_000), point('2026-02-01', 13_000)], { date: '2026-03-01', odometer: 10_000 });
    expect(check.tooLowFor).toEqual(point('2026-02-01', 13_000));
  });

  it('says nothing without logged values', () => {
    expect(checkOdometer([], { date: '2026-02-01', odometer: 1 })).toEqual({ tooLowFor: null, tooHighFor: null });
  });
});

describe('findDuplicateService', () => {
  const service = (id: string, vehicleId: string, date: string, odometer: number | null): Service => ({
    id,
    vehicleId,
    date,
    odometer,
    taskIds: [],
    notes: null,
    kind: 'maintenance',
    title: null,
    category: null,
    performedBy: 'diy',
    totalCost: null,
    partsUsed: [],
  });
  const services = [service('s1', 'v1', '2026-05-01', 20_000), service('s2', 'v2', '2026-05-01', 20_000), service('s3', 'v1', '2026-05-02', null)];

  it('finds the same vehicle, date and distance', () => {
    expect(findDuplicateService(services, { vehicleId: 'v1', date: '2026-05-01', odometer: 20_000 })?.id).toBe('s1');
  });

  it('ignores another vehicle, date or distance', () => {
    expect(findDuplicateService(services, { vehicleId: 'v3', date: '2026-05-01', odometer: 20_000 })).toBeNull();
    expect(findDuplicateService(services, { vehicleId: 'v1', date: '2026-05-02', odometer: 20_000 })).toBeNull();
    expect(findDuplicateService(services, { vehicleId: 'v1', date: '2026-05-01', odometer: 20_001 })).toBeNull();
  });

  it('never matches without a distance, on either side', () => {
    expect(findDuplicateService(services, { vehicleId: 'v1', date: '2026-05-02', odometer: null })).toBeNull();
  });

  it('leaves out the Service being edited', () => {
    expect(findDuplicateService(services, { vehicleId: 'v1', date: '2026-05-01', odometer: 20_000 }, 's1')).toBeNull();
  });
});
