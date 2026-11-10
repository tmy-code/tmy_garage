import { describe, expect, it } from 'vitest';
import { parseReference, vehiclePageMap } from './reference.ts';

// Fake Notion property values and pages: no real ids, nothing from a real workspace.
const text = (s: string) => [{ plain_text: s }];
const title = (s: string) => ({ type: 'title', title: text(s) });
const rich = (s: string) => ({ type: 'rich_text', rich_text: s ? text(s) : [] });
const num = (n: number | null) => ({ type: 'number', number: n });
const sel = (name: string | null) => ({ type: 'select', select: name === null ? null : { name } });
const multi = (...names: string[]) => ({ type: 'multi_select', multi_select: names.map((name) => ({ name })) });
const rel = (...ids: string[]) => ({ type: 'relation', relation: ids.map((id) => ({ id })) });
const check = (checkbox: boolean) => ({ type: 'checkbox', checkbox });
const date = (start: string | null) => ({ type: 'date', date: start ? { start } : null });
const page = (id: string, properties: Record<string, unknown>) => ({ id, properties });

const vehicleMap = new Map([['page-bike', 'bike'], ['page-car', 'car']]);

const taskPage = (id: string, extra: Record<string, unknown> = {}) =>
  page(id, {
    Tâche: title('Vidange'),
    Action: sel('Remplacement'),
    'Applicable si': multi(),
    'Intervalle par défaut (km)': num(6000),
    'Intervalle par défaut (mois)': num(12),
    'Types de consommables requis': rel('ct-1'),
    Composants: rel(),
    Outils: rel(),
    Instructions: rich('Chauffer le moteur'),
    ...extra,
  });

describe('parseReference: vocabulary', () => {
  it('maps Action, Famille and Statut to the app values', () => {
    const pull = parseReference(
      {
        tasks: [taskPage('t1'), taskPage('t2', { Tâche: title('Niveau'), Action: sel('Contrôle') })],
        consumableTypes: [
          page('c1', { Nom: title('Huile'), Catégorie: sel('Moteur'), Famille: sel('Fluide'), Notes: rich('') }),
          page('c2', { Nom: title('Filtre'), Catégorie: sel('Moteur'), Famille: sel('Pièce'), Notes: rich('') }),
        ],
        vehicleSpecs: [
          page('s1', { Élément: title('A'), Véhicule: rel('page-bike'), Valeur: num(1), Statut: sel('À confirmer') }),
          page('s2', { Élément: title('B'), Véhicule: rel('page-bike'), Valeur: num(2), Statut: sel('Confirmé') }),
        ],
      },
      vehicleMap,
    );
    expect(pull.tasks.rows.map((r) => r.action)).toEqual(['replace', 'inspect']);
    expect(pull.consumableTypes.rows.map((r) => r.family)).toEqual(['fluid', 'part']);
    expect(pull.vehicleSpecs.rows.map((r) => r.status)).toEqual(['to_confirm', 'confirmed']);
  });

  it('maps unknown vocabulary to null with a warning, and lists the vocabularies found', () => {
    const pull = parseReference({ tasks: [taskPage('t1', { Action: sel('Nettoyage') })] }, vehicleMap);
    expect(pull.tasks.rows[0]!.action).toBeNull();
    expect(pull.tasks.warnings.join('\n')).toContain('unknown value "Nettoyage" in "Action"');
    expect(pull.vocabularies["Tâches d'entretien / Action"]).toEqual(['Nettoyage']);
  });
});

