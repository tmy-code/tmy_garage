import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { todayIso } from '../shared/dates.ts';
import { createApp, readSnapshot } from './app.ts';
import { DEFAULT_GARAGE_ID, openDatabase } from './db.ts';
import { syncTodoist, todoistClient } from './todoist.ts';

// All configuration comes from the environment (set on the NAS), never from the code.
const port = Number(process.env.PORT ?? 3000);
const dataDir = resolve(process.env.DATA_DIR ?? './data');
const clientDir = resolve(process.env.CLIENT_DIR ?? './dist/client');
/** Todoist personal API token; without it the Todoist sync is off. */
const todoistToken = process.env.TODOIST_API_TOKEN;
/** Todoist project for the tasks; the Inbox when not set. */
const todoistProject = process.env.TODOIST_PROJECT_ID;
/** How often the logbook is compared with Todoist. Todoist is only called when something changed. */
const TODOIST_SYNC_MS = 10 * 60_000;

mkdirSync(dataDir, { recursive: true });
const db = openDatabase(join(dataDir, 'garage.sqlite'), join(dataDir, 'backups'));
const app = createApp(db, undefined, { uploadsDir: join(dataDir, 'uploads') });

if (existsSync(clientDir)) {
  const indexHtml = readFileSync(join(clientDir, 'index.html'), 'utf8');
  app.use('/*', serveStatic({ root: clientDir }));
  // Single-page app: every other path renders the app shell.
  app.get('*', (c) => c.html(indexHtml));
}

serve({ fetch: app.fetch, port }, () => {
  console.log(`tmy_garage listening on port ${port}, data in ${dataDir}`);
});

let todoistTimer: NodeJS.Timeout | undefined;
if (todoistToken) {
  const todoist = todoistClient(todoistToken, todoistProject);
  const run = () => {
    const today = todayIso(new Date());
    return syncTodoist(db, todoist, DEFAULT_GARAGE_ID, readSnapshot(db, DEFAULT_GARAGE_ID), today)
      .then((calls) => (calls > 0 ? console.log(`Todoist: ${calls} change(s) sent`) : undefined))
      .catch(console.error);
  };
  todoistTimer = setInterval(() => void run(), TODOIST_SYNC_MS);
  void run();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    clearInterval(todoistTimer);
    db.close();
    process.exit(0);
  });
}
