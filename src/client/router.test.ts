import { describe, expect, it } from 'vitest';
import { desktopOnlyRoute, legacyRoute, nextScroll } from './router.ts';

describe('nextScroll', () => {
  it('opens a new screen at the top', () => {
    const trail = [{ path: '/', y: 0 }];
    expect(nextScroll(trail, '/vehicles/a', 400)).toBe(0);
    expect(trail).toEqual([
      { path: '/', y: 400 },
      { path: '/vehicles/a', y: 0 },
    ]);
  });

  it('returns to where the previous screen was scrolled', () => {
    const trail = [{ path: '/', y: 0 }];
    nextScroll(trail, '/vehicles/a', 400);
    nextScroll(trail, '/vehicles/a/service', 900);
    expect(nextScroll(trail, '/vehicles/a', 250)).toBe(900);
    expect(nextScroll(trail, '/', 0)).toBe(400);
  });

  it('opens a screen visited earlier, but not just before, at the top', () => {
    const trail = [{ path: '/', y: 0 }];
    nextScroll(trail, '/vehicles/a', 0);
    nextScroll(trail, '/vehicles/a/service', 600);
    nextScroll(trail, '/vehicles/a', 300);
    expect(nextScroll(trail, '/vehicles/a/service', 300)).toBe(0);
  });
});

describe('desktopOnlyRoute', () => {
  const route = (path: string) => path.split('/').filter(Boolean);

  it('is true for the screens that only change the garage’s setup', () => {
    for (const path of [
      '/vehicles/new',
      '/vehicles/manage',
      '/vehicles/manage/v1',
      '/vehicles/v1/edit',
      '/vehicles/v1/sell',
      '/vehicles/v1/copy-tasks',
      '/vehicles/v1/setup',
      '/vehicles/v1/tasks/new',
      '/tasks/t1/edit',
      '/items/new',
      '/items/new/v1',
      '/items/item/p1',
      '/settings/parts',
      '/settings/parts/new/car',
      '/settings/parts/moto_chain',
    ]) {
      expect(desktopOnlyRoute(route(path)), path).toBe(true);
    }
  });

  it('is false for logging a Service, a reading or a fill-up, and for every read page', () => {
    for (const path of [
      '/',
      '/vehicles/v1',
      '/vehicles/v1/service',
      '/vehicles/v1/service/t1',
      '/vehicles/v1/reading',
      '/vehicles/v1/fillup',
      '/vehicles/v1/specs',
      '/vehicles/v1/items',
      '/services/s1/edit',
      '/readings/r1/edit',
      '/fillups/f1/edit',
      '/tasks/t1',
      '/items',
      '/items/vehicle/v1',
      '/settings',
      '/tools',
      '/workshop',
    ]) {
      expect(desktopOnlyRoute(route(path)), path).toBe(false);
    }
  });
});

describe('legacyRoute', () => {
  const route = (path: string) => path.split('/').filter(Boolean);

  it('moves a route from before the rename to its new address', () => {
    expect(legacyRoute(route('/parts'))).toBe('/items');
    expect(legacyRoute(route('/parts/vehicle/v1'))).toBe('/items/vehicle/v1');
    expect(legacyRoute(route('/parts/new'))).toBe('/items/new');
    expect(legacyRoute(route('/parts/new/v1'))).toBe('/items/new/v1');
    expect(legacyRoute(route('/parts/part/p1'))).toBe('/items/item/p1');
    expect(legacyRoute(route('/vehicles/v1/parts'))).toBe('/vehicles/v1/items');
  });

  it('leaves current routes and the Plan Templates screens alone', () => {
    for (const path of ['/', '/items', '/items/item/p1', '/vehicles/v1/items', '/settings/parts', '/settings/parts/new/car']) {
      expect(legacyRoute(route(path)), path).toBeNull();
    }
  });
});