describe('parseReference: values', () => {
  it('reads Valeur and Quantité as a number or as text', () => {
    const pull = parseReference(
      {
        vehicleSpecs: [
          page('s1', { Élément: title('Couple'), Véhicule: rel('page-bike'), Valeur: num(25.5) }),
          page('s2', { Élément: title('Taille'), Véhicule: rel('page-bike'), Valeur: rich('120/70 R17') }),
        ],
        vehicleConsumables: [
          page('k1', { Désignation: title('Huile'), Véhicule: rel('page-bike'), Type: rel('ct-1'), Quantité: num(3.2) }),
          page('k2', { Désignation: title('Liquide'), Véhicule: rel('page-bike'), Type: rel('ct-2'), Quantité: rich('0,5 L') }),
          page('k3', { Désignation: title('Graisse'), Véhicule: rel('page-bike'), Type: rel('ct-3'), Quantité: rich('au besoin') }),
        ],
      },
      vehicleMap,
    );
    expect(pull.vehicleSpecs.rows.map((r) => r.value)).toEqual(['25.5', '120/70 R17']);
    expect(pull.vehicleConsumables.rows.map((r) => r.quantity)).toEqual([3.2, 0.5, null]);
    expect(pull.vehicleConsumables.warnings.join('\n')).toContain('"Quantité" is not a number');
  });

  it('keeps relations as Notion page ids', () => {
    const pull = parseReference({ tasks: [taskPage('t1', { Outils: rel('tool-a', 'tool-b'), Composants: rel('comp-1') })] }, vehicleMap);
    expect(pull.tasks.rows[0]).toMatchObject({ consumableTypeNotionIds: ['ct-1'], toolNotionIds: ['tool-a', 'tool-b'], componentTypeNotionIds: ['comp-1'], instructions: 'Chauffer le moteur' });
  });

  it("maps a task's Catégorie to the app's category, accepting the other spellings of the catalogue", () => {
    const pull = parseReference(
      {
        tasks: [
          taskPage('t1', { Catégorie: sel('Refroidissement et climatisation') }),
          taskPage('t2', { Catégorie: sel('Freins') }),
          taskPage('t3', { Catégorie: sel('Électrique') }),
          taskPage('t4', { Catégorie: sel(null) }),
          taskPage('t5', { Catégorie: sel('Carrosserie') }),
        ],
      },
      vehicleMap,
    );
    expect(pull.tasks.rows.map((r) => r.category)).toEqual(['cooling_climate', 'brakes', 'electrical', null, null]);
    expect(pull.tasks.warnings.join('\n')).toContain('unknown value "Carrosserie" in "Catégorie"');
  });

  it('skips pages with an empty title', () => {
    const pull = parseReference({ tasks: [taskPage('t1', { Tâche: title('  ') }), taskPage('t2')] }, vehicleMap);
    expect(pull.tasks.rows.map((r) => r.notionId)).toEqual(['t2']);
  });

  it('reads a plan with its overrides and last-done date', () => {
    const pull = parseReference(
      {
        plans: [
          page('pl1', {
            Plan: title('Vidange – moto'),
            Véhicule: rel('page-bike'),
            Tâche: rel('t1'),
            'Intervalle (km)': num(4000),
            'Intervalle (mois)': num(null),
            'Dernier fait (km)': num(12000),
            'Dernier fait (date)': date('2026-05-01T08:00:00.000Z'),
            Notes: rich('Huile maison'),
          }),
        ],
      },
      vehicleMap,
    );
    expect(pull.plans.rows[0]).toEqual({
      notionId: 'pl1',
      name: 'Vidange – moto',
      vehicleAppId: 'bike',
      taskNotionId: 't1',
      intervalKm: 4000,
      intervalMonths: null,
      lastKm: 12000,
      lastDate: '2026-05-01',
      notes: 'Huile maison',
    });
  });
});

