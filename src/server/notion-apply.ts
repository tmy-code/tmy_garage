// Applies what the Notion pull found to the database (ADR 0007): the referentials are copied as they are in Notion, and
// each owned Vehicle's plan is derived from the catalogue, the Vehicle's equipment and the Plan pages.
// One transaction: an error leaves the data untouched. Only changes are written. Nothing is ever deleted: rows gone
// from Notion are hidden, and a Task that loses its link is paused, with its history kept.
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { applicableRefTasks, resolveInterval } from '../shared/applicability.ts';
import type { PartCategory } from '../shared/catalogue.ts';
import type { RefTask, Snapshot } from '../shared/types.ts';
import { refKey } from '../shared/workshop.ts';
import type { ComponentSpecRow, ItemSpecRow, ReferencePull } from '../notion/reference.ts';

type Row = Record<string, any>;

export interface DbCounts {
  created: number;
  updated: number;
  removed: number;
}

export const COUNT_KEYS = ['tasks', 'componentTypes', 'consumableTypes', 'products', 'tools', 'itemSpecs', 'componentSpecs', 'purchases', 'maintenanceTasks'] as const;
export type CountKey = (typeof COUNT_KEYS)[number];

export interface ApplyReport {
  /** Per database; `maintenanceTasks` counts the app's tasks (created or updated from the plan, `removed` = unlinked and paused). */
  counts: Record<CountKey, DbCounts>;
  warnings: string[];
  /** Tasks paused because their Plan page vanished or they no longer apply. */
  pausedTasks: number;
}

interface Incoming {
  notionId: string;
  vehicleId?: string;
  values: Record<string, unknown>;
}

/** A value as SQLite stores it here: lists as JSON, flags as 0/1. */
function stored(value: unknown): string | number | null {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value as string | number;
}

