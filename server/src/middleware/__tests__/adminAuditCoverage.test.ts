import { describe, expect, it } from 'vitest';

import app from '../../app';
import AdminRoutes from '../../routes/admin';
import { ADMIN_AUDIT_ROUTES } from '../adminAuditLogger';

interface ExpressLayer {
  name?: string;
  handle?: { name?: string; stack?: ExpressLayer[] };
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: ExpressLayer[];
  };
}

interface MountedRoute {
  router: unknown;
  method: string;
  path: string;
  middlewareNames: string[];
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE', '_ALL']);

const collectRoutes = (
  router: { stack: ExpressLayer[] },
  inheritedMiddleware: string[],
): MountedRoute[] => {
  const precedingMiddleware = [...inheritedMiddleware];
  const routes: MountedRoute[] = [];

  for (const layer of router.stack) {
    if (layer.route) {
      const routeMiddleware = layer.route.stack
        .map((routeLayer) => routeLayer.handle?.name)
        .filter((name): name is string => Boolean(name));
      for (const method of Object.keys(layer.route.methods)) {
        routes.push({
          router,
          method: method.toUpperCase(),
          path: layer.route.path,
          middlewareNames: [...precedingMiddleware, ...routeMiddleware],
        });
      }
    } else if (Array.isArray(layer.handle?.stack)) {
      routes.push(...collectRoutes(layer.handle as { stack: ExpressLayer[] }, precedingMiddleware));
    } else if (layer.handle?.name) {
      precedingMiddleware.push(layer.handle.name);
    }
  }

  return routes;
};

const applicationRouter = (app as unknown as { router: { stack: ExpressLayer[] } }).router;
const allRoutes = collectRoutes(applicationRouter, []);

const adminMutations = allRoutes.filter(
  (route) => MUTATING_METHODS.has(route.method) && route.middlewareNames.includes('isAdmin'),
);

const describeRoute = (route: MountedRoute) =>
  `${route.method} ${route.path} after ${route.middlewareNames.join(' > ')}`;

const auditKey = (route: MountedRoute) => `${route.method} ${route.path}`;

describe('admin audit coverage', () => {
  it('finds admin mutations on the mounted application', () => {
    expect(allRoutes.length).toBeGreaterThan(0);
    expect(adminMutations.map(auditKey)).toContain('POST /departments');
  });

  it('mounts every admin mutation on the audited admin router', () => {
    const outsideAdminRouter = adminMutations
      .filter((route) => route.router !== AdminRoutes)
      .map(describeRoute);

    expect(outsideAdminRouter).toEqual([]);
  });

  it('runs the audit logger ahead of every admin mutation', () => {
    const unlogged = adminMutations
      .filter((route) => !route.middlewareNames.includes('adminAuditMutationLogger'))
      .map(describeRoute);

    expect(unlogged).toEqual([]);
  });

  it('maps every admin mutation to an audit action', () => {
    const unmapped = adminMutations
      .filter((route) => !ADMIN_AUDIT_ROUTES[auditKey(route)])
      .map(describeRoute);

    expect(unmapped).toEqual([]);
  });

  it('maps only admin mutations that exist', () => {
    const mountedKeys = new Set(
      adminMutations.filter((route) => route.router === AdminRoutes).map(auditKey),
    );
    const stale = Object.keys(ADMIN_AUDIT_ROUTES).filter((key) => !mountedKeys.has(key));

    expect(stale).toEqual([]);
  });
});
