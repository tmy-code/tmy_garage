import { describe, expect, it } from 'vitest';
import { averageConsumption, consumptionOf, fillupProblem, fillupUnitPrice, sortFillups, type FillupLike } from './fuel.ts';

function fill(id: string, date: string, odometer: number | null, litres: number, fullTank = true): FillupLike {
  return { id, date, odometer, litres, totalPaid: litres * 1.7, fullTank };
}

describe('fillupUnitPrice', () => {
  it('is the total over the litres', () => {
    expect(fillupUnitPrice({ litres: 42, totalPaid: 71.4 })).toBeCloseTo(1.7, 10);
  });
});

describe('fillupProblem', () => {
  it('accepts a normal fill-up', () => {
    expect(fillupProblem({ litres: 42.1, totalPaid: 71.2 })).toBeNull();
  });
  it('flags litres outside 0.5 to 200, edges included as fine', () => {
    expect(fillupProblem({ litres: 0.4, totalPaid: 0.8 })).toBe('litres');
    expect(fillupProblem({ litres: 201, totalPaid: 300 })).toBe('litres');
    expect(fillupProblem({ litres: 0.5, totalPaid: 0.9 })).toBeNull();
    expect(fillupProblem({ litres: 200, totalPaid: 340 })).toBeNull();
  });
  it('flags a total above 2000', () => {
    expect(fillupProblem({ litres: 200, totalPaid: 2001 })).toBe('totalPaid');
  });
  it('flags a price per litre outside 0.2 to 10', () => {
    expect(fillupProblem({ litres: 40, totalPaid: 4 })).toBe('pricePerLitre');
    expect(fillupProblem({ litres: 40, totalPaid: 440 })).toBe('pricePerLitre');
    expect(fillupProblem({ litres: 40, totalPaid: 8 })).toBeNull();
    expect(fillupProblem({ litres: 40, totalPaid: 400 })).toBeNull();
  });
});

describe('consumptionOf', () => {
  it('works out consumption between two full tanks, from the litres of the second', () => {
    const result = consumptionOf([fill('a', '2026-01-01', 10_000, 40), fill('b', '2026-01-10', 10_500, 30)]);
    expect([...result.keys()]).toEqual(['b']);
    expect(result.get('b')).toMatchObject({ km: 500, litres: 30 });
    expect(result.get('b')!.lPer100).toBeCloseTo(6, 10);
  });

  it('adds the litres of top-ups in between, without a row of their own', () => {
    const result = consumptionOf([
      fill('a', '2026-01-01', 10_000, 40),
      fill('t', '2026-01-05', 10_200, 10, false),
      fill('b', '2026-01-10', 10_500, 20),
    ]);
    expect([...result.keys()]).toEqual(['b']);
    expect(result.get('b')).toMatchObject({ km: 500, litres: 30 });
  });

  it('breaks the chain at a full tank without a distance', () => {
    const result = consumptionOf([
      fill('a', '2026-01-01', 10_000, 40),
      fill('b', '2026-01-10', null, 30),
      fill('c', '2026-01-20', 11_000, 35),
      fill('d', '2026-01-30', 11_500, 30),
    ]);
    // c only restarts the chain; d is the first with a stretch.
    expect([...result.keys()]).toEqual(['d']);
    expect(result.get('d')).toMatchObject({ km: 500, litres: 30 });
  });

  it('gives nothing for an equal or lower distance, but the anchor still moves', () => {
    const result = consumptionOf([
      fill('a', '2026-01-01', 10_000, 40),
      fill('b', '2026-01-10', 10_000, 30),
      fill('c', '2026-01-20', 9_000, 30),
      fill('d', '2026-01-30', 9_400, 25),
    ]);
    expect([...result.keys()]).toEqual(['d']);
    expect(result.get('d')).toMatchObject({ km: 400, litres: 25 });
  });

  it('gives nothing with only top-ups', () => {
    expect(consumptionOf([fill('a', '2026-01-01', 10_000, 10, false), fill('b', '2026-01-05', 10_300, 10, false)]).size).toBe(0);
  });

  it('gives nothing for a first full tank alone, or an empty list', () => {
    expect(consumptionOf([fill('a', '2026-01-01', 10_000, 40)]).size).toBe(0);
    expect(consumptionOf([]).size).toBe(0);
  });

  it('orders same-day fill-ups by distance, then id, whatever the order given', () => {
    const list = [fill('z', '2026-01-10', 10_500, 30), fill('a', '2026-01-01', 10_000, 40), fill('y', '2026-01-10', null, 5, false)];
    expect(sortFillups(list).map((f) => f.id)).toEqual(['a', 'z', 'y']);
    expect(sortFillups([fill('b', '2026-01-10', 100, 1), fill('a', '2026-01-10', 100, 1)]).map((f) => f.id)).toEqual(['a', 'b']);
    expect(consumptionOf([...list].reverse())).toEqual(consumptionOf(list));
  });
});

describe('averageConsumption', () => {
  it('is null without any stretch', () => {
    expect(averageConsumption([])).toBeNull();
  });

  it('weighs by distance, not by the mean of the ratios', () => {
    // 10 L over 100 km (10 L/100) and 30 L over 900 km (3.33 L/100): mean of ratios 6.67, weighted 4.
    const spans = [
      { lPer100: 10, km: 100, litres: 10 },
      { lPer100: (30 / 900) * 100, km: 900, litres: 30 },
    ];
    expect(averageConsumption(spans)).toBeCloseTo(4, 10);
  });
});
