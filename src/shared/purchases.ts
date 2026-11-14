// Whether what a Task needs was bought since it was last done, read from the owner's Notion "Achats" (ADR 0008).
// Pure and read-only: no React, nothing from the client, so the server image can load it.
import { requiredConsumables } from './applicability.ts';
import type { IsoDate } from './dates.ts';
import type { ConsumableType, NotionPurchase, Snapshot, ItemSpec } from './types.ts';

export interface Bought {
  date: IsoDate;
  productId: string | null;
  shop: string | null;
}

export interface ConsumableBuyState {
  type: ConsumableType;
  /** False when the vehicle has no line for this type in Notion: nothing can be linked, so no state is shown. */
  tracked: boolean;
  /** The latest Achat after the last-done date, or null: still to buy. */
  bought: Bought | null;
}

/** The latest Achat of one of `lines` dated strictly after `after` (null = never done: any Achat counts); a tie on the date keeps the later one in the list. */
export function latestPurchase(purchases: NotionPurchase[], lines: ItemSpec[], after: IsoDate | null): Bought | null {
  const articles = new Set(lines.map((l) => l.notionId));
  let best: NotionPurchase | null = null;
  for (const p of purchases) {
    if (!articles.has(p.articleNotionId)) continue;
    if (after !== null && p.date <= after) continue;
    if (best === null || p.date >= best.date) best = p;
  }
  return best ? { date: best.date, productId: best.productId, shop: best.shop } : null;
}

/**
 * The buy state of every Consumable Type the given Tasks of a Vehicle require (catalogue Task -> required types ->
 * the Vehicle's lines of that type, via requiredConsumables). One entry per type however many Tasks ask for it.
 * `lastDone` is each Task's last-done date (DueInfo.lastDone?.date: last Service or baseline; null if none).
 * For several Tasks the strictest date applies: the latest of the non-null last-done dates (null only when none has one).
 */
export function buyStates(snapshot: Snapshot, vehicleId: string, tasks: { taskId: string; lastDone: IsoDate | null }[]): ConsumableBuyState[] {
  const merged = new Map<string, { type: ConsumableType; rows: ItemSpec[]; after: IsoDate | null }>();
  for (const { taskId, lastDone } of tasks) {
    for (const need of requiredConsumables(snapshot, vehicleId, taskId)) {
      const entry = merged.get(need.type.id);
      if (!entry) merged.set(need.type.id, { type: need.type, rows: need.rows, after: lastDone });
      else if (lastDone !== null && (entry.after === null || lastDone > entry.after)) entry.after = lastDone;
    }
  }
  return [...merged.values()].map(({ type, rows, after }) => ({
    type,
    tracked: rows.length > 0,
    bought: rows.length > 0 ? latestPurchase(snapshot.notionPurchases, rows, after) : null,
  }));
}
