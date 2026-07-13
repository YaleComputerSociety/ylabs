import { describe, expect, it } from 'vitest';
import router from '../users';

const routeByPathAndMethod = (path: string, method: string) =>
  (router as any).stack
    .map((layer: any) => layer.route)
    .find((route: any) => route?.path === path && route.methods?.[method]);

describe('user routes', () => {
  it('validates saved pathway-plan route ids before controller handlers', () => {
    for (const [path, method] of [
      ['/savedResearchPlanDetails/:pathwayId', 'put'],
      ['/savedResearchPlanDetails/:pathwayId', 'delete'],
      ['/favPathwayPlans/:pathwayId', 'put'],
      ['/favPathwayPlans/:pathwayId', 'delete'],
    ]) {
      const route = routeByPathAndMethod(path, method);

      expect(route).toBeTruthy();
      expect(route.stack.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps entity-owned planning routes authenticated and validates entity ids', () => {
    for (const [path, method] of [
      ['/savedResearchEntityPlans/:entityId', 'put'],
      ['/savedResearchEntityPlans/:entityId', 'delete'],
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
    ]) {
      const route = routeByPathAndMethod(path, method);
      expect(route).toBeTruthy();
      expect(route.stack.length).toBeGreaterThanOrEqual(2);
    }
  });
});
