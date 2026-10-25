import type { DatabaseSync } from 'node:sqlite';
import { addDays, type IsoDate } from '../shared/dates.ts';
import { vehicleDue } from '../shared/due.ts';
import { expiringDocuments, nextInspection } from '../shared/inspections.ts';
import { currentTerm, isActive, renewal } from '../shared/insurance.ts';
import type { DocumentType } from '../shared/schemas.ts';
import type { Snapshot } from '../shared/types.ts';
import type { PushMessage, PushSender } from './push.ts';

/** An overdue Reminder is sent again this often until it is dealt with. */
export const OVERDUE_REPEAT_DAYS = 7;
/** Lines listed in one notification before "and N more". */
const MAX_LINES = 5;

export type ReminderStatus = 'dueSoon' | 'overdue';

export type ReminderSubject =
  | { kind: 'task'; name: string }
  | { kind: 'inspection' }
  | { kind: 'document'; title: string | null; type: DocumentType }
  | { kind: 'renewal'; insurer: string; policyId: string };

export interface Reminder {
  /** Names one occurrence: doing the job, passing the inspection or renewing starts a new key, so the next one is reminded too. */
  key: string;
  status: ReminderStatus;
  vehicleId: string | null;
  subject: ReminderSubject;
  dueDate: IsoDate | null;
}

/** Everything due soon or overdue today: the same items the dashboard flags. */
export function currentReminders(snapshot: Snapshot, today: IsoDate): Reminder[] {
  const reminders: Reminder[] = [];
  for (const vehicle of snapshot.vehicles.filter((v) => v.status === 'owned')) {
    for (const d of vehicleDue(snapshot, vehicle.id, today).due) {
      if (d.status !== 'overdue' && d.status !== 'dueSoon') continue;
      const name = snapshot.tasks.find((t) => t.id === d.taskId)?.name ?? '';
      reminders.push({
        key: `task:${d.taskId}:${d.lastDone?.date ?? ''}`,
        status: d.status,
        vehicleId: vehicle.id,
        subject: { kind: 'task', name },
        dueDate: d.dueDate,
      });
    }
    const inspection = nextInspection(snapshot, vehicle, today);
    if (inspection.status === 'overdue' || inspection.status === 'dueSoon') {
      reminders.push({
        key: `inspection:${vehicle.id}:${inspection.last?.id ?? 'first'}`,
        status: inspection.status,
        vehicleId: vehicle.id,
        subject: { kind: 'inspection' },
        dueDate: inspection.dueDate,
      });
    }
    for (const doc of expiringDocuments(snapshot, vehicle.id, today)) {
      reminders.push({
        key: `document:${doc.id}:${doc.expiryDate}`,
        status: doc.expiryDate! < today ? 'overdue' : 'dueSoon',
        vehicleId: vehicle.id,
        subject: { kind: 'document', title: doc.title, type: doc.type },
        dueDate: doc.expiryDate,
      });
    }
  }
  for (const policy of snapshot.policies) {
    const due = renewal(policy, today);
    if (!due || due.status === 'ok') continue;
    const covers = (isActive(policy, today) ? currentTerm(policy, today)?.covers : undefined) ?? [];
    reminders.push({
      key: `renewal:${policy.id}:${due.date}`,
      status: due.status,
      vehicleId: covers.length === 1 ? covers[0]!.vehicleId : null,
      subject: { kind: 'renewal', insurer: policy.insurer, policyId: policy.id },
      dueDate: due.date,
    });
  }
  return reminders;
}

export interface SentReminder {
  key: string;
  status: ReminderStatus;
  sentOn: IsoDate;
}

/** The Reminders not sent yet in their current status, plus overdue ones last sent a week ago or more. */
export function remindersToSend(current: Reminder[], sent: SentReminder[], today: IsoDate): Reminder[] {
  const repeatBefore = addDays(today, -OVERDUE_REPEAT_DAYS + 1);
  return current.filter((r) => {
    const previous = sent.find((s) => s.key === r.key && s.status === r.status);
    return !previous || (r.status === 'overdue' && previous.sentOn < repeatBefore);
  });
}

