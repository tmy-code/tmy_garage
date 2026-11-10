// The Notion sync engine (ADR 0007), shared by the server's timer and the `npm run notion-sync` command:
// - fetchReference reads the owner's hand-made databases (read-only: nothing there is ever created, renamed or written);
// - pushAll copies Vehicles (the deal-hunting copy; Articles is no longer copied, ADR 0008) and the journal (Séances, Interventions, Consommables
//   utilisés), creating those databases and their missing columns; and writes back to the owner's Plans database.
//
// The ONLY writes into the owner's hand-made databases are, in "Plans d'entretien": a new page with its title (Plan),
// Véhicule and Tâche, and the two columns "Dernier fait (km)" and "Dernier fait (date)" of an existing page.
import type { Messages } from '../shared/messages.ts';
import type { IsoDate } from '../shared/dates.ts';
import type { Snapshot } from '../shared/types.ts';
import type { NotionApi } from './api.ts';
import { buildCopy } from './copy.ts';
import { buildJournal, buildLastDone, planKey } from './journal.ts';
import {
  APP_ID,
  INTERVENTIONS,
  REFERENCE_DBS,
  REMOVED,
  SESSIONS,
  USED,
  VEHICLES,
  columnSchema,
  fromNotion,
  notionType,
  relationPageIds,
  samePlain,
  toNotion,
  type Database,
  type DatabaseKey,
  type Plain,
  type ReferenceKey,
} from './databases.ts';
import { parseReference, titleKey, vehiclePageMap, type ReferencePull } from './reference.ts';

/** What the engine needs of the API client; the tests give it a stub. */
export type NotionClient = Pick<NotionApi, 'call' | 'all'>;

/** The databases the app manages itself, each after the ones its relations point at. */
const MANAGED = [VEHICLES, SESSIONS, INTERVENTIONS, USED] as const;

/** The title of the owner's Plans database, and the columns the app is allowed to write there. */
const PLANS = REFERENCE_DBS.find((d) => d.key === 'plans')!;
const LAST_KM = 'Dernier fait (km)';
const LAST_DATE = 'Dernier fait (date)';

export interface Counts {
  created: number;
  updated: number;
  unchanged: number;
  removed: number;
  /** Why no page was marked removed although some looked gone; shown with the other warnings. */
  warning?: string;
}

/** The databases under the parent page, by normalised title: the id of each one. */
async function databasesUnder(api: NotionClient, parentPageId: string): Promise<Map<string, string>> {
  const children = await api.all('GET', `/blocks/${parentPageId}/children`);
  return new Map<string, string>(children.filter((b) => b.type === 'child_database').map((b) => [titleKey(b.child_database.title as string), b.id as string]));
}

async function dataSourceOf(api: NotionClient, databaseId: string): Promise<string> {
  const database = await api.call('GET', `/databases/${databaseId}`);
  return database.data_sources[0].id as string;
}

/**
 * Reads every page of the owner's hand-made databases and of Véhicules (for the equipment and the page-to-vehicle
 * match), and parses them. Read only. A missing database is reported by the parse as incomplete; any API failure
 * throws, so a partial read is never mistaken for a complete one.
 */
export async function fetchReference(api: NotionClient, parentPageId: string): Promise<ReferencePull> {
  const existing = await databasesUnder(api, parentPageId);
  const pages: Record<string, any[]> = {};
  const wanted = [...REFERENCE_DBS.map((d) => [d.key, d.title] as const), ['vehicles', VEHICLES.title] as const];
  for (const [key, title] of wanted) {
    const databaseId = existing.get(titleKey(title));
    if (!databaseId) continue;
    const dataSourceId = await dataSourceOf(api, databaseId);
    pages[key] = await api.all('POST', `/data_sources/${dataSourceId}/query`);
  }
  return parseReference(pages, vehiclePageMap(pages.vehicles ?? []));
}

/**
 * Finds the app's own databases (Véhicules, Séances, Interventions, Consommables utilisés) under the parent page by title, creating the missing ones and
 * their missing columns. The owner's hand-made databases are not in this list, so they are never touched.
 */
