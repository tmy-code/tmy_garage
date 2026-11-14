// Writes the Item Spec and Component Spec pages of the owner's two spec databases (ADR 0009, superseding ADR 0007 for
// these two): builds the Notion property values for a desktop edit or the one-off move, and sends them.
// Only the values are written: no column is ever created, renamed or retyped, and "Produits compatibles" is never written.
// Pure builders (given the target's columns) and thin senders; the caller holds the sync lock and stores the page Notion returns.
import type { PartCategory } from '../shared/catalogue.ts';
import { messagesFor } from '../shared/messages.ts';
import type { ComponentSpecInput, ItemSpecInput } from '../shared/schemas.ts';
import { parsePlainNumber } from '../shared/session-consumables.ts';
import { refKey } from '../shared/workshop.ts';
import { REFERENCE_DBS, fromNotion, relationPageIds, samePlain, toNotion, type ColumnType, type Plain, type ReferenceDb } from './databases.ts';
import { databasesUnder, dataSourceOf, findReferenceDatabase, type NotionClient } from './engine.ts';
import { CATEGORIES } from './reference.ts';

export type SpecKind = 'itemSpecs' | 'componentSpecs';
export type SpecWriteCode = 'notion_incomplete' | 'value_not_number';

/** Why a spec page could not be built: the database or a column is not usable (409), or a value does not fit its column (422). */
export class SpecWriteError extends Error {
  readonly code: SpecWriteCode;
  readonly status: 409 | 422;

  constructor(code: SpecWriteCode, message: string) {
    super(message);
    this.name = 'SpecWriteError';
    this.code = code;
    this.status = code === 'notion_incomplete' ? 409 : 422;
  }
}

/** A spec database as found in Notion: where to write, and the columns (with the options of a select) it really has. */
export interface SpecTarget {
  kind: SpecKind;
  title: string;
  dataSourceId: string;
  columns: Record<string, { type: string; options: string[] }>;
}

export interface ItemSpecRefs {
  /** The Notion pages of the vehicles; used only when the page is created. */
  vehiclePageIds: string[];
  typeNotionId: string | null;
  chosenProductNotionId: string | null;
}

export interface ComponentSpecRefs {
  vehiclePageIds: string[];
  componentTypeNotionId: string | null;
}

const descriptor = (kind: SpecKind): ReferenceDb => REFERENCE_DBS.find((d) => d.key === kind)!;

/** The spec database under the parent page, with its columns; throws `notion_incomplete` when it is missing, ambiguous or lacks a required column. */
export async function specTarget(api: NotionClient, parentPageId: string, kind: SpecKind): Promise<SpecTarget> {
  const db = descriptor(kind);
  const found = findReferenceDatabase(await databasesUnder(api, parentPageId), db);
  if (found === null) throw new SpecWriteError('notion_incomplete', `${db.title}: the database was not found under the parent page`);
  if ('ambiguous' in found) {
    throw new SpecWriteError('notion_incomplete', `${db.title}: both "${found.ambiguous[0]}" and "${found.ambiguous[1]}" exist under the parent page; archive or rename one`);
  }
  const dataSourceId = await dataSourceOf(api, found.databaseId);
  const source = await api.call('GET', `/data_sources/${dataSourceId}`);
  const columns: SpecTarget['columns'] = {};
  for (const [name, property] of Object.entries((source.properties ?? {}) as Record<string, any>)) {
    const options = property.select?.options ?? property.multi_select?.options ?? [];
    columns[name] = { type: property.type as string, options: (options as { name: string }[]).map((o) => o.name) };
  }
  for (const c of db.required) {
    const column = columns[c.name];
    if (!column) throw new SpecWriteError('notion_incomplete', `${found.title}: the required column "${c.name}" is missing`);
    if (!c.types.includes(column.type)) throw new SpecWriteError('notion_incomplete', `${found.title}: the column "${c.name}" is a ${column.type}, expected ${c.types.join(' or ')}`);
  }
  return { kind, title: found.title, dataSourceId, columns };
}

/** The existing "Statut" option that means this confirmation, else the standard word. */
export function pickOption(options: string[], wanted: 'confirmed' | 'to_confirm'): string {
  const toConfirm = options.find((o) => refKey(o).includes('a confirmer'));
  if (wanted === 'to_confirm') return toConfirm ?? 'À confirmer';
  return options.find((o) => refKey(o).includes('confirme') && !refKey(o).includes('a confirmer')) ?? 'Confirmé';
}

/** The existing "Catégorie" option for a category, else the app's French label. */
export function pickCategoryOption(options: string[], category: PartCategory): string {
  return options.find((o) => CATEGORIES[refKey(o)] === category) ?? messagesFor('fr').workshop.partCategories[category];
}

/** One column to write: its wanted value, whether the column may be absent when empty, and how it is sent. */
interface Wanted {
  name: string;
  type: ColumnType;
  value: Plain;
  /** Written only when the page is created (the Véhicule relation). */
  createOnly?: boolean;
}

const isEmpty = (v: Plain): boolean => v === null || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && !Array.isArray(v) && v.appIds.length === 0);

