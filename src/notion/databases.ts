// The Notion databases the app manages (Véhicules, plus the journal: columns, and how a row becomes Notion property values),
// and the descriptors of the nine databases the owner makes by hand (ADR 0007, 0008): read only, except Plans and the two spec databases (ADR 0009).
// Columns marked `owner` are the owner's (Deals, filing reference, equipment): created if missing, never written.
import type { VehicleRow } from './copy.ts';
import {
  ACTION_ADJUST,
  ACTION_CLEAN,
  ACTION_INSPECT,
  ACTION_REPLACE,
  SESSION_MAINTENANCE,
  SESSION_REPAIR,
  type InterventionRow,
  type SessionRow,
  type UsedRow,
} from './journal.ts';

export type ColumnType = 'title' | 'rich_text' | 'number' | 'euro' | 'select' | 'multi_select' | 'date' | 'checkbox' | 'url' | 'relation';

export interface Column {
  name: string;
  type: ColumnType;
  /** For a relation: the key of the database it points at. */
  target?: DatabaseKey | ReferenceKey;
  /** For a select: options created with the column, with their colours. */
  options?: { name: string; color: string }[];
  owner?: boolean;
}

export type DatabaseKey = 'vehicles' | 'sessions' | 'interventions' | 'used';

/** A value as compared and written: text, number, date, checkbox, tags, or the app ids a relation points at. */
export type Plain = string | number | boolean | null | string[] | { appIds: string[] };

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

/** The owner's multi-select of equipment tags on a Véhicules page. */
export const EQUIPMENT = 'Équipements';

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
    // The equipment tags the owner picks; they decide which catalogue tasks apply. Read by the pull, never written.
    { name: EQUIPMENT, type: 'multi_select', owner: true },
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

/** A column of a hand-made database: the Notion property types it may have. */
export interface ReferenceColumn {
  name: string;
  types: string[];
}

export type ReferenceKey = 'tasks' | 'componentTypes' | 'consumableTypes' | 'products' | 'tools' | 'plans' | 'itemSpecs' | 'componentSpecs' | 'purchases';

/**
 * A database the owner makes and keeps by hand, matched by its title under the parent page. The app reads it. It writes
 * pages (title included) only in Plans and in the two spec databases (Item Specs, Component Specs; ADR 0009), and never
 * creates, renames or retypes the columns of any of them: these descriptors are never passed to column creation.
 * A missing required column makes the database "incomplete" (nothing is removed because of it); a missing optional
 * column is tolerated.
 */
export interface ReferenceDb {
  key: ReferenceKey;
  title: string;
  /** Earlier titles still accepted during a rename. */
  oldTitles?: string[];
  required: ReferenceColumn[];
  optional: ReferenceColumn[];
}

const col = (name: string, ...types: string[]): ReferenceColumn => ({ name, types });

export const REFERENCE_DBS: ReferenceDb[] = [
  {
    key: 'tasks',
    title: "Tâches d'entretien",
    required: [col('Tâche', 'title'), col('Action', 'select'), col('Applicable si', 'multi_select'), col('Intervalle par défaut (km)', 'number'), col('Intervalle par défaut (mois)', 'number')],
    optional: [col('Types de consommables requis', 'relation'), col('Composants', 'relation'), col('Outils', 'relation'), col('Instructions', 'rich_text'), col('Catégorie', 'select')],
  },
  {
    key: 'componentTypes',
    title: 'Types de composants',
    required: [col('Nom', 'title')],
    optional: [col('Catégorie', 'select'), col('Notes', 'rich_text')],
  },
  {
    key: 'consumableTypes',
    title: 'Types de consommables',
    required: [col('Nom', 'title')],
    optional: [col('Catégorie', 'select'), col('Famille', 'select'), col('Notes', 'rich_text')],
  },
  {
    key: 'products',
    title: 'Produits',
    required: [col('Nom', 'title')],
    optional: [col('Type de consommable', 'relation'), col('Marque', 'rich_text'), col('Référence', 'rich_text'), col('Fournisseur', 'rich_text'), col('Prix', 'number'), col('Notes', 'rich_text')],
  },
  {
    key: 'tools',
    title: 'Outils',
    required: [col('Nom', 'title')],
    optional: [col('Type', 'select'), col('Taille / capacité', 'rich_text'), col('Possédé', 'checkbox'), col('Prix', 'number'), col('Notes', 'rich_text')],
  },
  {
    key: 'plans',
    title: "Plans d'entretien",
    required: [col('Plan', 'title'), col('Véhicule', 'relation'), col('Tâche', 'relation')],
    optional: [col('Intervalle (km)', 'number'), col('Intervalle (mois)', 'number'), col('Dernier fait (km)', 'number'), col('Dernier fait (date)', 'date'), col('Notes', 'rich_text')],
  },
  {
    key: 'itemSpecs',
    title: "Spécifications d'articles",
    oldTitles: ['Consommables par véhicule'],
    required: [col('Désignation', 'title'), col('Véhicule', 'relation'), col('Type', 'relation')],
    optional: [
      col('Spécification', 'rich_text'),
      col('Réf. OEM', 'rich_text'),
      col('Capacité', 'rich_text'),
      col('Quantité', 'number', 'rich_text'),
      col('Produits compatibles', 'relation'),
      col('Produit retenu', 'relation'),
      col('Statut', 'select'),
    ],
  },
  {
    key: 'componentSpecs',
    title: 'Spécifications de composants',
    oldTitles: ['Spécifications'],
    required: [col('Élément', 'title'), col('Véhicule', 'relation'), col('Valeur', 'number', 'rich_text')],
    optional: [col('Composant', 'relation'), col('Catégorie', 'select'), col('Unité', 'select'), col('Source', 'rich_text'), col('Statut', 'select')],
  },
  {
    key: 'purchases',
    title: 'Achats',
    required: [col('Achat', 'title'), col('Date', 'date'), col('Article', 'relation')],
    optional: [col('Produit', 'relation'), col('Quantité', 'number', 'rich_text'), col('Prix payé', 'number'), col('Boutique', 'rich_text')],
  },
];

