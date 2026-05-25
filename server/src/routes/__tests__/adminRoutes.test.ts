import { describe, expect, it } from 'vitest';
import router from '../admin';

const routeByPath = (path: string) =>
  (router as any).stack.map((layer: any) => layer.route).find((route: any) => route?.path === path);

describe('admin routes', () => {
  it('keeps the operator board behind the admin router guards', () => {
    const guardNames = (router as any).stack
      .filter((layer: any) => !layer.route)
      .map((layer: any) => layer.handle?.name)
      .filter(Boolean);

    expect(guardNames).toEqual(expect.arrayContaining(['isAuthenticated', 'isAdmin']));
    expect(routeByPath('/operator-board')).toBeTruthy();
    expect(routeByPath('/release-queue')).toBeTruthy();
  });
});
