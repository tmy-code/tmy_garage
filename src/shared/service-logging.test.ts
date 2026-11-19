import { describe, expect, it } from 'vitest';
import { BUILT_IN_CATALOGUE } from './catalogue.ts';
import { logService, looseName, type ServiceLoggingContext } from './service-logging.ts';
import type { ComponentUsed, Service } from './types.ts';

const VEHICLE = 'vehicle-0001';

const tasks: ServiceLoggingContext['tasks'] = [
  { id: 'task-km-01', intervalKm: 10_000, templateCode: null },
  { id: 'task-km-02', intervalKm: 5_000, templateCode: null },
  { id: 'task-time-01', intervalKm: null, templateCode: null },
  { id: 'task-time-02', intervalKm: null, templateCode: null },
  { id: 'task-seals-1', intervalKm: null, templateCode: 'moto_fork_seals' },
  { id: 'task-forkoil', intervalKm: null, templateCode: 'moto_fork_oil' },
];

const context = (items: ServiceLoggingContext['items'] = []): ServiceLoggingContext => ({ tasks, items, catalogue: BUILT_IN_CATALOGUE });

const line = (over: Partial<ComponentUsed> = {}): ComponentUsed => ({
  description: 'Test oil 10W-40',
  partNumber: null,
  quantity: 2,
  unit: 'litre',
  price: 12.5,
  itemId: null,
  consumableTypeId: null,
  productId: null,
  remember: false,
  ...over,
});

const draft = (over: Partial<Service> = {}): Service => ({
  id: 'service-0001',
  vehicleId: VEHICLE,
  date: '2026-01-15',
  odometer: 12_000,
  taskIds: ['task-time-01'],
  notes: null,
  kind: 'maintenance',
  title: null,
  category: null,
  performedBy: 'diy',
  totalCost: null,
  componentsUsed: [],
  ...over,
});

let counter = 0;
const options = (canAddToItems = true) => ({ newId: () => `minted-${++counter}`, canAddToItems });