// Notifications are written on the server, so they carry their own small dictionary.
const TEXT = {
  en: {
    locale: 'en-GB',
    colon: ': ',
    many: (n: number) => `${n} reminders`,
    more: (n: number) => `and ${n} more`,
    inspection: 'Technical inspection',
    renewal: (insurer: string) => `Insurance renewal (${insurer})`,
    due: (date: string | null) => (date ? `due ${date}` : 'due soon'),
    overdue: (date: string | null) => (date ? `overdue since ${date}` : 'overdue'),
    expires: (date: string) => `expires ${date}`,
    expired: (date: string) => `expired ${date}`,
    renews: (date: string) => `renews ${date}`,
    renewalPassed: (date: string) => `renewed ${date}: record the new term`,
    test: { title: 'Reminders are on', body: 'This device will be told when something becomes due soon or overdue.' },
    types: {
      registration: 'Registration certificate',
      invoice: 'Invoice or receipt',
      inspectionReport: 'Inspection report',
      manual: 'Manual',
      photo: 'Photo',
      policySchedule: 'Policy schedule',
      insuranceCertificate: 'Proof of insurance',
      claimsStatement: 'Relevé d’information',
      claimReport: 'Claim paperwork',
      other: 'Document',
    } satisfies Record<DocumentType, string>,
  },
  fr: {
    locale: 'fr-FR',
    colon: ' : ',
    many: (n: number) => `${n} rappels`,
    more: (n: number) => `et ${n} de plus`,
    inspection: 'Contrôle technique',
    renewal: (insurer: string) => `Échéance d’assurance (${insurer})`,
    due: (date: string | null) => (date ? `à faire avant le ${date}` : 'bientôt'),
    overdue: (date: string | null) => (date ? `en retard depuis le ${date}` : 'en retard'),
    expires: (date: string) => `expire le ${date}`,
    expired: (date: string) => `expiré le ${date}`,
    renews: (date: string) => `échéance le ${date}`,
    renewalPassed: (date: string) => `échéance passée le ${date} : saisissez la nouvelle période`,
    test: { title: 'Rappels activés', body: 'Cet appareil sera prévenu quand quelque chose arrive à échéance ou est en retard.' },
    types: {
      registration: 'Carte grise',
      invoice: 'Facture ou ticket',
      inspectionReport: 'Procès-verbal de contrôle',
      manual: 'Manuel',
      photo: 'Photo',
      policySchedule: 'Conditions particulières',
      insuranceCertificate: 'Mémo véhicule assuré',
      claimsStatement: 'Relevé d’information',
      claimReport: 'Papiers de sinistre',
      other: 'Document',
    } satisfies Record<DocumentType, string>,
  },
};

export type ReminderLang = keyof typeof TEXT;

/** "1 Feb", with the year only when it is not this year's. */
function formatDay(date: IsoDate, locale: string, today: IsoDate): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: date.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric',
    timeZone: 'UTC',
  }).format(Date.UTC(y, m - 1, d));
}

function subjectLabel(subject: ReminderSubject, text: (typeof TEXT)[ReminderLang]): string {
  switch (subject.kind) {
    case 'task':
      return subject.name;
    case 'inspection':
      return text.inspection;
    case 'document':
      return subject.title ?? text.types[subject.type];
    case 'renewal':
      return text.renewal(subject.insurer);
  }
}

function whenLabel(r: Reminder, text: (typeof TEXT)[ReminderLang], today: IsoDate): string {
  const date = r.dueDate ? formatDay(r.dueDate, text.locale, today) : null;
  if (r.subject.kind === 'document' && date) return r.status === 'overdue' ? text.expired(date) : text.expires(date);
  if (r.subject.kind === 'renewal' && date) return r.status === 'overdue' ? text.renewalPassed(date) : text.renews(date);
  return r.status === 'overdue' ? text.overdue(date) : text.due(date);
}

