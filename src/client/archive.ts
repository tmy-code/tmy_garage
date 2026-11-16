// Filing a Receipt's Archive copy in the owner's Proton Drive folder (ADR 0010).
// Proton has no API: the desktop browser writes into the folder the Proton Drive client already syncs on the PC.
// Needs a Chromium browser (File System Access API); the picked folder is remembered in IndexedDB.

import { joinArchivePath, pathParts, uniqueFileName } from '../shared/archive-name.ts';

/** The subfolder of a Vehicle's Archive folder where Receipts go. */
export const RECEIPT_SUBFOLDER = 'Entretien';

type Handle = FileSystemDirectoryHandle & {
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
};

export const archiveSupported = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

const DB_NAME = 'tmy-garage-archive';
const STORE = 'handles';
const KEY = 'proton-root';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readRoot(): Promise<Handle | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(KEY);
      request.onsuccess = () => resolve((request.result as Handle | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

async function saveRoot(handle: Handle): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(handle, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Whether a Proton folder was picked on this browser before. */
export async function hasArchiveRoot(): Promise<boolean> {
  return (await readRoot()) !== null;
}

/** Asks the owner to pick the Proton Drive folder (the one that holds `10-19 …`, `30-39 …`), and remembers it. */
export async function chooseArchiveRoot(): Promise<void> {
  const picker = (window as unknown as { showDirectoryPicker(options: { mode: 'readwrite'; id: string }): Promise<Handle> }).showDirectoryPicker;
  await saveRoot(await picker.call(window, { mode: 'readwrite', id: 'proton-root' }));
}

/** The remembered folder, once the browser has (re)granted write access; must run from a click. */
async function writableRoot(): Promise<Handle> {
  const root = await readRoot();
  if (!root) throw new ArchiveError('no-root');
  const options = { mode: 'readwrite' } as const;
  if ((await root.queryPermission(options)) !== 'granted' && (await root.requestPermission(options)) !== 'granted') {
    throw new ArchiveError('no-permission');
  }
  return root;
}

/** Asks the browser for write access now; call it from a click, before any slow step, so the permission prompt is allowed. */
export async function ensureArchiveAccess(): Promise<void> {
  await writableRoot();
}

export class ArchiveError extends Error {
  readonly reason: 'no-root' | 'no-permission' | 'not-found' | 'write-failed';
  constructor(reason: 'no-root' | 'no-permission' | 'not-found' | 'write-failed') {
    super(reason);
    this.reason = reason;
  }
}

/**
 * Files `file` as `<folder>/Entretien/<name>`, making the Entretien folder if it is missing and never overwriting
 * (an existing name gets `-2`). The Vehicle's own folder must already exist: a typo there would otherwise make a stray tree.
 * Returns the path relative to the Proton folder, with forward slashes.
 */
export async function fileReceipt(file: Blob, folder: string, name: string): Promise<string> {
  const root = await writableRoot();
  try {
    let dir: FileSystemDirectoryHandle = root;
    for (const part of pathParts(folder)) dir = await dir.getDirectoryHandle(part);
    dir = await dir.getDirectoryHandle(RECEIPT_SUBFOLDER, { create: true });
    const taken: string[] = [];
    for await (const entry of (dir as unknown as { values(): AsyncIterable<{ name: string }> }).values()) taken.push(entry.name);
    const finalName = uniqueFileName(name, taken);
    const writable = await (await dir.getFileHandle(finalName, { create: true })).createWritable();
    await writable.write(file);
    await writable.close();
    return joinArchivePath(folder, RECEIPT_SUBFOLDER, finalName);
  } catch (error) {
    if (error instanceof ArchiveError) throw error;
    if (error instanceof DOMException && error.name === 'NotFoundError') throw new ArchiveError('not-found');
    throw new ArchiveError('write-failed');
  }
}
