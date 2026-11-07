import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_VERSION } from '../shared/api-version.ts';
import { request, VersionError } from './api.ts';

function answer(version: string | null) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (version !== null) headers.set('x-api-version', version);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers })));
}

afterEach(() => vi.unstubAllGlobals());

describe('API version check', () => {
  it('accepts a server speaking the same version', async () => {
    answer(String(API_VERSION));
    expect(await request('GET', '/api/health')).toEqual({ ok: true });
  });

  it('asks to update the app when the server is newer', async () => {
    answer(String(API_VERSION + 1));
    await expect(request('GET', '/api/health')).rejects.toMatchObject({ behind: 'app' });
  });

  it('treats a server that sends no version as behind', async () => {
    answer(null);
    const error = await request('GET', '/api/health').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VersionError);
    expect(error).toMatchObject({ behind: 'server' });
  });
});
