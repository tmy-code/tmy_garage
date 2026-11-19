// Desktop create, edit and delete of Item Specs and Component Specs (ADR 0009). Notion is the master copy: each operation
// runs under the sync's lock, writes to Notion first, and only then stores the page Notion sent back. A failure leaves the
// local rows exactly as they were; there is no offline edit.
import type { DatabaseSync } from 'node:sqlite';
import { NotionError } from '../notion/api.ts';
import type { NotionClient } from '../notion/engine.ts';
import { parseSpecPage } from '../notion/reference.ts';
import {
  componentSpecProperties,
  createSpecPage,
  itemSpecProperties,
  readPage,
  removeSpecPage,
  specTarget,
  updateSpecPage,
  type SpecKind,
} from '../notion/spec-pages.ts';
import { SpecError } from '../shared/spec-errors.ts';
import type { ComponentSpecInput, ItemSpecInput } from '../shared/schemas.ts';
import type { ComponentSpec, ItemSpec } from '../shared/types.ts';
import { markSpecPageRemoved, storeSpecPage } from './notion-apply.ts';
import type { NotionSyncService } from './notion-sync.ts';

type Row = Record<string, any>;

/** A SpecError as is; a busy sync or a Notion failure as its SpecError; anything else (a bug) is not ours: null. */
export function asSpecError(error: unknown): SpecError | null {
  if (error instanceof SpecError) return error;
  if (error instanceof Error && error.name === 'NotionSyncBusy') return new SpecError('notion_busy', 'A Notion sync is already running');
  if (error instanceof NotionError) return new SpecError('notion_failed', error.message);
  return null;
}

export interface SpecEditor {
  createItemSpec(vehicleId: string, input: ItemSpecInput): Promise<ItemSpec>;
  updateItemSpec(id: string, input: ItemSpecInput): Promise<ItemSpec>;
  deleteItemSpec(id: string): Promise<void>;
  createComponentSpec(vehicleId: string, input: ComponentSpecInput): Promise<ComponentSpec>;
  updateComponentSpec(id: string, input: ComponentSpecInput): Promise<ComponentSpec>;
  deleteComponentSpec(id: string): Promise<void>;
}

const TABLE: Record<SpecKind, string> = { itemSpecs: 'vehicle_consumables', componentSpecs: 'component_specs' };

