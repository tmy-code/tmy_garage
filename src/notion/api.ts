// A thin client for the Notion API: one request at a time, paced under Notion's rate limit, retried when it says so.

const BASE = 'https://api.notion.com/v1';
/** The version that brought data sources; databases hold one data source each here. */
const NOTION_VERSION = '2025-09-03';
/** Notion allows about three requests a second. */
const MIN_GAP_MS = 350;
const MAX_ATTEMPTS = 5;

export class NotionError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class NotionApi {
  private last = 0;
  requests = 0;

  private readonly token: string;

  constructor(token: string) {
    this.token = token;
  }

  async call<T = any>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const wait = this.last + MIN_GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);
      this.last = Date.now();
      this.requests++;
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (res.ok) return (await res.json()) as T;
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * attempt);
        continue;
      }
      const detail = await res.text();
      throw new NotionError(res.status, `Notion ${method} ${path} failed (${res.status}): ${detail}`);
    }
  }

  /** Every result of a paginated GET or POST endpoint. */
  async all<T = any>(method: 'GET' | 'POST', path: string, body: Record<string, unknown> = {}): Promise<T[]> {
    const results: T[] = [];
    let cursor: string | undefined;
    do {
      const page =
        method === 'GET'
          ? await this.call('GET', `${path}?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`)
          : await this.call('POST', path, { ...body, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
      results.push(...page.results);
      cursor = page.has_more ? page.next_cursor : undefined;
    } while (cursor);
    return results;
  }
}
