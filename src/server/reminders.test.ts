import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { Hono } from 'hono';
import { todayIso } from '../shared/dates.ts';
import type { MaintenanceTask, Snapshot, Vehicle } from '../shared/types.ts';
import { normalizeSnapshot } from '../shared/workshop.ts';
import { createApp, readSnapshot } from './app.ts';
import { openDatabase } from './db.ts';
import type { PushMessage, PushSender, StoredSubscription } from './push.ts';
import { currentReminders, reminderMessage, reminderRunDue, markReminderRun, remindersToSend, sendReminders } from './reminders.ts';

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
    status: 'owned',
    onGaragePage: true,
    soldDate: null,
    soldOdometer: null,
    soldPrice: null,
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

describe('currentReminders', () => {
  it('lists what the dashboard flags: the Tasks due soon or overdue', () => {
    const reminders = currentReminders(
      snapshot({
        tasks: [
          task({ id: 'soon', baselineDate: '2025-11-10' }),
          task({ id: 'late', name: 'Chain', baselineDate: '2025-01-01' }),
          task({ id: 'fine', baselineDate: '2026-09-01' }),
        ],
      }),
      TODAY,
    );
    expect(reminders.map((r) => [r.subject.kind, r.status, r.dueDate])).toEqual([
      ['task', 'overdue', '2026-01-01'],
      ['task', 'dueSoon', '2026-11-10'],
    ]);
  });

  it('starts a new key once the job is done, and ignores sold Vehicles', () => {
    const before = currentReminders(snapshot({ tasks: [task({ baselineDate: '2025-01-01' })] }), TODAY)[0]!;
    const after = currentReminders(
      snapshot({
        tasks: [task({ intervalMonths: 1, baselineDate: '2025-01-01' })],
        services: [{ id: 's', vehicleId: 'v', date: '2026-09-20', odometer: 1000, notes: null, kind: 'maintenance', title: null, category: null, performedBy: 'diy', totalCost: null, taskIds: ['t'], partsUsed: [] }],
      }),
      TODAY,
    )[0]!;
    expect(after.key).not.toBe(before.key);
    const sold = snapshot({ vehicles: [vehicle({ status: 'sold' })], tasks: [task({ baselineDate: '2025-01-01' })] });
    expect(currentReminders(sold, TODAY)).toEqual([]);
  });
});

describe('remindersToSend', () => {
  const [soon] = currentReminders(snapshot({ tasks: [task({ baselineDate: '2025-11-10' })] }), TODAY);
  const [late] = currentReminders(snapshot({ tasks: [task({ baselineDate: '2025-01-01' })] }), TODAY);

  it('sends each Reminder once per status', () => {
    expect(remindersToSend([soon!], [], TODAY)).toEqual([soon]);
    expect(remindersToSend([soon!], [{ key: soon!.key, status: 'dueSoon', sentOn: '2026-10-01' }], TODAY)).toEqual([]);
    // Becoming overdue is news even if "due soon" was sent.
    expect(remindersToSend([late!], [{ key: late!.key, status: 'dueSoon', sentOn: '2026-10-24' }], TODAY)).toEqual([late]);
  });

  it('repeats an overdue Reminder after a week', () => {
    expect(remindersToSend([late!], [{ key: late!.key, status: 'overdue', sentOn: '2026-10-19' }], TODAY)).toEqual([]);
    expect(remindersToSend([late!], [{ key: late!.key, status: 'overdue', sentOn: '2026-10-18' }], TODAY)).toEqual([late]);
  });
});

describe('reminderMessage', () => {
  const data = snapshot({
    vehicles: [vehicle(), vehicle({ id: 'car', kind: 'car', name: 'Test car' })],
    tasks: [task({ baselineDate: '2025-01-01' }), task({ id: 't2', vehicleId: 'car', name: 'Cabin filter', baselineDate: '2025-11-10' })],
  });
  const all = currentReminders(data, TODAY);

  it('names the Vehicle and the job when there is only one, and opens its page', () => {
    expect(reminderMessage([all[0]!], data, 'en', TODAY)).toEqual({
      title: 'Test bike · Oil change',
      body: 'overdue since 1 Jan',
      url: '/#/vehicles/v',
    });
    expect(reminderMessage([all[0]!], data, 'en', '2027-02-01').body).toBe('overdue since 1 Jan 2026');
  });

  it('lists several, overdue first, and opens the dashboard when they span Vehicles', () => {
    const message = reminderMessage([...all].reverse(), data, 'en', TODAY);
    expect(message.title).toBe('2 reminders');
    expect(message.body.split('\n')).toEqual(['Test bike · Oil change: overdue since 1 Jan', 'Test car · Cabin filter: due 10 Nov']);
    expect(message.url).toBe('/#/');
    expect(reminderMessage(all, data, 'fr', TODAY).body).toMatch(/^Test bike · Oil change : en retard depuis le 1 janv\./);
  });

  it('uses a Task’s French name in French', () => {
    const named = { ...data, tasks: data.tasks.map((t) => ({ ...t, nameFr: 'Vidange' })) };
    const reminders = currentReminders(named, TODAY);
    expect(reminderMessage([reminders[0]!], named, 'fr', TODAY).title).toBe('Test bike · Vidange');
    expect(reminderMessage([reminders[0]!], named, 'en', TODAY).title).toBe('Test bike · Oil change');
  });
});

