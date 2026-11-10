import { describe, expect, it } from 'vitest';
import { messagesFor } from '../shared/messages.ts';
import type { MaintenanceTask, Service, Snapshot, Vehicle } from '../shared/types.ts';
import { normalizeSnapshot } from '../shared/workshop.ts';
import { buildJournal, buildLastDone } from './journal.ts';

const fr = messagesFor('fr');

const vehicle = (id: string, overrides: Partial<Vehicle> = {}): Vehicle =>
  ({ id, kind: 'motorcycle', name: `Moto ${id}`, make: 'Exemple', model: 'Test', year: 2020, vin: 'VF1TESTVIN0000001', status: 'owned', onGaragePage: true, equipment: [], ...overrides }) as Vehicle;

const task = (id: string, overrides: Partial<MaintenanceTask> = {}): MaintenanceTask => ({
  id,
  vehicleId: 'v1',
  name: `Task ${id}`,
  nameFr: `Tâche ${id}`,
  action: 'replace',
  intervalKm: 6000,
  intervalMonths: 12,
  baselineDate: null,
  baselineOdometer: null,
  notes: 'NOTE-SECRET',
  category: null,
  switchedOff: false,
  refTaskId: null,
  notionPlanId: null,
  ...overrides,
});

const service = (id: string, overrides: Partial<Service> = {}): Service => ({
  id,
  vehicleId: 'v1',
  date: '2026-09-01',
  odometer: 12_000,
  taskIds: [],
  notes: 'SERVICE-NOTE-SECRET',
  kind: 'maintenance',
  title: null,
  category: null,
  performedBy: 'diy',
  totalCost: 999,
  partsUsed: [],
  ...overrides,
});

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return normalizeSnapshot({
    vehicles: [vehicle('v1'), vehicle('v2', { status: 'sold' })],
    tasks: [
      task('t-oil', { refTaskId: 'rt-oil', notionPlanId: 'plan-oil', action: 'replace' }),
      task('t-check', { action: 'inspect' }),
      task('t-clean', { action: 'clean' }),
    ],
    services: [],
    readings: [{ id: 'r1', vehicleId: 'v1', date: '2026-10-01', odometer: 13_000 }],
    fillups: [{ id: 'f1', vehicleId: 'v1', date: '2026-10-02', odometer: 13_100, litres: 10, totalPaid: 15, fullTank: true, notes: 'FILLUP-SECRET' }],
    notionPurchases: [{ id: 'b1', notionId: 'n-b1', date: '2026-01-10', articleNotionId: 'n-art', productId: null, quantity: 4, price: 40, shop: 'SHOP-SECRET' }],
    documents: [{ id: 'd1', vehicleId: 'v1', ownerKind: 'service', ownerId: 's1', type: 'invoice', title: 'RECEIPT-SECRET', issueDate: null, expiryDate: null, fileName: 'receipt-secret.pdf', contentType: 'application/pdf', size: 1 }],
    refTasks: [
      { id: 'rt-oil', name: 'Vidange', action: 'replace', applicableIf: [], defaultKm: 6000, defaultMonths: 12, consumableTypeIds: ['ct-oil', 'ct-filter'], componentTypeIds: [], toolIds: [], instructions: null, notionId: 'n-rt-oil' },
    ],
    ...overrides,
  } as unknown as Snapshot);
}

