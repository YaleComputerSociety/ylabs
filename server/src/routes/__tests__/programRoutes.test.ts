import { describe, expect, it, vi } from 'vitest';
import router from '../programs';

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

const routeByPath = (path: string) =>
  (router as any).stack.map((layer: any) => layer.route).find((route: any) => route?.path === path);

const routeHandlerNames = (path: string): string[] =>
  routeByPath(path)?.stack.map((layer: any) => layer.handle?.name).filter(Boolean) || [];

describe('program routes', () => {
  it('uses canonical program handlers instead of exporting the fellowship router', () => {
    expect(routeHandlerNames('/search')).toContain('searchProgramsController');
    expect(routeHandlerNames('/filters')).toContain('getProgramFilterOptions');
    expect(routeHandlerNames('/:id')).toContain('getProgramById');
  });

  it('marks authenticated program responses as private no-store payloads', async () => {
    expect(middlewareNames()).toContain('setPrivateProgramCacheHeaders');

    const { res, next } = await invokeMiddleware('setPrivateProgramCacheHeaders');

    expect(res.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'no-store, private, max-age=0',
    );
    expect(res.setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
    expect(next).toHaveBeenCalledOnce();
  });
});