function ok(result: ReturnType<typeof logService>) {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.errors)}`);
  return result;
}

describe('logService errors', () => {
  it('rejects a Task that is not on the Vehicle', () => {
    const result = logService(context(), draft({ taskIds: ['task-time-01', 'elsewhere'] }), options());
    expect(result).toEqual({ ok: false, errors: [{ code: 'task-not-on-vehicle', taskId: 'elsewhere' }] });
  });

  it('rejects a repair without a title', () => {
    const result = logService(context(), draft({ kind: 'repair', taskIds: [], title: '   ' }), options());
    expect(result).toEqual({ ok: false, errors: [{ code: 'repair-needs-title' }] });
  });

  it('rejects a maintenance Service without a Task', () => {
    const result = logService(context(), draft({ taskIds: [] }), options());
    expect(result).toEqual({ ok: false, errors: [{ code: 'maintenance-needs-task' }] });
  });

  it('asks for the odometer when a ticked Task counts distance', () => {
    const result = logService(context(), draft({ odometer: null, taskIds: ['task-km-01', 'task-time-01', 'task-km-02'] }), options());
    expect(result).toEqual({ ok: false, errors: [{ code: 'odometer-needed', taskIds: ['task-km-01', 'task-km-02'] }] });
  });

  it('reports the errors in order', () => {
    const result = logService(context(), draft({ odometer: null, taskIds: ['elsewhere', 'task-km-01'] }), options());
    expect(result).toEqual({
      ok: false,
      errors: [
        { code: 'task-not-on-vehicle', taskId: 'elsewhere' },
        { code: 'odometer-needed', taskIds: ['task-km-01'] },
      ],
    });
    const repair = logService(context(), draft({ kind: 'repair', taskIds: ['elsewhere'], title: null }), options());
    expect(repair).toEqual({
      ok: false,
      errors: [{ code: 'task-not-on-vehicle', taskId: 'elsewhere' }, { code: 'repair-needs-title' }],
    });
  });

  it('accepts no odometer when every ticked Task is time-based', () => {
    const result = ok(logService(context(), draft({ odometer: null, taskIds: ['task-time-01', 'task-time-02'] }), options()));
    expect(result.service.odometer).toBeNull();
  });
});

describe('logService tasks', () => {
  it('counts the fork oil with the fork seals, not the reverse', () => {
    const seals = ok(logService(context(), draft({ taskIds: ['task-seals-1'] }), options()));
    expect(seals.service.taskIds).toEqual(['task-seals-1', 'task-forkoil']);
    const oil = ok(logService(context(), draft({ taskIds: ['task-forkoil'] }), options()));
    expect(oil.service.taskIds).toEqual(['task-forkoil']);
  });

  it('does not repeat a Task that is already ticked', () => {
    const result = ok(logService(context(), draft({ taskIds: ['task-seals-1', 'task-forkoil'] }), options()));
    expect(result.service.taskIds).toEqual(['task-seals-1', 'task-forkoil']);
  });

  it('removes duplicate Task ids', () => {
    const result = ok(logService(context(), draft({ taskIds: ['task-time-01', 'task-time-01', 'task-time-02'] }), options()));
    expect(result.service.taskIds).toEqual(['task-time-01', 'task-time-02']);
  });

  it('keeps title and category only for a repair', () => {
    const maintenance = ok(logService(context(), draft({ title: 'Stray', category: 'engine' }), options()));
    expect(maintenance.service.title).toBeNull();
    expect(maintenance.service.category).toBeNull();
    const repair = ok(logService(context(), draft({ kind: 'repair', taskIds: [], title: 'Fix leak', category: 'engine' }), options()));
    expect(repair.service.title).toBe('Fix leak');
    expect(repair.service.category).toBe('engine');
  });
});

describe('logService components', () => {
  it('adds a kept line to the items, tied to the single Task', () => {
    const result = ok(logService(context(), draft({ componentsUsed: [line({ remember: true, itemId: 'item-new-001', partNumber: 'PN-1' })] }), options()));
    expect(result.newItems).toEqual([
      { id: 'item-new-001', vehicleId: VEHICLE, name: 'Test oil 10W-40', partNumber: 'PN-1', unit: 'litre', quantity: 2, price: 12.5, taskId: 'task-time-01' },
    ]);
    expect(result.service.componentsUsed[0]).toMatchObject({ itemId: 'item-new-001', remember: false });
  });

  it('ties the item to no Task when the Service has several', () => {
    const result = ok(logService(context(), draft({ taskIds: ['task-time-01', 'task-time-02'], componentsUsed: [line({ remember: true, itemId: 'item-new-001' })] }), options()));
    expect(result.newItems[0]!.taskId).toBeNull();
  });

  it('ties the item to the Task ticked, not to the ones that come with it', () => {
    const result = ok(logService(context(), draft({ taskIds: ['task-seals-1'], componentsUsed: [line({ remember: true, itemId: 'item-new-001' })] }), options()));
    expect(result.newItems[0]!.taskId).toBe('task-seals-1');
  });

  it('adds nothing on a replay with an item that is already listed', () => {
    const items = [{ id: 'item-new-001', name: 'Test oil 10W-40', partNumber: null }];
    const result = ok(logService(context(items), draft({ componentsUsed: [line({ remember: true, itemId: 'item-new-001' })] }), options()));
    expect(result.newItems).toEqual([]);
    expect(result.service.componentsUsed[0]!.itemId).toBe('item-new-001');
  });

  it('relinks a line to a twin found by loose name and part number', () => {
    const items = [{ id: 'item-twin-01', name: 'TEST  Öil 10w-40', partNumber: ' pn-1 ' }];
    const result = ok(logService(context(items), draft({ componentsUsed: [line({ remember: true, itemId: 'item-new-001', partNumber: 'PN-1' })] }), options()));
    expect(result.newItems).toEqual([]);
    expect(result.service.componentsUsed[0]!.itemId).toBe('item-twin-01');
  });

  it('gives one item for two identical lines', () => {
    const lines = [line({ remember: true, itemId: 'item-new-001' }), line({ remember: true, itemId: 'item-new-002' })];
    const result = ok(logService(context(), draft({ componentsUsed: lines }), options()));
    expect(result.newItems).toHaveLength(1);
    expect(result.service.componentsUsed.map((p) => p.itemId)).toEqual(['item-new-001', 'item-new-001']);
  });

  it('ignores remember when items cannot be added', () => {
    const result = ok(logService(context(), draft({ componentsUsed: [line({ remember: true, itemId: 'item-new-001' })] }), options(false)));
    expect(result.newItems).toEqual([]);
    expect(result.service.componentsUsed[0]).toMatchObject({ itemId: null, remember: false });
  });

  it('drops a link to an unknown item', () => {
    const result = ok(logService(context(), draft({ componentsUsed: [line({ itemId: 'item-gone-001' })] }), options()));
    expect(result.service.componentsUsed[0]!.itemId).toBeNull();
  });

  it('keeps a link to a listed item', () => {
    const items = [{ id: 'item-here-001', name: 'Other', partNumber: null }];
    const result = ok(logService(context(items), draft({ componentsUsed: [line({ itemId: 'item-here-001' })] }), options()));
    expect(result.service.componentsUsed[0]!.itemId).toBe('item-here-001');
  });

  it('passes the consumable type and product through', () => {
    const result = ok(logService(context(), draft({ componentsUsed: [line({ consumableTypeId: 'ctype-0001', productId: 'product-001' })] }), options()));
    expect(result.service.componentsUsed[0]).toMatchObject({ consumableTypeId: 'ctype-0001', productId: 'product-001' });
  });

  it('mints an id for a kept line without one', () => {
    const result = ok(logService(context(), draft({ componentsUsed: [line({ remember: true })] }), options()));
    expect(result.newItems).toHaveLength(1);
    expect(result.newItems[0]!.id).toMatch(/^minted-/);
    expect(result.service.componentsUsed[0]!.itemId).toBe(result.newItems[0]!.id);
  });
});

describe('looseName', () => {
  it('ignores case, accents and spacing', () => {
    expect(looseName('  Huile  MOTÜL ')).toBe('huile motul');
    expect(looseName(null)).toBe('');
  });
});