const parseList = (value: unknown): string[] => {
  try {
    const list: unknown = JSON.parse(String(value ?? '[]'));
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

/** The app's id of each Notion referential page (Notion page id to the app's row id), for the rows Notion still has. */
export interface NotionIdMaps {
  consumableTypes: Map<string, string>;
  products: Map<string, string>;
  componentTypes: Map<string, string>;
}

export function notionIdMaps(db: DatabaseSync, garageId: string): NotionIdMaps {
  const of = (table: string) =>
    new Map((db.prepare(`SELECT id, notion_id FROM ${table} WHERE garage_id = ? AND notion_removed = 0`).all(garageId) as Row[]).map((r) => [r.notion_id as string, r.id as string]));
  return { consumableTypes: of('consumable_types'), products: of('products'), componentTypes: of('ref_component_types') };
}

/** The columns of a vehicle_consumables row (an Item Spec) for one pulled row. */
export function itemSpecValues(r: ItemSpecRow, maps: NotionIdMaps, warn?: (message: string) => void): Record<string, unknown> {
  const compatible = r.compatibleProductNotionIds.flatMap((id) => (maps.products.has(id) ? [maps.products.get(id)!] : []));
  if (warn && compatible.length < new Set(r.compatibleProductNotionIds).size) warn(`Item Spec "${r.name}": a linked item is not in Notion's lists and was ignored`);
  return {
    name: r.name,
    type_id: r.typeNotionId ? (maps.consumableTypes.get(r.typeNotionId) ?? null) : null,
    specification: r.specification,
    oem_ref: r.oemRef,
    capacity: r.capacity,
    quantity: r.quantity,
    compatible_product_ids: [...new Set(compatible)],
    chosen_product_id: r.chosenProductNotionId ? (maps.products.get(r.chosenProductNotionId) ?? null) : null,
    confirmation: r.confirmation,
  };
}

/** The columns of a component_specs row (a Component Spec) for one pulled row. */
export function componentSpecValues(r: ComponentSpecRow, maps: NotionIdMaps): Record<string, unknown> {
  return {
    label: r.label,
    component_type_id: r.componentTypeNotionId ? (maps.componentTypes.get(r.componentTypeNotionId) ?? null) : null,
    category: r.category,
    value: r.value,
    unit: r.unit,
    source: r.source,
    confirmation: r.confirmation,
  };
}

const SPEC_TABLE = { itemSpecs: 'vehicle_consumables', componentSpecs: 'component_specs' } as const;

/**
 * Stores one spec page as Notion returned it: upserts (vehicle_id, notion_id) per row (notion_removed = 0), and marks
 * the owned Vehicles of this garage that are no longer on the page (notion_removed = 1). One transaction (or the
 * caller's, when one is open). Returns the row's app id by vehicle id.
 */
export function storeSpecPage(
  db: DatabaseSync,
  garageId: string,
  kind: 'itemSpecs' | 'componentSpecs',
  notionId: string,
  rows: (ItemSpecRow | ComponentSpecRow)[],
): Map<string, string> {
  const table = SPEC_TABLE[kind];
  const maps = notionIdMaps(db, garageId);
  const ids = new Map<string, string>();
  const own = !db.isTransaction;
  if (own) db.exec('BEGIN');
  try {
    for (const row of rows) {
      const values = kind === 'itemSpecs' ? itemSpecValues(row as ItemSpecRow, maps) : componentSpecValues(row as ComponentSpecRow, maps);
      const columns = Object.keys(values);
      const storedValues = columns.map((c) => stored(values[c]));
      const found = db.prepare(`SELECT id FROM ${table} WHERE vehicle_id = ? AND notion_id = ? AND garage_id = ?`).get(row.vehicleAppId, notionId, garageId) as Row | undefined;
      if (found) {
        db.prepare(`UPDATE ${table} SET ${columns.map((c) => `${c} = ?`).join(', ')}, notion_removed = 0 WHERE id = ?`).run(...storedValues, found.id);
        ids.set(row.vehicleAppId, found.id);
      } else {
        const id = randomUUID();
        const all = ['id', 'garage_id', 'notion_id', 'vehicle_id', ...columns];
        db.prepare(`INSERT INTO ${table} (${all.join(', ')}) VALUES (${all.map(() => '?').join(', ')})`).run(id, garageId, notionId, row.vehicleAppId, ...storedValues);
        ids.set(row.vehicleAppId, id);
      }
    }
    // Owned vehicles that had this page and are no longer on it.
    const present = rows.map((r) => r.vehicleAppId);
    const stale = db
      .prepare(`SELECT x.id, x.vehicle_id FROM ${table} x JOIN vehicles v ON v.id = x.vehicle_id WHERE x.garage_id = ? AND x.notion_id = ? AND x.notion_removed = 0 AND v.ownership = 'owned'`)
      .all(garageId, notionId) as Row[];
    for (const s of stale) if (!present.includes(s.vehicle_id)) db.prepare(`UPDATE ${table} SET notion_removed = 1 WHERE id = ?`).run(s.id);
    if (own) db.exec('COMMIT');
  } catch (error) {
    if (own) db.exec('ROLLBACK');
    throw error;
  }
  return ids;
}

/** Hides the rows of a spec page the app trashed (all of them, or just this Vehicle's when the page stays for others). */
export function markSpecPageRemoved(db: DatabaseSync, garageId: string, kind: 'itemSpecs' | 'componentSpecs', notionId: string, vehicleId?: string): void {
  const table = SPEC_TABLE[kind];
  if (vehicleId) db.prepare(`UPDATE ${table} SET notion_removed = 1 WHERE garage_id = ? AND notion_id = ? AND vehicle_id = ?`).run(garageId, notionId, vehicleId);
  else db.prepare(`UPDATE ${table} SET notion_removed = 1 WHERE garage_id = ? AND notion_id = ?`).run(garageId, notionId);
}

/** Brings the Notion referentials and the Vehicles' plans up to date with one pull. `snapshot` supplies the Vehicles. */
export function applyPull(db: DatabaseSync, garageId: string, pull: ReferencePull, snapshot: Pick<Snapshot, 'vehicles'>): ApplyReport {
  const counts = Object.fromEntries(COUNT_KEYS.map((k) => [k, { created: 0, updated: 0, removed: 0 }])) as Record<CountKey, DbCounts>;
  const warnings: string[] = [];
  const warn = (message: string) => {
    if (!warnings.includes(message)) warnings.push(message);
  };
  let pausedTasks = 0;

  /** Copies incoming rows into a referential table by Notion id, then hides the ones Notion no longer has (with guards). */
  function syncRows(table: string, label: string, incoming: Incoming[], complete: boolean, count: DbCounts, perVehicle = false): Map<string, string> {
    const existing = db.prepare(`SELECT * FROM ${table} WHERE garage_id = ?`).all(garageId) as Row[];
    const keyOf = (r: Row) => (perVehicle ? `${r.vehicle_id}|${r.notion_id}` : (r.notion_id as string));
    const byKey = new Map(existing.map((r) => [keyOf(r), r]));
    const ids = new Map<string, string>();
    if (!complete) {
      for (const r of existing) if (r.notion_removed === 0) ids.set(keyOf(r), r.id);
      return ids;
    }

    const seen = new Set<string>();
    for (const inc of incoming) {
      const key = perVehicle ? `${inc.vehicleId}|${inc.notionId}` : inc.notionId;
      if (seen.has(key)) continue;
      seen.add(key);
      const columns = Object.keys(inc.values);
      const values = columns.map((c) => stored(inc.values[c]));
      const found = byKey.get(key);
      if (!found) {
        const id = randomUUID();
        const head = perVehicle ? ['id', 'garage_id', 'notion_id', 'vehicle_id'] : ['id', 'garage_id', 'notion_id'];
        const headValues = perVehicle ? [id, garageId, inc.notionId, inc.vehicleId!] : [id, garageId, inc.notionId];
        const all = [...head, ...columns];
        db.prepare(`INSERT INTO ${table} (${all.join(', ')}) VALUES (${all.map(() => '?').join(', ')})`).run(...headValues, ...values);
        count.created++;
        ids.set(key, id);
      } else {
        ids.set(key, found.id);
        const changed = found.notion_removed === 1 || columns.some((c, i) => found[c] !== values[i]);
        if (changed) {
          db.prepare(`UPDATE ${table} SET ${columns.map((c) => `${c} = ?`).join(', ')}${columns.length ? ', ' : ''}notion_removed = 0 WHERE id = ?`).run(...values, found.id);
          count.updated++;
        }
      }
    }

    const live = existing.filter((r) => r.notion_removed === 0);
    const gone = live.filter((r) => !seen.has(keyOf(r)));
    let removeThem = gone.length > 0;
    if (gone.length > 0 && seen.size === 0) {
      warn(`${label}: Notion returned no rows but ${live.length} are linked, so none was removed`);
      removeThem = false;
    } else if (gone.length > Math.max(3, live.length / 2)) {
      warn(`${label}: ${gone.length} of ${live.length} rows are gone from Notion, which looks like a mistake, so none was removed`);
      removeThem = false;
    }
    for (const r of gone) {
      if (removeThem) {
        db.prepare(`UPDATE ${table} SET notion_removed = 1 WHERE id = ?`).run(r.id);
        count.removed++;
      } else {
        ids.set(keyOf(r), r.id);
      }
    }
    return ids;
  }

  /** The app ids of Notion pages, dropping (and reporting) the ones that are not in the pulled lists. */
  function resolve(map: Map<string, string>, notionIds: string[], what: string): string[] {
    const found = notionIds.flatMap((id) => (map.has(id) ? [map.get(id)!] : []));
    if (found.length < new Set(notionIds).size) warn(`${what}: a linked item is not in Notion's lists and was ignored`);
    return [...new Set(found)];
  }

  const vehicleIds = new Set(snapshot.vehicles.map((v) => v.id));

  db.exec('BEGIN');
  try {
    for (const key of ['tasks', 'componentTypes', 'consumableTypes', 'products', 'tools', 'itemSpecs', 'componentSpecs', 'purchases', 'plans'] as const) {
      for (const w of pull[key].warnings) warn(w);
    }
    for (const w of pull.vehicleWarnings) warn(w);

    // --- Types, tools, products, then what refers to them ---
    const componentIds = syncRows(
      'ref_component_types',
      'Types de composants',
      pull.componentTypes.rows.map((r) => ({ notionId: r.notionId, values: { name: r.name, category: r.category, notes: r.notes } })),
      pull.componentTypes.complete,
      counts.componentTypes,
    );
    const consumableIds = syncRows(
      'consumable_types',
      'Types de consommables',
      pull.consumableTypes.rows.map((r) => ({ notionId: r.notionId, values: { name: r.name, category: r.category, family: r.family, notes: r.notes } })),
      pull.consumableTypes.complete,
      counts.consumableTypes,
    );
    const toolIds = syncRows(
      'tools',
      'Outils',
      pull.tools.rows.map((r) => ({ notionId: r.notionId, values: { name: r.name, kind: r.kind, size: r.size, owned: r.owned, price: r.price, notes: r.notes } })),
      pull.tools.complete,
      counts.tools,
    );
    const productIds = syncRows(
      'products',
      'Produits',
      pull.products.rows.map((r) => ({
        notionId: r.notionId,
        values: {
          type_id: r.typeNotionId ? (consumableIds.get(r.typeNotionId) ?? null) : null,
          name: r.name,
          brand: r.brand,
          reference: r.reference,
          supplier: r.supplier,
          price: r.price,
          notes: r.notes,
        },
      })),
      pull.products.complete,
      counts.products,
    );
    const refIds = syncRows(
      'ref_tasks',
      "Tâches d'entretien",
      pull.tasks.rows.map((r) => {
        if (r.action === null) warn(`Tâche "${r.name}": no usable Action, treated as a replacement`);
        return {
          notionId: r.notionId,
          values: {
            name: r.name,
            action: r.action ?? 'replace',
            applicable_if: r.applicableIf,
            default_km: r.defaultKm,
            default_months: r.defaultMonths,
            consumable_type_ids: resolve(consumableIds, r.consumableTypeNotionIds, `Tâche "${r.name}"`),
            component_type_ids: resolve(componentIds, r.componentTypeNotionIds, `Tâche "${r.name}"`),
            tool_ids: resolve(toolIds, r.toolNotionIds, `Tâche "${r.name}"`),
            instructions: r.instructions,
            category: r.category,
          },
        };
      }),
      pull.tasks.complete,
      counts.tasks,
    );

    const knownVehicle = <T extends { vehicleAppId: string; name?: string; label?: string }>(r: T) => {
      if (vehicleIds.has(r.vehicleAppId)) return true;
      warn(`"${r.name ?? r.label}" is for a vehicle that is not in the app, skipped`);
      return false;
    };
    const maps: NotionIdMaps = { consumableTypes: consumableIds, products: productIds, componentTypes: componentIds };
    syncRows(
      'vehicle_consumables',
      "Spécifications d'articles",
      pull.itemSpecs.rows.filter(knownVehicle).map((r) => ({ notionId: r.notionId, vehicleId: r.vehicleAppId, values: itemSpecValues(r, maps, warn) })),
      pull.itemSpecs.complete,
      counts.itemSpecs,
      true,
    );
    syncRows(
      'component_specs',
      'Spécifications de composants',
      pull.componentSpecs.rows.filter(knownVehicle).map((r) => ({ notionId: r.notionId, vehicleId: r.vehicleAppId, values: componentSpecValues(r, maps) })),
      pull.componentSpecs.complete,
      counts.componentSpecs,
      true,
    );
    // The owner's Achats, read-only: matched to a vehicle's consumable line by the line's Notion page id when read.
    syncRows(
      'ref_purchases',
      'Achats',
      pull.purchases.rows.map((r) => ({
        notionId: r.notionId,
        values: {
          date: r.date,
          article_notion_id: r.articleNotionId,
          product_id: r.productNotionId ? (productIds.get(r.productNotionId) ?? null) : null,
          quantity: r.quantity,
          price: r.price,
          shop: r.shop,
        },
      })),
      pull.purchases.complete,
      counts.purchases,
    );

    // --- Equipment, and the link to each Vehicle's Notion page ---
    const equipmentOf = new Map<string, string[]>();
    for (const v of snapshot.vehicles) {
      const pageId = pull.vehiclePageIds[v.id];
      if (pageId !== undefined && pageId !== (v.notionPageId ?? null)) db.prepare('UPDATE vehicles SET notion_page_id = ? WHERE id = ? AND garage_id = ?').run(pageId, v.id, garageId);
      const tags = pull.equipment[v.id];
      if (tags === undefined) {
        equipmentOf.set(v.id, v.equipment);
        continue;
      }
      equipmentOf.set(v.id, tags);
      if (JSON.stringify(tags) !== JSON.stringify(v.equipment)) db.prepare('UPDATE vehicles SET equipment = ? WHERE id = ? AND garage_id = ?').run(JSON.stringify(tags), v.id, garageId);
      if (tags.length === 0 && v.ownership === 'owned') warn(`Vehicle "${v.name}" has no equipment in Notion: only the tasks with no condition apply to it`);
    }

    // --- Each owned Vehicle's plan ---
    if (!pull.tasks.complete || !pull.plans.complete) {
      warn('The task catalogue or the plans could not be read completely, so the vehicles\' tasks were not updated');
    } else {
      planTasks();
    }

    function planTasks(): void {
      const refs: (RefTask & { notionId: string; category: PartCategory | null })[] = (db.prepare('SELECT * FROM ref_tasks WHERE garage_id = ? AND notion_removed = 0').all(garageId) as Row[]).map((r) => ({
        id: r.id,
        name: r.name,
        action: r.action,
        applicableIf: parseList(r.applicable_if),
        defaultKm: r.default_km,
        defaultMonths: r.default_months,
        consumableTypeIds: parseList(r.consumable_type_ids),
        componentTypeIds: parseList(r.component_type_ids),
        toolIds: parseList(r.tool_ids),
        instructions: r.instructions,
        notionId: r.notion_id,
        category: r.category as PartCategory | null,
      }));
      const plans = new Map<string, (typeof pull.plans.rows)[number]>();
      for (const p of pull.plans.rows) {
        const key = `${p.vehicleAppId}|${p.taskNotionId}`;
        if (plans.has(key)) warn(`Plan "${p.name}" duplicates another plan of the same vehicle and task, so it is ignored`);
        else plans.set(key, p);
      }
      const livePlanIds = new Set([...pull.plans.rows.map((p) => p.notionId), ...pull.skippedPlanNotionIds]);

      for (const v of snapshot.vehicles) {
        if (v.ownership !== 'owned') continue;
        const equipment = equipmentOf.get(v.id) ?? [];
        const applicable = applicableRefTasks(refs, equipment) as (RefTask & { notionId: string; category: PartCategory | null })[];
        const applicableIds = new Set(applicable.map((r) => r.id));
        const tasks = db.prepare('SELECT * FROM maintenance_tasks WHERE vehicle_id = ? ORDER BY created_at, rowid').all(v.id) as Row[];
        const freed = new Set<string>();
        /** The catalogue tasks whose Task was unlinked in this pull: they are neither recreated nor re-adopted until the next one. */
        const freedRefs = new Set<string>();

        // A Task whose Plan page vanished, or that no longer applies, loses its link and is paused: kept, with its history.
        for (const t of tasks) {
          if (!t.ref_task_id) continue;
          const lostPlan = t.plan_auto === 0 && t.notion_plan_id !== null && !livePlanIds.has(t.notion_plan_id);
          if (applicableIds.has(t.ref_task_id) && !lostPlan) continue;
          db.prepare('UPDATE maintenance_tasks SET ref_task_id = NULL, notion_plan_id = NULL, plan_auto = 0, switched_off = 1 WHERE id = ?').run(t.id);
          freedRefs.add(t.ref_task_id);
          t.ref_task_id = null;
          t.notion_plan_id = null;
          freed.add(t.id);
          pausedTasks++;
          counts.maintenanceTasks.removed++;
          warn(`Task "${t.name}" of "${v.name}" ${lostPlan ? 'lost its Plan page' : 'no longer applies'} and was paused`);
        }

        for (const ref of applicable) {
          if (freedRefs.has(ref.id)) continue;
          const plan = plans.get(`${v.id}|${ref.notionId}`) ?? null;
          const want = resolveInterval(ref, plan);
          const linked = tasks.find((t) => t.ref_task_id === ref.id);

          if (linked) {
            let { intervalKm, intervalMonths } = want;
            if (intervalKm === null && intervalMonths === null) {
              warn(`Task "${ref.name}" has no interval in Notion: "${v.name}" keeps its current one`);
              intervalKm = linked.interval_km;
              intervalMonths = linked.interval_months;
            }
            update(linked, {
              name: ref.name,
              name_fr: ref.name,
              action: ref.action,
              interval_km: intervalKm,
              interval_months: intervalMonths,
              // Notion's category replaces the Task's only where Notion has one.
              category: ref.category ?? linked.category,
              notes: plan?.notes ?? linked.notes,
              notion_plan_id: plan ? plan.notionId : linked.notion_plan_id,
              plan_auto: plan ? 0 : linked.plan_auto,
            });
            continue;
          }

          // An unlinked Task named like the catalogue task is taken over instead of duplicated.
          const key = refKey(ref.name);
          const adopted = tasks.find((t) => !t.ref_task_id && !freed.has(t.id) && (refKey(t.name) === key || refKey(t.name_fr) === key));
          if (adopted) {
            update(adopted, {
              ref_task_id: ref.id,
              name: ref.name,
              name_fr: ref.name,
              action: ref.action,
              // Notion's interval replaces the app's only where Notion has one.
              interval_km: want.intervalKm ?? adopted.interval_km,
              interval_months: want.intervalMonths ?? adopted.interval_months,
              category: ref.category ?? adopted.category,
              notes: plan?.notes ?? adopted.notes,
              notion_plan_id: plan ? plan.notionId : null,
              plan_auto: plan ? 0 : 1,
            });
            continue;
          }

          if (want.intervalKm === null && want.intervalMonths === null) {
            warn(`Task "${ref.name}" has no interval in Notion, so it was not added to "${v.name}"`);
            continue;
          }
          const row = {
            id: randomUUID(),
            vehicle_id: v.id,
            name: ref.name,
            name_fr: ref.name,
            action: ref.action,
            interval_km: want.intervalKm,
            interval_months: want.intervalMonths,
            category: ref.category,
            notes: plan?.notes ?? null,
            ref_task_id: ref.id,
            notion_plan_id: plan ? plan.notionId : null,
            plan_auto: plan ? 0 : 1,
          };
          const columns = Object.keys(row);
          db.prepare(`INSERT INTO maintenance_tasks (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).run(...Object.values(row));
          tasks.push({ ...row, switched_off: 0 });
          counts.maintenanceTasks.created++;
        }
      }
    }

    /** Writes only the fields of a Task that differ. */
    function update(task: Row, fields: Record<string, string | number | null>): void {
      const changed = Object.keys(fields).filter((c) => task[c] !== fields[c]);
      if (changed.length === 0) return;
      db.prepare(`UPDATE maintenance_tasks SET ${changed.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...changed.map((c) => fields[c]!), task.id);
      for (const c of changed) task[c] = fields[c];
      counts.maintenanceTasks.updated++;
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { counts, warnings, pausedTasks };
}
