import { describe, expect, it } from 'vitest';
import type {
  Vehicle,
} from '../shared/types.ts';
import { API_VERSION } from '../shared/api-version.ts';
import { ANDROID_APP_ORIGIN, createApp } from './app.ts';
import { db, app, call, createVehicle, snapshot, setupGarage } from './test-helpers.ts';

setupGarage();

describe('garage isolation', () => {
  it('never shows another Garage’s vehicles', async () => {
    db.prepare(`INSERT INTO garages (id, name) VALUES ('friend', 'Friend')`).run();
    const friendApp = createApp(db, 'friend');
    await createVehicle('Mine');
    const res = await friendApp.request('/api/snapshot');
    expect((await res.json()).vehicles).toEqual([]);
  });
});

describe('Android app access', () => {
  it('tells every answer which API version it speaks, errors included', async () => {
    const ok = await app.request('/api/health');
    expect(ok.headers.get('x-api-version')).toBe(String(API_VERSION));
    const missing = await app.request('/api/vehicles/nope', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: 'not json' });
    expect(missing.status).toBeGreaterThanOrEqual(400);
    expect(missing.status).toBeLessThan(500);
    expect(missing.headers.get('x-api-version')).toBe(String(API_VERSION));
  });

  it('lets the Android app call the API and read the version', async () => {
    const preflight = await app.request('/api/services/x', {
      method: 'OPTIONS',
      headers: { origin: ANDROID_APP_ORIGIN, 'access-control-request-method': 'PUT', 'access-control-request-headers': 'content-type' },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(ANDROID_APP_ORIGIN);
    const res = await app.request('/api/snapshot', { headers: { origin: ANDROID_APP_ORIGIN } });
    expect(res.headers.get('access-control-allow-origin')).toBe(ANDROID_APP_ORIGIN);
    expect(res.headers.get('access-control-expose-headers')).toContain('x-api-version');
  });

  it('does not open the API to other websites', async () => {
    const res = await app.request('/api/snapshot', { headers: { origin: 'https://example.com' } });
    expect(res.headers.get('access-control-allow-origin')).not.toBe('https://example.com');
  });
});
