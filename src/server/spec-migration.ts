// The one-off move of the Spec Lines into the two Notion spec databases (ADR 0009): fluids and parts become Item Spec
// pages, torque and other become Component Spec pages, and each Vehicle Item's link is re-pointed. Dry run first.
// Everything runs under the sync's lock. A line is moved once (table spec_line_moves), so a re-run never makes a page twice.
// Lines that cannot move (no Notion page for the vehicle, nothing to say) stay visible in the app, read-only.
import type { DatabaseSync } from 'node:sqlite';
import { fetchReference } from '../notion/engine.ts';
import { parseSpecPage, type ItemSpecRow, type ComponentSpecRow, type ReferencePull } from '../notion/reference.ts';
import {
  SpecWriteError,
  componentSpecProperties,
  createSpecPage,
  itemSpecProperties,
  specTarget,
  type SpecKind,
  type SpecTarget,
} from '../notion/spec-pages.ts';
import type { PartCategory } from '../shared/catalogue.ts';
import type { ComponentSpecInput, ItemSpecInput, SpecGroup } from '../shared/schemas.ts';
import { refKey } from '../shared/workshop.ts';
import { readSnapshot } from './app.ts';
import { applyPull, storeSpecPage } from './notion-apply.ts';
import type { NotionSyncService } from './notion-sync.ts';

type Row = Record<string, any>;

export interface SpecMove {
  specLineId: string;
  vehicleId: string;
  vehicleName: string;
  label: string;
  group: SpecGroup;
  target: 'item_spec' | 'component_spec';
  action: 'create' | 'link' | 'skip';
  reason?: 'vehicle_not_in_notion' | 'empty' | 'already_moved' | 'type_not_found';
  preview?: Record<string, string | number | null>;
  /** Vehicle Items pointing at this line. */
  items: number;
}

export interface SpecMigrationReport {
  dryRun: boolean;
  moves: SpecMove[];
  created: number;
  linked: number;
  skipped: number;
  itemsRepointed: number;
  itemsUnlinked: number;
  warnings: string[];
}

/** "10W-40, 3,2 L" gives the grade and the capacity. */
const CAPACITY = /^(.*?)(?:[,;·]\s*|\s+)?(\d+(?:[.,]\d+)?\s?(?:l|litres?|ml|cl))\s*$/i;
/** "25 N·m" gives the number and what follows. */
const NUMBER_UNIT = /^\s*([-+]?\d+(?:[.,]\d+)?)\s*(.*)$/;

function splitItemValue(value: string): { specification: string | null; capacity: string | null } {
  const text = value.trim();
  const match = CAPACITY.exec(text);
  if (!match) return { specification: text === '' ? null : text, capacity: null };
  const rest = match[1]!.trim();
  return { specification: rest === '' ? null : rest, capacity: match[2]!.trim() };
}

function normaliseUnit(unit: string): string {
  const text = unit.trim();
  if (/^n\.?\s?[·.]?\s?m$/i.test(text)) return 'N·m';
  if (/^(l|litres?)$/i.test(text)) return 'L';
  return text;
}

/** The number and unit of a torque-like value, or null when it is not a figure followed by a plain unit. */
function splitComponentValue(value: string): { number: number; unit: string | null } | null {
  const match = NUMBER_UNIT.exec(value);
  if (!match) return null;
  const rest = match[2]!.trim();
  if (rest !== '' && (!/^[\p{L}°%µ]/u.test(rest) || rest.length > 20)) return null;
  return { number: Number(match[1]!.replace(',', '.')), unit: rest === '' ? null : normaliseUnit(rest) };
}

interface Planned {
  move: SpecMove;
  line: Row;
  /** The Vehicle Items of this line that have no Item Spec yet: the ones a move re-points. */
  pointable: number;
  /** Notion page id to link to, for a link. */
  linkNotionId?: string;
  /** For a create: what to send, built before anything is written. */
  properties?: Record<string, unknown>;
}

