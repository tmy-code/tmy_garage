import { addDays, addMonths, daysBetween, type IsoDate } from './dates.ts';
import type { GarageDocument, InspectionDefect, Snapshot, TechnicalInspection, Vehicle } from './types.ts';

/** How far ahead the dashboard warns about an inspection or an expiring Document. */
export const PAPERS_WARNING_DAYS = 60;

export interface NextInspection {
  /** Null when it cannot be worked out (no inspection and no first registration date). */
  dueDate: IsoDate | null;
  /** 'report': printed on the last report; otherwise estimated from French regulations. */
  basis: 'report' | 'counterVisit' | 'rhythm' | 'firstRegistration' | 'unknown';
  status: 'overdue' | 'dueSoon' | 'ok' | 'unknown';
  daysRemaining: number | null;
  last: TechnicalInspection | null;
}

/** Years between inspections once the first one is done. */
const RHYTHM_YEARS = { car: 2, motorcycle: 3 } as const;

/** Months allowed for the re-inspection (contre-visite) after a failed one. */
const COUNTER_VISIT_MONTHS = 2;

/**
 * When a motorcycle's first inspection is due. Two-wheelers were brought in from April 2024 in stages by
 * registration year (arrêté du 23 octobre 2023): at most 4 months after the registration anniversary in the
 * year of their stage, capped at the end of that year. From 2022 registrations, at 5 years.
 */
function firstMotorcycleInspection(firstRegistration: IsoDate): IsoDate {
  const year = Number(firstRegistration.slice(0, 4));
  const stage = year < 2017 ? 2024 : year <= 2019 ? 2025 : year <= 2021 ? 2026 : null;
  if (stage === null) return addMonths(firstRegistration, 5 * 12);
  const anniversary = `${stage}${firstRegistration.slice(4)}`;
  const deadline = addMonths(anniversary.endsWith('-02-29') ? `${stage}-02-28` : anniversary, 4);
  const endOfStage = `${stage}-12-31`;
  // The first stage opened on 15 April 2024, so earlier anniversaries had until 14 August.
  if (stage === 2024 && deadline < '2024-08-14') return '2024-08-14';
  return deadline < endOfStage ? deadline : endOfStage;
}

function needsCounterVisit(inspection: TechnicalInspection): boolean {
  return inspection.result !== 'passed';
}

function newestFirst(a: TechnicalInspection, b: TechnicalInspection): number {
  return a.date === b.date ? b.odometer - a.odometer : a.date < b.date ? 1 : -1;
}

export function nextInspection(snapshot: Snapshot, vehicle: Vehicle, today: IsoDate): NextInspection {
  const last = snapshot.inspections.filter((i) => i.vehicleId === vehicle.id).sort(newestFirst)[0] ?? null;
  let dueDate: IsoDate | null = null;
  let basis: NextInspection['basis'] = 'unknown';
  if (last?.nextDueDate) {
    dueDate = last.nextDueDate;
    basis = 'report';
  } else if (last && needsCounterVisit(last)) {
    dueDate = addMonths(last.date, COUNTER_VISIT_MONTHS);
    basis = 'counterVisit';
  } else if (last) {
    dueDate = addMonths(last.date, RHYTHM_YEARS[vehicle.kind] * 12);
    basis = 'rhythm';
  } else if (vehicle.firstRegistration) {
    dueDate = vehicle.kind === 'car' ? addMonths(vehicle.firstRegistration, 4 * 12) : firstMotorcycleInspection(vehicle.firstRegistration);
    basis = 'firstRegistration';
  }
  const daysRemaining = dueDate === null ? null : daysBetween(today, dueDate);
  const status =
    daysRemaining === null ? 'unknown' : daysRemaining < 0 ? 'overdue' : daysRemaining <= PAPERS_WARNING_DAYS ? 'dueSoon' : 'ok';
  return { dueDate, basis, status, daysRemaining, last };
}

/** Defects of the Vehicle's latest inspection that no Service has fixed yet. */
export function openDefects(snapshot: Snapshot, vehicle: Vehicle): InspectionDefect[] {
  const last = snapshot.inspections.filter((i) => i.vehicleId === vehicle.id).sort(newestFirst)[0];
  return last ? last.defects.filter((d) => d.fixedServiceId === null) : [];
}

/** The Vehicle's Documents that have expired or expire soon, soonest first. */
export function expiringDocuments(snapshot: Snapshot, vehicleId: string, today: IsoDate): GarageDocument[] {
  const limit = addDays(today, PAPERS_WARNING_DAYS);
  return snapshot.documents
    .filter((d) => d.vehicleId === vehicleId && d.expiryDate !== null && d.expiryDate <= limit)
    .sort((a, b) => (a.expiryDate! < b.expiryDate! ? -1 : 1));
}
