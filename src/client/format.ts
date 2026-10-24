import { effectiveInterval, type DueInfo } from '../shared/due.ts';
import type { PartUnit } from '../shared/schemas.ts';
import type { MaintenanceTask, PartSpec } from '../shared/types.ts';
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

/** A Standard Part is named in the interface language; another Part by the name the user gave it. */
export function partName(spec: PartSpec, m: Messages = messages()): string {
  return spec.standardPart ? m.workshop.standardParts[spec.standardPart] : spec.name;
}

/** A Part quantity in its unit, e.g. "3.2 L" or "2 pcs" ("3,2 L", "2 pièces" in French). */
export function formatQuantity(quantity: number, unit: PartUnit, m: Messages = messages()): string {
  const n = new Intl.NumberFormat(m.locale, { maximumFractionDigits: 2 }).format(quantity);
  return `${n} ${m.workshop.units[unit](quantity)}`;
}

function formatMonths(months: number, m: Messages): string {
  return months % 12 === 0 ? m.due.years(months / 12) : m.due.months(months);
}

function intervalParts(km: number | null, months: number | null, m: Messages): string[] {
  return [km !== null ? formatKm(km) : null, months !== null ? formatMonths(months, m) : null].filter((p): p is string => p !== null);
}

/** The Interval that applies (the stricter of yours and the official one), e.g. "Every 10 000 km or 1 year". */
export function describeInterval(task: MaintenanceTask, m: Messages = messages()): string {
  const { km, months } = effectiveInterval(task);
  return m.due.every(intervalParts(km, months, m));
}

/** The Official Interval, e.g. "Official: every 30 000 km or 2 years", or null when the Task has none. */
export function describeOfficialInterval(task: MaintenanceTask, m: Messages = messages()): string | null {
  const parts = intervalParts(task.officialIntervalKm, task.officialIntervalMonths, m);
  return parts.length > 0 ? m.due.official(parts) : null;
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