export async function migrateSpecLines(opts: { db: DatabaseSync; garageId: string; notionSync: NotionSyncService; dryRun: boolean }): Promise<SpecMigrationReport> {
  const { db, garageId, dryRun } = opts;
  return opts.notionSync.exclusive(async (api, parentPageId) => {
    const warnings: string[] = [];
    const warn = (message: string) => {
      if (!warnings.includes(message)) warnings.push(message);
    };

    // 1. Read Notion. A real run first brings the app up to date with it, so the types and the existing pages are known here.
    const pull: ReferencePull = await fetchReference(api, parentPageId);
    for (const w of [...pull.itemSpecs.warnings, ...pull.componentSpecs.warnings]) warn(w);
    if (!dryRun) for (const w of applyPull(db, garageId, pull, readSnapshot(db, garageId)).warnings) warn(w);

    const targets: Partial<Record<SpecKind, SpecTarget>> = {};
    for (const kind of ['itemSpecs', 'componentSpecs'] as const) {
      try {
        targets[kind] = await specTarget(api, parentPageId, kind);
      } catch (error) {
        if (!(error instanceof SpecWriteError) || !dryRun) throw error;
        warn(error.message);
      }
    }
    const emptyTarget = (kind: SpecKind): SpecTarget => ({ kind, title: '', dataSourceId: '', columns: {} });
    const targetOf = (kind: SpecKind): SpecTarget => targets[kind] ?? emptyTarget(kind);
    // A dry run without the database assumes the plainest columns, only to show what would be written.
    /** Builds the properties; a dry run reports a column problem as a warning instead of stopping (it is the preflight to look at). */
    const build = (label: string, make: () => Record<string, unknown>): Record<string, unknown> | undefined => {
      try {
        return make();
      } catch (error) {
        if (!(error instanceof SpecWriteError) || !dryRun) throw error;
        warn(`"${label}": ${error.message}`);
        return undefined;
      }
    };
    const valueIsNumber = (targets.componentSpecs?.columns['Valeur']?.type ?? 'number') === 'number';

    // 2. Plan each line not moved yet.
    const lines = db
      .prepare(
        `SELECT l.*, v.name AS vehicle_name FROM spec_lines l JOIN vehicles v ON v.id = l.vehicle_id
         WHERE v.garage_id = ? AND l.id NOT IN (SELECT spec_line_id FROM spec_line_moves)
         ORDER BY v.created_at, l.vehicle_id, l.spec_group, l.sort`,
      )
      .all(garageId) as Row[];
    const itemCount = db.prepare('SELECT count(*) AS n FROM vehicle_parts WHERE spec_line_id = ?');
    const pointableCount = db.prepare('SELECT count(*) AS n FROM vehicle_parts WHERE spec_line_id = ? AND item_spec_id IS NULL');
    const planned: Planned[] = [];
    const pageOfVehicle = new Map(Object.entries(pull.vehiclePageIds).map(([appId, pageId]) => [pageId, appId]));

    for (const line of lines) {
      const group = line.spec_group as SpecGroup;
      const target = group === 'fluids' || group === 'parts' ? 'item_spec' : 'component_spec';
      const label = String(line.label);
      const value = String(line.value ?? '');
      const oem: string | null = line.oem ?? null;
      const move: SpecMove = {
        specLineId: line.id,
        vehicleId: line.vehicle_id,
        vehicleName: line.vehicle_name,
        label,
        group,
        target,
        action: 'create',
        items: (itemCount.get(line.id) as Row).n,
      };
      const entry: Planned = { move, line, pointable: (pointableCount.get(line.id) as Row).n };
      planned.push(entry);

      const vehiclePageId = pull.vehiclePageIds[line.vehicle_id];
      if (!vehiclePageId) {
        move.action = 'skip';
        move.reason = 'vehicle_not_in_notion';
        continue;
      }
      if (value.trim() === '' && !oem && move.items === 0) {
        move.action = 'skip';
        move.reason = 'empty';
        continue;
      }

      if (target === 'item_spec') {
        const type = pull.consumableTypes.rows.find((t) => refKey(t.name) === refKey(label)) ?? null;
        const here = pull.itemSpecs.rows.filter((r: ItemSpecRow) => r.vehicleAppId === line.vehicle_id);
        const existing =
          here.find((r) => refKey(r.name) === refKey(label)) ?? (type ? (here.filter((r) => r.typeNotionId === type.notionId).length === 1 ? here.find((r) => r.typeNotionId === type.notionId) : undefined) : undefined);
        if (existing) {
          move.action = 'link';
          entry.linkNotionId = existing.notionId;
          move.preview = { Désignation: existing.name };
          continue;
        }
        // 3. Item preview.
        const { specification, capacity } = splitItemValue(value);
        if (!type) {
          move.reason = 'type_not_found';
          warn(`"${label}" (${line.vehicle_name}): no consumable type of that name in Notion, so Type stays empty; set it in Notion`);
        }
        const input: ItemSpecInput = { name: label, typeId: null, specification, oemRef: oem, capacity, quantity: null, chosenProductId: null, confirmation: 'to_confirm' };
        entry.properties = build(label, () => itemSpecProperties(input, targetOf('itemSpecs'), { vehiclePageIds: [vehiclePageId], typeNotionId: type?.notionId ?? null, chosenProductNotionId: null }));
        move.preview = { Désignation: label, Type: type?.name ?? null, Spécification: specification, Capacité: capacity, 'Réf. OEM': oem, Statut: 'À confirmer' };
        continue;
      }

      const existing = pull.componentSpecs.rows.find((r: ComponentSpecRow) => r.vehicleAppId === line.vehicle_id && refKey(r.label) === refKey(label));
      if (existing) {
        move.action = 'link';
        entry.linkNotionId = existing.notionId;
        move.preview = { Élément: existing.label };
        continue;
      }
      // 4. Component preview.
      let valueText = value.trim();
      let unit: string | null = null;
      let source: string | null = oem ? `OEM ${oem}` : null;
      if (valueIsNumber && valueText !== '') {
        const split = splitComponentValue(valueText);
        if (split) {
          valueText = String(split.number);
          unit = split.unit;
        } else {
          source = [`Appli : ${valueText}`, source].filter(Boolean).join(' · ');
          valueText = '';
          warn(`"${label}" (${line.vehicle_name}): the value is not a figure, so it is kept in Source and Valeur is left empty`);
        }
      }
      const category = (line.category ?? null) as PartCategory | null;
      const input: ComponentSpecInput = { label, componentTypeId: null, category, value: valueText, unit, source, confirmation: 'to_confirm' };
      entry.properties = build(label, () => componentSpecProperties(input, targetOf('componentSpecs'), { vehiclePageIds: [vehiclePageId], componentTypeNotionId: null }));
      move.preview = { Élément: label, Valeur: valueText === '' ? null : valueIsNumber ? Number(valueText) : valueText, Unité: unit, Source: source, Catégorie: category, Statut: 'À confirmer' };
    }

    const moves = planned.map((p) => p.move);
    const count = (action: SpecMove['action']) => moves.filter((m) => m.action === action).length;
    const unlinkedItems = moves.filter((m) => m.target === 'component_spec' || m.action === 'skip').reduce((n, m) => n + m.items, 0);
    const toRepoint = planned.filter((p) => p.move.target === 'item_spec' && p.move.action !== 'skip').reduce((n, p) => n + p.pointable, 0);

    if (dryRun) {
      return { dryRun: true, moves, created: count('create'), linked: count('link'), skipped: count('skip'), itemsRepointed: toRepoint, itemsUnlinked: unlinkedItems, warnings };
    }

    // 5. Preflight: every column the plan writes must exist with a usable type, before any write. (Done while planning:
    // the property builders throw `notion_incomplete` for a missing column, and the targets were required above.)
    // 6. Real run, one transaction per line.
    const insertMove = db.prepare('INSERT INTO spec_line_moves (spec_line_id, target, notion_id, created_page) VALUES (?, ?, ?, ?)');
    const moved: { planned: Planned; notionId: string }[] = [];
    for (const entry of planned) {
      const { move } = entry;
      if (move.action === 'skip') continue;
      if (move.action === 'link') {
        insertMove.run(move.specLineId, move.target, entry.linkNotionId!, 0);
        moved.push({ planned: entry, notionId: entry.linkNotionId! });
        continue;
      }
      const kind: SpecKind = move.target === 'item_spec' ? 'itemSpecs' : 'componentSpecs';
      const page = await createSpecPage(api, targetOf(kind), entry.properties!);
      db.exec('BEGIN');
      try {
        insertMove.run(move.specLineId, move.target, page.id, 1);
        const parsed = kind === 'itemSpecs' ? parseSpecPage('itemSpecs', page, pageOfVehicle) : parseSpecPage('componentSpecs', page, pageOfVehicle);
        storeSpecPage(db, garageId, kind, page.id, parsed.rows);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      moved.push({ planned: entry, notionId: page.id });
    }

    // 7. Re-point the Vehicle Items, in one transaction.
    let repointed = 0;
    let unlinked = unlinkedItems;
    db.exec('BEGIN');
    try {
      const find = db.prepare('SELECT id FROM vehicle_consumables WHERE vehicle_id = ? AND notion_id = ? AND garage_id = ? AND notion_removed = 0');
      const point = db.prepare('UPDATE vehicle_parts SET item_spec_id = ? WHERE spec_line_id = ? AND item_spec_id IS NULL');
      // Every recorded move, not only this run's: a run that stopped half way is finished by the next one.
      const recorded = db
        .prepare(
          `SELECT m.spec_line_id AS spec_line_id, m.notion_id AS notion_id, l.vehicle_id AS vehicle_id, l.label AS label
             FROM spec_line_moves m JOIN spec_lines l ON l.id = m.spec_line_id
             JOIN vehicles v ON v.id = l.vehicle_id
            WHERE m.target = 'item_spec' AND v.garage_id = ?`,
        )
        .all(garageId) as Row[];
      for (const r of recorded) {
        const local = find.get(r.vehicle_id, r.notion_id, garageId) as Row | undefined;
        if (!local) {
          const pending = Number((db.prepare('SELECT COUNT(*) AS n FROM vehicle_parts WHERE spec_line_id = ? AND item_spec_id IS NULL').get(r.spec_line_id) as Row).n);
          unlinked += pending;
          if (pending > 0) warn(`"${r.label}": the Notion page is not in the app yet, so its items were not re-pointed`);
          continue;
        }
        repointed += Number(point.run(local.id, r.spec_line_id).changes);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }

    return { dryRun: false, moves, created: count('create'), linked: count('link'), skipped: count('skip'), itemsRepointed: repointed, itemsUnlinked: unlinked, warnings };
  });
}
