// Reads the owner's hand-made Notion databases (task catalogue, plans, types, products, tools, per-vehicle consumables
// and specs) into typed rows. Pure: it takes the pages Notion returned and knows nothing of the API or the database.
// Relations keep Notion page ids; the apply step turns them into the app's ids.
import type { PartCategory } from '../shared/catalogue.ts';
import { refKey } from '../shared/workshop.ts';
import { APP_ID, EQUIPMENT, REFERENCE_DBS, REMOVED, relationPageIds, type ReferenceDb, type ReferenceKey } from './databases.ts';

export interface DbPull<Row> {
  rows: Row[];
  /** Whether every row could be read: false when the database or a required column is missing. Nothing is removed from an incomplete pull. */
  complete: boolean;
  warnings: string[];
}

export interface RefTaskRow {
  notionId: string;
  name: string;
  /** Null when Notion's value is not one the app knows. */
  action: 'inspect' | 'replace' | null;
  applicableIf: string[];
  defaultKm: number | null;
  defaultMonths: number | null;
  consumableTypeNotionIds: string[];
  componentTypeNotionIds: string[];
  toolNotionIds: string[];
  instructions: string | null;
  /** The section the Task is listed under on the vehicle page; null when empty or not one the app knows. */
  category: PartCategory | null;
}

export interface ComponentTypeRow {
  notionId: string;
  name: string;
  category: string | null;
  notes: string | null;
}

export interface ConsumableTypeRow {
  notionId: string;
  name: string;
  category: string | null;
  family: 'fluid' | 'part' | null;
  notes: string | null;
}

export interface ProductRow {
  notionId: string;
  name: string;
  typeNotionId: string | null;
  brand: string | null;
  reference: string | null;
  supplier: string | null;
  price: number | null;
  notes: string | null;
}

export interface ToolRow {
  notionId: string;
  name: string;
  kind: string | null;
  size: string | null;
  owned: boolean;
  price: number | null;
  notes: string | null;
}

export interface PlanRow {
  notionId: string;
  name: string;
  vehicleAppId: string;
  taskNotionId: string;
  intervalKm: number | null;
  intervalMonths: number | null;
  lastKm: number | null;
  lastDate: string | null;
  notes: string | null;
}

export interface VehicleConsumableRow {
  notionId: string;
  vehicleAppId: string;
  name: string;
  typeNotionId: string | null;
  specification: string | null;
  oemRef: string | null;
  capacity: string | null;
  quantity: number | null;
  compatibleProductNotionIds: string[];
  chosenProductNotionId: string | null;
  status: 'confirmed' | 'to_confirm' | null;
}

export interface VehicleSpecRow {
  notionId: string;
  vehicleAppId: string;
  label: string;
  componentTypeNotionId: string | null;
  category: string | null;
  /** A number or text as written; empty when Notion has nothing yet. */
  value: string;
  unit: string | null;
  source: string | null;
  status: 'confirmed' | 'to_confirm' | null;
}

export interface ReferencePull {
  tasks: DbPull<RefTaskRow>;
  componentTypes: DbPull<ComponentTypeRow>;
  consumableTypes: DbPull<ConsumableTypeRow>;
  products: DbPull<ProductRow>;
  tools: DbPull<ToolRow>;
  plans: DbPull<PlanRow>;
  vehicleConsumables: DbPull<VehicleConsumableRow>;
  vehicleSpecs: DbPull<VehicleSpecRow>;
  /** Plan pages that exist in Notion but could not be used (unknown vehicle or task): they are not "vanished". */
  skippedPlanNotionIds: string[];
  /** Equipment tags by the vehicle's app id, for the vehicles whose Équipements column could be read. */
  equipment: Record<string, string[]>;
  /** The Notion page of each vehicle, by the vehicle's app id. */
  vehiclePageIds: Record<string, string>;
  /** Problems with the Véhicules database itself. */
  vehicleWarnings: string[];
  /** The values found in every select and multi-select column, for checking the vocabulary against the app's. */
  vocabularies: Record<string, string[]>;
}

/** The app's Véhicules pages by Notion page id: the ones with an app id that are not marked removed. */
export function vehiclePageMap(vehiclePages: any[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const page of vehiclePages) {
    const appId = plainText(page.properties?.[APP_ID]);
    if (appId && page.properties?.[REMOVED]?.checkbox !== true) map.set(page.id, appId);
  }
  return map;
}

/** Text of a title or rich-text property (or a number or select read as text); null when empty. */
function plainText(property: any): string | null {
  if (!property) return null;
  let s: string;
  switch (property.type) {
    case 'title':
    case 'rich_text':
      s = (property[property.type] as { plain_text: string }[]).map((t) => t.plain_text).join('');
      break;
    case 'number':
      s = property.number === null ? '' : String(property.number);
      break;
    case 'select':
      s = property.select?.name ?? '';
      break;
    default:
      return null;
  }
  s = s.trim();
  return s === '' ? null : s;
}

