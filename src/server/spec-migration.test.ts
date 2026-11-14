import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  fakeNotion,
  numberValue,
  referenceDatabases,
  relationValue,
  richValue,
  selectValue,
  titleValue,
  vehiclesDatabase,
  type FakeDb,
} from '../notion/fake-notion.ts';
import { openDatabase } from './db.ts';
import { createNotionSync, type NotionSyncService } from './notion-sync.ts';
import { migrateSpecLines } from './spec-migration.ts';

const TOKEN = 'secret-test-token-0003';

let db: DatabaseSync;
let workspace: ReturnType<typeof fakeNotion>;
let sync: NotionSyncService;

const dbOf = (id: string): FakeDb => workspace.databases.find((d) => d.id === id)!;
const run = (dryRun: boolean) => migrateSpecLines({ db, garageId: 'default', notionSync: sync, dryRun });
const count = (table: string) => (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

/** A consumable type page and an Item Spec page, as the owner's Notion would have them. */
function seedNotion() {
  const databases = [...referenceDatabases(), vehiclesDatabase([['page-bike', 'bike'], ['page-car', 'car']])];
  workspace = fakeNotion(databases);
  dbOf('db-consumableTypes').pages.push({
    id: 'page-type-oil',
    properties: { Nom: titleValue('Huile moteur'), Catégorie: selectValue('Moteur'), Famille: selectValue('Fluide'), Notes: richValue('') },
  });
  // An Item Spec the owner already made for the bike: a line with the same name is linked, not created again.
  dbOf('db-itemSpecs').pages.push({
    id: 'page-brake',
    in_trash: false,
    properties: {
      Désignation: titleValue('Liquide de frein'),
      Véhicule: relationValue('page-bike'),
      Type: relationValue(),
      Spécification: richValue('DOT 4'),
      'Réf. OEM': richValue(''),
      Capacité: richValue(''),
      Quantité: numberValue(null),
      'Produit retenu': relationValue(),
      'Produits compatibles': relationValue(),
      Statut: selectValue('Confirmé'),
    },
  });
  sync = createNotionSync({ db, garageId: 'default', token: TOKEN, parentPageId: 'parent', apiFactory: () => workspace.client });
}

beforeEach(() => {
  db = openDatabase(':memory:');
  db.exec(`
    INSERT INTO vehicles (id, garage_id, kind, name, notion_page_id) VALUES ('bike', 'default', 'motorcycle', 'Moto test', 'page-bike'), ('car', 'default', 'car', 'Voiture test', 'page-car');
    INSERT INTO vehicles (id, garage_id, kind, name, ownership) VALUES ('sold', 'default', 'car', 'Vendue', 'sold');
    INSERT INTO spec_lines (id, vehicle_id, label, value, oem, spec_group, category, sort) VALUES
      ('l-oil', 'bike', 'Huile moteur', '10W-40, 3,2 L', 'OEM-1', 'fluids', 'engine', 0),
      ('l-brake', 'bike', 'Liquide de frein', 'DOT 4', NULL, 'fluids', 'brakes', 1),
      ('l-plug', 'bike', 'Bougie', 'NGK CR8E', NULL, 'parts', 'engine', 0),
      ('l-drain', 'bike', 'Bouchon de vidange', '25 N·m', NULL, 'torque', 'engine', 0),
      ('l-tyre', 'bike', 'Pneu avant', '120/70 ZR17', 'OEM-9', 'other', 'chassis', 0),
      ('l-empty', 'bike', 'Filtre à huile', '', NULL, 'parts', 'engine', 1),
      ('l-sold', 'sold', 'Huile moteur', '5W-30', NULL, 'fluids', NULL, 0);
    INSERT INTO vehicle_parts (id, vehicle_id, name, unit, quantity, spec_line_id) VALUES
      ('part-oil', 'bike', 'Motul 7100 10W-40', 'litre', 3.2, 'l-oil'),
      ('part-oil-2', 'bike', 'Autre huile', 'litre', 3.2, 'l-oil'),
      ('part-drain', 'bike', 'Joint de bouchon', 'piece', 1, 'l-drain');
    UPDATE vehicle_parts SET item_spec_id = 'chosen-by-owner' WHERE id = 'part-oil-2';
  `);
  seedNotion();
});

afterEach(() => db.close());

describe('migrateSpecLines', () => {
  it('a dry run reports the plan and makes no write to Notion and none here', async () => {
    const report = await run(true);
    expect(workspace.writes).toEqual([]);
    expect(count('spec_line_moves')).toBe(0);
    expect(count('vehicle_consumables')).toBe(0);
    expect(db.prepare("SELECT item_spec_id FROM vehicle_parts WHERE id = 'part-oil'").get()).toEqual({ item_spec_id: null });
    expect(report).toMatchObject({ dryRun: true, created: 4, linked: 1, skipped: 2, itemsRepointed: 1, itemsUnlinked: 1 });
    const move = (id: string) => report.moves.find((m) => m.specLineId === id)!;
    expect(move('l-oil')).toMatchObject({ target: 'item_spec', action: 'create', items: 2, preview: { Désignation: 'Huile moteur', Type: 'Huile moteur', Spécification: '10W-40', Capacité: '3,2 L', 'Réf. OEM': 'OEM-1', Statut: 'À confirmer' } });
    expect(move('l-brake')).toMatchObject({ action: 'link' });
    expect(move('l-plug')).toMatchObject({ target: 'item_spec', action: 'create', reason: 'type_not_found', preview: { Type: null, Spécification: 'NGK CR8E', Capacité: null } });
    expect(move('l-drain')).toMatchObject({ target: 'component_spec', action: 'create', preview: { Valeur: 25, Unité: 'N·m', Statut: 'À confirmer' } });
    expect(move('l-tyre')).toMatchObject({ target: 'component_spec', preview: { Valeur: null, Source: 'Appli : 120/70 ZR17 · OEM OEM-9' } });
    expect(move('l-empty')).toMatchObject({ action: 'skip', reason: 'empty' });
    expect(move('l-sold')).toMatchObject({ action: 'skip', reason: 'vehicle_not_in_notion' });
    expect(report.warnings.join('\n')).toContain('"Bougie"');
  });

  it('moves the lines, marks every page À confirmer, links instead of creating, and re-points the items', async () => {
    const report = await run(false);
    expect(report).toMatchObject({ dryRun: false, created: 4, linked: 1, skipped: 2, itemsRepointed: 1, itemsUnlinked: 1 });
    const creates = workspace.writes.filter((w) => w.method === 'POST' && w.path === '/pages');
    expect(creates).toHaveLength(4);
    for (const w of creates) expect(w.body.properties['Statut']).toEqual({ select: { name: 'À confirmer' } });
    const drain = creates.find((w) => w.body.properties['Élément']?.title[0].text.content === 'Bouchon de vidange')!.body.properties;
    expect(drain['Valeur']).toEqual({ number: 25 });
    expect(drain['Unité']).toEqual({ select: { name: 'N·m' } });
    expect(drain['Véhicule']).toEqual({ relation: [{ id: 'page-bike' }] });
    expect(workspace.writes.some((w) => w.method === 'PATCH')).toBe(false);

    expect(count('spec_line_moves')).toBe(5);
    expect(db.prepare("SELECT target, created_page FROM spec_line_moves WHERE spec_line_id = 'l-brake'").get()).toEqual({ target: 'item_spec', created_page: 0 });
    expect(db.prepare("SELECT created_page FROM spec_line_moves WHERE spec_line_id = 'l-oil'").get()).toEqual({ created_page: 1 });
    // The new pages are in the app already, and the items point at them (only where they pointed at nothing).
    const oil = db.prepare("SELECT id FROM vehicle_consumables WHERE vehicle_id = 'bike' AND name = 'Huile moteur'").get() as { id: string };
    expect(db.prepare("SELECT item_spec_id FROM vehicle_parts WHERE id = 'part-oil'").get()).toEqual({ item_spec_id: oil.id });
    expect(db.prepare("SELECT item_spec_id FROM vehicle_parts WHERE id = 'part-oil-2'").get()).toEqual({ item_spec_id: 'chosen-by-owner' });
    expect(db.prepare("SELECT item_spec_id FROM vehicle_parts WHERE id = 'part-drain'").get()).toEqual({ item_spec_id: null });
    expect(db.prepare("SELECT confirmation FROM vehicle_consumables WHERE id = ?").get(oil.id)).toEqual({ confirmation: 'to_confirm' });
    // Nothing is deleted: the lines stay, and only the unmoved ones remain in the snapshot.
    expect(count('spec_lines')).toBe(7);
  });

  it('is idempotent: a second run moves nothing and writes nothing', async () => {
    await run(false);
    const written = workspace.writes.length;
    const again = await run(false);
    expect(workspace.writes).toHaveLength(written);
    expect(again).toMatchObject({ created: 0, linked: 0, itemsRepointed: 0 });
    expect(again.moves.every((m) => m.action === 'skip')).toBe(true);
    expect(again.moves.map((m) => m.specLineId).sort()).toEqual(['l-empty', 'l-sold']);
    expect(count('spec_line_moves')).toBe(5);
  });

  it('finishes the re-pointing of lines moved by an earlier, interrupted run', async () => {
    await run(false);
    const oil = db.prepare("SELECT id FROM vehicle_consumables WHERE vehicle_id = 'bike' AND name = 'Huile moteur'").get() as { id: string };
    db.prepare("UPDATE vehicle_parts SET item_spec_id = NULL WHERE id = 'part-oil'").run(); // as if the run had stopped before step 7
    const again = await run(false);
    expect(again).toMatchObject({ created: 0, itemsRepointed: 1 });
    expect(db.prepare("SELECT item_spec_id FROM vehicle_parts WHERE id = 'part-oil'").get()).toEqual({ item_spec_id: oil.id });
  });

  it('stops before any write when a column the plan writes is missing', async () => {
    delete dbOf('db-itemSpecs').properties['Capacité'];
    await expect(run(false)).rejects.toMatchObject({ code: 'notion_incomplete' });
    expect(workspace.writes).toEqual([]);
    expect(count('spec_line_moves')).toBe(0);
    // A dry run still answers, with the problem as a warning.
    const report = await run(true);
    expect(report.warnings.join('\n')).toContain('Capacité');
  });
});
