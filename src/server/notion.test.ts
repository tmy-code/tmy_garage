import { describe, expect, it } from 'vitest';
import type {
  Vehicle,
} from '../shared/types.ts';
import { createApp } from './app.ts';
import { db, app, call, createVehicle, createTask, snapshot, setApp, setupGarage } from './test-helpers.ts';

setupGarage();

describe('the Achats read from Notion', () => {
  const insert = (id: string, article: string, removed = 0) =>
    db
      .prepare(
        `INSERT INTO ref_purchases (id, garage_id, notion_id, date, article_notion_id, product_id, quantity, price, shop, notion_removed)
         VALUES (?, 'default', ?, '2026-05-02', ?, NULL, 3, 31.5, 'Boutique Exemple', ?)`,
      )
      .run(id, `n-${id}`, article, removed);

  it('are in the snapshot, without the ones that vanished from Notion', async () => {
    insert('ach-1', 'n-article-1');
    insert('ach-2', 'n-article-2', 1);
    expect((await snapshot()).notionPurchases).toEqual([
      { id: 'ach-1', notionId: 'n-ach-1', date: '2026-05-02', articleNotionId: 'n-article-1', productId: null, quantity: 3, price: 31.5, shop: 'Boutique Exemple' },
    ]);
  });
});

describe('Notion-owned tasks and the Notion snapshot', () => {
  /** A Vehicle with one Task linked to a Catalogue Task, as the sync leaves it. */
  async function linkedTask() {
    const bike = await createVehicle();
    db.prepare(`INSERT INTO ref_tasks (id, garage_id, notion_id, name, action, default_km, default_months) VALUES ('rt1', 'default', 'n-rt1', 'Vidange', 'replace', 6000, 12)`).run();
    const task = await createTask(bike.id, { name: 'Vidange', nameFr: 'Vidange', intervalKm: 6000, intervalMonths: 12 });
    db.prepare(`UPDATE maintenance_tasks SET ref_task_id = 'rt1', plan_auto = 1 WHERE id = ?`).run(task.id);
    return { bike, task };
  }
  const putTask = (id: string, body: object) => call('PUT', `/api/tasks/${id}`, body);
  const sameAs = { name: 'Vidange', nameFr: 'Vidange', intervalKm: 6000, intervalMonths: 12, action: 'replace' };

  it('refuses to edit what Notion owns on a linked task, with a notion_owned code', async () => {
    const { task } = await linkedTask();
    for (const change of [{ name: 'Autre' }, { nameFr: 'Autre' }, { intervalKm: 7000 }, { intervalMonths: 6 }, { action: 'inspect' }, { notes: 'Ma note' }]) {
      const res = await putTask(task.id, { ...sameAs, ...change });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: 'notion_owned' });
    }
  });

  it('still lets the app edit the baseline, the category and switching off of a linked task', async () => {
    const { task } = await linkedTask();
    const res = await putTask(task.id, { ...sameAs, baselineDate: '2026-05-01', baselineOdometer: 12000, category: 'engine', switchedOff: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ baselineDate: '2026-05-01', category: 'engine', switchedOff: true, refTaskId: 'rt1' });
  });

  it('refuses to delete or merge away a linked task', async () => {
    const { bike, task } = await linkedTask();
    const del = await call('DELETE', `/api/tasks/${task.id}`);
    expect(del.status).toBe(409);
    expect(await del.json()).toMatchObject({ code: 'notion_owned' });
    const other = await createTask(bike.id, { name: 'Autre' });
    expect((await call('POST', `/api/tasks/${task.id}/merge`, { intoTaskId: other.id })).status).toBe(409);
    expect((await call('DELETE', `/api/tasks/${other.id}`)).status).toBe(204);
  });

  it('still edits and deletes tasks that are not linked', async () => {
    const bike = await createVehicle();
    const task = await createTask(bike.id);
    expect((await putTask(task.id, { name: 'Renamed', intervalKm: 5000 })).status).toBe(200);
    expect((await call('DELETE', `/api/tasks/${task.id}`)).status).toBe(204);
  });

  it('returns the referentials in the snapshot, hiding rows removed from Notion', async () => {
    const bike = await createVehicle();
    db.prepare(`UPDATE vehicles SET equipment = '["ABS","Transmission chaîne"]' WHERE id = ?`).run(bike.id);
    db.exec(`
      INSERT INTO ref_tasks (id, garage_id, notion_id, name, action, applicable_if, consumable_type_ids, tool_ids, instructions) VALUES ('rt1', 'default', 'n1', 'Vidange', 'replace', '["ABS"]', '["c1"]', '["tool1"]', 'Chauffer');
      INSERT INTO ref_component_types (id, garage_id, notion_id, name) VALUES ('comp1', 'default', 'n2', 'Bouchon');
      INSERT INTO consumable_types (id, garage_id, notion_id, name, family) VALUES ('c1', 'default', 'n3', 'Huile', 'fluid');
      INSERT INTO products (id, garage_id, notion_id, type_id, name, price) VALUES ('p1', 'default', 'n4', 'c1', 'Huile test', 9.5);
      INSERT INTO tools (id, garage_id, notion_id, name, owned) VALUES ('tool1', 'default', 'n5', 'Clé', 1), ('tool2', 'default', 'n6', 'Vieille clé', 0);
      UPDATE tools SET notion_removed = 1 WHERE id = 'tool2';
      INSERT INTO vehicle_consumables (id, garage_id, vehicle_id, notion_id, name, type_id, quantity, compatible_product_ids, confirmation) VALUES ('vc1', 'default', '${bike.id}', 'n7', 'Huile moteur', 'c1', 3.2, '["p1"]', 'to_confirm');
      INSERT INTO component_specs (id, garage_id, vehicle_id, notion_id, label, value, unit, confirmation) VALUES ('vs1', 'default', '${bike.id}', 'n8', 'Couple bouchon', '25', 'N·m', 'confirmed');
    `);
    const s = await snapshot();
    expect(s.vehicles[0]!.equipment).toEqual(['ABS', 'Transmission chaîne']);
    expect(s.refTasks).toEqual([
      { id: 'rt1', name: 'Vidange', action: 'replace', applicableIf: ['ABS'], defaultKm: null, defaultMonths: null, consumableTypeIds: ['c1'], componentTypeIds: [], toolIds: ['tool1'], instructions: 'Chauffer', notionId: 'n1' },
    ]);
    expect(s.componentTypes.map((c) => c.name)).toEqual(['Bouchon']);
    expect(s.consumableTypes).toMatchObject([{ id: 'c1', family: 'fluid' }]);
    expect(s.products).toMatchObject([{ id: 'p1', typeId: 'c1', price: 9.5 }]);
    expect(s.tools.map((t) => [t.name, t.owned])).toEqual([['Clé', true]]);
    expect(s.itemSpecs).toMatchObject([{ id: 'vc1', quantity: 3.2, compatibleProductIds: ['p1'], confirmation: 'to_confirm' }]);
    expect(s.componentSpecs).toMatchObject([{ id: 'vs1', value: '25', unit: 'N·m', confirmation: 'confirmed' }]);
    expect(s.notion).toBeNull();
  });
});

