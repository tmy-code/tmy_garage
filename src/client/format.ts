import type { DueInfo } from '../shared/due.ts';
import type { MaintenanceTask } from '../shared/types.ts';
import { messages, type Messages } from './i18n.ts';

// Distances use French digit grouping ("24 000 km") in both languages.
const numberFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

export function formatDate(iso: string, m: Messages = messages()): string {
  return new Intl.DateTimeFormat(m.locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${iso}T00:00:00Z`),
  );
}

export function formatKm(km: number): string {
  return `${numberFormat.format(km)} km`;
}

export function formatMoney(amount: number, m: Messages = messages()): string {
  return new Intl.NumberFormat(m.locale, { style: 'currency', currency: 'EUR' }).format(amount);
}

function formatMonths(months: number, m: Messages): string {
  return months % 12 === 0 ? m.due.years(months / 12) : m.due.months(months);
}

export function describeInterval(task: MaintenanceTask, m: Messages = messages()): string {
  const parts = [
    task.intervalKm !== null ? formatKm(task.intervalKm) : null,
    task.intervalMonths !== null ? formatMonths(task.intervalMonths, m) : null,
  ];
  return m.due.every(parts.filter((p): p is string => p !== null));
}

/** One line saying when the task is due, e.g. "Due 14 Mar 2027 (in 141 days) · at 24 000 km (1 200 km left)". */
export function describeDue(due: DueInfo, m: Messages = messages()): string {
  if (due.status === 'unknown') return due.lastDone ? m.due.noOdometer : m.due.never;
  const parts: string[] = [];
  if (due.dueDate !== null && due.daysRemaining !== null) {
    const estimated = due.dueDate === due.distanceDueDate && due.dueDate !== due.timeDueDate ? '≈ ' : '';
    const days = due.daysRemaining;
    const when = days < 0 ? m.due.daysAgo(-days) : days === 0 ? m.due.today : m.due.inDays(days);
    parts.push(`${days < 0 ? m.due.wasDue : m.due.due} ${estimated}${formatDate(due.dueDate, m)} (${when})`);
  }
  if (due.dueOdometer !== null) {
    const left =
      due.kmRemaining === null
        ? ''
        : ` (${due.kmRemaining < 0 ? m.due.over(formatKm(-due.kmRemaining)) : m.due.left(formatKm(due.kmRemaining))})`;
    parts.push(`${m.due.at(formatKm(due.dueOdometer))}${left}`);
  }
  return parts.join(' · ');
}

/** Parses a numeric text field: empty means "not set". Spaces are allowed ("24 000"). */
export function parseNumber(text: string): number | null {
  const cleaned = text.replace(/[\s ]/g, '').replace(',', '.');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}
