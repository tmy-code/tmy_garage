import { describe, expect, it } from 'vitest';
import { expiringDocuments, nextInspection, openDefects } from './inspections.ts';
import type { GarageDocument, Snapshot, TechnicalInspection, Vehicle } from './types.ts';

function vehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 'v',
    kind: 'car',
    name: 'Car',
    make: null,
    model: null,
    year: null,
    registration: null,
    firstRegistration: null,
    vin: null,
    version: null,
    fiscalPower: null,
    nationalType: null,
    purchaseDate: null,
    overnightParking: null,
    status: 'owned',
    soldDate: null,
    soldOdometer: null,
    soldPrice: null,
    ...overrides,
  };
}

function inspection(overrides: Partial<TechnicalInspection> = {}): TechnicalInspection {
  return {
    id: 'i',
    vehicleId: 'v',
    date: '2025-03-10',
    odometer: 90_000,
    centre: null,
    result: 'passed',
    nextDueDate: null,
    notes: null,
    defects: [],
    ...overrides,
  };
}

function snapshot(inspections: TechnicalInspection[] = [], documents: GarageDocument[] = []): Snapshot {
  return {
    vehicles: [],
    tasks: [],
    services: [],
    readings: [],
    vehicleSpecs: [],
    partSpecs: [],
    positions: [],
    inspections,
    modifications: [],
    documents,
    drivers: [],
    policies: [],
    claims: [],
    quotes: [],
  };
}

describe('nextInspection', () => {
  it('uses the date printed on the last report', () => {
    const next = nextInspection(snapshot([inspection({ nextDueDate: '2027-03-09' })]), vehicle(), '2026-10-25');
    expect(next).toMatchObject({ dueDate: '2027-03-09', basis: 'report', status: 'ok' });
  });

  it('estimates two years later for a car, three for a motorcycle', () => {
    expect(nextInspection(snapshot([inspection()]), vehicle(), '2026-10-25')).toMatchObject({ dueDate: '2027-03-10', basis: 'rhythm' });
    expect(nextInspection(snapshot([inspection()]), vehicle({ kind: 'motorcycle' }), '2026-10-25').dueDate).toBe('2028-03-10');
  });

  it('gives two months for a re-inspection after a failed one', () => {
    const failed = inspection({ date: '2026-10-01', result: 'majorDefects' });
    expect(nextInspection(snapshot([failed]), vehicle(), '2026-10-25')).toMatchObject({
      dueDate: '2026-12-01',
      basis: 'counterVisit',
      status: 'dueSoon',
    });
  });

  it('counts a car’s first inspection from its first registration', () => {
    const next = nextInspection(snapshot(), vehicle({ firstRegistration: '2022-06-15' }), '2026-10-25');
    expect(next).toMatchObject({ dueDate: '2026-06-15', basis: 'firstRegistration', status: 'overdue' });
  });

  it('follows the phased calendar for a motorcycle’s first inspection', () => {
    const bike = (firstRegistration: string) =>
      nextInspection(snapshot(), vehicle({ kind: 'motorcycle', firstRegistration }), '2026-10-25').dueDate;
    expect(bike('2019-03-20')).toBe('2025-07-20');
    expect(bike('2018-10-05')).toBe('2025-12-31');
    expect(bike('2016-05-01')).toBe('2024-09-01');
    expect(bike('2014-02-03')).toBe('2024-08-14');
    expect(bike('2021-01-10')).toBe('2026-05-10');
    expect(bike('2023-04-02')).toBe('2028-04-02');
  });

  it('cannot tell without an inspection or a first registration date', () => {
    expect(nextInspection(snapshot(), vehicle(), '2026-10-25')).toMatchObject({ dueDate: null, status: 'unknown' });
  });
});

describe('openDefects', () => {
  it('lists the latest inspection’s defects that no Service fixed', () => {
    const older = inspection({ id: 'old', date: '2023-01-01', defects: [{ description: 'Old', severity: 'minor', fixedServiceId: null }] });
    const latest = inspection({
      defects: [
        { description: 'Worn pads', severity: 'major', fixedServiceId: 's1' },
        { description: 'Wiper', severity: 'minor', fixedServiceId: null },
      ],
    });
    expect(openDefects(snapshot([older, latest]), vehicle()).map((d) => d.description)).toEqual(['Wiper']);
  });
});

describe('expiringDocuments', () => {
  const doc = (id: string, expiryDate: string | null): GarageDocument => ({
    id,
    vehicleId: 'v',
    ownerKind: 'vehicle',
    ownerId: 'v',
    type: 'other',
    title: null,
    issueDate: null,
    expiryDate,
    fileName: `${id}.pdf`,
    contentType: 'application/pdf',
    size: 1,
  });

  it('lists expired and soon-expiring Documents, soonest first', () => {
    const docs = [doc('later', '2027-06-01'), doc('soon', '2026-12-01'), doc('expired', '2026-01-01'), doc('never', null)];
    expect(expiringDocuments(snapshot([], docs), 'v', '2026-10-25').map((d) => d.id)).toEqual(['expired', 'soon']);
  });
});
