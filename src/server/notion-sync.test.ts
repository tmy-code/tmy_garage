import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
    // Only the app-managed databases exist, and they can be created: the hand-made ones are missing, so nothing is applied.
    const api = {
      call: async (method: string, path: string) => {
        if (method !== 'GET') writes.push(`${method} ${path}`);
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
    expect(outcome.pushed!.map((p) => p.database)).toEqual(['Véhicules', 'Articles']);
    expect(writes).toContain('POST /databases');
    expect(state()).toMatchObject({ last_sync_at: now.toISOString(), last_error: null });

    const app = createApp(db, undefined, { notionSync: sync });
    const snapshot = await (await app.request('/api/snapshot')).json();
    expect(snapshot.notion).toMatchObject({ lastSyncAt: now.toISOString(), lastError: null });
    expect(JSON.stringify(snapshot)).not.toContain(TOKEN);
  });
});