/** A Notion title as written, with typographic apostrophes made straight, to match database titles. */
export function titleKey(title: string): string {
  return refKey(title.replace(/[’‘]/g, "'"));
}

const ACTIONS: Record<string, 'inspect' | 'replace'> = { controle: 'inspect', remplacement: 'replace' };
const FAMILIES: Record<string, 'fluid' | 'part'> = { fluide: 'fluid', piece: 'part' };
/** The app's French category labels, plus the spellings used elsewhere in the owner's catalogue. */
export const CATEGORIES: Record<string, PartCategory> = {
  moteur: 'engine',
  transmission: 'transmission',
  freinage: 'brakes',
  freins: 'brakes',
  chassis: 'chassis',
  roues: 'chassis',
  electricite: 'electrical',
  electrique: 'electrical',
  'refroidissement et climatisation': 'cooling_climate',
  refroidissement: 'cooling_climate',
  autre: 'other',
};

class RowReader {
  readonly warnings: string[];
  private readonly seen = new Set<string>();
  private readonly usable: Set<string>;
  private readonly db: ReferenceDb;
  private readonly vocab: Map<string, Set<string>>;

  constructor(db: ReferenceDb, usable: Set<string>, warnings: string[], vocab: Map<string, Set<string>>) {
    this.db = db;
    this.usable = usable;
    this.warnings = warnings;
    this.vocab = vocab;
  }

  warn(message: string): void {
    const full = `${this.db.title}: ${message}`;
    if (this.seen.has(full)) return;
    this.seen.add(full);
    this.warnings.push(full);
  }

  private prop(page: any, name: string): any {
    return this.usable.has(name) ? page.properties?.[name] : undefined;
  }

  private note(name: string, value: string): void {
    const key = `${this.db.title} / ${name}`;
    const set = this.vocab.get(key) ?? new Set<string>();
    set.add(value);
    this.vocab.set(key, set);
  }

  title(page: any): string | null {
    return plainText(page.properties?.[this.db.required[0]!.name]);
  }

  text(page: any, name: string): string | null {
    return plainText(this.prop(page, name));
  }

  /** A number from a number column, or from text such as "3,5 L" (the leading figure). */
  num(page: any, name: string): number | null {
    const p = this.prop(page, name);
    if (!p) return null;
    if (p.type === 'number') return typeof p.number === 'number' ? p.number : null;
    const s = plainText(p);
    if (s === null) return null;
    const match = /^[-+]?\d+(?:[.,]\d+)?/.exec(s.replace(/\s/g, ''));
    if (!match) {
      this.warn(`"${name}" is not a number ("${s}")`);
      return null;
    }
    return Number(match[0].replace(',', '.'));
  }

  /** A whole number of at least 1 (an interval), else null. */
  interval(page: any, name: string): number | null {
    const n = this.num(page, name);
    return n !== null && n >= 1 ? Math.round(n) : null;
  }

  select(page: any, name: string): string | null {
    const p = this.prop(page, name);
    const value = p?.type === 'select' ? (p.select?.name ?? null) : null;
    if (value !== null) this.note(name, value);
    return value;
  }

  tags(page: any, name: string): string[] {
    const p = this.prop(page, name);
    if (p?.type !== 'multi_select') return [];
    const names = [...new Set((p.multi_select as { name: string }[]).map((o) => o.name.trim()).filter(Boolean))];
    for (const n of names) this.note(name, n);
    return names;
  }

  check(page: any, name: string): boolean {
    return this.prop(page, name)?.checkbox === true;
  }

  date(page: any, name: string): string | null {
    const start = this.prop(page, name)?.date?.start;
    return typeof start === 'string' ? start.slice(0, 10) : null;
  }

  rel(page: any, name: string): string[] {
    return relationPageIds(this.prop(page, name));
  }

  /** A select mapped through a table keyed by refKey; an unknown value gives null and a warning. */
  mapped<T>(page: any, name: string, table: Record<string, T>): T | null {
    const value = this.select(page, name);
    if (value === null) return null;
    const found = table[refKey(value)];
    if (found === undefined) {
      this.warn(`unknown value "${value}" in "${name}"`);
      return null;
    }
    return found;
  }

  status(page: any): 'confirmed' | 'to_confirm' | null {
    const value = this.select(page, 'Statut');
    if (value === null) return null;
    const key = refKey(value);
    if (key.includes('a confirmer')) return 'to_confirm';
    if (key.includes('confirme')) return 'confirmed';
    this.warn(`unknown value "${value}" in "Statut"`);
    return null;
  }

