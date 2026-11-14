import { describe, expect, it } from 'vitest';
import type { ComponentSpecInput, ItemSpecInput } from '../shared/schemas.ts';
import { fakeNotion, numberValue, referenceDatabases, relationValue, richValue, selectValue, titleValue, type FakeDb } from './fake-notion.ts';
import {
  SpecWriteError,
  componentSpecProperties,
  createSpecPage,
  itemSpecProperties,
  pickCategoryOption,
  pickOption,
  removeSpecPage,
  specTarget,
  type SpecTarget,
} from './spec-pages.ts';

const item = (overrides: Partial<ItemSpecInput> = {}): ItemSpecInput => ({
  name: 'Huile moteur',
  typeId: null,
  specification: '10W-40',
  oemRef: null,
  capacity: '3,2 L',
  quantity: null,
  chosenProductId: null,
  confirmation: null,
  ...overrides,
});

const component = (overrides: Partial<ComponentSpecInput> = {}): ComponentSpecInput => ({
  label: 'Bouchon de vidange',
  componentTypeId: null,
  category: null,
  value: '25',
  unit: 'N·m',
  source: null,
  confirmation: null,
  ...overrides,
});

const target = (kind: SpecTarget['kind'], columns: SpecTarget['columns']): SpecTarget => ({ kind, title: 'Base de test', dataSourceId: 'ds-test', columns });

const itemColumns = (extra: SpecTarget['columns'] = {}): SpecTarget['columns'] => ({
  Désignation: { type: 'title', options: [] },
  Véhicule: { type: 'relation', options: [] },
  Type: { type: 'relation', options: [] },
  Spécification: { type: 'rich_text', options: [] },
  'Réf. OEM': { type: 'rich_text', options: [] },
  Capacité: { type: 'rich_text', options: [] },
  Quantité: { type: 'number', options: [] },
  'Produit retenu': { type: 'relation', options: [] },
  Statut: { type: 'select', options: ['Confirmé', 'À confirmer'] },
  ...extra,
});

const componentColumns = (extra: SpecTarget['columns'] = {}): SpecTarget['columns'] => ({
  Élément: { type: 'title', options: [] },
  Véhicule: { type: 'relation', options: [] },
  Valeur: { type: 'number', options: [] },
  Composant: { type: 'relation', options: [] },
  Catégorie: { type: 'select', options: ['Moteur', 'Freins'] },
  Unité: { type: 'select', options: ['n·m', 'L'] },
  Source: { type: 'rich_text', options: [] },
  Statut: { type: 'select', options: ['Confirmé', 'À confirmer'] },
  ...extra,
});

const refs = { vehiclePageIds: ['page-bike'], typeNotionId: 'page-type-oil', chosenProductNotionId: null };

