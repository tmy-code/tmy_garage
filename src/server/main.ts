import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { todayIso } from '../shared/dates.ts';
import { createApp, readSnapshot } from './app.ts';
import { DEFAULT_GARAGE_ID, openDatabase } from './db.ts';
import { webPushSender } from './push.ts';
import { markReminderRun, reminderRunDue, sendReminders } from './reminders.ts';

// All configuration comes from the environment (set on the NAS), never from the code.
const port = Number(process.env.PORT ?? 3000);
const dataDir = resolve(process.env.DATA_DIR ?? './data');
const clientDir = resolve(process.env.CLIENT_DIR ?? './dist/client');
/** Reminders go out once a day from this hour, in the server's time zone (TZ). */
const reminderHour = Number(process.env.REMINDER_HOUR ?? 9);
/** Push services want a way to reach whoever runs the server if it misbehaves. */
const pushContact = process.env.PUSH_CONTACT ?? 'https://github.com/tmy-code/tmy_garage';
/** How often the server checks whether today's Reminders are due. */
const REMINDER_CHECK_MS = 10 * 60_000;

mkdirSync(dataDir, { recursive: true });
const db = openDatabase(join(dataDir, 'garage.sqlite'), join(dataDir, 'backups'));
const push = webPushSender(join(dataDir, 'push-keys.json'), pushContact);
const app = createApp(db, undefined, { uploadsDir: join(dataDir, 'uploads'), push });

if (existsSync(clientDir)) {
  const indexHtml = readFileSync(join(clientDir, 'index.html'), 'utf8');
  app.use('/*', serveStatic({ root: clientDir }));
  // Single-page app: every other path renders the app shell.
  app.get('*', (c) => c.html(indexHtml));
}

serve({ fetch: app.fetch, port }, () => {
  console.log(`TMY Garage listening on port ${port}, data in ${dataDir}`);
});

async function checkReminders() {
  const now = new Date();
  const today = todayIso(now);
  if (!reminderRunDue(db, DEFAULT_GARAGE_ID, now, reminderHour, today)) return;
  markReminderRun(db, DEFAULT_GARAGE_ID, today);
  const delivered = await sendReminders(db, push, DEFAULT_GARAGE_ID, readSnapshot(db, DEFAULT_GARAGE_ID), today);
  if (delivered > 0) console.log(`Reminders sent to ${delivered} device(s)`);
}
const reminderTimer = setInterval(() => void checkReminders().catch(console.error), REMINDER_CHECK_MS);
void checkReminders().catch(console.error);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    clearInterval(reminderTimer);
    db.close();
    process.exit(0);
  });
}
