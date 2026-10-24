import { useSyncExternalStore } from 'react';
import { get, set } from 'idb-keyval';
import type { Snapshot } from '../shared/types.ts';
import { ApiError, NetworkError, request } from './api.ts';
import { applyOutbox, enqueueOp, opRequest, type OutboxOp } from './outbox.ts';

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
  /** Queued changes the server refused; shown so nothing disappears silently. */
  rejected: { op: OutboxOp; reason: string }[];
  loaded: boolean;
}

let state: StoreState = {
  serverSnapshot: null,
  view: null,
  outbox: [],
  reachable: true,
  contacted: false,
  syncing: false,
  rejected: [],
  loaded: false,
};

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

/** Sends queued changes in order. Stops at the first network failure and keeps the rest for later. */
async function flush(): Promise<void> {
  if (state.syncing) return;
  update({ syncing: true });
  try {
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
      update({ outbox: state.outbox.slice(1), reachable: true });
      await persist('outbox', state.outbox);
    }
    await fetchSnapshot();
  } catch (error) {
    if (error instanceof NetworkError) update({ reachable: false });
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

/** Runs a change that needs a connection (vehicle and task setup), then refreshes the offline copy. */
export async function online<T>(method: string, path: string, body?: unknown): Promise<T> {
  try {
    const result = await request<T>(method, path, body);
    update({ reachable: true });
    await flush();
    return result;
  } catch (error) {
    if (error instanceof NetworkError) update({ reachable: false });
    throw error;
  }
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
  update({ serverSnapshot: snapshot ?? null, outbox: outbox ?? [], rejected: rejected ?? [], loaded: true });
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
