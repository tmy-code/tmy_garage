import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { REFERENCE_DBS } from '../notion/databases.ts';
import type { NotionClient } from '../notion/engine.ts';
import { createApp } from './app.ts';
import { openDatabase } from './db.ts';
import { createNotionSync } from './notion-sync.ts';

const TOKEN = 'secret-test-token-0001';

let db: DatabaseSync;

beforeEach(() => {
  db = openDatabase(':memory:');
});

afterEach(() => db.close());

/** A workspace with no databases at all: every read answers with an empty list. */
const emptyWorkspace = (): NotionClient => ({ call: async () => ({}), all: async () => [] }) as unknown as NotionClient;

const state = () => db.prepare('SELECT * FROM notion_state').get() as Record<string, any> | undefined;

describe('createNotionSync', () => {
  it('records the error without the token, changes no data, and is free to run again', async () => {
    db.exec(`INSERT INTO ref_tasks (id, garage_id, notion_id, name, action) VALUES ('r1', 'default', 'n1', 'Vidange', 'replace')`);
    const failing = { call: async () => ({}), all: async () => { throw new Error(`Notion rejected ${TOKEN}`); } } as unknown as NotionClient;
    const sync = createNotionSync({ db, garageId: 'default', token: TOKEN, parentPageId: 'parent', apiFactory: () => failing });
    await expect(sync.run()).rejects.toThrow('Notion rejected ***');
    expect(sync.running()).toBe(false);
    expect(state()!.last_error).toBe('Notion rejected ***');
    expect(JSON.stringify(state())).not.toContain(TOKEN);
    expect(db.prepare('SELECT count(*) AS n FROM ref_tasks WHERE notion_removed = 0').get()).toEqual({ n: 1 });
  });

  it('runs a dry run without touching the data or the status', async () => {
    const sync = createNotionSync({ db, garageId: 'default', token: TOKEN, parentPageId: 'parent', apiFactory: emptyWorkspace });
    const outcome = await sync.run({ dryRun: true });
    expect(outcome).toMatchObject({ dryRun: true, applied: null, pushed: null });
    expect(outcome.pulled.tasks).toEqual({ rows: 0, complete: false });
    expect(Object.keys(outcome.pulled)).toHaveLength(9);
    expect(outcome.warnings.join('\n')).toContain('not found');
    expect(state()).toBeUndefined();
  });

  it('refuses to start a second sync while one is running', async () => {
    let release!: () => void;
    const slow = {
      call: async () => ({}),
      all: () => new Promise<never[]>((resolve) => (release = () => resolve([]))),
    } as unknown as NotionClient;
    const sync = createNotionSync({ db, garageId: 'default', token: TOKEN, parentPageId: 'parent', apiFactory: () => slow });
    const first = sync.run({ dryRun: true });
    expect(sync.running()).toBe(true);
    await expect(sync.run({ dryRun: true })).rejects.toThrow('already running');
    release();
    await first;
    expect(sync.running()).toBe(false);
  });

  it('applies the pull, then pushes, and records the status for the snapshot', async () => {
    const writes: string[] = [];
    const createdTitles: string[] = [];
    // Only the app-managed databases exist, and they can be created: the hand-made ones are missing, so nothing is applied.
    const api = {
      call: async (method: string, path: string, body?: any) => {
        if (method !== 'GET') writes.push(`${method} ${path}`);
        if (path === '/databases') createdTitles.push(body?.title?.[0]?.text?.content);
        if (path === '/databases') return { id: 'db-new', data_sources: [{ id: 'ds-new' }] };
        if (path.startsWith('/data_sources/')) return { properties: {} };
        return {};
      },
      all: async () => [],
    } as unknown as NotionClient;
    const now = new Date('2026-11-10T09:00:00.000Z');
    const sync = createNotionSync({ db, garageId: 'default', token: TOKEN, parentPageId: 'parent', apiFactory: () => api, now: () => now });
    const outcome = await sync.run();
    expect(outcome.applied!.warnings.join('\n')).toContain('not found');
    expect(outcome.pushed!.map((p) => p.database)).toEqual(['Véhicules', 'Séances', 'Interventions', 'Consommables utilisés']);
    expect(writes).toContain('POST /databases');
    expect(createdTitles).not.toContain('Articles');
    expect(state()).toMatchObject({ last_sync_at: now.toISOString(), last_error: null });

    const app = createApp(db, undefined, { notionSync: sync });
    const snapshot = await (await app.request('/api/snapshot')).json();
    expect(snapshot.notion).toMatchObject({ lastSyncAt: now.toISOString(), lastError: null });
    expect(JSON.stringify(snapshot)).not.toContain(TOKEN);
  });
});

