import { effectiveInterval, type DueInfo } from '../shared/due.ts';
import type { PartUnit } from '../shared/schemas.ts';
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

/** Overdue for longer than this many days is said in years and months. */
const DAYS_BEFORE_YEARS = 90;

/** "1 010 days", digits grouped like the kilometres. */
export function formatDays(days: number, m: Messages = messages()): string {
  return m.due.dayCount(days, numberFormat.format(days));
}

/** "in 91 days" or "today", for a date that is not past. */
export function formatUntil(days: number, m: Messages = messages()): string {
  return days === 0 ? m.due.today : m.due.inDays(formatDays(days, m));
}

/** "Overdue by 45 days", or "Overdue by 2 years 9 months" once it is long past. */
export function formatOverdue(days: number, m: Messages = messages()): string {
  if (days <= DAYS_BEFORE_YEARS) return m.due.overdueBy(formatDays(days, m));
  const months = Math.floor(days / 30.44);
  const span = [months >= 12 ? m.due.years(Math.floor(months / 12)) : null, months % 12 > 0 ? m.due.months(months % 12) : null]
    .filter(Boolean)
    .join(' ');
  return m.due.overdueBy(span);
}

/** Past or coming: how far the date is from today, in a few words. */
export function formatDueIn(days: number, m: Messages = messages()): string {
  return days < 0 ? formatOverdue(-days, m) : formatUntil(days, m);
}

/** Whether any of the texts contains what was typed in a search box, ignoring case and accents. */
export function matchesQuery(texts: (string | null)[], query: string): boolean {
  const loose = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
  const wanted = loose(query);
  return wanted === '' || texts.some((text) => text !== null && loose(text).includes(wanted));
}

/** "3.2 litres", "1 piece". */
export function formatQuantity(quantity: number, unit: PartUnit, m: Messages = messages()): string {
  const word = quantity === 1 ? m.parts.unitSingular[unit] : (unit === 'litre' ? m.workshop.litre : m.workshop.piece).toLowerCase();
  return `${quantity} ${word}`;
}

/** A figure with a fixed number of decimals, in the language's own style ("1.7" or "1,7"). */
export function formatDecimal(value: number, digits = 1, m: Messages = messages()): string {
  return new Intl.NumberFormat(m.locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

/** The currency symbol formatMoney uses ("€"), for labels of money fields. */
export function currencySymbol(m: Messages = messages()): string {
  return new Intl.NumberFormat(m.locale, { style: 'currency', currency: 'EUR' }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? '€';
}

export function formatMoney(amount: number, m: Messages = messages()): string {
  return new Intl.NumberFormat(m.locale, { style: 'currency', currency: 'EUR' }).format(amount);
}

/** A bonus-malus coefficient as printed on a relevé d’information, e.g. "0.50" ("0,50" in French). */
export function formatCrm(crm: number, m: Messages = messages()): string {
  return new Intl.NumberFormat(m.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(crm);
}

/** A name the user gave in English, with an optional French one shown instead in French. */
function localName(item: { name: string; nameFr: string | null }, m: Messages): string {
  return m.lang === 'fr' && item.nameFr ? item.nameFr : item.name;
}

export function taskName(task: MaintenanceTask, m: Messages = messages()): string {
  return localName(task, m);
}

function formatMonths(months: number, m: Messages): string {
  return months % 12 === 0 ? m.due.years(months / 12) : m.due.months(months);
}

function intervalParts(km: number | null, months: number | null, m: Messages): string[] {
  return [km !== null ? formatKm(km) : null, months !== null ? formatMonths(months, m) : null].filter((p): p is string => p !== null);
}

/** The Interval, e.g. "Every 10 000 km or 1 year". */
export function describeInterval(task: MaintenanceTask, m: Messages = messages()): string {
  const { km, months } = effectiveInterval(task);
  return describeEvery(km, months, m);
}

/** An Interval given as distance and months, e.g. "Every 10 000 km or 1 year". */
export function describeEvery(km: number | null, months: number | null, m: Messages = messages()): string {
  return m.due.every(intervalParts(km, months, m));
}

/** One line saying when the task is due, e.g. "Due 14 Mar 2027 (in 141 days) · at 24 000 km (1 200 km left)". */
export function describeDue(due: DueInfo, m: Messages = messages()): string {
  if (due.status === 'paused') return m.due.paused;
  if (due.status === 'unknown') return due.lastDone ? m.due.noOdometer : m.due.never;
  const parts: string[] = [];
  if (due.dueDate !== null && due.daysRemaining !== null) {
    const estimated = due.dueDate === due.distanceDueDate && due.dueDate !== due.timeDueDate ? '≈ ' : '';
    const when = formatDueIn(due.daysRemaining, m);
    parts.push(`${due.daysRemaining < 0 ? m.due.wasDue : m.due.due} ${estimated}${formatDate(due.dueDate, m)} (${when})`);
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

/**
 * The same facts as `describeDue`, as two short lines for a list row: when ("6 Feb 2027 · in 91 days") and how far
 * ("3 035 km left"). The distance the task is due at is left for the task page.
 */
export function describeDueShort(due: DueInfo, m: Messages = messages()): { when: string | null; distance: string | null } {
  if (due.status === 'paused') return { when: m.due.paused, distance: null };
  if (due.status === 'unknown') return { when: due.lastDone ? m.due.noOdometer : m.due.never, distance: null };
  const estimated = due.dueDate === due.distanceDueDate && due.dueDate !== due.timeDueDate ? '≈ ' : '';
  return {
    when:
      due.dueDate !== null && due.daysRemaining !== null
        ? `${estimated}${formatDate(due.dueDate, m)} · ${formatDueIn(due.daysRemaining, m)}`
        : null,
    distance:
      due.kmRemaining === null ? null : due.kmRemaining < 0 ? m.due.over(formatKm(-due.kmRemaining)) : m.due.left(formatKm(due.kmRemaining)),
  };
}

/** Parses a numeric text field: empty means "not set". Spaces are allowed ("24 000"). */
export function parseNumber(text: string): number | null {
  const cleaned = text.replace(/[\s ]/g, '').replace(',', '.');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}
