import { describe, expect, it } from 'vitest';
import router from '../listings';

describe('retired listings route', () => {
  it('mounts a single catch-all retired endpoint so writes cannot recreate listings', () => {
    const routes = (router as any).stack
      .map((layer: any) => layer.route)
      .filter(Boolean);

    expect(routes).toHaveLength(1);
    expect(routes[0].path).toBe('*');
    expect(routes[0].methods).toMatchObject({
      _all: true,
    });
  });
});