// A small Notion workspace that remembers the pages written to it, so a second run sees what the first one made.
function livingWorkspace() {
  interface Db {
    id: string;
    title: string;
    properties: Record<string, string>;
    pages: any[];
  }
  const dbs: Db[] = REFERENCE_DBS.map((d) => ({
    id: `db-${d.key}`,
    title: d.title,
    properties: Object.fromEntries([...d.required, ...d.optional].map((c) => [c.name, c.types[0]!])),
    pages: [],
  }));
  const writes: { method: string; path: string; body: any }[] = [];
  let counter = 0;
  const source = (id: string) => dbs.find((d) => `ds-${d.id}` === id)!;
  /** A written property value, as Notion would give it back when read. */
  const stored = (value: any) => {
    if (value.title) return { type: 'title', title: value.title.map((t: any) => ({ plain_text: t.text.content })) };
    if (value.rich_text) return { type: 'rich_text', rich_text: value.rich_text.map((t: any) => ({ plain_text: t.text.content })) };
    if (value.relation) return { type: 'relation', relation: value.relation };
    if ('checkbox' in value) return { type: 'checkbox', checkbox: value.checkbox };
    return { type: 'other' };
  };
  const client = {
    async call(method: string, path: string, body?: any) {
      if (method === 'GET') {
        const database = path.match(/^\/databases\/(.+)$/);
        if (database) return { data_sources: [{ id: `ds-${database[1]}` }] };
        return { properties: Object.fromEntries(Object.entries(source(path.replace('/data_sources/', '')).properties).map(([name, type]) => [name, { type }])) };
      }
      writes.push({ method, path, body });
      if (path === '/databases') {
        const id = `db-new-${++counter}`;
        const schema = body.initial_data_source.properties as Record<string, object>;
        dbs.push({ id, title: body.title[0].text.content, properties: Object.fromEntries(Object.entries(schema).map(([n, s]) => [n, Object.keys(s)[0]!])), pages: [] });
        return { id, data_sources: [{ id: `ds-${id}` }] };
      }
      if (path === '/pages') {
        const id = `${body.parent.data_source_id === 'ds-db-plans' ? 'plan' : 'page'}-new-${++counter}`;
        source(body.parent.data_source_id).pages.push({ id, properties: Object.fromEntries(Object.entries(body.properties).map(([n, v]) => [n, stored(v)])) });
        return { id };
      }
      return {};
    },
    async all(method: string, path: string) {
      if (method === 'GET') return dbs.map((d) => ({ type: 'child_database', id: d.id, child_database: { title: d.title } }));
      return source(path.match(/^\/data_sources\/(.+)\/query$/)![1]!).pages;
    },
  } as unknown as NotionClient;
  return { client, writes, dbs };
}

describe('reading the owner’s Achats', () => {
  it('copies them into ref_purchases and never writes to that database', async () => {
    const { client, writes, dbs } = livingWorkspace();
    dbs.find((d) => d.id === 'db-purchases')!.pages.push({
      id: 'achat-1',
      properties: {
        Achat: { type: 'title', title: [{ plain_text: 'Huile test' }] },
        Date: { type: 'date', date: { start: '2026-05-02' } },
        Article: { type: 'relation', relation: [{ id: 'article-1' }] },
        'Prix payé': { type: 'number', number: 31.5 },
        Boutique: { type: 'rich_text', rich_text: [{ plain_text: 'Boutique Exemple' }] },
      },
    });
    const sync = createNotionSync({ db, garageId: 'default', token: TOKEN, parentPageId: 'parent', apiFactory: () => client });
    const outcome = await sync.run();
    expect(outcome.applied!.counts.purchases).toEqual({ created: 1, updated: 0, removed: 0 });
    expect(db.prepare('SELECT date, article_notion_id, price, shop FROM ref_purchases').all()).toMatchObject([{ date: '2026-05-02', article_notion_id: 'article-1', price: 31.5, shop: 'Boutique Exemple' }]);
    expect(writes.filter((w) => w.path.includes('db-purchases') || w.body?.parent?.data_source_id === 'ds-db-purchases')).toEqual([]);
  });
});

