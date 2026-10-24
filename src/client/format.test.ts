import { describe, expect, it } from 'vitest';
import type { DueInfo } from '../shared/due.ts';
import type { MaintenanceTask } from '../shared/types.ts';
import { describeDue, describeInterval, formatDate } from './format.ts';
import { messagesFor } from './i18n.ts';

const en = messagesFor('en');
const fr = messagesFor('fr');
// Intl separates groups with a narrow no-break space; compare with plain spaces.
const plain = (s: string) => s.replace(/[  ]/g, ' ');

const task = (intervalKm: number | null, intervalMonths: number | null): MaintenanceTask => ({
  id: 't',
  vehicleId: 'v',
  name: 'Oil',
  intervalKm,
  intervalMonths,
  baselineDate: null,
  baselineOdometer: null,
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