describe('the Notion sync endpoint and status', () => {
  const stub = (run: (opts?: { dryRun?: boolean }) => Promise<unknown>, running = false) => ({ run, running: () => running, start: () => undefined, stop: () => undefined }) as any;

  it('answers 503 when the sync is not set up, and the snapshot has no Notion status', async () => {
    const res = await call('POST', '/api/notion/sync');
    expect(res.status).toBe(503);
    expect((await snapshot()).notion).toBeNull();
  });

  it('answers 409 while a sync is running', async () => {
    setApp(createApp(db, undefined, { notionSync: stub(async () => ({}), true) }));
    expect((await call('POST', '/api/notion/sync')).status).toBe(409);
  });

  it('runs the sync and passes ?dryRun=1 on', async () => {
    const seen: unknown[] = [];
    setApp(createApp(db, undefined, {
      notionSync: stub(async (opts) => {
        seen.push(opts);
        return { dryRun: opts?.dryRun === true };
      }),
    }));
    expect(await (await call('POST', '/api/notion/sync')).json()).toEqual({ dryRun: false });
    expect(await (await call('POST', '/api/notion/sync?dryRun=1')).json()).toEqual({ dryRun: true });
    expect(seen).toEqual([{ dryRun: false }, { dryRun: true }]);
  });

  it('answers 502 with the message when the sync fails', async () => {
    setApp(createApp(db, undefined, {
      notionSync: stub(async () => {
        throw new Error('Notion is down');
      }),
    }));
    const res = await call('POST', '/api/notion/sync');
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'Notion is down' });
  });

  it('shows the last sync in the snapshot, and an empty status when the sync is set up but has not run', async () => {
    setApp(createApp(db, undefined, { notionSync: stub(async () => ({})) }));
    expect((await snapshot()).notion).toEqual({ lastSyncAt: null, lastError: null, warnings: [], pausedTasks: 0 });
    db.prepare(`INSERT INTO notion_state (garage_id, last_sync_at, last_error, warnings, paused_tasks) VALUES ('default', '2026-11-01T10:00:00.000Z', NULL, '["Un avertissement"]', 2)`).run();
    expect((await snapshot()).notion).toEqual({ lastSyncAt: '2026-11-01T10:00:00.000Z', lastError: null, warnings: ['Un avertissement'], pausedTasks: 2 });
  });
});
