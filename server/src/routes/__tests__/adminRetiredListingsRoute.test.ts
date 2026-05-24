import { describe, expect, it } from 'vitest';
import router from '../admin';

describe('admin retired listings routes', () => {
  it('registers retired catch-all listing handlers before legacy admin listing handlers', () => {
    const listingRoutes = (router as any).stack
      .map((layer: any) => layer.route)
      .filter((route: any) => route?.path === '/listings' || route?.path === '/listings/:id');

    expect(listingRoutes[0]).toMatchObject({
      path: '/listings',
      methods: { _all: true },
    });
    expect(listingRoutes[1]).toMatchObject({
      path: '/listings/:id',
      methods: { _all: true },
    });
  });
});
