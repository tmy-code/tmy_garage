// npm run notion-sync: a thin command line over the Notion engine (ADR 0005 and 0007).
// The server runs the full sync (pull, apply, push) by itself; this command only pushes the deal-hunting copy by hand
// and can show what the pull would read.
// Options:
//   --dry-run       show what would be pushed, no Notion access
//   --snapshot <f>  read a saved snapshot instead of the server
//   --pull-dry-run  fetch and parse the owner's reference databases and print them with the vocabularies found; no database
import { readFile } from 'node:fs/promises';
import { messagesFor } from '../shared/messages.ts';
import { todayIso } from '../shared/dates.ts';
import type { Snapshot } from '../shared/types.ts';
import { normalizeSnapshot } from '../shared/workshop.ts';
import { NotionApi } from './api.ts';
import { buildCopy, type NotionCopy } from './copy.ts';
import { fetchReference, pushAll } from './engine.ts';

function option(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`${name} is not set. Add it to .env (see .env.example).`);
    process.exit(1);
  }
  return value;
}

async function loadSnapshot(): Promise<Snapshot> {
  const file = option('--snapshot');
  if (file) return normalizeSnapshot(JSON.parse(await readFile(file, 'utf8')) as Snapshot);
  const base = required('GARAGE_URL').replace(/\/+$/, '');
  const res = await fetch(`${base}/api/snapshot`);
  if (!res.ok) throw new Error(`The garage server answered ${res.status} for /api/snapshot.`);
  return normalizeSnapshot((await res.json()) as Snapshot);
}

function report(copy: NotionCopy): void {
  console.log(`To copy: ${copy.vehicles.length} vehicles, ${copy.items.length} items.`);
}

async function main(): Promise<void> {
  if (process.argv.includes('--pull-dry-run')) {
    const pull = await fetchReference(new NotionApi(required('NOTION_TOKEN')), required('NOTION_PARENT_PAGE_ID'));
    console.log(JSON.stringify(pull, null, 2));
    console.log('\nVocabularies found (compare with the app: Contrôle/Remplacement, Fluide/Pièce, Confirmé/À confirmer):');
    for (const [column, values] of Object.entries(pull.vocabularies)) console.log(`  ${column}: ${values.join(', ')}`);
    return;
  }

  const snapshot = await loadSnapshot();
  const copy = buildCopy(snapshot, todayIso(), messagesFor('fr'));
  report(copy);

  if (process.argv.includes('--dry-run')) {
    console.log(JSON.stringify(copy, null, 2));
    return;
  }

  const api = new NotionApi(required('NOTION_TOKEN'));
  const results = await pushAll(api, required('NOTION_PARENT_PAGE_ID'), snapshot, todayIso(), messagesFor('fr'));
  for (const [title, c] of results) {
    console.log(`${title}: ${c.created} created, ${c.updated} updated, ${c.unchanged} unchanged, ${c.removed} marked removed.`);
  }
  console.log(`Done in ${api.requests} Notion requests.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
