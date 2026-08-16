import { describe, expect, it } from 'vitest';

import router from '../opportunities';

const registeredRoutes = () =>
  (router as any).stack
    .map((layer: any) => layer.route)
    .filter(Boolean)
    .flatMap((route: any) =>
      Object.keys(route.methods).map((method) => ({ method, path: route.path })),
    );

describe('opportunity routes', () => {
  it('exposes source-discovered opportunity details without faculty authoring routes', () => {
    expect(registeredRoutes()).toEqual([{ method: 'get', path: '/:id' }]);
  });
});
