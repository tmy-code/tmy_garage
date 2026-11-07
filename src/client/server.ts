// Where the server is. In the browser the screens come from the server itself, so the address is empty and paths
// stay relative. The Android app bundles the screens, so the address is typed once on first launch and kept on the
// phone (ADR 0003); it is never written in the code.

const KEY = 'serveur';

function stored(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

let base = stored();

/** The server's address, without a trailing slash, or '' when the screens are served by the server itself. */
export function serverAddress(): string {
  return base;
}

export function setServerAddress(address: string): void {
  base = address.trim().replace(/\/+$/, '');
  try {
    localStorage.setItem(KEY, base);
  } catch {
    // Storage refused: the address still works until the app is closed.
  }
}

/** The full address of a server path such as `/api/snapshot`. */
export function serverUrl(path: string): string {
  return `${base}${path}`;
}
