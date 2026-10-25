import { describe, expect, it } from 'vitest';
import { annualKm, compareQuotes, currentCover, recentClaims, renewal } from './insurance.ts';
import type { Claim, Cover, InsurancePolicy, PolicyTerm, Quote, Snapshot } from './types.ts';
import { normalizeSnapshot } from './workshop.ts';

function cover(overrides: Partial<Cover> = {}): Cover {
  return {
    id: 'c',
    vehicleId: 'v',
    level: 'thirdParty',
    guarantees: null,
    excess: null,
    premium: 400,
    crm: 0.5,
    notes: null,
    ...overrides,
  };
}

function term(startDate: string, endDate: string, covers: Cover[] = [cover()]): PolicyTerm {
  return { id: `t-${startDate}`, policyId: 'p', startDate, endDate, notes: null, covers };
}

function policy(overrides: Partial<InsurancePolicy> = {}): InsurancePolicy {
  return {
    id: 'p',
    insurer: 'Assurance Exemple',
    policyNumber: null,
    startDate: '2025-04-01',
    cancelledDate: null,
    driverIds: [],
    notes: null,
    terms: [term('2025-04-01', '2026-04-01', [cover({ premium: 380 })]), term('2026-04-01', '2027-04-01')],
    ...overrides,
  };
}

function snapshot(data: Partial<Snapshot>): Snapshot {
  return normalizeSnapshot({ vehicles: [], tasks: [], services: [], readings: [], ...data } as Snapshot);
}

describe('currentCover', () => {
  it('finds the running Term’s Cover with the premium of the Term before', () => {
    const current = currentCover(snapshot({ policies: [policy()] }), 'v', '2026-10-25');
    expect(current).toMatchObject({ term: { startDate: '2026-04-01' }, cover: { premium: 400 }, previousPremium: 380 });
  });

  it('ignores a cancelled Policy and a Vehicle it does not cover', () => {
    expect(currentCover(snapshot({ policies: [policy({ cancelledDate: '2026-09-01' })] }), 'v', '2026-10-25')).toBeNull();
    expect(currentCover(snapshot({ policies: [policy()] }), 'other', '2026-10-25')).toBeNull();
  });

  it('keeps the last Term when its renewal has not been recorded yet', () => {
    expect(currentCover(snapshot({ policies: [policy()] }), 'v', '2027-05-01')?.term.startDate).toBe('2026-04-01');
  });
});

describe('renewal', () => {
  it('warns two months ahead, and is overdue once the Term ends without a new one', () => {
    expect(renewal(policy(), '2026-10-25')).toMatchObject({ date: '2027-04-01', status: 'ok' });
    expect(renewal(policy(), '2027-02-15')).toMatchObject({ status: 'dueSoon', daysRemaining: 45 });
    expect(renewal(policy(), '2027-04-01')?.status).toBe('overdue');
  });

  it('allows cancelling at any time after the first year (Loi Hamon)', () => {
    expect(renewal(policy({ startDate: '2026-04-01', terms: [term('2026-04-01', '2027-04-01')] }), '2026-10-25')?.canCancelAnyTime).toBe(
      false,
    );
    expect(renewal(policy(), '2026-10-25')?.canCancelAnyTime).toBe(true);
  });

  it('has nothing to renew on a cancelled Policy', () => {
    expect(renewal(policy({ cancelledDate: '2026-06-01' }), '2026-10-25')).toBeNull();
  });
});

describe('recentClaims', () => {
  const claim = (id: string, date: string): Claim => ({
    id,
    policyId: 'p',
    vehicleId: 'v',
    driverId: null,
    date,
    responsibility: 'notAtFault',
    amount: null,
    description: 'Parked, hit by a car',
    notes: null,
  });

  it('keeps five years of Claims, newest first', () => {
    const claims = [claim('old', '2021-10-24'), claim('a', '2021-10-25'), claim('b', '2025-01-10')];
    expect(recentClaims(snapshot({ claims }), '2026-10-25').map((c) => c.id)).toEqual(['b', 'a']);
  });
});

describe('compareQuotes', () => {
  const quote = (id: string, premium: number, validUntil: string | null = null): Quote => ({
    id,
    vehicleId: 'v',
    insurer: 'Assurance Exemple',
    date: '2026-10-01',
    level: 'thirdParty',
    guarantees: null,
    excess: null,
    premium,
    validUntil,
    notes: null,
  });

  it('sorts Quotes by price against the current premium', () => {
    const compared = compareQuotes(
      snapshot({ policies: [policy()], quotes: [quote('dear', 450), quote('cheap', 320, '2026-10-20')] }),
      'v',
      '2026-10-25',
    );
    expect(compared.map((c) => [c.quote.id, c.difference, c.expired])).toEqual([
      ['cheap', -80, true],
      ['dear', 50, false],
    ]);
  });
});

describe('annualKm', () => {
  it('rounds the projected yearly distance to the hundred', () => {
    expect(annualKm(16.4)).toBe(6000);
    expect(annualKm(null)).toBeNull();
  });
});
