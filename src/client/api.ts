import { API_VERSION, API_VERSION_HEADER } from '../shared/api-version.ts';
import { serverUrl } from './server.ts';

/** The server answered, but refused the request (validation, conflict, not found). Retrying will not help. */
export class ApiError extends Error {
  readonly status: number;
  /** A machine-readable reason, such as 'notion_owned' for a Task that Notion decides. */
  readonly code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** The server could not be reached: no signal, timeout, or the NAS is down. Retry later. */
export class NetworkError extends Error {}

/** The server speaks another version of the API: nothing is sent until the app or the server is updated. */
export class VersionError extends Error {
  /** Which side is behind: the app (the server is newer) or the server. */
  readonly behind: 'app' | 'server';
  constructor(serverVersion: number) {
    const behind = serverVersion > API_VERSION ? 'app' : 'server';
    super(behind === 'app' ? 'Update the app' : 'The server is not up to date');
    this.behind = behind;
  }
}

// Short, so a phone with one bar in the basement falls back to the offline copy quickly.
const TIMEOUT_MS = 8000;
/** A 25 MB photo or PDF needs longer than a normal request, and so does a Notion sync. */
const UPLOAD_TIMEOUT_MS = 120_000;
/** The Notion sync answers 502 or 503 when Notion or its setup is at fault: that is an answer, not a server that is down. */
const NOTION_PATH = '/api/notion/';

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  // A file upload goes as multipart form data; the browser sets its content type.
  const upload = body instanceof FormData;
  try {
    res = await fetch(serverUrl(path), {
      method,
      headers: body === undefined || upload ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : upload ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(upload || path.startsWith(NOTION_PATH) ? UPLOAD_TIMEOUT_MS : TIMEOUT_MS),
    });
  } catch {
    throw new NetworkError('Cannot reach the garage server');
  }
  if (res.status >= 500 && !path.startsWith(NOTION_PATH)) throw new NetworkError(`Server error (${res.status})`);
  // A server from before the version existed sends no header: it counts as version 0, so it is behind.
  const serverVersion = Number(res.headers.get(API_VERSION_HEADER) ?? 0);
  if (serverVersion !== API_VERSION) throw new VersionError(serverVersion);
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
    throw new ApiError(res.status, payload?.error ?? `Request failed (${res.status})`, payload?.code);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

/** Ids for records created on the phone, so the server can recognise a replayed change. */
export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  // randomUUID needs HTTPS; this fallback keeps plain-HTTP access working.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
