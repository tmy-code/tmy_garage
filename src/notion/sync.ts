// npm run notion-sync: copies the garage into Notion for deal hunting (ADR 0005).
// Reads the app's snapshot, works out what to copy, and creates or updates the Notion pages.
// Options: --dry-run (show what would be copied, no Notion access), --snapshot <file> (read a saved snapshot instead of the server).
import { readFile } from 'node:fs/promises';
import { messagesFor } from '../client/i18n.ts';
import { todayIso } from '../shared/dates.ts';
import type { Snapshot } from '../shared/types.ts';
import { normalizeSnapshot } from '../shared/workshop.ts';
import { NotionApi } from './api.ts';
import { buildCopy, type NotionCopy } from './copy.ts';
import {
  APP_ID,
  ITEMS,
  REMOVED,
  SPECS,
  VEHICLES,
  columnSchema,
  fromNotion,
  notionType,
  samePlain,
  toNotion,
  type Database,
  type Plain,
  type DatabaseKey,
} from './databases.ts';

const DATABASES = [VEHICLES, SPECS, ITEMS] as const;

interface Counts {
  created: number;
  updated: number;
  unchanged: number;
  removed: number;
}

function option(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`${name} is not set. Add it to .env (see .env.example).`);
    process.exit(1);
  }
  return value;
}

async function loadSnapshot(): Promise<Snapshot> {
  const file = option('--snapshot');
  if (file) return normalizeSnapshot(JSON.parse(await readFile(file, 'utf8')) as Snapshot);
  const base = required('GARAGE_URL').replace(/\/+$/, '');
  const res = await fetch(`${base}/api/snapshot`);
  if (!res.ok) throw new Error(`The garage server answered ${res.status} for /api/snapshot.`);
  return normalizeSnapshot((await res.json()) as Snapshot);
}

/** Finds each database under the parent page by its title, creating the missing ones and their missing columns. */
async function ensureDatabases(api: NotionApi, parentPageId: string): Promise<Record<DatabaseKey, string>> {
  const children = await api.all('GET', `/blocks/${parentPageId}/children`);
  const existing = new Map<string, string>(
    children.filter((b) => b.type === 'child_database').map((b) => [b.child_database.title as string, b.id as string]),
  );
  const dataSourceIds: Partial<Record<DatabaseKey, string>> = {};

  for (const db of DATABASES) {
    const databaseId = existing.get(db.title);
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
      console.log(`Created the ${db.title} database.`);
    } else {
      const database = await api.call('GET', `/databases/${databaseId}`);
      dataSourceIds[db.key] = database.data_sources[0].id;
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
      console.log(`${db.title}: added ${Object.keys(missing).join(', ')}.`);
    }
  }
  return dataSourceIds as Record<DatabaseKey, string>;
}

/** Notion page id by app id, for every database, so relations can be written and read back. */
type PageIndex = Map<string, string>;

async function syncDatabase<Row extends { appId: string }>(
  api: NotionApi,
  db: Database<Row>,
  dataSourceId: string,
  rows: Row[],
  pageIndex: PageIndex,
  appIdOfPage: Map<string, string>,
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
    const properties = Object.fromEntries(
      changed.map((c) => [c.name, toNotion(c.type, wanted[c.name] ?? null, (id) => pageIndex.get(id))]),
    );
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
  const kept = new Set(rows.map((r) => r.appId));
  for (const [appId, page] of byAppId) {
    if (kept.has(appId) || page.properties[REMOVED]?.checkbox === true) continue;
    await api.call('PATCH', `/pages/${page.id}`, { properties: { [REMOVED]: { checkbox: true } } });
    counts.removed++;
  }
  return counts;
}

function report(copy: NotionCopy): void {
  console.log(`To copy: ${copy.vehicles.length} vehicles, ${copy.specs.length} spec lines, ${copy.items.length} items.`);
}

async function main(): Promise<void> {
  const snapshot = await loadSnapshot();
  const copy = buildCopy(snapshot, todayIso(), messagesFor('fr'));
  report(copy);

  if (process.argv.includes('--dry-run')) {
    console.log(JSON.stringify(copy, null, 2));
    return;
  }

  const api = new NotionApi(required('NOTION_TOKEN'));
  const dataSourceIds = await ensureDatabases(api, required('NOTION_PARENT_PAGE_ID'));
  const pageIndex: PageIndex = new Map();
  const appIdOfPage = new Map<string, string>();

  const results: [string, Counts][] = [
    [VEHICLES.title, await syncDatabase(api, VEHICLES, dataSourceIds.vehicles, copy.vehicles, pageIndex, appIdOfPage)],
    [SPECS.title, await syncDatabase(api, SPECS, dataSourceIds.specs, copy.specs, pageIndex, appIdOfPage)],
    [ITEMS.title, await syncDatabase(api, ITEMS, dataSourceIds.items, copy.items, pageIndex, appIdOfPage)],
  ];
  for (const [title, c] of results) {
    console.log(`${title}: ${c.created} created, ${c.updated} updated, ${c.unchanged} unchanged, ${c.removed} marked removed.`);
  }
  console.log(`Done in ${api.requests} Notion requests.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
