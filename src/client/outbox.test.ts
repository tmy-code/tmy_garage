import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../shared/types.ts';
import { applyOutbox, enqueueOp, opRequest, type OutboxOp } from './outbox.ts';

const base: Snapshot = {
  vehicles: [],
  tasks: [],
  services: [{ id: 's1', vehicleId: 'v', date: '2026-01-01', odometer: 100, taskIds: ['t'], notes: null, partsUsed: [] }],
  readings: [],
  vehicleSpecs: [],
  partSpecs: [],
  positions: [],
  inspections: [],
  modifications: [],
  documents: [],
  drivers: [],
  policies: [],
  claims: [],
  quotes: [],
};

const service = (id: string, odometer: number): OutboxOp => ({
  kind: 'service',
  data: { id, vehicleId: 'v', date: '2026-10-01', odometer, taskIds: ['t'], notes: null, partsUsed: [] },
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
});
