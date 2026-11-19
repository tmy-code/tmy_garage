import { describe, expect, it } from 'vitest';
import type { MaintenanceTask, Snapshot } from '../shared/types.ts';
import { logService } from '../shared/service-logging.ts';
import { catalogueOf } from '../shared/catalogue.ts';
import { applyOutbox, enqueueOp, opDeletePath, opRequest, serviceToSend, type OutboxOp } from './outbox.ts';

const task = (id: string, templateCode: string | null, intervalKm: number | null): MaintenanceTask => ({
  id, vehicleId: 'v', name: id, nameFr: null, action: 'replace', intervalKm, intervalMonths: null, baselineDate: null, baselineOdometer: null, notes: null, category: null, switchedOff: false, templateCode,
});

const base: Snapshot = {
  vehicles: [],
  tasks: [task('t', null, 5000), task('t-seals', 'moto_fork_seals', 60000), task('t-oil', 'moto_fork_oil', 30000)],
  services: [{ id: 's1', vehicleId: 'v', date: '2026-01-01', odometer: 100, taskIds: ['t'], notes: null, kind: 'maintenance', title: null, category: null, performedBy: 'diy', totalCost: null, componentsUsed: [] }],
  readings: [],
  specLines: [],
  vehicleItems: [
    { id: 'item-0001', vehicleId: 'v', name: 'Engine oil', partNumber: 'P-1', unit: 'litre', quantity: 3, price: null, taskId: null, itemSpecId: null, specLineId: null, notes: null },
    { id: 'item-other', vehicleId: 'w', name: 'Other bike item', partNumber: null, unit: 'piece', quantity: 1, price: null, taskId: null, itemSpecId: null, specLineId: null, notes: null },
  ],
  fillups: [],
  documents: [],
  catalogue: [],
  refTasks: [], componentTypes: [], consumableTypes: [], products: [], tools: [], itemSpecs: [], componentSpecs: [], notionPurchases: [], notion: null,
};

const service = (id: string, odometer: number): OutboxOp => ({
  kind: 'service',
  data: { id, vehicleId: 'v', date: '2026-10-01', odometer, taskIds: ['t'], notes: null, kind: 'maintenance', title: null, category: null, performedBy: 'diy', totalCost: null, componentsUsed: [] },
});

describe('outbox', () => {
  it('shows queued changes on top of the server snapshot', () => {
    const reading: OutboxOp = { kind: 'reading', data: { id: 'r1', vehicleId: 'v', date: '2026-10-02', odometer: 300 } };
    const view = applyOutbox(base, [service('s2', 200), service('s1', 150), reading]);
    expect(view.services.map((s) => [s.id, s.odometer])).toEqual([
      ['s1', 150],
      ['s2', 200],
    ]);
    expect(view.readings).toHaveLength(1);
    expect(base.services[0]!.odometer).toBe(100);
  });

  it('shows the Components Used of a Service queued with the old partsUsed key', () => {
    const legacy = { kind: 'service', data: { ...service('s3', 300).data, componentsUsed: undefined, partsUsed: [{ description: 'Oil', quantity: 1, unit: 'litre', partId: 'item-0001' }] } } as unknown as OutboxOp;
    const view = applyOutbox(base, [legacy]);
    const added = view.services.find((s) => s.id === 's3')!;
    expect(added.componentsUsed[0]).toMatchObject({ description: 'Oil', itemId: 'item-0001' });
    expect(added).not.toHaveProperty('partsUsed');
  });

  it('keeps one queued version per record, the latest', () => {
    const ops = enqueueOp(enqueueOp([], service('s2', 200)), service('s2', 210));
    expect(ops).toHaveLength(1);
    expect(ops[0]!.data.odometer).toBe(210);
  });

  it('maps each change to its idempotent endpoint', () => {
    expect(opRequest(service('s2', 1)).path).toBe('/api/services/s2');
    expect(opRequest({ kind: 'reading', data: { id: 'r9', vehicleId: 'v', date: '2026-01-01', odometer: 1 } }).path).toBe(
      '/api/odometer-readings/r9',
    );
  });

  it('queues Fill-ups: endpoint, upsert into the snapshot, one version per record', () => {
    const fillup = (id: string, litres: number): OutboxOp => ({
      kind: 'fillup',
      data: { id, vehicleId: 'v', date: '2026-10-01', odometer: 500, litres, totalPaid: litres * 1.7, fullTank: true, notes: null },
    });
    expect(opRequest(fillup('f1', 40)).path).toBe('/api/fillups/f1');
    expect(applyOutbox(base, [fillup('f1', 40)]).fillups.map((f) => f.litres)).toEqual([40]);
    expect(applyOutbox(base, [fillup('f1', 40), fillup('f2', 30), fillup('f1', 41)]).fillups.map((f) => [f.id, f.litres])).toEqual([
      ['f1', 41],
      ['f2', 30],
    ]);
    expect(enqueueOp(enqueueOp([], fillup('f1', 40)), fillup('f1', 42))).toHaveLength(1);
    expect(base.fillups).toEqual([]);
  });

  it('gives the delete path of every kind of change', () => {
    expect(opDeletePath(service('s2', 1))).toBe('/api/services/s2');
    expect(opDeletePath({ kind: 'reading', data: { id: 'r9', vehicleId: 'v', date: '2026-01-01', odometer: 1 } })).toBe('/api/odometer-readings/r9');
    expect(
      opDeletePath({ kind: 'fillup', data: { id: 'f9', vehicleId: 'v', date: '2026-01-01', odometer: null, litres: 1, totalPaid: 1, fullTank: false, notes: null } }),
    ).toBe('/api/fillups/f9');
  });
});

