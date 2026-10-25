import { describe, expect, it } from 'vitest';
import type { DueInfo } from '../shared/due.ts';
import type { MaintenanceTask, PartSpec } from '../shared/types.ts';
import {
  describeDue,
  describeInterval,
  describeOfficialInterval,
  formatDate,
  formatQuantity,
  partName,
  partReferences,
  taskName,
} from './format.ts';
import { messagesFor } from './i18n.ts';

const en = messagesFor('en');
const fr = messagesFor('fr');
// Intl separates groups with a narrow no-break space; compare with plain spaces.
const plain = (s: string) => s.replace(/[  ]/g, ' ');

const part: PartSpec = {
  id: 'p',
  vehicleId: 'v',
  standardPart: null,
  name: 'Fork seal',
  nameFr: 'Joint spi',
  characteristics: null,
  oemReference: '51490-MKN-D01',
  partNumbers: null,
  unit: 'piece',
  notFitted: false,
};

const task = (intervalKm: number | null, intervalMonths: number | null): MaintenanceTask => ({
  id: 't',
  vehicleId: 'v',
  name: 'Oil',
  nameFr: null,
  intervalKm,
  intervalMonths,
  officialIntervalKm: null,
  officialIntervalMonths: null,
  baselineDate: null,
  baselineOdometer: null,
  workshopNotes: null,
  requiredParts: [],
  tools: [],
  specIds: [],
});

const due: DueInfo = {
  taskId: 't',
  status: 'ok',
  lastDone: { date: '2026-04-01', odometer: 18_000, source: 'service' },
  timeDueDate: '2027-04-01',
  dueOdometer: 24_000,
  distanceDueDate: '2027-03-14',
  dueDate: '2027-03-14',
  kmRemaining: 1_200,
  daysRemaining: 141,
};

describe('format in both languages', () => {
  it('formats dates in the language', () => {
    expect(formatDate('2027-03-14', en)).toBe('14 Mar 2027');
    expect(formatDate('2027-03-14', fr)).toBe('14 mars 2027');
  });

  it('describes intervals', () => {
    expect(plain(describeInterval(task(6000, 12), en))).toBe('Every 6 000 km or 1 year');
    expect(plain(describeInterval(task(null, 24), fr))).toBe('Tous les 2 ans');
    expect(plain(describeInterval(task(500, 1), fr))).toBe('Tous les 500 km ou 1 mois');
  });

  it('shows the stricter interval with the official one alongside', () => {
    const airFilter = { ...task(null, 12), officialIntervalKm: 30_000, officialIntervalMonths: 24 };
    expect(plain(describeInterval(airFilter, en))).toBe('Every 30 000 km or 1 year');
    expect(plain(describeOfficialInterval(airFilter, en)!)).toBe('Official: every 30 000 km or 2 years');
    expect(plain(describeOfficialInterval(airFilter, fr)!)).toBe('Constructeur : tous les 30 000 km ou 2 ans');
    expect(describeOfficialInterval(task(6000, 12), en)).toBeNull();
  });

  it('names Tasks and Parts in the interface language, falling back to English', () => {
    const oil = { ...task(6000, 12), name: 'Engine oil', nameFr: 'Huile moteur' };
    expect(taskName(oil, fr)).toBe('Huile moteur');
    expect(taskName(oil, en)).toBe('Engine oil');
    expect(taskName({ ...oil, nameFr: null }, fr)).toBe('Engine oil');
    expect(partName(part, fr)).toBe('Joint spi');
    expect(partName({ ...part, standardPart: 'engineOil' }, fr)).toBe(fr.workshop.standardParts.engineOil);
  });

  it('lists the OEM reference before the acceptable part numbers', () => {
    const filter = { ...part, oemReference: '15410-MFJ-D01', partNumbers: 'HF204, KN-204' };
    expect(partReferences(filter, en)).toBe('OEM 15410-MFJ-D01 · HF204, KN-204');
    expect(partReferences({ ...filter, partNumbers: null }, fr)).toBe('Réf. constructeur 15410-MFJ-D01');
    expect(partReferences({ ...filter, oemReference: null, partNumbers: null }, en)).toBeNull();
  });

  it('formats Part quantities in their unit', () => {
    expect(formatQuantity(3.2, 'litre', en)).toBe('3.2 L');
    expect(formatQuantity(3.2, 'litre', fr)).toBe('3,2 L');
    expect(formatQuantity(1, 'piece', en)).toBe('1 pc');
    expect(formatQuantity(2, 'piece', fr)).toBe('2 pièces');
  });

  it('describes a projected Due Date', () => {
    expect(plain(describeDue(due, en))).toBe('Due ≈ 14 Mar 2027 (in 141 days) · at 24 000 km (1 200 km left)');
    expect(plain(describeDue(due, fr))).toBe('Échéance ≈ 14 mars 2027 (dans 141 jours) · à 24 000 km (encore 1 200 km)');
  });

  it('describes an overdue task', () => {
    const overdue = { ...due, status: 'overdue' as const, daysRemaining: -1, kmRemaining: -300 };
    expect(plain(describeDue(overdue, en))).toBe('Was due ≈ 14 Mar 2027 (1 day ago) · at 24 000 km (300 km over)');
    expect(plain(describeDue(overdue, fr))).toBe('Échéance ≈ 14 mars 2027 (il y a 1 jour) · à 24 000 km (300 km de dépassement)');
  });
});