export const SESSIONS: Database<SessionRow> = {
  key: 'sessions',
  title: 'Séances',
  icon: '🛠️',
  columns: [
    { name: 'Séance', type: 'title' },
    { name: 'Véhicule', type: 'relation', target: 'vehicles' },
    { name: 'Date', type: 'date' },
    { name: 'Km', type: 'number' },
    { name: 'Réalisé par', type: 'select' },
    {
      name: 'Type',
      type: 'select',
      options: [
        { name: SESSION_MAINTENANCE, color: 'green' },
        { name: SESSION_REPAIR, color: 'orange' },
      ],
    },
    ...common,
  ],
  values: (r) => ({
    Séance: r.title,
    Véhicule: { appIds: [r.vehicleAppId] },
    Date: r.date,
    Km: r.km,
    'Réalisé par': r.performedBy,
    Type: r.type,
  }),
};

export const INTERVENTIONS: Database<InterventionRow> = {
  key: 'interventions',
  title: 'Interventions',
  icon: '🔧',
  columns: [
    { name: 'Intervention', type: 'title' },
    { name: 'Séance', type: 'relation', target: 'sessions' },
    { name: 'Tâche', type: 'relation', target: 'tasks' },
    { name: 'Plan', type: 'relation', target: 'plans' },
    {
      name: 'Action',
      type: 'select',
      options: [
        { name: ACTION_INSPECT, color: 'blue' },
        { name: ACTION_REPLACE, color: 'purple' },
        { name: ACTION_CLEAN, color: 'green' },
        { name: ACTION_ADJUST, color: 'yellow' },
      ],
    },
    ...common,
  ],
  values: (r) => ({
    Intervention: r.title,
    Séance: { appIds: [r.sessionAppId] },
    Tâche: { appIds: r.refTaskKey ? [r.refTaskKey] : [] },
    Plan: { appIds: r.planKey ? [r.planKey] : [] },
    Action: r.action,
  }),
};

export const USED: Database<UsedRow> = {
  key: 'used',
  title: 'Consommables utilisés',
  icon: '🛢️',
  columns: [
    { name: 'Ligne', type: 'title' },
    { name: 'Intervention', type: 'relation', target: 'interventions' },
    { name: 'Type de consommable', type: 'relation', target: 'consumableTypes' },
    { name: 'Produit utilisé', type: 'relation', target: 'products' },
    { name: 'Désignation', type: 'rich_text' },
    { name: 'Quantité', type: 'number' },
    { name: 'Prix unitaire', type: 'euro' },
    ...common,
  ],
  values: (r) => ({
    Ligne: r.designation,
    Intervention: { appIds: r.interventionAppId ? [r.interventionAppId] : [] },
    'Type de consommable': { appIds: r.consumableTypeKey ? [r.consumableTypeKey] : [] },
    'Produit utilisé': { appIds: r.productKey ? [r.productKey] : [] },
    Désignation: r.designation,
    Quantité: r.quantity,
    'Prix unitaire': r.unitPrice,
  }),
};

/** The schema Notion needs to create a column. */
export function columnSchema(column: Column, dataSourceIds: Partial<Record<DatabaseKey | ReferenceKey, string>>): Record<string, unknown> {
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
    case 'multi_select':
      return { multi_select: { options: column.options ?? [] } };
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
    case 'multi_select':
      return { multi_select: Array.isArray(value) ? value.map((name) => ({ name })) : [] };
    case 'date':
      return { date: value === null ? null : { start: String(value) } };
    case 'checkbox':
      return { checkbox: value === true };
    case 'url':
      return { url: value === null || value === '' ? null : String(value) };
    case 'relation': {
      const ids = value !== null && typeof value === 'object' && !Array.isArray(value) ? value.appIds : [];
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
    case 'multi_select':
      return (property.multi_select as { name: string }[]).map((o) => o.name);
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

/** The Notion page ids of a relation property, as Notion gives them (not mapped to the app's ids). */
export function relationPageIds(property: any): string[] {
  if (!property || property.type !== 'relation') return [];
  return (property.relation as { id: string }[]).map((r) => r.id);
}

/** Whether two plain values are the same once written to Notion. */
export function samePlain(a: Plain, b: Plain): boolean {
  const norm = (v: Plain): string => {
    if (Array.isArray(v)) return `tags:${[...v].sort().join('|')}`;
    if (v !== null && typeof v === 'object') return `rel:${[...v.appIds].sort().join(',')}`;
    if (v === '' || v === undefined) return 'null';
    if (typeof v === 'string') return `s:${v.slice(0, MAX_TEXT)}`;
    return JSON.stringify(v);
  };
  return norm(a) === norm(b);
}
