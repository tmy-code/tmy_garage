// The Notion sync running on the server (ADR 0007): pull the owner's referentials, apply them, then push the copy.
// The Notion token lives here only: it is never sent to a phone, logged or returned by an endpoint.
import type { DatabaseSync } from 'node:sqlite';
import { messagesFor } from '../shared/messages.ts';
import { todayIso } from '../shared/dates.ts';
import { NotionApi, NotionError } from '../notion/api.ts';
import { fetchReference, pushAll, type Counts, type NotionClient } from '../notion/engine.ts';
import { REFERENCE_DBS } from '../notion/databases.ts';
import type { ReferencePull } from '../notion/reference.ts';
import { readSnapshot } from './app.ts';
import { applyPull, type ApplyReport } from './notion-apply.ts';

export interface SyncOutcome {
  dryRun: boolean;
  /** What was read from each database. */
  pulled: Record<string, { rows: number; complete: boolean }>;
  /** What changed in the app; null for a dry run. */
  applied: ApplyReport | null;
  /** What was copied to Notion; null for a dry run. */
  pushed: { database: string; counts: Counts }[] | null;
  warnings: string[];
}

export interface NotionSyncService {
  run(opts?: { dryRun?: boolean }): Promise<SyncOutcome>;
  /** Whether a sync is in progress. */
  running(): boolean;
  /** Starts the timer: a first run about a minute after, then every `intervalMs` (30 minutes). */
  start(intervalMs?: number): void;
  stop(): void;
  /**
   * Runs `fn` while no sync can start (a desktop spec edit, the one-off move); throws an Error named 'NotionSyncBusy' if one
   * runs. The token is stripped from errors; a NotionError keeps its status.
   */
  exclusive<T>(fn: (api: NotionClient, parentPageId: string) => Promise<T>): Promise<T>;
}

export interface NotionSyncOptions {
  db: DatabaseSync;
  garageId: string;
  token: string;
  parentPageId: string;
  /** Makes the API client; the tests give a stub. */
  apiFactory?: (token: string) => NotionClient;
  /** The clock, for tests. */
  now?: () => Date;
}

export const SYNC_INTERVAL_MS = 30 * 60_000;
const FIRST_RUN_DELAY_MS = 60_000;

/** Counts and completeness of each pulled database, for the answer to "Sync now". */
function summarize(pull: ReferencePull): SyncOutcome['pulled'] {
  const out: SyncOutcome['pulled'] = {};
  for (const d of REFERENCE_DBS) out[d.key] = { rows: pull[d.key].rows.length, complete: pull[d.key].complete };
  return out;
}

function allWarnings(pull: ReferencePull): string[] {
  return [...REFERENCE_DBS.flatMap((d) => pull[d.key].warnings), ...pull.vehicleWarnings];
}

