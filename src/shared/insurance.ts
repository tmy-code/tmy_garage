import { addMonths, daysBetween, type IsoDate } from './dates.ts';
import type { Claim, Cover, InsurancePolicy, PolicyTerm, Quote, Snapshot } from './types.ts';

/** How far ahead the dashboard warns about a renewal date (échéance). */
export const RENEWAL_WARNING_DAYS = 60;

/** After a Policy's first year, Loi Hamon lets the user cancel it at any time, the new Insurer handling it. */
const HAMON_MONTHS = 12;

/** Competing Insurers ask about the Claims of the last five years, as the relevé d'information lists them. */
export const CLAIMS_HISTORY_YEARS = 5;

export function isActive(policy: InsurancePolicy, today: IsoDate): boolean {
  return policy.cancelledDate === null || policy.cancelledDate > today;
}

/** The Term running today; otherwise the latest one already started, whose renewal has not been recorded yet. */
export function currentTerm(policy: InsurancePolicy, today: IsoDate): PolicyTerm | null {
  const started = policy.terms.filter((t) => t.startDate <= today);
  return started.find((t) => today < t.endDate) ?? started[started.length - 1] ?? null;
}

export interface CurrentCover {
  policy: InsurancePolicy;
  term: PolicyTerm;
  cover: Cover;
  /** The same Vehicle's premium in the Term before, to show how much the renewal changed it. */
  previousPremium: number | null;
}

/** What insures a Vehicle today, if a Policy that is still running covers it. */
export function currentCover(snapshot: Snapshot, vehicleId: string, today: IsoDate): CurrentCover | null {
  let best: CurrentCover | null = null;
  for (const policy of snapshot.policies) {
    if (!isActive(policy, today)) continue;
    const term = currentTerm(policy, today);
    const cover = term?.covers.find((c) => c.vehicleId === vehicleId);
    if (!term || !cover || (best && best.term.startDate > term.startDate)) continue;
    const index = policy.terms.indexOf(term);
    const previous = index > 0 ? policy.terms[index - 1]!.covers.find((c) => c.vehicleId === vehicleId) : undefined;
    best = { policy, term, cover, previousPremium: previous?.premium ?? null };
  }
  return best;
}

export interface Renewal {
  /** The current Term's end: the premium notice for the next Term arrives shortly before. */
  date: IsoDate;
  daysRemaining: number;
  /** Overdue means the Term has ended and the new one has not been recorded. */
  status: 'overdue' | 'dueSoon' | 'ok';
  /** Past the first year, the renewal is a moment to compare Quotes rather than a deadline (Loi Hamon). */
  canCancelAnyTime: boolean;
}

export function renewal(policy: InsurancePolicy, today: IsoDate): Renewal | null {
  const term = isActive(policy, today) ? currentTerm(policy, today) : null;
  if (!term) return null;
  const daysRemaining = daysBetween(today, term.endDate);
  return {
    date: term.endDate,
    daysRemaining,
    status: daysRemaining <= 0 ? 'overdue' : daysRemaining <= RENEWAL_WARNING_DAYS ? 'dueSoon' : 'ok',
    canCancelAnyTime: addMonths(policy.startDate, HAMON_MONTHS) <= today,
  };
}

/** Claims of the last five years, on any Vehicle and Policy: Insurers ask about all of them. Newest first. */
export function recentClaims(snapshot: Snapshot, today: IsoDate): Claim[] {
  const since = addMonths(today, -12 * CLAIMS_HISTORY_YEARS);
  return snapshot.claims.filter((c) => c.date >= since && c.date <= today).sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** The yearly distance insurers ask for, rounded to the hundred, from the projected daily usage. */
export function annualKm(kmPerDay: number | null): number | null {
  return kmPerDay === null ? null : Math.round((kmPerDay * 365) / 100) * 100;
}

export interface ComparedQuote {
  quote: Quote;
  /** Against the current Cover's premium: negative is cheaper. Null without a current premium. */
  difference: number | null;
  expired: boolean;
}

/** A Vehicle's Quotes, cheapest first, set against what its current Cover costs. */
export function compareQuotes(snapshot: Snapshot, vehicleId: string, today: IsoDate): ComparedQuote[] {
  const premium = currentCover(snapshot, vehicleId, today)?.cover.premium ?? null;
  return snapshot.quotes
    .filter((q) => q.vehicleId === vehicleId)
    .sort((a, b) => a.premium - b.premium || (a.date < b.date ? 1 : -1))
    .map((quote) => ({
      quote,
      difference: premium === null ? null : quote.premium - premium,
      expired: quote.validUntil !== null && quote.validUntil < today,
    }));
}
