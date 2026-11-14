// A fake Notion workspace for tests: databases with their columns and pages, and a record of every write. No network and
// no real ids. It answers the calls the engine and the spec writers make, and echoes a created or changed page back the
// way Notion does (property values as typed objects), so what the app stores can be checked against what it sent.
import { REFERENCE_DBS, VEHICLES } from './databases.ts';
import type { NotionClient } from './engine.ts';

export interface FakeColumn {
  type: string;
  options?: string[];
}

export interface FakeDb {
  id: string;
  title: string;
  properties: Record<string, FakeColumn>;
  pages: any[];
}

export interface FakeWrite {
  method: string;
  path: string;
  body: any;
}

export const text = (s: string) => [{ plain_text: s }];
export const titleValue = (s: string) => ({ type: 'title', title: text(s) });
export const richValue = (s: string) => ({ type: 'rich_text', rich_text: s ? text(s) : [] });
export const numberValue = (n: number | null) => ({ type: 'number', number: n });
export const selectValue = (name: string | null) => ({ type: 'select', select: name === null ? null : { name } });
export const relationValue = (...ids: string[]) => ({ type: 'relation', relation: ids.map((id) => ({ id })) });
export const checkboxValue = (checkbox: boolean) => ({ type: 'checkbox', checkbox });
export const multiValue = (...names: string[]) => ({ type: 'multi_select', multi_select: names.map((name) => ({ name })) });

/** A property value as the app sends it, read back as Notion returns it. */
function echo(type: string, sent: any): any {
  switch (type) {
    case 'title':
      return { type, title: (sent.title as any[]).map((t) => ({ plain_text: t.text.content })) };
    case 'rich_text':
      return { type, rich_text: (sent.rich_text as any[]).map((t) => ({ plain_text: t.text.content })) };
    case 'number':
      return { type, number: sent.number };
    case 'select':
      return { type, select: sent.select };
    case 'relation':
      return { type, relation: sent.relation };
    case 'checkbox':
      return { type, checkbox: sent.checkbox };
    default:
      throw new Error(`The fake does not echo a ${type} column`);
  }
}

/** Every hand-made database of the owner, empty, with their columns typed as the app expects (the first accepted type). */
export function referenceDatabases(): FakeDb[] {
  return REFERENCE_DBS.map((d) => ({
    id: `db-${d.key}`,
    title: d.title,
    properties: Object.fromEntries([...d.required, ...d.optional].map((c) => [c.name, { type: c.types[0]! } as FakeColumn])),
    pages: [],
  }));
}

/** The app's Véhicules database with the pages given: [Notion page id, the app's vehicle id]. */
export function vehiclesDatabase(pages: [string, string][] = []): FakeDb {
  return {
    id: 'db-vehicles',
    title: VEHICLES.title,
    properties: { Nom: { type: 'title' }, 'ID app': { type: 'rich_text' }, 'Supprimé de l’app': { type: 'checkbox' }, Équipements: { type: 'multi_select' } },
    pages: pages.map(([id, appId]) => ({
      id,
      properties: { Nom: titleValue(appId), 'ID app': richValue(appId), 'Supprimé de l’app': checkboxValue(false), Équipements: multiValue() },
    })),
  };
}

export function fakeNotion(databases: FakeDb[], options: { failWrite?: (write: FakeWrite) => Error | undefined } = {}) {
  const writes: FakeWrite[] = [];
  let created = 0;
  const dbOfSource = (id: string) => databases.find((d) => `ds-${d.id}` === id)!;
  const findPage = (id: string) => {
    for (const d of databases) {
      const page = d.pages.find((p) => p.id === id);
      if (page) return { db: d, page };
    }
    throw new Error(`Unknown page ${id}`);
  };

  const client = {
    async call(method: string, path: string, body?: any) {
      if (method === 'GET') {
        const database = path.match(/^\/databases\/(.+)$/);
        if (database) return { data_sources: [{ id: `ds-${database[1]}` }] };
        const source = path.match(/^\/data_sources\/(.+)$/);
        if (source) {
          return {
            properties: Object.fromEntries(
              Object.entries(dbOfSource(source[1]!).properties).map(([name, c]) => [
                name,
                { type: c.type, ...(c.type === 'select' ? { select: { options: (c.options ?? []).map((o) => ({ name: o })) } } : {}) },
              ]),
            ),
          };
        }
        const page = path.match(/^\/pages\/(.+)$/);
        if (page) return findPage(page[1]!).page;
        throw new Error(`Unexpected GET ${path}`);
      }
      const write = { method, path, body };
      const failure = options.failWrite?.(write);
      if (failure) throw failure;
      writes.push(write);
      if (method === 'POST' && path === '/pages') {
        const db = dbOfSource(body.parent.data_source_id);
        const properties = Object.fromEntries(
          Object.entries(db.properties).map(([name, c]) => [name, name in body.properties ? echo(c.type, body.properties[name]) : emptyValue(c.type)]),
        );
        const page = { id: `page-new-${++created}`, in_trash: false, properties };
        db.pages.push(page);
        return page;
      }
      const patch = path.match(/^\/pages\/(.+)$/);
      if (method === 'PATCH' && patch) {
        const { db, page } = findPage(patch[1]!);
        if (body.in_trash !== undefined) page.in_trash = body.in_trash;
        for (const [name, value] of Object.entries(body.properties ?? {})) page.properties[name] = echo(db.properties[name]!.type, value);
        return page;
      }
      throw new Error(`Unexpected ${method} ${path}`);
    },
    async all(method: string, path: string) {
      if (method === 'GET') return databases.map((d) => ({ type: 'child_database', id: d.id, child_database: { title: d.title } }));
      const source = path.match(/^\/data_sources\/(.+)\/query$/);
      return dbOfSource(source![1]!).pages.filter((p) => p.in_trash !== true);
    },
  } as unknown as NotionClient;

  return { client, writes, databases };
}

function emptyValue(type: string): any {
  switch (type) {
    case 'title':
      return titleValue('');
    case 'rich_text':
      return richValue('');
    case 'number':
      return numberValue(null);
    case 'select':
      return selectValue(null);
    case 'relation':
      return relationValue();
    default:
      return { type };
  }
}
