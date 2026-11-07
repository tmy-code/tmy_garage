// The three Notion databases of the copy, their columns, and how a row becomes Notion property values.
// Columns marked `owner` are the owner's (Deals, filing reference): created if missing, never written.
import { STATE_BOUGHT, STATE_TO_BUY, type ItemRow, type SpecRow, type VehicleRow } from './copy.ts';

export type ColumnType = 'title' | 'rich_text' | 'number' | 'euro' | 'select' | 'date' | 'checkbox' | 'url' | 'relation';

export interface Column {
  name: string;
  type: ColumnType;
  /** For a relation: the key of the database it points at. */
  target?: DatabaseKey;
  /** For a select: options created with the column, with their colours. */
  options?: { name: string; color: string }[];
  owner?: boolean;
}

export type DatabaseKey = 'vehicles' | 'specs' | 'items';

/** A value as compared and written: text, number, date, checkbox, or the app ids a relation points at. */
export type Plain = string | number | boolean | null | { appIds: string[] };

export interface Database<Row> {
  key: DatabaseKey;
  title: string;
  icon: string;
  columns: Column[];
  values(row: Row): Record<string, Plain>;
}

/** The app's id of each row, the key that lets a copy run again without doubling pages. */
export const APP_ID = 'ID app';
/** Ticked on a page whose record is gone from the copy (deleted, or its Vehicle sold); the page is kept. */
export const REMOVED = 'Supprimé de l’app';

const common: Column[] = [
  { name: APP_ID, type: 'rich_text' },
  { name: REMOVED, type: 'checkbox' },
];

export const VEHICLES: Database<VehicleRow> = {
  key: 'vehicles',
  title: 'Véhicules',
  icon: '🏍️',
  columns: [
    { name: 'Nom', type: 'title' },
    { name: 'Type', type: 'select' },
    { name: 'Marque', type: 'rich_text' },
    { name: 'Modèle', type: 'rich_text' },
    { name: 'Année', type: 'number' },
    { name: 'Motorisation', type: 'rich_text' },
    { name: 'Kilométrage', type: 'number' },
    { name: 'Relevé le', type: 'date' },
    { name: 'Km par jour', type: 'number' },
    { name: 'Copié le', type: 'date' },
    ...common,
    { name: 'JDex', type: 'rich_text', owner: true },
  ],
  values: (r) => ({
    Nom: r.name,
    Type: r.kind,
    Marque: r.make,
    Modèle: r.model,
    Année: r.year,
    Motorisation: r.build,
    Kilométrage: r.odometer,
    'Relevé le': r.odometerDate,
    'Km par jour': r.kmPerDay,
    'Copié le': r.copiedOn,
  }),
};

export const SPECS: Database<SpecRow> = {
  key: 'specs',
  title: 'Caractéristiques',
  icon: '📐',
  columns: [
    { name: 'Caractéristique', type: 'title' },
    { name: 'Valeur', type: 'rich_text' },
    { name: 'Réf. OEM', type: 'rich_text' },
    { name: 'Groupe', type: 'select' },
    { name: 'Catégorie', type: 'select' },
    { name: 'Véhicule', type: 'relation', target: 'vehicles' },
    ...common,
  ],
  values: (r) => ({
    Caractéristique: r.label,
    Valeur: r.value,
    'Réf. OEM': r.oem,
    Groupe: r.group,
    Catégorie: r.category,
    Véhicule: { appIds: [r.vehicleAppId] },
  }),
};

export const ITEMS: Database<ItemRow> = {
  key: 'items',
  title: 'Articles',
  icon: '🛒',
  columns: [
    { name: 'Article', type: 'title' },
    { name: 'Référence', type: 'rich_text' },
    {
      name: 'État',
      type: 'select',
      options: [
        { name: STATE_TO_BUY, color: 'orange' },
        { name: STATE_BOUGHT, color: 'green' },
      ],
    },
    { name: 'Unité', type: 'select' },
    { name: 'Quantité habituelle', type: 'number' },
    { name: 'Dernier prix unitaire', type: 'euro' },
    { name: 'Tâche', type: 'rich_text' },
    { name: 'Échéance', type: 'date' },
    { name: 'Statut', type: 'select' },
    { name: 'Véhicule', type: 'relation', target: 'vehicles' },
    { name: 'Caractéristique', type: 'relation', target: 'specs' },
    ...common,
    { name: 'Lien affaire', type: 'url', owner: true },
    { name: 'Prix affaire', type: 'euro', owner: true },
    { name: 'Boutique', type: 'rich_text', owner: true },
    { name: 'Vérifié le', type: 'date', owner: true },
  ],
  values: (r) => ({
    Article: r.name,
    Référence: r.partNumber,
    État: r.state,
    Unité: r.unit,
    'Quantité habituelle': r.quantity,
    'Dernier prix unitaire': r.lastUnitPrice,
    Tâche: r.task,
    Échéance: r.dueDate,
    Statut: r.dueStatus,
    Véhicule: { appIds: [r.vehicleAppId] },
    Caractéristique: { appIds: r.specAppId ? [r.specAppId] : [] },
  }),
};