export async function ensureDatabases(
  api: NotionClient,
  parentPageId: string,
  log: (message: string) => void = console.log,
  /** Filled with the relation columns that could not be created because the database they point at does not exist. */
  skipped: Map<DatabaseKey, Set<string>> = new Map(),
): Promise<Record<DatabaseKey, string>> {
  const existing = await databasesUnder(api, parentPageId);
  const dataSourceIds: Partial<Record<DatabaseKey | ReferenceKey, string>> = {};

  /** The data source a relation points at: one of the app's own databases, or (read only) one of the owner's. */
  async function targetOf(key: DatabaseKey | ReferenceKey): Promise<string | undefined> {
    if (dataSourceIds[key]) return dataSourceIds[key];
    const reference = REFERENCE_DBS.find((d) => d.key === key);
    const databaseId = reference ? existing.get(titleKey(reference.title)) : undefined;
    return databaseId ? (dataSourceIds[key] = await dataSourceOf(api, databaseId)) : undefined;
  }

  for (const db of MANAGED) {
    const databaseId = existing.get(titleKey(db.title));
    const skip = new Set<string>();
    skipped.set(db.key, skip);
    for (const c of db.columns) if (c.type === 'relation') await targetOf(c.target!);
    if (!databaseId) {
      // Create with the title and the columns whose target database exists.
      const properties: Record<string, unknown> = {};
      for (const c of db.columns) {
        if (c.type !== 'relation' || dataSourceIds[c.target!]) properties[c.name] = columnSchema(c, dataSourceIds);
        else skip.add(c.name);
      }
      const created = await api.call('POST', '/databases', {
        parent: { type: 'page_id', page_id: parentPageId },
        title: [{ type: 'text', text: { content: db.title } }],
        icon: { type: 'emoji', emoji: db.icon },
        initial_data_source: { properties },
      });
      const full = created.data_sources ? created : await api.call('GET', `/databases/${created.id}`);
      dataSourceIds[db.key] = full.data_sources[0].id;
      log(`Created the ${db.title} database.`);
    } else {
      dataSourceIds[db.key] = await dataSourceOf(api, databaseId);
    }

    // Add any column that is missing, never changing one that exists (the owner may have tuned it).
    const source = await api.call('GET', `/data_sources/${dataSourceIds[db.key]}`);
    const props = source.properties as Record<string, { type: string }>;
    const titleName = Object.entries(props).find(([, p]) => p.type === 'title')?.[0];
    const missing: Record<string, unknown> = {};
    for (const c of db.columns) {
      if (c.type === 'title') {
        if (titleName && titleName !== c.name) missing[titleName] = { name: c.name };
        continue;
      }
      const found = props[c.name];
      if (!found) {
        if (c.type === 'relation' && !dataSourceIds[c.target!]) skip.add(c.name);
        else missing[c.name] = columnSchema(c, dataSourceIds);
      } else if (found.type !== notionType(c.type)) {
        throw new Error(`In ${db.title}, the column "${c.name}" is a ${found.type}, not a ${notionType(c.type)}. Rename or fix it in Notion.`);
      }
    }
    if (Object.keys(missing).length > 0) {
      await api.call('PATCH', `/data_sources/${dataSourceIds[db.key]}`, { properties: missing });
      log(`${db.title}: added ${Object.keys(missing).join(', ')}.`);
    }
    if (skip.size > 0) log(`${db.title}: not created, the database they point at is missing: ${[...skip].join(', ')}.`);
  }
  return dataSourceIds as Record<DatabaseKey, string>;
}

/** Notion page id by app id, for every database, so relations can be written and read back. */
type PageIndex = Map<string, string>;