export function createSpecEditor(opts: {
  db: DatabaseSync;
  garageId: string;
  notionSync: NotionSyncService;
  toItemSpec: (r: Row) => ItemSpec;
  toComponentSpec: (r: Row) => ComponentSpec;
}): SpecEditor {
  const { db, garageId, notionSync } = opts;

  /** Runs one operation under the sync lock, turning every known failure into a SpecError (nothing is changed locally on failure). */
  async function guarded<T>(fn: (api: NotionClient, parentPageId: string) => Promise<T>): Promise<T> {
    try {
      return await notionSync.exclusive(fn);
    } catch (error) {
      const specError = asSpecError(error);
      if (specError) throw specError;
      throw error;
    }
  }

  /** An owned Vehicle of this garage that has a Notion page. */
  function vehicleWithPage(vehicleId: string): { id: string; pageId: string } {
    const row = db.prepare('SELECT id, ownership, notion_page_id FROM vehicles WHERE id = ? AND garage_id = ?').get(vehicleId, garageId) as Row | undefined;
    if (!row) throw new SpecError('not_found', 'Vehicle not found');
    if (row.ownership !== 'owned' || !row.notion_page_id) {
      throw new SpecError('vehicle_not_in_notion', 'This vehicle has no page in Notion yet: run a Notion sync first');
    }
    return { id: row.id, pageId: row.notion_page_id };
  }

  /** The pages of the owned Vehicles, to read a returned page like the pull would. */
  function pageMap(): Map<string, string> {
    const rows = db.prepare("SELECT id, notion_page_id FROM vehicles WHERE garage_id = ? AND ownership = 'owned' AND notion_page_id IS NOT NULL").all(garageId) as Row[];
    return new Map(rows.map((r) => [r.notion_page_id as string, r.id as string]));
  }

  /** The Notion page id of a referential row of this garage; an unknown or hidden id is refused. */
  function notionIdOf(table: 'consumable_types' | 'products' | 'ref_component_types', id: string | null, what: string): string | null {
    if (id === null) return null;
    const row = db.prepare(`SELECT notion_id FROM ${table} WHERE id = ? AND garage_id = ? AND notion_removed = 0`).get(id, garageId) as Row | undefined;
    if (!row) throw new SpecError('not_found', `That ${what} is not in the app's Notion lists`, 422);
    return row.notion_id as string;
  }

  function spec(kind: SpecKind, id: string): Row {
    const row = db.prepare(`SELECT * FROM ${TABLE[kind]} WHERE id = ? AND garage_id = ? AND notion_removed = 0`).get(id, garageId) as Row | undefined;
    if (!row) throw new SpecError('not_found', kind === 'itemSpecs' ? 'Item Spec not found' : 'Component Spec not found');
    return row;
  }

  /** Stores the page Notion returned and gives back the row of (vehicle, page). */
  function store(kind: SpecKind, page: any, vehicleId: string): Row {
    const parsed = kind === 'itemSpecs' ? parseSpecPage('itemSpecs', page, pageMap()) : parseSpecPage('componentSpecs', page, pageMap());
    storeSpecPage(db, garageId, kind, page.id, parsed.rows);
    const row = db.prepare(`SELECT * FROM ${TABLE[kind]} WHERE vehicle_id = ? AND notion_id = ? AND garage_id = ?`).get(vehicleId, page.id, garageId) as Row | undefined;
    if (!row || row.notion_removed === 1) throw new SpecError('notion_failed', 'Notion did not return the page as expected');
    return row;
  }

  /** A page that is in Notion's trash is gone: hide it here too. */
  function failIfTrashed(kind: SpecKind, page: any, notionId: string): void {
    if (page.in_trash === true || page.archived === true) {
      markSpecPageRemoved(db, garageId, kind, notionId);
      throw new SpecError('not_found', 'This page is no longer in Notion');
    }
  }

  return {
    createItemSpec: (vehicleId, input) =>
      guarded(async (api, parent) => {
        const vehicle = vehicleWithPage(vehicleId);
        const refs = {
          vehiclePageIds: [vehicle.pageId],
          typeNotionId: notionIdOf('consumable_types', input.typeId, 'type'),
          chosenProductNotionId: notionIdOf('products', input.chosenProductId, 'product'),
        };
        const target = await specTarget(api, parent, 'itemSpecs');
        const page = await createSpecPage(api, target, itemSpecProperties(input, target, refs));
        return opts.toItemSpec(store('itemSpecs', page, vehicle.id));
      }),

    updateItemSpec: (id, input) =>
      guarded(async (api, parent) => {
        const row = spec('itemSpecs', id);
        vehicleWithPage(row.vehicle_id);
        const refs = {
          vehiclePageIds: [],
          typeNotionId: notionIdOf('consumable_types', input.typeId, 'type'),
          chosenProductNotionId: notionIdOf('products', input.chosenProductId, 'product'),
        };
        const target = await specTarget(api, parent, 'itemSpecs');
        const current = await readPage(api, row.notion_id);
        failIfTrashed('itemSpecs', current, row.notion_id);
        const properties = itemSpecProperties(input, target, refs, current);
        const page = Object.keys(properties).length > 0 ? await updateSpecPage(api, row.notion_id, properties) : current;
        return opts.toItemSpec(store('itemSpecs', page, row.vehicle_id));
      }),

    deleteItemSpec: (id) =>
      guarded(async (api) => {
        const row = spec('itemSpecs', id);
        const vehicle = vehicleWithPage(row.vehicle_id);
        const page = await readPage(api, row.notion_id);
        failIfTrashed('itemSpecs', page, row.notion_id);
        const result = await removeSpecPage(api, page, vehicle.pageId);
        if (result === 'detached') markSpecPageRemoved(db, garageId, 'itemSpecs', row.notion_id, row.vehicle_id);
        else markSpecPageRemoved(db, garageId, 'itemSpecs', row.notion_id);
      }),

    createComponentSpec: (vehicleId, input) =>
      guarded(async (api, parent) => {
        const vehicle = vehicleWithPage(vehicleId);
        const refs = { vehiclePageIds: [vehicle.pageId], componentTypeNotionId: notionIdOf('ref_component_types', input.componentTypeId, 'component type') };
        const target = await specTarget(api, parent, 'componentSpecs');
        const page = await createSpecPage(api, target, componentSpecProperties(input, target, refs));
        return opts.toComponentSpec(store('componentSpecs', page, vehicle.id));
      }),

    updateComponentSpec: (id, input) =>
      guarded(async (api, parent) => {
        const row = spec('componentSpecs', id);
        vehicleWithPage(row.vehicle_id);
        const refs = { vehiclePageIds: [], componentTypeNotionId: notionIdOf('ref_component_types', input.componentTypeId, 'component type') };
        const target = await specTarget(api, parent, 'componentSpecs');
        const current = await readPage(api, row.notion_id);
        failIfTrashed('componentSpecs', current, row.notion_id);
        const properties = componentSpecProperties(input, target, refs, current);
        const page = Object.keys(properties).length > 0 ? await updateSpecPage(api, row.notion_id, properties) : current;
        return opts.toComponentSpec(store('componentSpecs', page, row.vehicle_id));
      }),

    deleteComponentSpec: (id) =>
      guarded(async (api) => {
        const row = spec('componentSpecs', id);
        const vehicle = vehicleWithPage(row.vehicle_id);
        const page = await readPage(api, row.notion_id);
        failIfTrashed('componentSpecs', page, row.notion_id);
        const result = await removeSpecPage(api, page, vehicle.pageId);
        if (result === 'detached') markSpecPageRemoved(db, garageId, 'componentSpecs', row.notion_id, row.vehicle_id);
        else markSpecPageRemoved(db, garageId, 'componentSpecs', row.notion_id);
      }),
  };
}
