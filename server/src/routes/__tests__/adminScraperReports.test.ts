import { describe, expect, it } from 'vitest';
import router from '../admin';

function mountedAdminRoute(path: string): unknown {
  return (router as any).stack.find(
    (layer: any) => layer.route?.path === path && layer.route?.methods?.get,
  );
}

describe('admin scraper report routes', () => {
  it('mounts backend-only source health and scrape-run report endpoints behind admin router', () => {
    expect(mountedAdminRoute('/scraper-sources/health')).toBeTruthy();
    expect(mountedAdminRoute('/scrape-runs/:id/report')).toBeTruthy();
  });
});