/** Creates or updates one page per row, writing only the app's columns of a page that changed; a gone record keeps its page. */
export async function syncDatabase<Row extends { appId: string }>(
  api: NotionClient,
  db: Database<Row>,
  dataSourceId: string,
  rows: Row[],
  pageIndex: PageIndex,
  appIdOfPage: Map<string, string>,
  /** When set, no page is marked removed (the snapshot cannot be trusted to say what is gone), and this is why. */
  holdRemovals?: string,
  /** Columns that do not exist in Notion (a relation to a database that is missing): left out of every write. */
  skipColumns: Set<string> = new Set(),
): Promise<Counts> {
  const counts: Counts = { created: 0, updated: 0, unchanged: 0, removed: 0 };
  const pages = await api.all('POST', `/data_sources/${dataSourceId}/query`);
  const byAppId = new Map<string, any>();
  for (const page of pages) {
    const appId = fromNotion(page.properties[APP_ID], () => undefined);
    if (typeof appId === 'string') {
      byAppId.set(appId, page);
      pageIndex.set(appId, page.id);
      appIdOfPage.set(page.id, appId);
    }
  }

  // The owner's columns (Deals, filing reference, equipment) are never in this list, so they are never written.
  const appColumns = db.columns.filter((c) => !c.owner && !skipColumns.has(c.name));
  for (const row of rows) {
    const wanted: Record<string, Plain> = { ...db.values(row), [APP_ID]: row.appId, [REMOVED]: false };
    const page = byAppId.get(row.appId);
    const changed = appColumns.filter(
      (c) => !page || !samePlain(fromNotion(page.properties[c.name], (id) => appIdOfPage.get(id)), wanted[c.name] ?? null),
    );
    if (page && changed.length === 0) {
      counts.unchanged++;
      continue;
    }
    const properties = Object.fromEntries(changed.map((c) => [c.name, toNotion(c.type, wanted[c.name] ?? null, (id) => pageIndex.get(id))]));
    if (page) {
      await api.call('PATCH', `/pages/${page.id}`, { properties });
      counts.updated++;
    } else {
      const created = await api.call('POST', '/pages', { parent: { type: 'data_source_id', data_source_id: dataSourceId }, properties });
      pageIndex.set(row.appId, created.id);
      appIdOfPage.set(created.id, row.appId);
      counts.created++;
    }
  }

  // A record gone from the copy keeps its page, so the owner's Deals are never lost.
  // Never on a doubtful snapshot: an empty one, or one that would mark most pages at once, is a mistake, not a clean-up.
  const kept = new Set(rows.map((r) => r.appId));
  const live = [...byAppId].filter(([, page]) => page.properties[REMOVED]?.checkbox !== true);
  const gone = live.filter(([appId]) => !kept.has(appId));
  if (gone.length > 0) {
    const reason =
      holdRemovals ??
      (rows.length === 0
        ? `the app has no row for it but Notion has ${live.length} linked page${live.length === 1 ? '' : 's'}`
        : gone.length > Math.max(3, live.length / 2)
          ? `${gone.length} of ${live.length} linked pages would be marked removed at once, which looks like a mistake`
          : null);
    if (reason) {
      counts.warning = `${db.title}: no page was marked "Supprimé de l’app": ${reason}`;
      return counts;
    }
  }
  for (const [appId, page] of gone) {
    await api.call('PATCH', `/pages/${page.id}`, { properties: { [REMOVED]: { checkbox: true } } });
    counts.removed++;
  }
  return counts;
}

export interface PushOptions {
  /** Nothing is read or written: a dry run creates nothing. */
  dryRun?: boolean;
  /** Called as soon as a Plan page is created, so its id is kept even if a later step fails. */
  onPlanCreated?: (taskId: string, pageId: string) => void;
}

export interface PushResult {
  /** Counts per database title, in the order they were pushed. */
  databases: [string, Counts][];
  /** The Plan pages created in this push, by the app's Task. */
  createdPlans: { taskId: string; pageId: string }[];
  warnings: string[];
}

