import { describe, expect, it } from 'vitest';
import router from '../researchGroups';

const routesByPath = (path: string) =>
  (router as any).stack
    .map((layer: any) => layer.route)
    .filter((route: any) => route?.path === path);

const routeMethods = (path: string) =>
  routesByPath(path).flatMap((route: any) =>
    Object.keys(route.methods).filter((m) => route.methods[m]),
  );

const routeHandlerNames = (path: string, method: string): string[] =>
  routesByPath(path)
    .filter((route: any) => route.methods[method])
    .flatMap((route: any) => route.stack)
    .map((layer: any) => layer.handle?.name)
    .filter(Boolean);

describe('research group routes', () => {
  it('serves the read paths without requiring authentication', () => {
    expect(routeMethods('/search')).toContain('post');
    expect(routeHandlerNames('/search', 'post')).not.toContain('isAuthenticated');

    expect(routeMethods('/:slug')).toContain('get');
    expect(routeHandlerNames('/:slug', 'get')).not.toContain('isAuthenticated');
  });

  it('keeps correction reports and personal report reads behind authentication', () => {
    expect(routeHandlerNames('/:slug/report', 'post')).toContain('isAuthenticated');
    expect(routeHandlerNames('/:slug/reports/mine', 'get')).toContain('isAuthenticated');
  });
});
