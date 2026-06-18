import { describe, expect, it, vi } from 'vitest';
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
    expect(routeHandlerNames('/refresh')).toContain('setPrivateConfigRefreshCacheHeaders');
    expect(routeHandlerNames('/refresh')).toContain('isAuthenticated');
    expect(routeHandlerNames('/refresh')).toContain('isAdmin');
  });

  it('marks admin config refresh responses as private no-store payloads', () => {
    const handler = (router as any).stack
      .map((layer: any) => layer.route)
      .find((route: any) => route?.path === '/refresh')
      .stack.find((layer: any) => layer.handle?.name === 'setPrivateConfigRefreshCacheHeaders')
      .handle;
    const res = { setHeader: vi.fn() };
    const next = vi.fn();

    handler({} as any, res as any, next);

    expect(res.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'no-store, private, max-age=0',
    );
    expect(res.setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
    expect(res.setHeader).toHaveBeenCalledWith('Surrogate-Control', 'no-store');
    expect(res.setHeader).toHaveBeenCalledWith('Expires', '0');
    expect(res.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    expect(next).toHaveBeenCalled();
  });
});
