import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { MaintenanceTask, Snapshot, Vehicle } from '../shared/types.ts';
import { normalizeSnapshot } from '../shared/workshop.ts';
import { DEFAULT_GARAGE_ID, openDatabase } from './db.ts';
import { syncTodoist, todoistClient, wantedTasks, type TodoistClient } from './todoist.ts';

const TODAY = '2026-10-25';

function vehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 'v',
    kind: 'motorcycle',
    name: 'Test bike',
    make: null,
    model: null,
    year: null,
    vin: null,
    firstRegistrationDate: null,
    purchaseDate: null,
    fuel: null,
    transmission: null,
    drivetrain: null,
    distribution: null,
    cooling: null,
    finalDrive: null,
    cylinders: null,
    hasHydraulicClutch: false,
    hasTurbo: false,
    hasDirectInjection: false,
    hasStartStop: false,
    hasAdblue: false,
    hasAc: false,
    hasAirSuspension: false,
    ownership: 'owned',
    onGaragePage: true,
    soldDate: null,
    soldOdometer: null,
    soldPrice: null,
    equipment: [],
    ...overrides,
  };
}

function task(overrides: Partial<MaintenanceTask> = {}): MaintenanceTask {
  return {
    id: 't',
    vehicleId: 'v',
    name: 'Oil change',
    nameFr: null,
    intervalKm: null,
    intervalMonths: 12,
    action: 'replace',
    baselineDate: '2025-10-01',
    baselineOdometer: null,
    notes: null,
    category: null,
    switchedOff: false,
    ...overrides,
  };
}

function snapshot(data: Partial<Snapshot>): Snapshot {
  return normalizeSnapshot({ vehicles: [vehicle()], tasks: [], services: [], readings: [], ...data } as Snapshot);
}

function fakeClient() {
  const client = {
    create: vi.fn(async (_task: unknown) => `todo-${client.create.mock.calls.length}`),
    setDueDate: vi.fn(async (_id: string, _date: string): Promise<'ok' | 'gone'> => 'ok'),
    close: vi.fn(async (_id: string): Promise<'ok' | 'gone'> => 'ok'),
  };
  return client satisfies TodoistClient;
}

describe('wantedTasks', () => {
  it('lists the Tasks due soon or overdue, with their estimated date', () => {
    const wanted = wantedTasks(
      snapshot({
        tasks: [
          task({ id: 'soon', baselineDate: '2025-11-10' }),
          task({ id: 'late', name: 'Chain', baselineDate: '2025-01-01' }),
          task({ id: 'fine', baselineDate: '2026-09-01' }),
          task({ id: 'off', baselineDate: '2025-01-01', switchedOff: true }),
        ],
      }),
      TODAY,
    );
    expect(wanted.map((w) => [w.content, w.dueDate])).toEqual([
      ['Test bike · Chain', '2026-01-01'],
      ['Test bike · Oil change', '2026-11-10'],
    ]);
  });

  it('ignores sold Vehicles and starts a new key once the job is done', () => {
    const sold = snapshot({ vehicles: [vehicle({ ownership: 'sold' })], tasks: [task({ baselineDate: '2025-01-01' })] });
    expect(wantedTasks(sold, TODAY)).toEqual([]);
    const before = wantedTasks(snapshot({ tasks: [task({ baselineDate: '2025-01-01' })] }), TODAY)[0]!;
    const after = wantedTasks(
      snapshot({
        tasks: [task({ intervalMonths: 1, baselineDate: '2025-01-01' })],
        services: [{ id: 's', vehicleId: 'v', date: '2026-09-20', odometer: 1000, notes: null, kind: 'maintenance', title: null, category: null, performedBy: 'diy', totalCost: null, taskIds: ['t'], partsUsed: [] }],
      }),
      TODAY,
    )[0]!;
    expect(after.key).not.toBe(before.key);
  });
});

