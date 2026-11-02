import { daysBetween, type IsoDate } from './dates.ts';
import { vehicleDue, type DueInfo } from './due.ts';
import type { Snapshot } from './types.ts';

/** Tasks that are fine for now still appear on the dashboard, a few of them, so it is never empty. */
export const UPCOMING_PREVIEW = 5;
/** A Task due further away than this is left off the dashboard. */
export const UPCOMING_HORIZON_DAYS = 365;
/** Nudge for a fresh odometer reading so the projection stays honest. */
export const STALE_READING_DAYS = 30;

type Urgency = 'overdue' | 'dueSoon' | 'ok';

/** One line of the dashboard: something coming up on one of the owned Vehicles. */
export type Upcoming = { vehicleId: string; status: Urgency; date: IsoDate | null } & (
  | { kind: 'task'; due: DueInfo }
  | { kind: 'reading'; daysSince: number | null }
);

const ORDER: Record<Urgency, number> = { overdue: 0, dueSoon: 1, ok: 2 };

function byUrgency(a: Upcoming, b: Upcoming): number {
  const byStatus = ORDER[a.status] - ORDER[b.status];
  if (byStatus !== 0) return byStatus;
  if (a.date === b.date) return 0;
  if (a.date === null) return 1;
  if (b.date === null) return -1;
  return a.date < b.date ? -1 : 1;
}

/**
 * What is coming up across all owned Vehicles, most urgent first: every overdue or due-soon item, then the
 * next few Maintenance Tasks due within a year. Odometer reminders close the list.
 */
export function upcoming(snapshot: Snapshot, today: IsoDate): Upcoming[] {
  const urgent: Upcoming[] = [];
  const later: Upcoming[] = [];
  const readings: Upcoming[] = [];
  for (const vehicle of snapshot.vehicles) {
    if (vehicle.status !== 'owned') continue;
    const vehicleId = vehicle.id;
    const { usage, due } = vehicleDue(snapshot, vehicleId, today);
    for (const d of due) {
      if (d.status === 'overdue' || d.status === 'dueSoon') urgent.push({ vehicleId, status: d.status, date: d.dueDate, kind: 'task', due: d });
      else if (d.status === 'ok' && d.daysRemaining !== null && d.daysRemaining <= UPCOMING_HORIZON_DAYS)
        later.push({ vehicleId, status: 'ok', date: d.dueDate, kind: 'task', due: d });
    }
    const daysSince = usage.latest ? daysBetween(usage.latest.date, today) : null;
    if (daysSince === null || daysSince > STALE_READING_DAYS) readings.push({ vehicleId, status: 'ok', date: null, kind: 'reading', daysSince });
  }
  return [...urgent.sort(byUrgency), ...later.sort(byUrgency).slice(0, UPCOMING_PREVIEW), ...readings];
}
