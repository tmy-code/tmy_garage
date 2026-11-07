import { useSyncExternalStore } from 'react';
import { get, set } from 'idb-keyval';
import type { Snapshot } from '../shared/types.ts';
import { normalizeSnapshot } from '../shared/workshop.ts';
import { ApiError, NetworkError, request, VersionError } from './api.ts';
import { isAndroidApp } from './native.ts';
import { applyOutbox, enqueueOp, opRequest, type OutboxOp } from './outbox.ts';
import { serverAddress, setServerAddress } from './server.ts';

export interface StoreState {
  /** The last copy received from the server, kept on the phone for offline use. */
  serverSnapshot: Snapshot | null;
  /** serverSnapshot with queued changes applied: what the screens show. */
  view: Snapshot | null;
  outbox: OutboxOp[];
  /** Whether the last request reached the server. navigator.onLine is unreliable with weak signal. */
  reachable: boolean;
  /** Whether the server has been reached since the app opened; until then "synced" would be a guess. */
  contacted: boolean;
  syncing: boolean;
  /** Set when the server speaks another API version: the queue is kept, and nothing is sent until one side is updated. */
  versionMismatch: VersionError['behind'] | null;
  /** Queued changes the server refused; shown so nothing disappears silently. */
  rejected: { op: OutboxOp; reason: string }[];
  loaded: boolean;
  /** The server's address; '' in the browser, where the screens come from the server itself. */
  server: string;
}

let state: StoreState = {
  serverSnapshot: null,
  view: null,
  outbox: [],
  reachable: true,
  contacted: false,
  syncing: false,
  versionMismatch: null,
  rejected: [],
  loaded: false,
  server: serverAddress(),
};

/** The Android app does not know where the server is until its address is typed on first launch. */
export function needsServerAddress(s: StoreState = state): boolean {
  return isAndroidApp && s.server === '';
}

const listeners = new Set<() => void>();

function update(patch: Partial<StoreState>) {
  const next = { ...state, ...patch };
  if ('serverSnapshot' in patch || 'outbox' in patch) {
    next.view = next.serverSnapshot ? applyOutbox(next.serverSnapshot, next.outbox) : null;
  }
  state = next;
  listeners.forEach((l) => l());
}

export function useStore(): StoreState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

// IndexedDB can fail (private browsing, storage pressure); the app must still work online.
async function persist(key: 'snapshot' | 'outbox' | 'rejected', value: unknown) {
  try {
    await set(key, value);
  } catch (error) {
    console.warn('Could not save offline copy', error);
  }
}

async function load<T>(key: string): Promise<T | undefined> {
  try {
    return await get<T>(key);
  } catch {
    return undefined;
  }
}

async function fetchSnapshot() {
  const snapshot = await request<Snapshot>('GET', '/api/snapshot');
  update({ serverSnapshot: snapshot, reachable: true, contacted: true });
  await persist('snapshot', snapshot);
}

let flushing: Promise<void> = Promise.resolve();

/** Sends queued changes in order. Stops at the first network failure and keeps the rest for later. */
function flush(): Promise<void> {
  if (needsServerAddress()) return Promise.resolve();
  if (state.syncing) return flushing;
  flushing = flushOnce();
  return flushing;
}

async function flushOnce(): Promise<void> {
  update({ syncing: true });
  try {
    // Checks the API version before sending anything, so a queued change never reaches a server that would misread it.
    await request('GET', '/api/health');
    update({ versionMismatch: null });
    while (state.outbox.length > 0) {
      const op = state.outbox[0]!;
      const { path, body } = opRequest(op);
      try {
        await request('PUT', path, body);
      } catch (error) {
        if (error instanceof ApiError) {
          update({ rejected: [...state.rejected, { op, reason: error.message }] });
          await persist('rejected', state.rejected);
        } else {
          throw error;
        }
      }
      update({ outbox: state.outbox.filter((o) => o !== op), reachable: true });
      await persist('outbox', state.outbox);
    }
    await fetchSnapshot();
  } catch (error) {
    if (error instanceof NetworkError) update({ reachable: false });
    else if (error instanceof VersionError) update({ reachable: true, contacted: true, versionMismatch: error.behind });
    else throw error;
  } finally {
    update({ syncing: false });
  }
}

export function sync(): Promise<void> {
  return flush();
}

/** Saves a Service or Odometer Reading: shown at once, sent to the server now or when back in range. */
export async function enqueue(op: OutboxOp): Promise<void> {
  update({ outbox: enqueueOp(state.outbox, op) });
  await persist('outbox', state.outbox);
  void flush();
}

/**
 * Takes back a Service or Odometer Reading just created: dropped from the queue if not sent yet,
 * otherwise deleted on the server (which needs a connection).
 */
export async function undoCreate(op: OutboxOp): Promise<void> {
  const inFlight = state.syncing && state.outbox[0]?.data.id === op.data.id;
  if (!inFlight && state.outbox.some((o) => o.data.id === op.data.id)) {
    update({ outbox: state.outbox.filter((o) => o.data.id !== op.data.id) });
    await persist('outbox', state.outbox);
    return;
  }
  // Being sent right now: let it arrive, then delete it, so the two requests can't cross.
  if (inFlight) await flushing;
  await online('DELETE', op.kind === 'service' ? `/api/services/${op.data.id}` : `/api/odometer-readings/${op.data.id}`);
}

/** Runs a change that needs a connection (vehicle and task setup), then refreshes the offline copy. */
export async function online<T>(method: string, path: string, body?: unknown): Promise<T> {
  try {
    const result = await request<T>(method, path, body);
    update({ reachable: true });
    await flush();
    return result;
  } catch (error) {
    if (error instanceof NetworkError) update({ reachable: false });
    if (error instanceof VersionError) update({ versionMismatch: error.behind });
    throw error;
  }
}

/**
 * Checks that a garage server answers at this address with the same API version, then uses it. Throws otherwise, with
 * `notFound` as the message when nothing answers. The offline copy is kept: it is the same server, reached another way.
 */
export async function connectServer(address: string, notFound: string): Promise<void> {
  const previous = serverAddress();
  setServerAddress(address);
  try {
    await request('GET', '/api/health');
  } catch (error) {
    setServerAddress(previous);
    if (error instanceof VersionError) throw error;
    throw new Error(notFound);
  }
  update({ server: serverAddress(), versionMismatch: null });
  await flush();
}

export async function dismissRejected(): Promise<void> {
  update({ rejected: [] });
  await persist('rejected', []);
}

export async function initStore(): Promise<void> {
  const [snapshot, outbox, rejected] = await Promise.all([
    load<Snapshot>('snapshot'),
    load<OutboxOp[]>('outbox'),
    load<StoreState['rejected']>('rejected'),
  ]);
  update({ serverSnapshot: snapshot ? normalizeSnapshot(snapshot) : null, outbox: outbox ?? [], rejected: rejected ?? [], loaded: true });
  void flush();

  window.addEventListener('online', () => void flush());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void flush();
  });
  // Retry queued changes regularly while the app is open, since "online" events are unreliable.
  setInterval(() => {
    if (state.outbox.length > 0 || !state.reachable) void flush();
  }, 30_000);
}
