import { describe, expect, it } from 'vitest';
import router from '../config';

const routesByPath = (path: string) =>
  (router as any).stack.map((layer: any) => layer.route).filter((route: any) => route?.path === path);

const routeHandlerNames = (path: string): string[] =>
  routesByPath(path)
    .flatMap((route: any) => route.stack)
    .map((layer: any) => layer.handle?.name)
    .filter(Boolean);

describe('config routes', () => {
  it('keeps public config reads on GET and cache refreshes on admin-only POST', () => {
    const refreshRoutes = routesByPath('/refresh');
    expect(refreshRoutes).toHaveLength(1);
    expect(refreshRoutes[0].methods).toMatchObject({ post: true });
    expect(refreshRoutes[0].methods.get).toBeUndefined();
    expect(routeHandlerNames('/refresh')).toContain('isAuthenticated');
    expect(routeHandlerNames('/refresh')).toContain('isAdmin');
  });
});