describe('parseReference: vehicles', () => {
  const spec = (id: string, vehicles: string[]) => page(id, { Élément: title('Couple bouchon'), Véhicule: rel(...vehicles), Valeur: num(25) });

  it('expands a page pointing at several vehicles into one row per vehicle', () => {
    const pull = parseReference({ vehicleSpecs: [spec('s1', ['page-bike', 'page-car'])] }, vehicleMap);
    expect(pull.vehicleSpecs.rows.map((r) => [r.notionId, r.vehicleAppId])).toEqual([['s1', 'bike'], ['s1', 'car']]);
  });

  it('skips a row whose vehicle is unknown or removed, with a warning', () => {
    const pull = parseReference({ vehicleSpecs: [spec('s1', ['page-gone']), spec('s2', []), spec('s3', ['page-bike', 'page-gone'])] }, vehicleMap);
    expect(pull.vehicleSpecs.rows.map((r) => [r.notionId, r.vehicleAppId])).toEqual([['s3', 'bike']]);
    expect(pull.vehicleSpecs.warnings.join('\n')).toContain('is not in the app or was removed, skipped');
    expect(pull.vehicleSpecs.warnings.join('\n')).toContain('has no vehicle, skipped');
  });

  it('does not count a plan skipped for its vehicle as vanished', () => {
    const pull = parseReference({ plans: [page('pl1', { Plan: title('P'), Véhicule: rel('page-gone'), Tâche: rel('t1') })] }, vehicleMap);
    expect(pull.plans.rows).toEqual([]);
    expect(pull.skippedPlanNotionIds).toEqual(['pl1']);
  });

  it('reads the equipment tags by vehicle app id, skipping removed vehicles', () => {
    const vehicles = [
      page('page-bike', { 'ID app': rich('bike'), 'Supprimé de l’app': check(false), Équipements: multi('Transmission chaîne', 'ABS', 'ABS') }),
      page('page-car', { 'ID app': rich('car'), 'Supprimé de l’app': check(false), Équipements: multi() }),
      page('page-old', { 'ID app': rich('old'), 'Supprimé de l’app': check(true), Équipements: multi('ABS') }),
      page('page-noid', { 'ID app': rich(''), 'Supprimé de l’app': check(false), Équipements: multi('ABS') }),
    ];
    expect([...vehiclePageMap(vehicles)]).toEqual([['page-bike', 'bike'], ['page-car', 'car']]);
    const pull = parseReference({ vehicles }, vehiclePageMap(vehicles));
    expect(pull.equipment).toEqual({ bike: ['Transmission chaîne', 'ABS'], car: [] });
    expect(pull.vehiclePageIds).toEqual({ bike: 'page-bike', car: 'page-car' });
    expect(pull.vocabularies['Véhicules / Équipements']).toEqual(['ABS', 'Transmission chaîne']);
  });

  it('reads no equipment, with a warning, when the Équipements column is missing', () => {
    const pull = parseReference({ vehicles: [page('page-bike', { 'ID app': rich('bike') })] }, vehicleMap);
    expect(pull.equipment).toEqual({});
    expect(pull.vehicleWarnings.join('\n')).toContain('Équipements');
  });
});

describe('parseReference: columns and completeness', () => {
  it('tolerates missing optional columns', () => {
    const minimal = page('t1', {
      Tâche: title('Vidange'),
      Action: sel('Remplacement'),
      'Applicable si': multi(),
      'Intervalle par défaut (km)': num(6000),
      'Intervalle par défaut (mois)': num(12),
    });
    const pull = parseReference({ tasks: [minimal] }, vehicleMap);
    expect(pull.tasks.complete).toBe(true);
    expect(pull.tasks.rows[0]).toMatchObject({ consumableTypeNotionIds: [], toolNotionIds: [], componentTypeNotionIds: [], instructions: null });
  });

  it('marks a database incomplete, with a warning, when a required column is missing', () => {
    const noAction = page('t1', { Tâche: title('Vidange'), 'Applicable si': multi() });
    const pull = parseReference({ tasks: [noAction] }, vehicleMap);
    expect(pull.tasks.complete).toBe(false);
    expect(pull.tasks.rows).toEqual([]);
    expect(pull.tasks.warnings.join('\n')).toContain('the required column "Action" is missing');
  });

  it('marks a database that was not found incomplete', () => {
    const pull = parseReference({}, vehicleMap);
    expect(pull.products.complete).toBe(false);
    expect(pull.products.warnings.join('\n')).toContain('not found');
  });

  it('treats an empty database as complete with no rows', () => {
    const pull = parseReference({ tools: [] }, vehicleMap);
    expect(pull.tools).toEqual({ rows: [], complete: true, warnings: [] });
  });
});
