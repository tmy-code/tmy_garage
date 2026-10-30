import { useSyncExternalStore } from 'react';

/** A short message after an action ("Service saved"), optionally with a way to take it back. */
export interface Toast {
  id: number;
  text: string;
  undo?: { label: string; run: () => Promise<void> | void };
}

/** A question asked before a destructive action, answered in the app's own dialog. */
export interface ConfirmRequest {
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  resolve: (ok: boolean) => void;
}

interface FeedbackState {
  toast: Toast | null;
  confirm: ConfirmRequest | null;
}

let state: FeedbackState = { toast: null, confirm: null };
const listeners = new Set<() => void>();
let nextId = 1;
let timer: ReturnType<typeof setTimeout> | undefined;
/** Long enough to read and reach the Undo button. */
const TOAST_MS = 6000;

function update(patch: Partial<FeedbackState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useFeedback(): FeedbackState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

export function showToast(text: string, undo?: Toast['undo']): void {
  clearTimeout(timer);
  update({ toast: { id: nextId++, text, undo } });
  timer = setTimeout(dismissToast, TOAST_MS);
}

export function dismissToast(): void {
  clearTimeout(timer);
  update({ toast: null });
}

/** Asks in the app's dialog; resolves true when the user confirms. */
export function confirmAction(message: string, labels: { confirm: string; cancel: string }): Promise<boolean> {
  state.confirm?.resolve(false);
  return new Promise((resolve) => {
    update({
      confirm: {
        message,
        confirmLabel: labels.confirm,
        cancelLabel: labels.cancel,
        resolve: (ok) => {
          update({ confirm: null });
          resolve(ok);
        },
      },
    });
  });
}