describe('writing plan pages back to Notion', () => {
  const seed = () => {
    db.exec(`INSERT INTO vehicles (id, garage_id, kind, name) VALUES ('v1', 'default', 'motorcycle', 'Moto test')`);
    db.exec(`INSERT INTO ref_tasks (id, garage_id, notion_id, name, action, default_km, default_months) VALUES ('rt1', 'default', 'n-rt1', 'Vidange', 'replace', 6000, 12)`);
  };
  const task = () => db.prepare('SELECT * FROM maintenance_tasks').all() as Record<string, any>[];
  const planPosts = (writes: { method: string; body: any }[]) => writes.filter((w) => w.method === 'POST' && w.body?.parent?.data_source_id === 'ds-db-plans');

  it('derives the task, creates its plan page once, keeps the page id, and does nothing more on the next run', async () => {
    seed();
    const { client, writes } = livingWorkspace();
    const sync = createNotionSync({ db, garageId: 'default', token: TOKEN, parentPageId: 'parent', apiFactory: () => client });

    await sync.run();
    expect(task()).toMatchObject([{ name: 'Vidange', plan_auto: 0, notion_plan_id: expect.stringMatching(/^plan-new-/) }]);
    expect(planPosts(writes)).toHaveLength(1);
    const planId = task()[0]!.notion_plan_id;

    const before = writes.length;
    const outcome = await sync.run();
    expect(planPosts(writes)).toHaveLength(1);
    expect(task()).toHaveLength(1);
    expect(task()[0]).toMatchObject({ notion_plan_id: planId, ref_task_id: 'rt1', switched_off: 0 });
    expect(outcome.applied!.pausedTasks).toBe(0);
    // Nothing new was created in Notion on the second run.
    expect(writes.slice(before).filter((w) => w.method === 'POST')).toEqual([]);
  });

  it('pauses, and does not recreate, the plan page when the owner archives it', async () => {
    seed();
    const { client, writes, dbs } = livingWorkspace();
    const sync = createNotionSync({ db, garageId: 'default', token: TOKEN, parentPageId: 'parent', apiFactory: () => client });
    await sync.run();
    // Archiving removes the page from what Notion returns.
    dbs.find((d) => d.id === 'db-plans')!.pages.length = 0;
    const outcome = await sync.run();
    expect(outcome.applied!.pausedTasks).toBe(1);
    expect(task()).toMatchObject([{ ref_task_id: null, notion_plan_id: null, switched_off: 1 }]);
    expect(planPosts(writes)).toHaveLength(1);
    await sync.run();
    expect(planPosts(writes)).toHaveLength(1);
  });

  it('writes and creates nothing in Notion on a dry run, and keeps no plan id', async () => {
    seed();
    const { client, writes } = livingWorkspace();
    const sync = createNotionSync({ db, garageId: 'default', token: TOKEN, parentPageId: 'parent', apiFactory: () => client });
    const outcome = await sync.run({ dryRun: true });
    expect(outcome.pushed).toBeNull();
    expect(writes).toEqual([]);
    expect(task()).toEqual([]);
  });

  it('surfaces the push warnings with the others', async () => {
    seed();
    const { client, dbs } = livingWorkspace();
    // The Dernier fait columns are of the wrong type, so the sync says it could not write them.
    db.exec(`UPDATE vehicles SET equipment = '[]'`);
    db.exec(`INSERT INTO service_tasks (service_id, task_id) SELECT 's1', 'none' WHERE 0`);
    dbs.find((d) => d.id === 'db-plans')!.properties['Dernier fait (km)'] = 'rich_text';
    const sync = createNotionSync({ db, garageId: 'default', token: TOKEN, parentPageId: 'parent', apiFactory: () => client });
    db.exec(`UPDATE ref_tasks SET default_km = 6000`);
    // Give the task a baseline once it exists, so there is something to write.
    await sync.run();
    db.exec(`UPDATE maintenance_tasks SET baseline_date = '2026-01-10', baseline_odometer = 5000`);
    const outcome = await sync.run();
    expect(outcome.warnings.join('\n')).toContain('"Dernier fait (km)" (number)');
    expect(JSON.parse(state()!.warnings).join('\n')).toContain('"Dernier fait (km)" (number)');
  });
});
