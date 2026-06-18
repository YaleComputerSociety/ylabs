import { describe, expect, it, vi } from 'vitest';
import router from '../profiles';

const middlewareNames = () =>
  (router as any).stack
    .filter((layer: any) => !layer.route)
    .map((layer: any) => layer.handle?.name)
    .filter(Boolean);

const routeHandlers = (path: string) => {
  const route = (router as any).stack
    .map((layer: any) => layer.route)
    .find((candidate: any) => candidate?.path === path);
  expect(route).toBeTruthy();
  return route.stack.map((layer: any) => layer.handle);
};

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

describe('profile routes', () => {
  it('marks authenticated profile responses as private no-store payloads', async () => {
    expect(middlewareNames()).toContain('setPrivateProfileCacheHeaders');

    const { res, next } = await invokeMiddleware('setPrivateProfileCacheHeaders');

    expect(res.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'no-store, private, max-age=0',
    );
    expect(res.setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
    expect(next).toHaveBeenCalledOnce();
  });

  it('bounds profile netid path params before controller work', () => {
    for (const path of ['/:netid', '/:netid/publications', '/:netid/listings', '/:netid/courses']) {
      const handlers = routeHandlers(path);
      expect(handlers[0].name).toBe('isAuthenticated');
      expect(handlers).toHaveLength(3);

      const req = { params: { netid: 'not valid because spaces' } };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };
      const next = vi.fn();

      handlers[1](req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid netid' });
    }
  });
});
