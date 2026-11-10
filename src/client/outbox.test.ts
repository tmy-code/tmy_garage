import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../shared/types.ts';
import { applyOutbox, enqueueOp, opDeletePath, opRequest, type OutboxOp } from './outbox.ts';

const base: Snapshot = {
  vehicles: [],
  tasks: [],
  services: [{ id: 's1', vehicleId: 'v', date: '2026-01-01', odometer: 100, taskIds: ['t'], notes: null, kind: 'maintenance', title: null, category: null, performedBy: 'diy', totalCost: null, partsUsed: [] }],
  readings: [],
  specLines: [],
  vehicleParts: [],
  fillups: [],
  purchases: [],
  documents: [],
  catalogue: [],
  refTasks: [], componentTypes: [], consumableTypes: [], products: [], tools: [], vehicleConsumables: [], vehicleSpecs: [], notion: null,
};

const service = (id: string, odometer: number): OutboxOp => ({
  kind: 'service',
  data: { id, vehicleId: 'v', date: '2026-10-01', odometer, taskIds: ['t'], notes: null, kind: 'maintenance', title: null, category: null, performedBy: 'diy', totalCost: null, partsUsed: [] },
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