describe('sending', () => {
  let db: DatabaseSync;
  let app: Hono;
  let sent: { endpoint: string; message: PushMessage }[];
  let gone: Set<string>;
  const sender: PushSender = {
    publicKey: 'test-public-key',
    async send(subscription: StoredSubscription, message: PushMessage) {
      if (gone.has(subscription.endpoint)) return 'gone';
      sent.push({ endpoint: subscription.endpoint, message });
      return 'sent';
    },
  };
  const device = (name: string, lang = 'en') => ({
    endpoint: `https://push.example.test/${name}`,
    keys: { p256dh: 'p256dh-key', auth: 'auth-secret' },
    lang,
  });
  const call = (method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const addDevice = (endpoint: string, lang: string) =>
    db
      .prepare("INSERT INTO push_subscriptions (endpoint, garage_id, p256dh, auth, lang) VALUES (?, 'default', 'k', 'a', ?)")
      .run(endpoint, lang);

  beforeEach(async () => {
    db = openDatabase(':memory:');
    app = createApp(db, undefined, { push: sender });
    sent = [];
    gone = new Set();
    // Added directly, without the Maintenance Tasks a new vehicle starts with: the tests count Reminders for this one Task.
    db.exec(`INSERT INTO vehicles (id, garage_id, kind, name) VALUES ('v', 'default', 'motorcycle', 'Test bike')`);
    await call('POST', '/api/vehicles/v/tasks', { name: 'Oil change', intervalMonths: 12, baselineDate: '2020-01-01' });
  });

  it('gives a new device what is already due, then only what is new', async () => {
    expect((await call('PUT', '/api/push/subscription', device('phone'))).status).toBe(204);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.message.title).toBe('Test bike · Oil change');

    expect(await sendReminders(db, sender, 'default', readSnapshot(db), todayIso())).toBe(0);
    // Overdue Reminders come back a week later.
    const nextWeek = new Date(Date.now() + 7 * 86_400_000);
    expect(await sendReminders(db, sender, 'default', readSnapshot(db), todayIso(nextWeek))).toBe(1);
  });

  it('records nothing while no device is subscribed', async () => {
    expect(await sendReminders(db, sender, 'default', readSnapshot(db), TODAY)).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM reminders_sent').get()).toEqual({ n: 0 });
  });

  it('writes in each device’s language and forgets devices that unsubscribed', async () => {
    addDevice(device('fr').endpoint, 'fr');
    addDevice(device('old').endpoint, 'en');
    gone.add(device('old').endpoint);
    expect(await sendReminders(db, sender, 'default', readSnapshot(db), TODAY)).toBe(1);
    expect(sent[0]!.message.body).toMatch(/^en retard depuis le/);
    expect(db.prepare('SELECT endpoint FROM push_subscriptions').all()).toEqual([{ endpoint: device('fr').endpoint }]);
  });

  it('sends a test, unsubscribes, and refuses bad subscriptions', async () => {
    await call('PUT', '/api/push/subscription', device('phone'));
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect((await call('POST', '/api/push/test', { endpoint: device('phone').endpoint })).status).toBe(204);
    expect(sent[1]!.message).toMatchObject({ title: 'Reminders are on', url: '/#/settings' });

    expect((await call('POST', '/api/push/unsubscribe', { endpoint: device('phone').endpoint })).status).toBe(204);
    expect((await call('POST', '/api/push/test', { endpoint: device('phone').endpoint })).status).toBe(404);
    expect((await call('PUT', '/api/push/subscription', { ...device('x'), endpoint: 'http://push.example.test/x' })).status).toBe(422);
  });

  it('confirms a new device with a test when nothing is due', async () => {
    db.prepare('DELETE FROM maintenance_tasks').run();
    await call('PUT', '/api/push/subscription', device('phone', 'fr'));
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.message.title).toBe('Rappels activés');
  });

  it('is unavailable when the server has no push identity', async () => {
    expect((await createApp(db).request('/api/push')).status).toBe(503);
    expect(await (await call('GET', '/api/push')).json()).toEqual({ publicKey: 'test-public-key' });
  });

  it('runs once a day from the reminder hour', () => {
    const later = new Date(2026, 9, 25, 9, 5);
    expect(reminderRunDue(db, 'default', new Date(2026, 9, 25, 8, 30), 9, TODAY)).toBe(false);
    expect(reminderRunDue(db, 'default', later, 9, TODAY)).toBe(true);
    markReminderRun(db, 'default', TODAY);
    expect(reminderRunDue(db, 'default', later, 9, TODAY)).toBe(false);
    expect(reminderRunDue(db, 'default', new Date(2026, 9, 26, 9, 0), 9, '2026-10-26')).toBe(true);
  });
});