describe('buildJournal', () => {
  const s = snapshot({
    services: [
      service('s1', {
        taskIds: ['t-oil', 't-check'],
        partsUsed: [
          { description: 'Huile test 10W-40', partNumber: 'PN-SECRET', quantity: 3.2, unit: 'litre', price: 11.5, consumableTypeId: 'ct-oil', productId: 'prod-1' },
          { description: 'Filtre test', partNumber: null, quantity: 1, unit: 'piece', price: 9, consumableTypeId: 'ct-filter' },
          { description: 'Joint tapé à la main', partNumber: null, quantity: 1, unit: 'piece', price: null },
        ],
      }),
      service('s2', { kind: 'repair', title: 'REPAIR-TITLE-SECRET', performedBy: 'garage', odometer: null, taskIds: [] }),
      service('s3', { vehicleId: 'v2', taskIds: [] }),
    ],
  });
  const journal = buildJournal(s, fr);

  it('makes a session per Service of an owned vehicle, with only date, km, who did it and the type', () => {
    expect(journal.sessions).toEqual([
      { appId: 's1', vehicleAppId: 'v1', title: '2026-09-01 · Moto v1', date: '2026-09-01', km: 12_000, performedBy: 'Moi-même', type: 'Entretien' },
      { appId: 's2', vehicleAppId: 'v1', title: '2026-09-01 · Moto v1', date: '2026-09-01', km: null, performedBy: 'Garage indépendant', type: 'Réparation' },
    ]);
  });

  it('makes an intervention per Task of a Service, with its action', () => {
    expect(journal.interventions).toEqual([
      { appId: 's1:t-oil', sessionAppId: 's1', title: 'Tâche t-oil', refTaskKey: 'rt-oil', planKey: 'plan:t-oil', action: 'Remplacement' },
      { appId: 's1:t-check', sessionAppId: 's1', title: 'Tâche t-check', refTaskKey: null, planKey: null, action: 'Contrôle' },
    ]);
  });

  it('gives a cleaning and an adjustment their own action', () => {
    const s2 = snapshot({ tasks: [task('t-clean', { action: 'clean' }), task('t-adjust', { action: 'adjust' })], services: [service('s1', { taskIds: ['t-clean', 't-adjust'] })] });
    expect(buildJournal(s2, fr).interventions.map((i) => i.action)).toEqual(['Nettoyage', 'Réglage']);
  });

  it('makes a line per part used, with its own quantity and unit price; a free-typed line has no type or product', () => {
    expect(journal.used).toEqual([
      { appId: 's1:0', interventionAppId: 's1:t-oil', consumableTypeKey: 'ct-oil', productKey: 'prod-1', designation: 'Huile test 10W-40', quantity: 3.2, unitPrice: 11.5 },
      { appId: 's1:1', interventionAppId: 's1:t-oil', consumableTypeKey: 'ct-filter', productKey: null, designation: 'Filtre test', quantity: 1, unitPrice: 9 },
      { appId: 's1:2', interventionAppId: 's1:t-oil', consumableTypeKey: null, productKey: null, designation: 'Joint tapé à la main', quantity: 1, unitPrice: null },
    ]);
  });

  it('never carries notes, receipts, VIN, shop, repair title, total cost, readings, purchases or fill-ups', () => {
    const text = JSON.stringify(journal);
    for (const secret of ['SERVICE-NOTE-SECRET', 'NOTE-SECRET', 'RECEIPT-SECRET', 'receipt-secret', 'VF1TESTVIN', 'SHOP-SECRET', 'REPAIR-TITLE-SECRET', 'FILLUP-SECRET', 'PN-SECRET', '999', '13000', '13100']) {
      expect(text).not.toContain(secret);
    }
  });

  it('gives nothing for a Service of a sold vehicle, and leaves a line with no Task unattached', () => {
    expect(journal.sessions.map((x) => x.appId)).not.toContain('s3');
    const alone = buildJournal(snapshot({ services: [service('s9', { partsUsed: [{ description: 'Chiffon', partNumber: null, quantity: 1, unit: 'piece' }] })] }), fr);
    expect(alone.used[0]).toMatchObject({ interventionAppId: null });
  });
});

describe('buildLastDone', () => {
  const today = '2026-11-01';

  it('uses the last Service, else the baseline, of Tasks that follow the catalogue only', () => {
    const s = snapshot({
      tasks: [
        task('t-oil', { refTaskId: 'rt-oil', notionPlanId: 'plan-oil' }),
        task('t-base', { refTaskId: 'rt-base', baselineDate: '2026-02-01', baselineOdometer: 5000 }),
        task('t-own', { baselineDate: '2026-02-01' }),
        task('t-never', { refTaskId: 'rt-never' }),
      ],
      services: [service('s1', { taskIds: ['t-oil'], odometer: 12_000 }), service('s0', { taskIds: ['t-oil'], date: '2026-03-01', odometer: 8000 })],
    });
    const byTask = (a: { taskId: string }, b: { taskId: string }) => a.taskId.localeCompare(b.taskId);
    expect(buildLastDone(s, today).sort(byTask)).toEqual([
      { taskId: 't-base', vehicleAppId: 'v1', planPageId: null, km: 5000, date: '2026-02-01' },
      { taskId: 't-oil', vehicleAppId: 'v1', planPageId: 'plan-oil', km: 12_000, date: '2026-09-01' },
    ]);
  });

  it('skips the Tasks of a sold vehicle', () => {
    const s = snapshot({ vehicles: [vehicle('v1', { status: 'sold' })], tasks: [task('t-oil', { refTaskId: 'rt-oil', baselineDate: '2026-02-01' })] });
    expect(buildLastDone(s, today)).toEqual([]);
  });
});