describe('itemSpecProperties', () => {
  it('writes the name, the vehicle, the type and the filled columns of a new page, and nothing empty', () => {
    const properties = itemSpecProperties(item(), target('itemSpecs', itemColumns()), refs);
    expect(Object.keys(properties).sort()).toEqual(['Capacité', 'Désignation', 'Spécification', 'Type', 'Véhicule']);
    expect(properties['Véhicule']).toEqual({ relation: [{ id: 'page-bike' }] });
    expect(properties['Type']).toEqual({ relation: [{ id: 'page-type-oil' }] });
    expect(properties['Capacité']).toEqual({ rich_text: [{ type: 'text', text: { content: '3,2 L' } }] });
  });

  it('never writes the compatible products', () => {
    const properties = itemSpecProperties(item({ chosenProductId: 'p' }), target('itemSpecs', itemColumns({ 'Produits compatibles': { type: 'relation', options: [] } })), {
      ...refs,
      chosenProductNotionId: 'page-product',
    });
    expect(properties).not.toHaveProperty('Produits compatibles');
    expect(properties['Produit retenu']).toEqual({ relation: [{ id: 'page-product' }] });
  });

  it('writes Quantité as a number, or as text with a decimal comma when the column is text', () => {
    const asNumber = itemSpecProperties(item({ quantity: 3.2 }), target('itemSpecs', itemColumns()), refs);
    expect(asNumber['Quantité']).toEqual({ number: 3.2 });
    const asText = itemSpecProperties(item({ quantity: 3.2 }), target('itemSpecs', itemColumns({ Quantité: { type: 'rich_text', options: [] } })), refs);
    expect(asText['Quantité']).toEqual({ rich_text: [{ type: 'text', text: { content: '3,2' } }] });
  });

  it('skips a missing optional column when there is nothing to write, and refuses when there is', () => {
    const columns = itemColumns();
    delete columns['Capacité'];
    expect(itemSpecProperties(item({ capacity: null }), target('itemSpecs', columns), refs)).not.toHaveProperty('Capacité');
    expect(() => itemSpecProperties(item({ capacity: '3 L' }), target('itemSpecs', columns), refs)).toThrow(SpecWriteError);
    try {
      itemSpecProperties(item({ capacity: '3 L' }), target('itemSpecs', columns), refs);
    } catch (error) {
      expect(error).toMatchObject({ code: 'notion_incomplete', status: 409 });
      expect((error as Error).message).toContain('Capacité');
    }
  });

  it('writes only what differs from the page on an update, and clears what was emptied', () => {
    const current = {
      id: 'page-1',
      properties: {
        Désignation: titleValue('Huile moteur'),
        Véhicule: relationValue('page-bike'),
        Type: relationValue('page-type-oil'),
        Spécification: richValue('10W-40'),
        'Réf. OEM': richValue('OEM-1'),
        Capacité: richValue('3,2 L'),
        Quantité: numberValue(null),
        'Produit retenu': relationValue(),
        Statut: selectValue(null),
      },
    };
    expect(itemSpecProperties(item({ oemRef: 'OEM-1' }), target('itemSpecs', itemColumns()), { ...refs, vehiclePageIds: [] }, current)).toEqual({});
    const changed = itemSpecProperties(item({ specification: '5W-30', oemRef: null, confirmation: 'confirmed' }), target('itemSpecs', itemColumns()), { ...refs, vehiclePageIds: [] }, current);
    expect(Object.keys(changed).sort()).toEqual(['Réf. OEM', 'Spécification', 'Statut']);
    expect(changed['Réf. OEM']).toEqual({ rich_text: [] });
    expect(changed['Statut']).toEqual({ select: { name: 'Confirmé' } });
  });
});

describe('componentSpecProperties', () => {
  it('writes a number Valeur as a number, with its unit matched to an existing option', () => {
    const properties = componentSpecProperties(component(), target('componentSpecs', componentColumns()), { vehiclePageIds: ['page-bike'], componentTypeNotionId: null });
    expect(properties['Valeur']).toEqual({ number: 25 });
    expect(properties['Unité']).toEqual({ select: { name: 'n·m' } });
  });

  it('refuses a text where Valeur is a number, but lets an empty value be empty', () => {
    const t = target('componentSpecs', componentColumns());
    const r = { vehiclePageIds: ['page-bike'], componentTypeNotionId: null };
    expect(() => componentSpecProperties(component({ value: '120/70 R17' }), t, r)).toThrow(SpecWriteError);
    try {
      componentSpecProperties(component({ value: '25 Nm' }), t, r);
    } catch (error) {
      expect(error).toMatchObject({ code: 'value_not_number', status: 422 });
    }
    expect(componentSpecProperties(component({ value: '', unit: null }), t, r)).not.toHaveProperty('Valeur');
    const current = { id: 'p', properties: { Élément: titleValue('Bouchon de vidange'), Valeur: numberValue(25), Unité: selectValue('n·m'), Source: richValue(''), Statut: selectValue(null), Catégorie: selectValue(null), Composant: relationValue() } };
    expect(componentSpecProperties(component({ value: '' }), t, { vehiclePageIds: [], componentTypeNotionId: null }, current)['Valeur']).toEqual({ number: null });
  });

  it('writes the text as it is where Valeur is a text column', () => {
    const t = target('componentSpecs', componentColumns({ Valeur: { type: 'rich_text', options: [] } }));
    const properties = componentSpecProperties(component({ value: '120/70 R17', unit: null }), t, { vehiclePageIds: [], componentTypeNotionId: null });
    expect(properties['Valeur']).toEqual({ rich_text: [{ type: 'text', text: { content: '120/70 R17' } }] });
  });

  it('picks the existing Catégorie option for the category, else the French label', () => {
    const t = target('componentSpecs', componentColumns());
    const r = { vehiclePageIds: [], componentTypeNotionId: null };
    expect(componentSpecProperties(component({ category: 'brakes' }), t, r)['Catégorie']).toEqual({ select: { name: 'Freins' } });
    expect(componentSpecProperties(component({ category: 'chassis' }), t, r)['Catégorie']).toEqual({ select: { name: 'Châssis' } });
  });
});