  /** The app ids of the vehicles a relation points at; the ones Notion points at but the app does not know are reported. */
  vehicles(page: any, label: string, vehicleOf: Map<string, string>): string[] {
    const ids = this.rel(page, 'Véhicule');
    const known = [...new Set(ids.flatMap((id) => (vehicleOf.has(id) ? [vehicleOf.get(id)!] : [])))];
    if (ids.length === 0) this.warn(`"${label}" has no vehicle, skipped`);
    else if (known.length < new Set(ids).size) this.warn(`"${label}" points at a vehicle that is not in the app or was removed${known.length === 0 ? ', skipped' : ''}`);
    return known;
  }
}

/** The columns of a database the owner's data can be read from; sets `complete` false when a required one is missing. */
function usableColumns(db: ReferenceDb, pages: any[], pull: DbPull<unknown>): Set<string> {
  const usable = new Set<string>();
  if (pages.length === 0) {
    for (const c of [...db.required, ...db.optional]) usable.add(c.name);
    return usable;
  }
  const props = (pages[0].properties ?? {}) as Record<string, { type?: string }>;
  for (const [list, required] of [[db.required, true], [db.optional, false]] as const) {
    for (const c of list) {
      const found = props[c.name];
      if (found && c.types.includes(found.type ?? '')) usable.add(c.name);
      else if (required) {
        pull.complete = false;
        pull.warnings.push(
          found
            ? `${db.title}: the column "${c.name}" is a ${found.type}, expected ${c.types.join(' or ')}`
            : `${db.title}: the required column "${c.name}" is missing`,
        );
      } else if (found) {
        pull.warnings.push(`${db.title}: the column "${c.name}" is a ${found.type}, expected ${c.types.join(' or ')}, so it is ignored`);
      }
    }
  }
  return usable;
}

/**
 * Turns the pages of each database (by ReferenceKey, plus `vehicles` for the app's Véhicules database) into typed rows.
 * `vehiclePageToAppId` says which Notion page is which of the app's vehicles (see vehiclePageMap).
 */