const line = (over: Record<string, unknown>) => ({ description: 'Gasket', partNumber: null, quantity: 1, unit: 'piece', price: null, ...over });
const withLines = (id: string, componentsUsed: unknown[], over: Record<string, unknown> = {}): OutboxOp => {
  const op = service(id, 200);
  return { kind: 'service', data: { ...op.data, componentsUsed, ...over } } as OutboxOp;
};

describe('applyOutbox shows a queued Service as the server keeps it', () => {
  it('expands a Task that comes with another', () => {
    const view = applyOutbox(base, [withLines('s2', [], { taskIds: ['t-seals'] })]);
    expect(view.services.find((s) => s.id === 's2')!.taskIds).toEqual(['t-seals', 't-oil']);
  });

  it('adds an item to remember to the items list and keeps the line linked', () => {
    const view = applyOutbox(base, [withLines('s2', [line({ itemId: 'item-new', remember: true, description: 'Fresh filter' })])]);
    expect(view.vehicleItems.find((i) => i.id === 'item-new')).toMatchObject({ vehicleId: 'v', name: 'Fresh filter', taskId: 't', itemSpecId: null, specLineId: null, notes: null });
    expect(view.services.find((s) => s.id === 's2')!.componentsUsed[0]).toMatchObject({ itemId: 'item-new' });
  });

  it('relinks a line to an existing item with the same loose name and part number', () => {
    const view = applyOutbox(base, [withLines('s2', [line({ itemId: 'item-new', remember: true, description: ' ENGINE  oil', partNumber: 'p-1' })])]);
    expect(view.vehicleItems).toHaveLength(base.vehicleItems.length);
    expect(view.services.find((s) => s.id === 's2')!.componentsUsed[0]).toMatchObject({ itemId: 'item-0001' });
  });

  it('links a legacy partsUsed line to an existing item and drops a link to a missing one', () => {
    const legacy = (id: string, partId: string) =>
      ({ kind: 'service', data: { ...service(id, 300).data, componentsUsed: undefined, partsUsed: [{ description: 'Oil', quantity: 1, unit: 'litre', partId }] } }) as unknown as OutboxOp;
    const view = applyOutbox(base, [legacy('s3', 'item-0001'), legacy('s4', 'item-gone'), legacy('s5', 'item-other')]);
    expect(view.services.find((s) => s.id === 's3')!.componentsUsed[0]!.itemId).toBe('item-0001');
    expect(view.services.find((s) => s.id === 's4')!.componentsUsed[0]!.itemId).toBeNull();
    expect(view.services.find((s) => s.id === 's5')!.componentsUsed[0]!.itemId).toBeNull();
  });

  it('shows an invalid Service unchanged instead of dropping it', () => {
    const op = withLines('s6', [], { kind: 'repair', title: null, taskIds: [] });
    const view = applyOutbox(base, [op]);
    expect(view.services.find((s) => s.id === 's6')).toMatchObject({ kind: 'repair', title: null });
  });

  it('does not add an item of another Vehicle and unlinks the line', () => {
    const view = applyOutbox(base, [withLines('s7', [line({ itemId: 'item-other', remember: true })])]);
    expect(view.vehicleItems.filter((i) => i.id === 'item-other')).toHaveLength(1);
    expect(view.vehicleItems.find((i) => i.id === 'item-other')!.vehicleId).toBe('w');
    expect(view.services.find((s) => s.id === 's7')!.componentsUsed[0]!.itemId).toBeNull();
  });

  it('is deterministic, idempotent and leaves the snapshot alone', () => {
    const ops = [
      withLines('s2', [line({ itemId: 'item-new', remember: true })], { taskIds: ['t-seals'] }),
      withLines('s8', [line({ remember: true, description: 'No id yet' })]),
    ];
    const before = structuredClone(base);
    const once = applyOutbox(base, ops);
    expect(applyOutbox(base, ops)).toEqual(once);
    expect(applyOutbox(once, ops)).toEqual(once);
    expect(base).toEqual(before);
  });

  it('adds an item named by two queued Services once', () => {
    const view = applyOutbox(base, [withLines('s2', [line({ itemId: 'item-new', remember: true })]), withLines('s9', [line({ itemId: 'item-new', remember: true })])]);
    expect(view.vehicleItems.filter((i) => i.id === 'item-new')).toHaveLength(1);
    expect(view.services.find((s) => s.id === 's9')!.componentsUsed[0]!.itemId).toBe('item-new');
  });
});

describe('serviceToSend', () => {
  it('keeps remember only on lines whose item is still to be added', () => {
    const draft = withLines('s2', [line({ itemId: 'item-new', remember: true }), line({ itemId: 'item-0001' }), line({ description: 'Plain' })]).data as import('../shared/types.ts').Service;
    const r = logService({ tasks: base.tasks, items: base.vehicleItems.filter((i) => i.vehicleId === 'v'), catalogue: catalogueOf(base) }, draft, { newId: () => 'x', canAddToItems: true });
    if (!r.ok) throw new Error('expected ok');
    const sent = serviceToSend(r);
    expect(sent.componentsUsed.map((p) => [p.itemId, p.remember ?? false])).toEqual([
      ['item-new', true],
      ['item-0001', false],
      [null, false],
    ]);
  });
});
