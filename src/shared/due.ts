import { addDays, addMonths, daysBetween, minDate, type IsoDate } from './dates.ts';
import type { MaintenanceTask, Service, Snapshot } from './types.ts';

/** Only the last months of readings are used, so the projection follows seasonal use. */
const USAGE_WINDOW_DAYS = 180;
/** A Task is Due Soon once this share of its Interval is left (10%), by distance or by time. */
export const DUE_SOON_SHARE = 0.1;
/** Readings closer together than this give an unreliable rate. */
const MIN_USAGE_SPAN_DAYS = 14;

export interface OdometerPoint {
  date: IsoDate;
  odometer: number;
}

/** What was logged about a Vehicle's distance: never a guess at today's odometer. */
export interface Usage {
  /** The latest odometer value logged (a reading or a Service). */
  latest: OdometerPoint | null;
  /** The recent rate, from logged values, for projecting distance-based Due Dates. */
  kmPerDay: number | null;
}

/** 'paused': the owner switched the Task off on this Vehicle, so it is not due at all. */
export type DueStatus = 'overdue' | 'dueSoon' | 'ok' | 'unknown' | 'paused';

export interface DueInfo {
  taskId: string;
  status: DueStatus;
  /** A baseline may have a date but no odometer value. */
  lastDone: { date: IsoDate; odometer: number | null; source: 'service' | 'baseline' } | null;
  timeDueDate: IsoDate | null;
  dueOdometer: number | null;
  /** Projected date the Vehicle reaches dueOdometer. */
  distanceDueDate: IsoDate | null;
  /** The Due Date: the earlier of timeDueDate and distanceDueDate. */
  dueDate: IsoDate | null;
  kmRemaining: number | null;
  daysRemaining: number | null;
}

function byDateThenOdometer(a: OdometerPoint, b: OdometerPoint): number {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : a.odometer - b.odometer;
}

function rateBetween(first: OdometerPoint, last: OdometerPoint): number | null {
  const days = daysBetween(first.date, last.date);
  if (days < MIN_USAGE_SPAN_DAYS) return null;
  const rate = (last.odometer - first.odometer) / days;
  return rate >= 0 ? rate : null;
}

export function estimateUsage(points: OdometerPoint[]): Usage {
  const sorted = [...points].sort(byDateThenOdometer);
  const latest = sorted.at(-1);
  if (!latest) return { latest: null, kmPerDay: null };

  const windowStart = addDays(latest.date, -USAGE_WINDOW_DAYS);
  const firstInWindow = sorted.findIndex((p) => p.date >= windowStart);
  // Prefer the recent window; fall back to the reading just before it, then to the whole history.
  const kmPerDay =
    rateBetween(sorted[firstInWindow]!, latest) ??
    rateBetween(sorted[Math.max(0, firstInWindow - 1)]!, latest) ??
    rateBetween(sorted[0]!, latest);
  return { latest, kmPerDay };
}

export function usageOf(snapshot: Snapshot, vehicleId: string): Usage {
  const points: OdometerPoint[] = [
    ...snapshot.readings.filter((r) => r.vehicleId === vehicleId),
    // A Service may have left the odometer out.
    ...snapshot.services.filter((s): s is Service & { odometer: number } => s.vehicleId === vehicleId && s.odometer !== null),
  ].map(({ date, odometer }) => ({ date, odometer }));
  return estimateUsage(points);
}

/** The Interval that applies, for distance and time separately. */
export function effectiveInterval(task: MaintenanceTask): { km: number | null; months: number | null } {
  return { km: task.intervalKm, months: task.intervalMonths };
}

function lastDoneOf(task: MaintenanceTask, services: Service[]): DueInfo['lastDone'] {
  const last = services
    .filter((s) => s.taskIds.includes(task.id))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.odometer ?? 0) - (b.odometer ?? 0)))
    .at(-1);
  if (last) return { date: last.date, odometer: last.odometer, source: 'service' };
  if (task.baselineDate !== null) {
    return { date: task.baselineDate, odometer: task.baselineOdometer, source: 'baseline' };
  }
  return null;
}

export function computeDue(task: MaintenanceTask, services: Service[], usage: Usage, today: IsoDate): DueInfo {
  const lastDone = lastDoneOf(task, services);
  const interval = effectiveInterval(task);
  const timeDueDate = lastDone && interval.months !== null ? addMonths(lastDone.date, interval.months) : null;
  const dueOdometer =
    lastDone && lastDone.odometer !== null && interval.km !== null ? lastDone.odometer + interval.km : null;

  let distanceDueDate: IsoDate | null = null;
  if (dueOdometer !== null && usage.latest) {
    if (usage.kmPerDay) {
      distanceDueDate = addDays(usage.latest.date, (dueOdometer - usage.latest.odometer) / usage.kmPerDay);
    } else if (usage.latest.odometer >= dueOdometer) {
      distanceDueDate = usage.latest.date;
    }
  }

  const dueDate = minDate(timeDueDate, distanceDueDate);
  // Counted from the latest logged odometer value, not a guess at today's.
  const kmRemaining = dueOdometer !== null && usage.latest ? dueOdometer - usage.latest.odometer : null;
  const daysRemaining = dueDate !== null ? daysBetween(today, dueDate) : null;

  let status: DueStatus;
  if (timeDueDate === null && dueOdometer === null) {
    status = 'unknown';
  } else if ((timeDueDate !== null && timeDueDate < today) || (kmRemaining !== null && kmRemaining < 0)) {
    status = 'overdue';
  } else if (
    (timeDueDate !== null && daysBetween(today, timeDueDate) <= DUE_SOON_SHARE * daysBetween(lastDone!.date, timeDueDate)) ||
    (kmRemaining !== null && kmRemaining <= DUE_SOON_SHARE * interval.km!)
  ) {
    status = 'dueSoon';
  } else {
    status = 'ok';
  }

  return { taskId: task.id, status, lastDone, timeDueDate, dueOdometer, distanceDueDate, dueDate, kmRemaining, daysRemaining };
}

/** Whether the owner paused a Task on its Vehicle. */
export function isPaused(_snapshot: Snapshot, task: MaintenanceTask): boolean {
  return task.switchedOff;
}

function pausedDue(task: MaintenanceTask, services: Service[]): DueInfo {
  return {
    taskId: task.id,
    status: 'paused',
    lastDone: lastDoneOf(task, services),
    timeDueDate: null,
    dueOdometer: null,
    distanceDueDate: null,
    dueDate: null,
    kmRemaining: null,
    daysRemaining: null,
  };
}

const STATUS_ORDER: Record<DueStatus, number> = { overdue: 0, dueSoon: 1, ok: 2, unknown: 3, paused: 4 };

export function compareDue(a: DueInfo, b: DueInfo): number {
  const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
  if (byStatus !== 0) return byStatus;
  if (a.dueDate === b.dueDate) return 0;
  if (a.dueDate === null) return 1;
  if (b.dueDate === null) return -1;
  return a.dueDate < b.dueDate ? -1 : 1;
}

/** Due information for every Maintenance Task of a Vehicle, most urgent first; paused Tasks come last. */
export function vehicleDue(snapshot: Snapshot, vehicleId: string, today: IsoDate): { usage: Usage; due: DueInfo[] } {
  const usage = usageOf(snapshot, vehicleId);
  const services = snapshot.services.filter((s) => s.vehicleId === vehicleId);
  const due = snapshot.tasks
    .filter((t) => t.vehicleId === vehicleId)
    .map((t) => (isPaused(snapshot, t) ? pausedDue(t, services) : computeDue(t, services, usage, today)))
    .sort(compareDue);
  return { usage, due };
}