/** One notification listing the Reminders, overdue first; tapping it opens the page that deals with them. */
export function reminderMessage(reminders: Reminder[], snapshot: Snapshot, lang: ReminderLang, today: IsoDate): PushMessage {
  const text = TEXT[lang];
  const sorted = [...reminders].sort((a, b) => (a.status === b.status ? 0 : a.status === 'overdue' ? -1 : 1));
  const vehicleName = (id: string | null) => snapshot.vehicles.find((v) => v.id === id)?.name ?? null;
  const vehicles = new Set(sorted.map((r) => r.vehicleId));
  const only = sorted.length === 1 ? sorted[0]! : null;

  let url = '/#/';
  if (only?.subject.kind === 'renewal') url = `/#/policies/${only.subject.policyId}`;
  else if (vehicles.size === 1 && sorted[0]!.vehicleId) url = `/#/vehicles/${sorted[0]!.vehicleId}`;

  if (only) {
    const vehicle = vehicleName(only.vehicleId);
    const label = subjectLabel(only.subject, text);
    return { title: vehicle ? `${vehicle} · ${label}` : label, body: whenLabel(only, text, today), url };
  }
  const lines = sorted.slice(0, MAX_LINES).map((r) => {
    const vehicle = vehicleName(r.vehicleId);
    return `${vehicle ? `${vehicle} · ` : ''}${subjectLabel(r.subject, text)}${text.colon}${whenLabel(r, text, today)}`;
  });
  if (sorted.length > MAX_LINES) lines.push(text.more(sorted.length - MAX_LINES));
  const single = vehicles.size === 1 ? vehicleName(sorted[0]!.vehicleId) : null;
  return { title: single ? `${single} · ${text.many(sorted.length)}` : text.many(sorted.length), body: lines.join('\n'), url };
}

export function testMessage(lang: ReminderLang): PushMessage {
  return { ...TEXT[lang].test, url: '/#/reminders' };
}

/**
 * Sends one Garage's new Reminders to each of its devices, in the device's language, and records them as sent.
 * Nothing is recorded when the Garage has no device yet, so a device subscribed later still hears about everything due.
 */
export async function sendReminders(
  db: DatabaseSync,
  sender: PushSender,
  garageId: string,
  snapshot: Snapshot,
  today: IsoDate,
): Promise<number> {
  const devices = db.prepare('SELECT * FROM push_subscriptions WHERE garage_id = ?').all(garageId) as {
    endpoint: string;
    p256dh: string;
    auth: string;
    lang: ReminderLang;
  }[];
  if (devices.length === 0) return 0;
  const sent = db
    .prepare('SELECT key, status, sent_on AS sentOn FROM reminders_sent WHERE garage_id = ?')
    .all(garageId) as unknown as SentReminder[];
  const due = remindersToSend(currentReminders(snapshot, today), sent, today);
  if (due.length === 0) return 0;

  let delivered = 0;
  for (const device of devices) {
    try {
      const result = await sender.send(device, reminderMessage(due, snapshot, device.lang, today));
      if (result === 'gone') db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(device.endpoint);
      else delivered++;
    } catch (error) {
      console.error('Push notification failed', error);
    }
  }
  // When no device could be reached, try again on the next run.
  if (delivered > 0) {
    const record = db.prepare(
      `INSERT INTO reminders_sent (garage_id, key, status, sent_on) VALUES (?, ?, ?, ?)
       ON CONFLICT (garage_id, key, status) DO UPDATE SET sent_on = excluded.sent_on`,
    );
    for (const r of due) record.run(garageId, r.key, r.status, today);
  }
  return delivered;
}

/** Whether today's Reminders still have to go out: once a day, from the given hour of the server's local time. */
export function reminderRunDue(db: DatabaseSync, garageId: string, now: Date, hour: number, today: IsoDate): boolean {
  if (now.getHours() < hour) return false;
  const row = db.prepare('SELECT last_date FROM reminder_runs WHERE garage_id = ?').get(garageId) as { last_date: string } | undefined;
  return row?.last_date !== today;
}

export function markReminderRun(db: DatabaseSync, garageId: string, today: IsoDate): void {
  db.prepare(
    `INSERT INTO reminder_runs (garage_id, last_date) VALUES (?, ?)
     ON CONFLICT (garage_id) DO UPDATE SET last_date = excluded.last_date`,
  ).run(garageId, today);
}