/** The properties to send: on create every non-empty value, on update only what differs from the current page. */
function build(target: SpecTarget, wanted: Wanted[], current: any | undefined): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const w of wanted) {
    if (w.createOnly && current) continue;
    const column = target.columns[w.name];
    if (!column) {
      if (isEmpty(w.value)) continue;
      throw new SpecWriteError('notion_incomplete', `${target.title}: the column "${w.name}" is missing, so its value could not be written`);
    }
    const currentValue: Plain = current ? fromNotion(current.properties?.[w.name], (id) => id) : null;
    if (current ? samePlain(currentValue, w.value) : isEmpty(w.value)) continue;
    properties[w.name] = toNotion(w.type, w.value, (id) => id);
  }
  return properties;
}

const ids = (pageIds: string[]): Plain => ({ appIds: pageIds });
const optionalId = (id: string | null): string[] => (id ? [id] : []);

function statut(target: SpecTarget, confirmation: 'confirmed' | 'to_confirm' | null): Plain {
  return confirmation === null ? null : pickOption(target.columns['Statut']?.options ?? [], confirmation);
}

/** Notion property values for an Item Spec page. */
export function itemSpecProperties(input: ItemSpecInput, target: SpecTarget, refs: ItemSpecRefs, current?: any): Record<string, unknown> {
  const quantityColumn = target.columns['Quantité'];
  const quantity: Plain =
    input.quantity === null ? null : quantityColumn?.type === 'rich_text' ? String(input.quantity).replace('.', ',') : input.quantity;
  return build(
    target,
    [
      { name: 'Désignation', type: 'title', value: input.name },
      { name: 'Véhicule', type: 'relation', value: ids(refs.vehiclePageIds), createOnly: true },
      { name: 'Type', type: 'relation', value: ids(optionalId(refs.typeNotionId)) },
      { name: 'Spécification', type: 'rich_text', value: input.specification },
      { name: 'Réf. OEM', type: 'rich_text', value: input.oemRef },
      { name: 'Capacité', type: 'rich_text', value: input.capacity },
      { name: 'Quantité', type: quantityColumn?.type === 'rich_text' ? 'rich_text' : 'number', value: quantity },
      { name: 'Produit retenu', type: 'relation', value: ids(optionalId(refs.chosenProductNotionId)) },
      { name: 'Statut', type: 'select', value: statut(target, input.confirmation) },
    ],
    current,
  );
}

/** Notion property values for a Component Spec page. */
export function componentSpecProperties(input: ComponentSpecInput, target: SpecTarget, refs: ComponentSpecRefs, current?: any): Record<string, unknown> {
  const valueColumn = target.columns['Valeur'];
  let value: Plain;
  if (valueColumn?.type === 'number') {
    if (input.value.trim() === '') value = null;
    else {
      const number = parsePlainNumber(input.value);
      if (number === null) throw new SpecWriteError('value_not_number', `${target.title}: "Valeur" is a number column in Notion, "${input.value}" is not a number`);
      value = number;
    }
  } else {
    value = input.value.trim() === '' ? null : input.value.trim();
  }
  const unitOptions = target.columns['Unité']?.options ?? [];
  const unit = input.unit === null ? null : (unitOptions.find((o) => o.toLowerCase() === input.unit!.toLowerCase()) ?? input.unit);
  const categoryOptions = target.columns['Catégorie']?.options ?? [];
  return build(
    target,
    [
      { name: 'Élément', type: 'title', value: input.label },
      { name: 'Véhicule', type: 'relation', value: ids(refs.vehiclePageIds), createOnly: true },
      { name: 'Composant', type: 'relation', value: ids(optionalId(refs.componentTypeNotionId)) },
      { name: 'Catégorie', type: 'select', value: input.category === null ? null : pickCategoryOption(categoryOptions, input.category) },
      { name: 'Valeur', type: valueColumn?.type === 'rich_text' ? 'rich_text' : 'number', value },
      { name: 'Unité', type: 'select', value: unit },
      { name: 'Source', type: 'rich_text', value: input.source },
      { name: 'Statut', type: 'select', value: statut(target, input.confirmation) },
    ],
    current,
  );
}

export async function createSpecPage(api: NotionClient, target: SpecTarget, properties: Record<string, unknown>): Promise<any> {
  return api.call('POST', '/pages', { parent: { type: 'data_source_id', data_source_id: target.dataSourceId }, properties });
}

export async function readPage(api: NotionClient, pageId: string): Promise<any> {
  return api.call('GET', `/pages/${pageId}`);
}

export async function updateSpecPage(api: NotionClient, pageId: string, properties: Record<string, unknown>): Promise<any> {
  return api.call('PATCH', `/pages/${pageId}`, { properties });
}

/** Several vehicles on the page: removes this one from Véhicule and keeps the page. Otherwise the page goes to Notion's trash. */
export async function removeSpecPage(api: NotionClient, page: any, vehiclePageId: string): Promise<'detached' | 'trashed'> {
  const others = relationPageIds(page.properties?.['Véhicule']).filter((id) => id !== vehiclePageId);
  if (others.length > 0) {
    await api.call('PATCH', `/pages/${page.id}`, { properties: { Véhicule: { relation: others.map((id) => ({ id })) } } });
    return 'detached';
  }
  await api.call('PATCH', `/pages/${page.id}`, { in_trash: true });
  return 'trashed';
}