export function parseReference(pages: Record<string, any[]>, vehiclePageToAppId: Map<string, string>): ReferencePull {
  const vocab = new Map<string, Set<string>>();
  const empty = <Row>(): DbPull<Row> => ({ rows: [], complete: true, warnings: [] });
  const result: ReferencePull = {
    tasks: empty(),
    componentTypes: empty(),
    consumableTypes: empty(),
    products: empty(),
    tools: empty(),
    plans: empty(),
    vehicleConsumables: empty(),
    vehicleSpecs: empty(),
    skippedPlanNotionIds: [],
    equipment: {},
    vehiclePageIds: {},
    vehicleWarnings: [],
    vocabularies: {},
  };

  for (const db of REFERENCE_DBS) {
    const pull = result[db.key as ReferenceKey] as DbPull<unknown>;
    const list = pages[db.key];
    if (!list) {
      pull.complete = false;
      pull.warnings.push(`${db.title}: the database was not found under the parent page`);
      continue;
    }
    const reader = new RowReader(db, usableColumns(db, list, pull), pull.warnings, vocab);
    if (!pull.complete) continue;
    const rows = pull.rows as unknown[];

    for (const page of list) {
      const name = reader.title(page);
      if (!name) continue;
      switch (db.key) {
        case 'tasks':
          rows.push({
            notionId: page.id,
            name,
            action: reader.mapped(page, 'Action', ACTIONS),
            applicableIf: reader.tags(page, 'Applicable si'),
            defaultKm: reader.interval(page, 'Intervalle par défaut (km)'),
            defaultMonths: reader.interval(page, 'Intervalle par défaut (mois)'),
            consumableTypeNotionIds: reader.rel(page, 'Types de consommables requis'),
            componentTypeNotionIds: reader.rel(page, 'Composants'),
            toolNotionIds: reader.rel(page, 'Outils'),
            instructions: reader.text(page, 'Instructions'),
            category: reader.mapped(page, 'Catégorie', CATEGORIES),
          } satisfies RefTaskRow);
          break;
        case 'componentTypes':
          rows.push({ notionId: page.id, name, category: reader.select(page, 'Catégorie'), notes: reader.text(page, 'Notes') } satisfies ComponentTypeRow);
          break;
        case 'consumableTypes':
          rows.push({
            notionId: page.id,
            name,
            category: reader.select(page, 'Catégorie'),
            family: reader.mapped(page, 'Famille', FAMILIES),
            notes: reader.text(page, 'Notes'),
          } satisfies ConsumableTypeRow);
          break;
        case 'products':
          rows.push({
            notionId: page.id,
            name,
            typeNotionId: reader.rel(page, 'Type de consommable')[0] ?? null,
            brand: reader.text(page, 'Marque'),
            reference: reader.text(page, 'Référence'),
            supplier: reader.text(page, 'Fournisseur'),
            price: reader.num(page, 'Prix'),
            notes: reader.text(page, 'Notes'),
          } satisfies ProductRow);
          break;
        case 'tools':
          rows.push({
            notionId: page.id,
            name,
            kind: reader.select(page, 'Type'),
            size: reader.text(page, 'Taille / capacité'),
            owned: reader.check(page, 'Possédé'),
            price: reader.num(page, 'Prix'),
            notes: reader.text(page, 'Notes'),
          } satisfies ToolRow);
          break;
        case 'plans': {
          const vehicles = reader.vehicles(page, name, vehiclePageToAppId);
          const tasks = reader.rel(page, 'Tâche');
          if (tasks.length === 0) reader.warn(`"${name}" has no task, skipped`);
          if (vehicles.length > 1) reader.warn(`"${name}" has several vehicles, only the first is used`);
          if (tasks.length > 1) reader.warn(`"${name}" has several tasks, only the first is used`);
          if (vehicles.length === 0 || tasks.length === 0) {
            result.skippedPlanNotionIds.push(page.id);
            break;
          }
          rows.push({
            notionId: page.id,
            name,
            vehicleAppId: vehicles[0]!,
            taskNotionId: tasks[0]!,
            intervalKm: reader.interval(page, 'Intervalle (km)'),
            intervalMonths: reader.interval(page, 'Intervalle (mois)'),
            lastKm: reader.interval(page, 'Dernier fait (km)'),
            lastDate: reader.date(page, 'Dernier fait (date)'),
            notes: reader.text(page, 'Notes'),
          } satisfies PlanRow);
          break;
        }
        case 'vehicleConsumables':
          // One row per vehicle when the page points at several.
          for (const vehicleAppId of reader.vehicles(page, name, vehiclePageToAppId)) {
            rows.push({
              notionId: page.id,
              vehicleAppId,
              name,
              typeNotionId: reader.rel(page, 'Type')[0] ?? null,
              specification: reader.text(page, 'Spécification'),
              oemRef: reader.text(page, 'Réf. OEM'),
              capacity: reader.text(page, 'Capacité'),
              quantity: reader.num(page, 'Quantité'),
              compatibleProductNotionIds: reader.rel(page, 'Produits compatibles'),
              chosenProductNotionId: reader.rel(page, 'Produit retenu')[0] ?? null,
              status: reader.status(page),
            } satisfies VehicleConsumableRow);
          }
          break;
        case 'vehicleSpecs': {
          const p = page.properties?.['Valeur'];
          const value = p?.type === 'number' ? (p.number === null ? '' : String(p.number)) : (reader.text(page, 'Valeur') ?? '');
          for (const vehicleAppId of reader.vehicles(page, name, vehiclePageToAppId)) {
            rows.push({
              notionId: page.id,
              vehicleAppId,
              label: name,
              componentTypeNotionId: reader.rel(page, 'Composant')[0] ?? null,
              category: reader.select(page, 'Catégorie'),
              value,
              unit: reader.select(page, 'Unité'),
              source: reader.text(page, 'Source'),
              status: reader.status(page),
            } satisfies VehicleSpecRow);
          }
          break;
        }
      }
    }
  }

  // The owner's equipment tags on the app's Véhicules pages.
  const vehiclePages = pages.vehicles;
  for (const [pageId, appId] of vehiclePageToAppId) result.vehiclePageIds[appId] = pageId;
  if (!vehiclePages) {
    result.vehicleWarnings.push('Véhicules: the database was not found under the parent page');
  } else if (vehiclePages.length > 0 && vehiclePages[0].properties?.[EQUIPMENT]?.type !== 'multi_select') {
    result.vehicleWarnings.push(`Véhicules: the column "${EQUIPMENT}" is missing or is not a multi-select, so no equipment was read`);
  } else {
    for (const page of vehiclePages) {
      const appId = plainText(page.properties?.[APP_ID]);
      if (!appId || page.properties?.[REMOVED]?.checkbox === true) continue;
      const tags = [...new Set(((page.properties[EQUIPMENT].multi_select ?? []) as { name: string }[]).map((o) => o.name.trim()).filter(Boolean))];
      result.equipment[appId] = tags;
      const key = `Véhicules / ${EQUIPMENT}`;
      const set = vocab.get(key) ?? new Set<string>();
      for (const t of tags) set.add(t);
      vocab.set(key, set);
    }
  }

  result.vocabularies = Object.fromEntries([...vocab].map(([key, values]) => [key, [...values].sort()]));
  return result;
}