describe('syncTodoist', () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = openDatabase(':memory:');
  });
  const run = (client: TodoistClient, data: Snapshot, today = TODAY) => syncTodoist(db, client, DEFAULT_GARAGE_ID, data, today);

  it('creates a Todoist task once, when the Task becomes due soon', async () => {
    const client = fakeClient();
    const data = snapshot({ tasks: [task({ baselineDate: '2025-11-10' })] });
    expect(await run(client, data)).toBe(1);
    expect(client.create).toHaveBeenCalledWith(expect.objectContaining({ content: 'Test bike · Oil change', dueDate: '2026-11-10' }));
    expect(await run(client, data)).toBe(0);
    expect(client.create).toHaveBeenCalledTimes(1);
  });

  it('leaves Tasks that are fine for now out of Todoist', async () => {
    const client = fakeClient();
    await run(client, snapshot({ tasks: [task({ baselineDate: '2026-09-01' })] }));
    expect(client.create).not.toHaveBeenCalled();
  });

  it('updates the date when the estimate moves, e.g. after a new odometer reading', async () => {
    const client = fakeClient();
    const byDistance = task({ intervalKm: 5000, intervalMonths: null, baselineDate: '2026-01-01', baselineOdometer: 0 });
    const reading = (id: string, date: string, odometer: number) => ({ id, vehicleId: 'v', date, odometer });
    const first = snapshot({ tasks: [byDistance], readings: [reading('a', '2026-09-01', 4200), reading('b', '2026-10-01', 4600)] });
    const later = snapshot({ tasks: [byDistance], readings: [...first.readings, reading('c', '2026-10-20', 4700)] });
    await run(client, first);
    expect(client.create).toHaveBeenCalledWith(expect.objectContaining({ dueDate: '2026-10-31' }));
    expect(await run(client, later)).toBe(1);
    expect(client.create).toHaveBeenCalledTimes(1);
    expect(client.setDueDate).toHaveBeenCalledTimes(1);
    expect(client.setDueDate.mock.calls[0]![0]).toBe('todo-1');
    expect(client.setDueDate.mock.calls[0]![1]).not.toBe('2026-10-31');
    expect(await run(client, later)).toBe(0);
  });

  it('completes the Todoist task when the job is done, and makes a new one for the next occurrence', async () => {
    const client = fakeClient();
    await run(client, snapshot({ tasks: [task({ baselineDate: '2025-11-10' })] }));
    const done = snapshot({
      tasks: [task({ baselineDate: '2025-11-10' })],
      services: [{ id: 's', vehicleId: 'v', date: '2026-10-24', odometer: 1000, notes: null, kind: 'maintenance', title: null, category: null, performedBy: 'diy', totalCost: null, taskIds: ['t'], partsUsed: [] }],
    });
    await run(client, done);
    expect(client.close).toHaveBeenCalledWith('todo-1');
    expect(db.prepare('SELECT COUNT(*) AS n FROM todoist_tasks').get()).toEqual({ n: 0 });
    // A year later it is due soon again: a fresh Todoist task.
    await run(client, done, '2027-10-15');
    expect(client.create).toHaveBeenCalledTimes(2);
  });

  it('completes the Todoist task when the Task is paused', async () => {
    const client = fakeClient();
    await run(client, snapshot({ tasks: [task({ baselineDate: '2025-11-10' })] }));
    await run(client, snapshot({ tasks: [task({ baselineDate: '2025-11-10', switchedOff: true })] }));
    expect(client.close).toHaveBeenCalledTimes(1);
  });

  it('does not create a task again that the owner deleted in Todoist', async () => {
    const client = fakeClient();
    client.setDueDate.mockResolvedValue('gone');
    const byDistance = task({ intervalKm: 5000, intervalMonths: null, baselineDate: '2026-01-01', baselineOdometer: 0 });
    const reading = (id: string, date: string, odometer: number) => ({ id, vehicleId: 'v', date, odometer });
    const first = snapshot({ tasks: [byDistance], readings: [reading('a', '2026-09-01', 4200), reading('b', '2026-10-01', 4600)] });
    const later = snapshot({ tasks: [byDistance], readings: [...first.readings, reading('c', '2026-10-20', 4700)] });
    await run(client, first);
    await run(client, later);
    await run(client, later);
    expect(client.create).toHaveBeenCalledTimes(1);
    expect(client.setDueDate).toHaveBeenCalledTimes(1);
  });

  it('tries again on the next run when Todoist cannot be reached', async () => {
    const client = fakeClient();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    client.create.mockRejectedValueOnce(new Error('offline'));
    const data = snapshot({ tasks: [task({ baselineDate: '2025-11-10' })] });
    await run(client, data);
    expect(db.prepare('SELECT COUNT(*) AS n FROM todoist_tasks').get()).toEqual({ n: 0 });
    await run(client, data);
    expect(db.prepare('SELECT COUNT(*) AS n FROM todoist_tasks').get()).toEqual({ n: 1 });
    error.mockRestore();
  });
});

describe('todoistClient', () => {
  const answer = (status: number, body: unknown = {}) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it('creates a task with the token, the date and the project', async () => {
    const fetchImpl = answer(200, { id: '99' });
    const id = await todoistClient('secret', 'proj', fetchImpl).create({ content: 'A', description: 'B', dueDate: '2026-11-10' });
    expect(id).toBe('99');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.todoist.com/api/v1/tasks');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret');
    expect(JSON.parse(init.body as string)).toEqual({ content: 'A', description: 'B', due_date: '2026-11-10', project_id: 'proj' });
  });

  it('reports a task that no longer exists, and fails on a bad token', async () => {
    expect(await todoistClient('t', undefined, answer(404)).setDueDate('1', '2026-11-10')).toBe('gone');
    expect(await todoistClient('t', undefined, answer(400)).close('1')).toBe('gone');
    await expect(todoistClient('t', undefined, answer(401)).close('1')).rejects.toThrow('401');
  });
});
