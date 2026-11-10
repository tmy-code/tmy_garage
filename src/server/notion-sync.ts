// The Notion sync running on the server (ADR 0007): pull the owner's referentials, apply them, then push the copy.
// The Notion token lives here only: it is never sent to a phone, logged or returned by an endpoint.
import type { DatabaseSync } from 'node:sqlite';
import { messagesFor } from '../shared/messages.ts';
import { todayIso } from '../shared/dates.ts';
import { NotionApi } from '../notion/api.ts';
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

  async function run({ dryRun = false }: { dryRun?: boolean } = {}): Promise<SyncOutcome> {
    if (busy) {
      const error = new Error('A Notion sync is already running');
      error.name = 'NotionSyncBusy';
      throw error;
    }
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
        const pushed = await pushAll(api, parentPageId, readSnapshot(db, garageId), todayIso(now()), messagesFor('fr'), () => undefined);
        const pushWarnings = pushed.flatMap(([, counts]) => (counts.warning ? [counts.warning] : []));
        const warnings = [...applied.warnings, ...pushWarnings];
        if (pushWarnings.length > 0) saveState({ lastError: null, warnings, pausedTasks: applied.pausedTasks });
        return {
          dryRun: false,
          pulled: summarize(pull),
          applied,
          pushed: pushed.map(([database, counts]) => ({ database, counts })),
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
      (error: unknown) => console.error(`Notion sync failed: ${safe(error)}`),
    );
  }

  return {
    run,
    running: () => busy,
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
