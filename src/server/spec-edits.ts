// Desktop create, edit and delete of Item Specs and Component Specs (ADR 0009). Notion is the master copy: each operation
// runs under the sync's lock, writes to Notion first, and only then stores the page Notion sent back. A failure leaves the
// local rows exactly as they were; there is no offline edit.
import type { DatabaseSync } from 'node:sqlite';
import { NotionError } from '../notion/api.ts';
import type { NotionClient } from '../notion/engine.ts';
import { parseSpecPage } from '../notion/reference.ts';
import {
  SpecWriteError,
  componentSpecProperties,
  createSpecPage,
  itemSpecProperties,
  readPage,
  removeSpecPage,
  specTarget,
  updateSpecPage,
  type SpecKind,
} from '../notion/spec-pages.ts';
import type { ComponentSpecInput, ItemSpecInput } from '../shared/schemas.ts';
import type { ComponentSpec, ItemSpec } from '../shared/types.ts';
import { markSpecPageRemoved, storeSpecPage } from './notion-apply.ts';
import type { NotionSyncService } from './notion-sync.ts';

type Row = Record<string, any>;

export class SpecEditError extends Error {
  readonly status: 404 | 409 | 422 | 502 | 503;
  readonly code: 'not_found' | 'notion_off' | 'notion_busy' | 'vehicle_not_in_notion' | 'notion_incomplete' | 'value_not_number' | 'notion_failed';

  constructor(status: SpecEditError['status'], code: SpecEditError['code'], message: string) {
    super(message);
    this.name = 'SpecEditError';
    this.status = status;
    this.code = code;
  }
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

  /** Runs one operation under the sync lock, turning every failure into a SpecEditError (nothing is changed locally on failure). */
  async function guarded<T>(fn: (api: NotionClient, parentPageId: string) => Promise<T>): Promise<T> {
    try {
      return await notionSync.exclusive(fn);
    } catch (error) {
      if (error instanceof SpecEditError) throw error;
      if (error instanceof SpecWriteError) throw new SpecEditError(error.status, error.code, error.message);
      if (error instanceof Error && error.name === 'NotionSyncBusy') throw new SpecEditError(409, 'notion_busy', 'A Notion sync is already running');
      if (error instanceof NotionError) throw new SpecEditError(502, 'notion_failed', error.message);
      throw error;
    }
  }

  /** An owned Vehicle of this garage that has a Notion page. */
  function vehicleWithPage(vehicleId: string): { id: string; pageId: string } {
    const row = db.prepare('SELECT id, ownership, notion_page_id FROM vehicles WHERE id = ? AND garage_id = ?').get(vehicleId, garageId) as Row | undefined;
    if (!row) throw new SpecEditError(404, 'not_found', 'Vehicle not found');
    if (row.ownership !== 'owned' || !row.notion_page_id) {
      throw new SpecEditError(409, 'vehicle_not_in_notion', 'This vehicle has no page in Notion yet: run a Notion sync first');
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
    if (!row) throw new SpecEditError(422, 'not_found', `That ${what} is not in the app's Notion lists`);
    return row.notion_id as string;
  }

  function spec(kind: SpecKind, id: string): Row {
    const row = db.prepare(`SELECT * FROM ${TABLE[kind]} WHERE id = ? AND garage_id = ? AND notion_removed = 0`).get(id, garageId) as Row | undefined;
    if (!row) throw new SpecEditError(404, 'not_found', kind === 'itemSpecs' ? 'Item Spec not found' : 'Component Spec not found');
    return row;
  }

  /** Stores the page Notion returned and gives back the row of (vehicle, page). */
  function store(kind: SpecKind, page: any, vehicleId: string): Row {
    const parsed = kind === 'itemSpecs' ? parseSpecPage('itemSpecs', page, pageMap()) : parseSpecPage('componentSpecs', page, pageMap());
    storeSpecPage(db, garageId, kind, page.id, parsed.rows);
    const row = db.prepare(`SELECT * FROM ${TABLE[kind]} WHERE vehicle_id = ? AND notion_id = ? AND garage_id = ?`).get(vehicleId, page.id, garageId) as Row | undefined;
    if (!row || row.notion_removed === 1) throw new SpecEditError(502, 'notion_failed', 'Notion did not return the page as expected');
    return row;
  }

  /** A page that is in Notion's trash is gone: hide it here too. */
  function failIfTrashed(kind: SpecKind, page: any, notionId: string): void {
    if (page.in_trash === true || page.archived === true) {
      markSpecPageRemoved(db, garageId, kind, notionId);
      throw new SpecEditError(404, 'not_found', 'This page is no longer in Notion');
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
