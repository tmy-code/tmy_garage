import { useSyncExternalStore } from 'react';
import { LANGS, MESSAGES, messagesFor, type Lang, type Messages } from '../shared/messages.ts';

// The messages live in shared/messages.ts so the server image can use them without React.
export { LANGS, messagesFor };
export type { Lang, Messages };

const STORAGE_KEY = 'lang';

// The choice is a per-device convenience, so localStorage is enough; it may be unavailable (private mode).
function detect(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'fr') return saved;
  } catch {
    // fall through to the device language
  }
  const preferred = typeof navigator !== 'undefined' ? (navigator.languages ?? [navigator.language]) : [];
  return preferred.some((l) => l?.toLowerCase().startsWith('fr')) ? 'fr' : 'en';
}

let current: Lang = typeof window !== 'undefined' ? detect() : 'en';
const listeners = new Set<() => void>();

if (typeof document !== 'undefined') document.documentElement.lang = current;

export function setLang(lang: Lang): void {
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // the choice then lasts until the app is closed
  }
  document.documentElement.lang = lang;
  listeners.forEach((l) => l());
}

export function getLang(): Lang {
  return current;
}

/** The current language's messages, for code outside components (formatting helpers). */
export function messages(): Messages {
  return MESSAGES[current];
}


/** Messages for the current language; re-renders the component when the language changes. */
export function useT(): Messages {
  const lang = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
  return MESSAGES[lang];
}