/** The schema Notion needs to create a column. */
export function columnSchema(column: Column, dataSourceIds: Partial<Record<DatabaseKey, string>>): Record<string, unknown> {
  switch (column.type) {
    case 'title':
      return { title: {} };
    case 'rich_text':
      return { rich_text: {} };
    case 'number':
      return { number: { format: 'number' } };
    case 'euro':
      return { number: { format: 'euro' } };
    case 'select':
      return { select: { options: column.options ?? [] } };
    case 'date':
      return { date: {} };
    case 'checkbox':
      return { checkbox: {} };
    case 'url':
      return { url: {} };
    case 'relation': {
      const target = dataSourceIds[column.target!];
      if (!target) throw new Error(`The ${column.target} database must exist before the ${column.name} column.`);
      return { relation: { data_source_id: target, single_property: {} } };
    }
  }
}

/** Notion's type name for a column, to check an existing one. */
export function notionType(type: ColumnType): string {
  return type === 'euro' ? 'number' : type;
}

/** Notion refuses longer text in one piece. */
const MAX_TEXT = 2000;
const text = (s: string) => [{ type: 'text', text: { content: s.slice(0, MAX_TEXT) } }];

/** A plain value as a Notion property value; `pageIds` turns the app ids of a relation into Notion page ids. */
export function toNotion(type: ColumnType, value: Plain, pageIds: (appId: string) => string | undefined): unknown {
  switch (type) {
    case 'title':
      return { title: value === null ? [] : text(String(value)) };
    case 'rich_text':
      return { rich_text: value === null || value === '' ? [] : text(String(value)) };
    case 'number':
    case 'euro':
      return { number: typeof value === 'number' ? value : null };
    case 'select':
      return { select: value === null || value === '' ? null : { name: String(value) } };
    case 'date':
      return { date: value === null ? null : { start: String(value) } };
    case 'checkbox':
      return { checkbox: value === true };
    case 'url':
      return { url: value === null || value === '' ? null : String(value) };
    case 'relation': {
      const ids = value !== null && typeof value === 'object' ? value.appIds : [];
      return {
        relation: ids.flatMap((id) => {
          const pageId = pageIds(id);
          return pageId ? [{ id: pageId }] : [];
        }),
      };
    }
  }
}

/** A Notion property value read back as a plain value, in the same shape `values` gives, to skip unchanged pages. */
export function fromNotion(property: any, appIdOfPage: (pageId: string) => string | undefined): Plain {
  if (!property) return null;
  switch (property.type) {
    case 'title':
    case 'rich_text': {
      const s = (property[property.type] as { plain_text: string }[]).map((t) => t.plain_text).join('');
      return s === '' ? null : s;
    }
    case 'number':
      return property.number;
    case 'select':
      return property.select?.name ?? null;
    case 'date':
      return property.date?.start ?? null;
    case 'checkbox':
      return property.checkbox;
    case 'url':
      return property.url;
    case 'relation':
      return { appIds: (property.relation as { id: string }[]).map((r) => appIdOfPage(r.id) ?? `?${r.id}`) };
    default:
      return null;
  }
}

/** Whether two plain values are the same once written to Notion. */
export function samePlain(a: Plain, b: Plain): boolean {
  const norm = (v: Plain): string => {
    if (v !== null && typeof v === 'object') return `rel:${[...v.appIds].sort().join(',')}`;
    if (v === '' || v === undefined) return 'null';
    if (typeof v === 'string') return `s:${v.slice(0, MAX_TEXT)}`;
    return JSON.stringify(v);
  };
  return norm(a) === norm(b);
}
