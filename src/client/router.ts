import { useSyncExternalStore } from 'react';

// Hash routes ("#/vehicles/abc") need no server configuration and work from the offline cache.
function currentPath(): string {
  return window.location.hash.replace(/^#/, '') || '/';
}

export function useRoute(): string[] {
  const path = useSyncExternalStore(
    (listener) => {
      window.addEventListener('hashchange', listener);
      return () => window.removeEventListener('hashchange', listener);
    },
    currentPath,
  );
  return path.split('/').filter(Boolean);
}

export function navigate(path: string, { replace = false } = {}): void {
  if (replace) window.location.replace(`#${path}`);
  else window.location.hash = path;
}

export function goBack(fallback: string): void {
  if (window.history.length > 1) window.history.back();
  else navigate(fallback, { replace: true });
}
