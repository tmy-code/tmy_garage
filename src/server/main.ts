import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from './app.ts';
import { openDatabase } from './db.ts';

// All configuration comes from the environment (set on the NAS), never from the code.
const port = Number(process.env.PORT ?? 3000);
const dataDir = resolve(process.env.DATA_DIR ?? './data');
const clientDir = resolve(process.env.CLIENT_DIR ?? './dist/client');

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
  console.log(`TMY Garage listening on port ${port}, data in ${dataDir}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    db.close();
    process.exit(0);
  });
}
