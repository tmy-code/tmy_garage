import type { IsoDate } from './dates.ts';

/** What a fill-up can plausibly be: anything outside is almost surely a typo (a slipped decimal point). */
export const FUEL_LIMITS = { litresMin: 0.5, litresMax: 200, pricePerLitreMin: 0.2, pricePerLitreMax: 10, totalMax: 2000 } as const;

/** The part of a Fill-up that consumption is worked out from. */
export interface FillupLike {
  id: string;
  date: IsoDate;
  odometer: number | null;
  litres: number;
  totalPaid: number;
  fullTank: boolean;
}

/** What a litre cost: Total paid over the litres. Worked out, never stored. */
export function fillupUnitPrice(f: Pick<FillupLike, 'litres' | 'totalPaid'>): number {
  return f.totalPaid / f.litres;
}

/** Which figure looks wrong, if any: the litres, the total, or the price per litre they give. */
export function fillupProblem(f: Pick<FillupLike, 'litres' | 'totalPaid'>): 'litres' | 'totalPaid' | 'pricePerLitre' | null {
  if (!(f.litres >= FUEL_LIMITS.litresMin) || f.litres > FUEL_LIMITS.litresMax) return 'litres';
  if (!(f.totalPaid >= 0) || f.totalPaid > FUEL_LIMITS.totalMax) return 'totalPaid';
  const price = fillupUnitPrice(f);
  if (price < FUEL_LIMITS.pricePerLitreMin || price > FUEL_LIMITS.pricePerLitreMax) return 'pricePerLitre';
  return null;
}

/** A stretch between two full tanks: what was used over the distance driven. */
export interface Consumption {
  lPer100: number;
  km: number;
  litres: number;
}

/** Date, then odometer (unknown last), then id, so the order never depends on how the list arrived. */
export function sortFillups<T extends FillupLike>(fillups: T[]): T[] {
  return [...fillups].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.odometer !== b.odometer) {
      if (a.odometer === null) return 1;
      if (b.odometer === null) return -1;
      return a.odometer - b.odometer;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Consumption of each full tank, by the id of the fill-up that closes the stretch. Takes one Vehicle's Fill-ups.
 * A stretch runs from one full tank with a known odometer to the next; top-ups in between add their litres to it.
 * A full tank without an odometer breaks the chain: the next full tank only starts a new stretch.
 */
export function consumptionOf(fillups: FillupLike[]): Map<string, Consumption> {
  const result = new Map<string, Consumption>();
  let anchor: FillupLike | null = null;
  let litres = 0;
  for (const f of sortFillups(fillups)) {
    if (anchor === null) {
      if (f.fullTank && f.odometer !== null) {
        anchor = f;
        litres = 0;
      }
      continue;
    }
    litres += f.litres;
    if (!f.fullTank) continue;
    if (f.odometer === null) {
      anchor = null;
      litres = 0;
      continue;
    }
    if (f.odometer > anchor.odometer!) {
      const km = f.odometer - anchor.odometer!;
      result.set(f.id, { km, litres, lPer100: (litres / km) * 100 });
    }
    anchor = f;
    litres = 0;
  }
  return result;
}

/** Distance-weighted: all litres over all kilometres, so a long stretch counts for more than a short one. */
export function averageConsumption(spans: Iterable<Consumption>): number | null {
  let km = 0;
  let litres = 0;
  for (const s of spans) {
    km += s.km;
    litres += s.litres;
  }
  return km > 0 ? (litres / km) * 100 : null;
}