/**
 * Writes back to the owner's Plans database, and nowhere else in the owner's databases:
 * - a Plan page for each Task that follows the catalogue and has none, with ONLY its title (Plan), Véhicule and Tâche;
 *   never when a page for that vehicle and task already exists (the owner's own, or one made by an earlier run), and
 *   never for a paused Task;
 * - "Dernier fait (km)" and "Dernier fait (date)" of each Task's page, only where the value differs, only when both
 *   columns exist with the right types, and not on a page that covers several vehicles.
 * A Plan page the owner archived is not in the query, so it is never recreated here: the pull unlinks and pauses its Task.
 */
async function syncPlans(
  api: NotionClient,
  parentPageId: string,
  snapshot: Snapshot,
  today: IsoDate,
  pageIndex: PageIndex,
  warnings: string[],
  onCreated?: (taskId: string, pageId: string) => void,
): Promise<{ counts: Counts; created: { taskId: string; pageId: string }[] } | null> {
  const owned = new Map(snapshot.vehicles.filter((v) => v.status === 'owned').map((v) => [v.id, v]));
  const refs = new Map(snapshot.refTasks.map((r) => [r.id, r]));
  const linked = snapshot.tasks.filter((task) => task.refTaskId && owned.has(task.vehicleId) && refs.has(task.refTaskId));
  const lastDone = new Map(buildLastDone(snapshot, today).map((l) => [l.taskId, l]));
  // A paused Task gets no page: that is also how a Plan page the owner archived stays archived (the pull paused its Task).
  const toCreate = linked.filter((task) => !task.notionPlanId && !task.switchedOff);
  const toWrite = linked.filter((task) => lastDone.has(task.id));
  if (toCreate.length === 0 && toWrite.length === 0) return null;

  const counts: Counts = { created: 0, updated: 0, unchanged: 0, removed: 0 };
  const created: { taskId: string; pageId: string }[] = [];
  const warn = (message: string) => {
    if (!warnings.includes(message)) warnings.push(message);
  };

  const databaseId = (await databasesUnder(api, parentPageId)).get(titleKey(PLANS.title));
  if (!databaseId) {
    warn(`${PLANS.title}: the database was not found, so no plan page was created and "Dernier fait" was not written`);
    return { counts, created };
  }
  const dataSourceId = await dataSourceOf(api, databaseId);
  const props = ((await api.call('GET', `/data_sources/${dataSourceId}`)).properties ?? {}) as Record<string, { type: string }>;
  const pages = await api.all('POST', `/data_sources/${dataSourceId}/query`);
  const pageById = new Map<string, any>(pages.map((page) => [page.id, page]));
  const known = new Set<string>();
  for (const page of pages) {
    for (const v of relationPageIds(page.properties?.['Véhicule'])) for (const k of relationPageIds(page.properties?.['Tâche'])) known.add(`${v}|${k}`);
  }

  const canCreate = props[PLANS.required[0]!.name]?.type === 'title' && props['Véhicule']?.type === 'relation' && props['Tâche']?.type === 'relation';
  if (toCreate.length > 0 && !canCreate) {
    warn(`${PLANS.title}: the columns Plan, Véhicule and Tâche are needed to create plan pages, so none was created`);
  } else {
    for (const task of toCreate) {
      const vehiclePage = pageIndex.get(task.vehicleId);
      const ref = refs.get(task.refTaskId!)!;
      if (!vehiclePage) continue;
      const key = `${vehiclePage}|${ref.notionId}`;
      if (known.has(key)) {
        counts.unchanged++;
        continue;
      }
      const page = await api.call('POST', '/pages', {
        parent: { type: 'data_source_id', data_source_id: dataSourceId },
        properties: {
          Plan: { title: [{ type: 'text', text: { content: `${ref.name} · ${owned.get(task.vehicleId)!.name}` } }] },
          Véhicule: { relation: [{ id: vehiclePage }] },
          Tâche: { relation: [{ id: ref.notionId }] },
        },
      });
      known.add(key);
      pageById.set(page.id, { id: page.id, properties: {} });
      created.push({ taskId: task.id, pageId: page.id });
      onCreated?.(task.id, page.id);
      counts.created++;
    }
  }

  if (toWrite.length > 0 && !(props[LAST_KM]?.type === 'number' && props[LAST_DATE]?.type === 'date')) {
    warn(`${PLANS.title}: "${LAST_KM}" (number) and "${LAST_DATE}" (date) are needed to write when a task was last done, so nothing was written`);
    return { counts, created };
  }
  const createdPage = new Map(created.map((c) => [c.taskId, c.pageId]));
  for (const task of toWrite) {
    const page = pageById.get(task.notionPlanId ?? createdPage.get(task.id) ?? '');
    if (!page) continue;
    if (relationPageIds(page.properties?.['Véhicule']).length > 1) {
      warn(`${PLANS.title}: the plan page of "${refs.get(task.refTaskId!)!.name}" covers several vehicles, so "Dernier fait" was not written`);
      continue;
    }
    const done = lastDone.get(task.id)!;
    const patch: Record<string, unknown> = {};
    const currentKm = page.properties?.[LAST_KM]?.number ?? null;
    if (done.km !== null && done.km !== currentKm) patch[LAST_KM] = { number: done.km };
    const currentDate = page.properties?.[LAST_DATE]?.date?.start;
    if (done.date !== (typeof currentDate === 'string' ? currentDate.slice(0, 10) : null)) patch[LAST_DATE] = { date: { start: done.date } };
    if (Object.keys(patch).length === 0) {
      counts.unchanged++;
      continue;
    }
    await api.call('PATCH', `/pages/${page.id}`, { properties: patch });
    counts.updated++;
  }
  return { counts, created };
}

