import { describe, expect, it } from 'vitest';
import { nextScroll } from './router.ts';

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
