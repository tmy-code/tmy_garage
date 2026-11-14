// What the Notion journal holds (ADR 0007): each Service is a Séance, its Tasks are Interventions, its part lines are
// Consommables utilisés. Pure: turns a snapshot into rows keyed by the app's ids, with no knowledge of the Notion API.
//
// Privacy: no free-text notes, receipts or other Documents, VIN, shop, repair title or Service total, and no odometer-only
// reading, Purchase or Fill-up. A line's own quantity and unit price are included.
import type { Messages } from '../shared/messages.ts';
import type { IsoDate } from '../shared/dates.ts';
import { vehicleDue } from '../shared/due.ts';
import type { Snapshot } from '../shared/types.ts';

export const SESSION_MAINTENANCE = 'Entretien';
export const SESSION_REPAIR = 'Réparation';
export const ACTION_INSPECT = 'Contrôle';
export const ACTION_REPLACE = 'Remplacement';
export const ACTION_CLEAN = 'Nettoyage';
export const ACTION_ADJUST = 'Réglage';

/** The Notion word for each of the app's Actions, as the catalogue's Action column says it. */
export const ACTION_WORDS = { inspect: ACTION_INSPECT, replace: ACTION_REPLACE, clean: ACTION_CLEAN, adjust: ACTION_ADJUST } as const;

/** The key a Plan relation uses: a Task's plan page is registered under it once the page exists. */
export const planKey = (taskId: string) => `plan:${taskId}`;

export interface SessionRow {
  appId: string;
  vehicleAppId: string;
  title: string;
  date: IsoDate;
  km: number | null;
  performedBy: string;
  type: string;
}

export interface InterventionRow {
  appId: string;
  sessionAppId: string;
  title: string;
  /** The app id of the Catalogue Task, when the Task follows the catalogue. */
  refTaskKey: string | null;
  /** The key of the Task's Plan page (see planKey), when it has one. */
  planKey: string | null;
  action: string | null;
}

export interface UsedRow {
  appId: string;
  /** The Intervention the line belongs to; empty for a Service with no Task. */
  interventionAppId: string | null;
  /** The app ids of the Consumable Type and Product, when the line has them. */
  consumableTypeKey: string | null;
  productKey: string | null;
  designation: string;
  quantity: number;
  unitPrice: number | null;
}

export interface NotionJournal {
  sessions: SessionRow[];
  interventions: InterventionRow[];
  used: UsedRow[];
}

/** What to write in "Dernier fait" on a Task's Plan page. */
export interface LastDone {
  taskId: string;
  vehicleAppId: string;
  /** The Notion page of the Task's Plan, once it has one. */
  planPageId: string | null;
  km: number | null;
  date: IsoDate;
}

export function buildJournal(snapshot: Snapshot, t: Messages): NotionJournal {
  const owned = new Map(snapshot.vehicles.filter((v) => v.ownership === 'owned').map((v) => [v.id, v]));
  const tasks = new Map(snapshot.tasks.map((task) => [task.id, task]));
  const refTasks = new Map(snapshot.refTasks.map((r) => [r.id, r]));
  const journal: NotionJournal = { sessions: [], interventions: [], used: [] };

  for (const service of snapshot.services) {
    const vehicle = owned.get(service.vehicleId);
    if (!vehicle) continue;
    journal.sessions.push({
      appId: service.id,
      vehicleAppId: vehicle.id,
      title: `${service.date} · ${vehicle.name}`,
      date: service.date,
      km: service.odometer,
      performedBy: t.service.performers[service.performedBy],
      type: service.kind === 'repair' ? SESSION_REPAIR : SESSION_MAINTENANCE,
    });

    const interventions = service.taskIds.flatMap((taskId) => {
      const task = tasks.get(taskId);
      if (!task) return [];
      const row: InterventionRow = {
        appId: `${service.id}:${taskId}`,
        sessionAppId: service.id,
        // The task's name in the sync's language (not imported from the client: the server image has no React).
        title: t.lang === 'fr' && task.nameFr ? task.nameFr : task.name,
        refTaskKey: task.refTaskId ?? null,
        planKey: task.notionPlanId ? planKey(task.id) : null,
        action: ACTION_WORDS[task.action] ?? null,
      };
      return [{ row, consumableTypeIds: refTasks.get(task.refTaskId ?? '')?.consumableTypeIds ?? [] }];
    });
    journal.interventions.push(...interventions.map((i) => i.row));

    service.partsUsed.forEach((line, index) => {
      // A line goes with the Task that needs its Consumable Type, else with the Service's first Task.
      const owner = interventions.find((i) => line.consumableTypeId && i.consumableTypeIds.includes(line.consumableTypeId)) ?? interventions[0];
      journal.used.push({
        appId: `${service.id}:${index}`,
        interventionAppId: owner?.row.appId ?? null,
        consumableTypeKey: line.consumableTypeId ?? null,
        productKey: line.productId ?? null,
        designation: line.description,
        quantity: line.quantity,
        unitPrice: line.price ?? null,
      });
    });
  }
  return journal;
}

/** For every Task that follows the catalogue and has been done (or has a baseline): when, and at what odometer. */
export function buildLastDone(snapshot: Snapshot, today: IsoDate): LastDone[] {
  const tasks = new Map(snapshot.tasks.map((task) => [task.id, task]));
  const result: LastDone[] = [];
  for (const vehicle of snapshot.vehicles) {
    if (vehicle.ownership !== 'owned') continue;
    for (const due of vehicleDue(snapshot, vehicle.id, today).due) {
      const task = tasks.get(due.taskId);
      if (!task?.refTaskId || !due.lastDone) continue;
      result.push({ taskId: task.id, vehicleAppId: vehicle.id, planPageId: task.notionPlanId ?? null, km: due.lastDone.odometer, date: due.lastDone.date });
    }
  }
  return result;
}
