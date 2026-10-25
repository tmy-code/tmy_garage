/** The server answered, but refused the request (validation, conflict, not found). Retrying will not help. */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** The server could not be reached: no signal, timeout, or the NAS is down. Retry later. */
export class NetworkError extends Error {}

// Short, so a phone with one bar in the basement falls back to the offline copy quickly.
const TIMEOUT_MS = 8000;
/** A 25 MB photo or PDF needs longer than a normal request. */
const UPLOAD_TIMEOUT_MS = 120_000;

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  // A file upload goes as multipart form data; the browser sets its content type.
  const upload = body instanceof FormData;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined || upload ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : upload ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(upload ? UPLOAD_TIMEOUT_MS : TIMEOUT_MS),
    });
  } catch {
    throw new NetworkError('Cannot reach the garage server');
  }
  if (res.status >= 500) throw new NetworkError(`Server error (${res.status})`);
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, payload?.error ?? `Request failed (${res.status})`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

/** Ids for records created on the phone, so the server can recognise a replayed change. */
export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  // randomUUID needs HTTPS; this fallback keeps plain-HTTP access working.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
