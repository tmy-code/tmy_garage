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