describe('option matching', () => {
  it('finds the Statut option by meaning, or falls back to the standard word', () => {
    expect(pickOption(['Confirmé', 'À confirmer'], 'confirmed')).toBe('Confirmé');
    expect(pickOption(['Confirmé', 'A confirmer ?'], 'to_confirm')).toBe('A confirmer ?');
    expect(pickOption([], 'to_confirm')).toBe('À confirmer');
    expect(pickOption([], 'confirmed')).toBe('Confirmé');
  });

  it('finds the Catégorie option by the app category', () => {
    expect(pickCategoryOption(['Freins', 'Moteur'], 'engine')).toBe('Moteur');
    expect(pickCategoryOption([], 'cooling_climate')).toBe('Refroidissement et climatisation');
  });
});

describe('specTarget and the writes', () => {
  const workspace = (mutate: (dbs: FakeDb[]) => void = () => undefined) => {
    const dbs = referenceDatabases();
    mutate(dbs);
    return fakeNotion(dbs);
  };

  it('finds the database by its new title or an old one, with its columns and options', async () => {
    const { client } = workspace((dbs) => {
      const spec = dbs.find((d) => d.id === 'db-itemSpecs')!;
      spec.title = 'Consommables par véhicule';
      spec.properties['Statut'] = { type: 'select', options: ['Confirmé'] };
    });
    const found = await specTarget(client, 'parent', 'itemSpecs');
    expect(found.title).toBe('Consommables par véhicule');
    expect(found.columns['Statut']).toEqual({ type: 'select', options: ['Confirmé'] });
  });

  it('is incomplete when the database is missing, both titles exist, or a required column is missing', async () => {
    await expect(specTarget(workspace((dbs) => dbs.splice(dbs.findIndex((d) => d.id === 'db-itemSpecs'), 1)).client, 'parent', 'itemSpecs')).rejects.toMatchObject({ code: 'notion_incomplete' });
    const both = workspace((dbs) => dbs.push({ id: 'db-old', title: 'Consommables par véhicule', properties: {}, pages: [] }));
    await expect(specTarget(both.client, 'parent', 'itemSpecs')).rejects.toMatchObject({ code: 'notion_incomplete' });
    const noType = workspace((dbs) => delete dbs.find((d) => d.id === 'db-itemSpecs')!.properties['Type']);
    await expect(specTarget(noType.client, 'parent', 'itemSpecs')).rejects.toThrow('"Type"');
  });

  it('creates a page, and detaches one vehicle from a shared page but trashes a page with one vehicle', async () => {
    const { client, writes, databases } = workspace();
    const target = await specTarget(client, 'parent', 'itemSpecs');
    const page = await createSpecPage(client, target, itemSpecProperties(item(), target, refs));
    expect(page.properties['Désignation'].title[0].plain_text).toBe('Huile moteur');
    expect(writes.map((w) => `${w.method} ${w.path}`)).toEqual(['POST /pages']);

    page.properties['Véhicule'] = relationValue('page-bike', 'page-car');
    expect(await removeSpecPage(client, page, 'page-bike')).toBe('detached');
    expect(writes.at(-1)!.body).toEqual({ properties: { Véhicule: { relation: [{ id: 'page-car' }] } } });
    expect(databases.find((d) => d.id === 'db-itemSpecs')!.pages[0].in_trash).toBe(false);

    expect(await removeSpecPage(client, page, 'page-car')).toBe('trashed');
    expect(writes.at(-1)!.body).toEqual({ in_trash: true });
  });
});