/**
 * Pushes to Notion: the deal-hunting copy (Véhicules), the Plan pages and "Dernier fait" of the owner's Plans
 * database, then the journal (Séances, Interventions, Consommables utilisés). Every app database goes through the same
 * removal guard. Returns the counts per database title, the Plan pages created and the warnings.
 */
export async function pushAll(
  api: NotionClient,
  parentPageId: string,
  snapshot: Snapshot,
  today: IsoDate,
  t: Messages,
  log: (message: string) => void = console.log,
  options: PushOptions = {},
): Promise<PushResult> {
  if (options.dryRun) return { databases: [], createdPlans: [], warnings: [] };
  const copy = buildCopy(snapshot, today, t);
  const journal = buildJournal(snapshot, t);
  const skipped = new Map<DatabaseKey, Set<string>>();
  const dataSourceIds = await ensureDatabases(api, parentPageId, log, skipped);
  const pageIndex: PageIndex = new Map();
  const appIdOfPage = new Map<string, string>();
  const warnings: string[] = [];
  // A snapshot with no vehicles at all (a wrong or empty database) must not mark anything removed.
  const hold = snapshot.vehicles.length === 0 ? 'the app has no vehicles at all' : undefined;
  const databases: [string, Counts][] = [];
  const push = async <Row extends { appId: string }>(db: Database<Row>, rows: Row[]) =>
    databases.push([db.title, await syncDatabase(api, db, dataSourceIds[db.key], rows, pageIndex, appIdOfPage, hold, skipped.get(db.key))]);

  await push(VEHICLES, copy.vehicles);

  // The owner's pages that relations point at are known by their Notion ids.
  for (const r of snapshot.refTasks) pageIndex.set(r.id, r.notionId);
  for (const c of snapshot.consumableTypes) pageIndex.set(c.id, c.notionId);
  for (const p of snapshot.products) pageIndex.set(p.id, p.notionId);

  const plans = await syncPlans(api, parentPageId, snapshot, today, pageIndex, warnings, options.onPlanCreated);
  if (plans) databases.push([PLANS.title, plans.counts]);
  for (const task of snapshot.tasks) if (task.notionPlanId) pageIndex.set(planKey(task.id), task.notionPlanId);
  for (const c of plans?.created ?? []) pageIndex.set(planKey(c.taskId), c.pageId);

  await push(SESSIONS, journal.sessions);
  await push(INTERVENTIONS, journal.interventions);
  await push(USED, journal.used);
  return { databases, createdPlans: plans?.created ?? [], warnings };
}
