import { describe, expect, it, vi } from 'vitest';
import router from '../pathways';

const middlewareNames = () =>
  (router as any).stack
    .filter((layer: any) => !layer.route)
    .map((layer: any) => layer.handle?.name)
    .filter(Boolean);

const invokeMiddleware = async (name: string) => {
  const layer = (router as any).stack.find(
    (candidate: any) => !candidate.route && candidate.handle?.name === name,
  );
  expect(layer).toBeTruthy();

  const res = {
    setHeader: vi.fn(),
  } as any;
  const next = vi.fn();

  await layer.handle({} as any, res, next);
  return { res, next };
};

const routesByPath = (path: string) =>
  (router as any).stack.map((layer: any) => layer.route).filter((route: any) => route?.path === path);

const routeHandlerNames = (route: any): string[] =>
  (route?.stack || [])
    .map((layer: any) => layer.handle?.name)
    .filter(Boolean);

describe('pathways routes', () => {
  it('keeps pathway search authenticated', () => {
    const searchRoute = routesByPath('/search').find((route: any) => route.methods?.post);

    expect(searchRoute).toBeTruthy();
    expect(routeHandlerNames(searchRoute)).toContain('isAuthenticated');
  });

  it('marks authenticated pathway responses as private no-store payloads', async () => {
    expect(middlewareNames()).toContain('setPrivatePathwayCacheHeaders');

    const { res, next } = await invokeMiddleware('setPrivatePathwayCacheHeaders');

    expect(res.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'no-store, private, max-age=0',
    );
    expect(res.setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
    expect(next).toHaveBeenCalledOnce();
  });
});
