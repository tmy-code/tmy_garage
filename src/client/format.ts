import type { DueInfo } from '../shared/due.ts';
import type { MaintenanceTask } from '../shared/types.ts';

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const numberFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

export function formatDate(iso: string): string {
  return dateFormat.format(new Date(`${iso}T00:00:00Z`));
}

export function formatKm(km: number): string {
  return `${numberFormat.format(km)} km`;
}

export function formatMoney(amount: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount);
}

function formatMonths(months: number): string {
  if (months % 12 === 0) return months === 12 ? '1 year' : `${months / 12} years`;
  return months === 1 ? '1 month' : `${months} months`;
}

export function describeInterval(task: MaintenanceTask): string {
  const parts = [task.intervalKm !== null ? formatKm(task.intervalKm) : null, task.intervalMonths !== null ? formatMonths(task.intervalMonths) : null];
  return `Every ${parts.filter(Boolean).join(' or ')}`;
}

function days(n: number): string {
  return Math.abs(n) === 1 ? '1 day' : `${Math.abs(n)} days`;
}

/** One line saying when the task is due, e.g. "Due 14 Mar 2027 (in 141 days) · at 24 000 km (1 200 km left)". */
export function describeDue(due: DueInfo): string {
  if (due.status === 'unknown') {
    return due.lastDone ? 'Needs an odometer value for when it was last done' : 'Never recorded: log a Service or set when it was last done';
  }
  const parts: string[] = [];
  if (due.dueDate !== null && due.daysRemaining !== null) {
    const estimated = due.dueDate === due.distanceDueDate && due.dueDate !== due.timeDueDate ? '≈ ' : '';
    const when = due.daysRemaining < 0 ? `${days(due.daysRemaining)} ago` : due.daysRemaining === 0 ? 'today' : `in ${days(due.daysRemaining)}`;
    parts.push(`${due.daysRemaining < 0 ? 'Was due' : 'Due'} ${estimated}${formatDate(due.dueDate)} (${when})`);
  }
  if (due.dueOdometer !== null) {
    const left =
      due.kmRemaining === null ? '' : due.kmRemaining < 0 ? ` (${formatKm(-due.kmRemaining)} over)` : ` (${formatKm(due.kmRemaining)} left)`;
    parts.push(`at ${formatKm(due.dueOdometer)}${left}`);
  }
  return parts.join(' · ');
}

export const STATUS_LABEL: Record<DueInfo['status'], string> = {
  overdue: 'Overdue',
  dueSoon: 'Due soon',
  ok: 'OK',
  unknown: 'No record',
};

/** Parses a numeric text field: empty means "not set". Spaces are allowed ("24 000"). */
export function parseNumber(text: string): number | null {
  const cleaned = text.replace(/[\s ]/g, '').replace(',', '.');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}
