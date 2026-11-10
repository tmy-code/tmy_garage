// The Notion sync engine (ADR 0007), shared by the server's timer and the `npm run notion-sync` command:
// - fetchReference reads the owner's hand-made databases (read-only: nothing there is ever created, renamed or written);
// - pushAll copies Vehicles and Articles (the deal-hunting copy), creating those two databases and their missing columns.
import type { Messages } from '../shared/messages.ts';
import type { IsoDate } from '../shared/dates.ts';
import type { Snapshot } from '../shared/types.ts';
import type { NotionApi } from './api.ts';
import { buildCopy } from './copy.ts';
import {
  APP_ID,
  ITEMS,
  REFERENCE_DBS,
  REMOVED,
  VEHICLES,
  columnSchema,
  fromNotion,
  notionType,
  samePlain,
  toNotion,
  type Database,
  type DatabaseKey,
  type Plain,
} from './databases.ts';
import { parseReference, titleKey, vehiclePageMap, type ReferencePull } from './reference.ts';

/** What the engine needs of the API client; the tests give it a stub. */
export type NotionClient = Pick<NotionApi, 'call' | 'all'>;

/** The databases the app manages itself. */
const MANAGED = [VEHICLES, ITEMS] as const;

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
 * Finds the app's own databases (Véhicules, Articles) under the parent page by title, creating the missing ones and
 * their missing columns. The owner's hand-made databases are not in this list, so they are never touched.
 */
export async function ensureDatabases(api: NotionClient, parentPageId: string, log: (message: string) => void = console.log): Promise<Record<DatabaseKey, string>> {
  const existing = await databasesUnder(api, parentPageId);
  const dataSourceIds: Partial<Record<DatabaseKey, string>> = {};

  for (const db of MANAGED) {
    const databaseId = existing.get(titleKey(db.title));
    if (!databaseId) {
      // Create with the title and the columns that do not point at a database still to be made.
      const properties: Record<string, unknown> = {};
      for (const c of db.columns) {
        if (c.type !== 'relation' || dataSourceIds[c.target!]) properties[c.name] = columnSchema(c, dataSourceIds);
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
      if (!found) missing[c.name] = columnSchema(c, dataSourceIds);
      else if (found.type !== notionType(c.type)) {
        throw new Error(`In ${db.title}, the column "${c.name}" is a ${found.type}, not a ${notionType(c.type)}. Rename or fix it in Notion.`);
      }
    }
    if (Object.keys(missing).length > 0) {
      await api.call('PATCH', `/data_sources/${dataSourceIds[db.key]}`, { properties: missing });
      log(`${db.title}: added ${Object.keys(missing).join(', ')}.`);
    }
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
  const appColumns = db.columns.filter((c) => !c.owner);
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

/**
 * Pushes the deal-hunting copy: Véhicules, then Articles. (The Plans page and the journal databases are not pushed yet.)
 * Returns the counts per database title.
 */
export async function pushAll(api: NotionClient, parentPageId: string, snapshot: Snapshot, today: IsoDate, t: Messages, log: (message: string) => void = console.log): Promise<[string, Counts][]> {
  const copy = buildCopy(snapshot, today, t);
  const dataSourceIds = await ensureDatabases(api, parentPageId, log);
  const pageIndex: PageIndex = new Map();
  const appIdOfPage = new Map<string, string>();
  // A snapshot with no vehicles at all (a wrong or empty database) must not mark anything removed.
  const hold = snapshot.vehicles.length === 0 ? 'the app has no vehicles at all' : undefined;
  return [
    [VEHICLES.title, await syncDatabase(api, VEHICLES, dataSourceIds.vehicles, copy.vehicles, pageIndex, appIdOfPage, hold)],
    [ITEMS.title, await syncDatabase(api, ITEMS, dataSourceIds.items, copy.items, pageIndex, appIdOfPage, hold)],
  ];
}
