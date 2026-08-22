/**
 * Records an append-only audit event for every successful admin mutation.
 *
 * Mounted once on the admin router so new mutation routes are covered by a
 * single, curated action vocabulary instead of per-handler instrumentation.
 */
import { NextFunction, Request, Response } from 'express';
import {
  AdminAuditSummary,
  MAX_AUDIT_SUMMARY_FIELDS,
  recordAdminAuditEvent,
} from '../services/adminAuditService';

interface AdminAuditRouteDescriptor {
  action: string;
  targetType: string;
  targetId?: (req: Request, responseBody: unknown) => unknown;
}

const responseObject = (body: unknown): Record<string, any> =>
  body && typeof body === 'object' ? (body as Record<string, any>) : {};

const paramId =
  (name: string) =>
  (req: Request): unknown =>
    req.params?.[name];

export const ADMIN_AUDIT_ROUTES: Record<string, AdminAuditRouteDescriptor> = {
  'POST /admin-grants': {
    action: 'admin_grant.grant',
    targetType: 'adminGrant',
    targetId: (req, body) => responseObject(body).grant?.netid ?? req.body?.netid,
  },
  'POST /admin-grants/:netid/revoke': {
    action: 'admin_grant.revoke',
    targetType: 'adminGrant',
    targetId: paramId('netid'),
  },
  'PUT /listings/:id': {
    action: 'listing.update',
    targetType: 'listing',
    targetId: paramId('id'),
  },
  'DELETE /listings/:id': {
    action: 'listing.delete',
    targetType: 'listing',
    targetId: paramId('id'),
  },
  'PUT /profiles/:netid': {
    action: 'profile.update',
    targetType: 'profile',
    targetId: paramId('netid'),
  },
  'POST /departments': {
    action: 'department.create',
    targetType: 'department',
    targetId: (_req, body) => responseObject(body).department?._id,
  },
  'PUT /departments/:id': {
    action: 'department.update',
    targetType: 'department',
    targetId: paramId('id'),
  },
  'DELETE /departments/:id': {
    action: 'department.delete',
    targetType: 'department',
    targetId: paramId('id'),
  },
  'PUT /research-areas/:id': {
    action: 'research_area.update',
    targetType: 'researchArea',
    targetId: paramId('id'),
  },
  'DELETE /research-areas/:id': {
    action: 'research_area.delete',
    targetType: 'researchArea',
    targetId: paramId('id'),
  },
  'PUT /fellowships/:id': {
    action: 'fellowship.update',
    targetType: 'fellowship',
    targetId: paramId('id'),
  },
  'PUT /fellowships/:id/archive': {
    action: 'fellowship.archive',
    targetType: 'fellowship',
    targetId: paramId('id'),
  },
  'PUT /fellowships/:id/unarchive': {
    action: 'fellowship.unarchive',
    targetType: 'fellowship',
    targetId: paramId('id'),
  },
  'DELETE /fellowships/:id': {
    action: 'fellowship.delete',
    targetType: 'fellowship',
    targetId: paramId('id'),
  },
  'PUT /access-review/:id/manual-locks': {
    action: 'access_review.manual_locks',
    targetType: 'researchEntity',
    targetId: paramId('id'),
  },
  'PUT /access-review/records/:type/:recordId/review': {
    action: 'access_review.record_review',
    targetType: 'accessReviewRecord',
    targetId: paramId('recordId'),
  },
  'PUT /listing-claims/:id': {
    action: 'listing_claim.review',
    targetType: 'listingClaim',
    targetId: paramId('id'),
  },
};

const AUDIT_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const resolveAdminAuditContext = (req: Request): AdminAuditRouteDescriptor | undefined => {
  const routePath = (req.route as { path?: string } | undefined)?.path;
  if (!routePath) return undefined;
  return ADMIN_AUDIT_ROUTES[`${req.method} ${routePath}`];
};

const actorNetid = (req: Request): unknown =>
  (req.user as { netId?: unknown; netid?: unknown } | undefined)?.netId ??
  (req.user as { netid?: unknown } | undefined)?.netid;

const auditPayloadFields = (req: Request): string[] => {
  const body = req.body as Record<string, unknown> | undefined;
  const source =
    body?.data && typeof body.data === 'object' && !Array.isArray(body.data)
      ? (body.data as Record<string, unknown>)
      : body && typeof body === 'object' && !Array.isArray(body)
        ? body
        : {};

  return Object.keys(source).slice(0, MAX_AUDIT_SUMMARY_FIELDS);
};

const buildAuditSummary = (req: Request): AdminAuditSummary => {
  const summary: AdminAuditSummary = {};
  const fields = auditPayloadFields(req);
  if (fields.length > 0) summary.fields = fields;

  const note = (req.body as Record<string, unknown> | undefined)?.note;
  if (typeof note === 'string' && note.trim()) summary.note = note;

  const status = (req.body as Record<string, unknown> | undefined)?.status;
  if (typeof status === 'string' && status.trim()) summary.status = status;

  return summary;
};

export const adminAuditMutationLogger = (req: Request, res: Response, next: NextFunction): void => {
  if (!AUDIT_METHODS.has(req.method)) {
    next();
    return;
  }

  let responseBody: unknown;
  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    responseBody = body;
    return originalJson(body);
  };

  res.on('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return;

    const context = resolveAdminAuditContext(req);
    if (!context) return;

    void recordAdminAuditEvent({
      actorNetid: actorNetid(req),
      action: context.action,
      targetType: context.targetType,
      targetId: context.targetId ? context.targetId(req, responseBody) : undefined,
      summary: buildAuditSummary(req),
    });
  });

  next();
};