export function createNotionSync({ db, garageId, token, parentPageId, apiFactory, now = () => new Date() }: NotionSyncOptions): NotionSyncService {
  let busy = false;
  let first: NodeJS.Timeout | undefined;
  let timer: NodeJS.Timeout | undefined;

  /** An error message with the token removed, in case Notion's answer echoes it. */
  const safe = (error: unknown): string => {
    const message = error instanceof Error ? error.message : String(error);
    return token ? message.split(token).join('***') : message;
  };

  function saveState(state: { lastSyncAt?: string; lastError: string | null; warnings?: string[]; pausedTasks?: number }): void {
    db.prepare(
      `INSERT INTO notion_state (garage_id, last_sync_at, last_error, warnings, paused_tasks) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (garage_id) DO UPDATE SET last_sync_at = coalesce(?, last_sync_at), last_error = excluded.last_error,
         warnings = coalesce(?, warnings), paused_tasks = coalesce(?, paused_tasks)`,
    ).run(
      garageId,
      state.lastSyncAt ?? null,
      state.lastError,
      JSON.stringify(state.warnings ?? []),
      state.pausedTasks ?? 0,
      state.lastSyncAt ?? null,
      state.warnings ? JSON.stringify(state.warnings) : null,
      state.pausedTasks ?? null,
    );
  }

  function busyError(): Error {
    const error = new Error('A Notion sync is already running');
    error.name = 'NotionSyncBusy';
    return error;
  }

  async function exclusive<T>(fn: (api: NotionClient, parentPageId: string) => Promise<T>): Promise<T> {
    if (busy) throw busyError();
    busy = true;
    try {
      return await fn(apiFactory ? apiFactory(token) : new NotionApi(token), parentPageId);
    } catch (error) {
      if (error instanceof NotionError) throw new NotionError(error.status, safe(error));
      if (error instanceof Error && error.name !== 'NotionSyncBusy' && error.message.includes(token) && token) {
        const cleaned = new Error(safe(error));
        cleaned.name = error.name;
        throw cleaned;
      }
      throw error;
    } finally {
      busy = false;
    }
  }

  async function run({ dryRun = false }: { dryRun?: boolean } = {}): Promise<SyncOutcome> {
    if (busy) throw busyError();
    busy = true;
    try {
      const api = apiFactory ? apiFactory(token) : new NotionApi(token);
      let applied: ApplyReport;
      let pull: ReferencePull;
      try {
        pull = await fetchReference(api, parentPageId);
        if (dryRun) return { dryRun: true, pulled: summarize(pull), applied: null, pushed: null, warnings: allWarnings(pull) };
        applied = applyPull(db, garageId, pull, readSnapshot(db, garageId));
      } catch (error) {
        if (!dryRun) saveState({ lastError: safe(error) });
        throw new Error(safe(error));
      }
      saveState({ lastSyncAt: now().toISOString(), lastError: null, warnings: applied.warnings, pausedTasks: applied.pausedTasks });

      // The reference data is in; a failing push is reported but undoes nothing.
      try {
        // A Plan page is kept against its Task as soon as it exists (the Task then counts as made from a Plan page).
        const keepPlan = db.prepare(
          `UPDATE maintenance_tasks SET notion_plan_id = ?, plan_auto = 0
           WHERE id = ? AND notion_plan_id IS NULL AND vehicle_id IN (SELECT id FROM vehicles WHERE garage_id = ?)`,
        );
        const pushed = await pushAll(api, parentPageId, readSnapshot(db, garageId), todayIso(now()), messagesFor('fr'), () => undefined, {
          onPlanCreated: (taskId, pageId) => void keepPlan.run(pageId, taskId, garageId),
        });
        const pushWarnings = [...pushed.warnings, ...pushed.databases.flatMap(([, counts]) => (counts.warning ? [counts.warning] : []))];
        const warnings = [...applied.warnings, ...pushWarnings];
        if (pushWarnings.length > 0) saveState({ lastError: null, warnings, pausedTasks: applied.pausedTasks });
        return {
          dryRun: false,
          pulled: summarize(pull),
          applied,
          pushed: pushed.databases.map(([database, counts]) => ({ database, counts })),
          warnings,
        };
      } catch (error) {
        saveState({ lastError: safe(error) });
        throw new Error(safe(error));
      }
    } finally {
      busy = false;
    }
  }

  function tick(): void {
    run().then(
      (outcome) => console.log(`Notion sync: ${outcome.applied?.warnings.length ?? 0} warning(s)`),
      (error: unknown) =>
        error instanceof Error && error.name === 'NotionSyncBusy'
          ? console.log('Notion sync skipped: another Notion operation is running')
          : console.error(`Notion sync failed: ${safe(error)}`),
    );
  }

  return {
    run,
    running: () => busy,
    exclusive,
    start(intervalMs = SYNC_INTERVAL_MS) {
      first = setTimeout(tick, FIRST_RUN_DELAY_MS);
      timer = setInterval(tick, intervalMs);
    },
    stop() {
      clearTimeout(first);
      clearInterval(timer);
    },
  };
}
