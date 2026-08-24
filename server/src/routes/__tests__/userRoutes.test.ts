import { describe, expect, it } from 'vitest';
import router from '../users';

const routeByPathAndMethod = (path: string, method: string) =>
  (router as any).stack
    .map((layer: any) => layer.route)
    .find((route: any) => route?.path === path && route.methods?.[method]);

describe('user routes', () => {
  it('keeps entity-owned planning routes authenticated and validates entity ids', () => {
    for (const [path, method] of [
      ['/savedResearchEntityPlans/:entityId', 'put'],
      ['/savedResearchEntityPlans/:entityId', 'delete'],
      ['/savedResearchFollowUps/:entityId/dismiss', 'post'],
      ['/watchedProgramPlans/:programId', 'put'],
      ['/watchedProgramPlans/:programId', 'delete'],
    ]) {
      const route = routeByPathAndMethod(path, method);
      expect(route).toBeTruthy();
      expect(route.stack.length).toBeGreaterThanOrEqual(3);
    }

    for (const [path, method] of [
      ['/savedResearchEntityIds', 'get'],
      ['/savedResearchEntities', 'get'],
      ['/savedResearchEntities', 'put'],
      ['/savedResearchEntities', 'delete'],
      ['/savedResearchEntityPlans', 'get'],
      ['/savedResearchEntityPlans/export', 'get'],
      ['/savedResearchEntityPlans/export', 'post'],
      ['/savedResearchFollowUps', 'get'],
    ]) {
      const route = routeByPathAndMethod(path, method);
      expect(route).toBeTruthy();
      expect(route.stack.length).toBeGreaterThanOrEqual(2);
    }
  });
});
