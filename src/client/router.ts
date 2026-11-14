import { useSyncExternalStore } from 'react';

// Hash routes ("#/vehicles/abc") need no server configuration and work from the offline cache.
function currentPath(): string {
  return window.location.hash.replace(/^#/, '') || '/';
}

/**
 * The screens walked through, with how far each was scrolled. Returning to the screen just before
 * (back arrow, or saving a form) puts it back where it was; any other screen opens at the top.
 */
const trail: { path: string; y: number }[] = [{ path: typeof window === 'undefined' ? '/' : currentPath(), y: 0 }];
let pendingScroll = 0;

export function nextScroll(trail: { path: string; y: number }[], path: string, y: number): number {
  trail[trail.length - 1]!.y = y;
  if (trail.length >= 2 && trail[trail.length - 2]!.path === path) {
    trail.pop();
    return trail[trail.length - 1]!.y;
  }
  trail.push({ path, y: 0 });
  if (trail.length > 50) trail.shift();
  return 0;
}

// Registered before React subscribes, so the old screen's scroll position is still readable.
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    pendingScroll = nextScroll(trail, currentPath(), window.scrollY);
  });
}

/** Where the screen just opened should be scrolled to, once it has rendered. */
export function scrollForNewRoute(): number {
  return pendingScroll;
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

/**
 * Whether a screen only changes the garage's setup (vehicles, tasks, items, templates): on the phone it shows a note
 * instead (ADR 0009). Services, odometer readings and fill-ups, new or edited, and every read page stay open.
 */
export function desktopOnlyRoute(route: string[]): boolean {
  const [section, id, sub, subId] = route;
  if (section === 'vehicles') {
    if (id === 'new' || id === 'manage') return true;
    if (sub === 'edit' || sub === 'sell' || sub === 'copy-tasks' || sub === 'setup') return true;
    return sub === 'tasks' && subId === 'new';
  }
  if (section === 'tasks') return sub === 'edit';
  if (section === 'parts') return id === 'new' || id === 'part';
  if (section === 'settings') return id === 'parts';
  return false;
}

export function navigate(path: string, { replace = false } = {}): void {
  if (replace) window.location.replace(`#${path}`);
  else window.location.hash = path;
}

export function goBack(fallback: string): void {
  if (window.history.length > 1) window.history.back();
  else navigate(fallback, { replace: true });
}
