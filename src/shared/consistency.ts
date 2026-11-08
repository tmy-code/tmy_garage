import type { IsoDate } from './dates.ts';
import type { OdometerPoint } from './due.ts';
import type { Service } from './types.ts';

export interface OdometerCheck {
  /** A value logged on or before this date with a higher odometer: the nearest one (latest date, then highest km). */
  tooLowFor: OdometerPoint | null;
  /** A value logged after this date with a lower odometer: the earliest one. */
  tooHighFor: OdometerPoint | null;
}

/**
 * Whether a new odometer value contradicts what was logged: the distance only goes up with time.
 * `points` must leave out the record being edited. A value logged the same day counts as earlier, for the low check only.
 */
export function checkOdometer(points: OdometerPoint[], candidate: { date: IsoDate; odometer: number }): OdometerCheck {
  let tooLowFor: OdometerPoint | null = null;
  let tooHighFor: OdometerPoint | null = null;
  for (const p of points) {
    if (p.date <= candidate.date) {
      if (p.odometer > candidate.odometer && (!tooLowFor || p.date > tooLowFor.date || (p.date === tooLowFor.date && p.odometer > tooLowFor.odometer))) {
        tooLowFor = p;
      }
    } else if (p.odometer < candidate.odometer && (!tooHighFor || p.date < tooHighFor.date)) {
      tooHighFor = p;
    }
  }
  return { tooLowFor, tooHighFor };
}

/** A Service of the same Vehicle on the same date at the same odometer: probably logged twice. */
export function findDuplicateService(
  services: Service[],
  candidate: { vehicleId: string; date: IsoDate; odometer: number | null },
  exceptId?: string,
): Service | null {
  if (candidate.odometer === null) return null;
  return (
    services.find(
      (s) => s.id !== exceptId && s.vehicleId === candidate.vehicleId && s.date === candidate.date && s.odometer === candidate.odometer,
    ) ?? null
  );
}
