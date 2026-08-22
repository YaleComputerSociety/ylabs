import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  recordAdminAuditEvent: vi.fn(),
}));

vi.mock('../../services/adminAuditService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/adminAuditService')>()),
  recordAdminAuditEvent: mocks.recordAdminAuditEvent,
}));

import {
  ADMIN_AUDIT_ROUTES,
  adminAuditMutationLogger,
  resolveAdminAuditContext,
} from '../adminAuditLogger';

const buildReq = (key: string, overrides: Record<string, any> = {}) => {
  const [method, path] = key.split(' ');
  return {
    method,
    route: { path },
    params: {},
    body: {},
    user: { netId: 'admin1' },
    ...overrides,
  } as any;
};

const buildRes = (statusCode: number) => {
  let finishHandler: (() => void) | undefined;
  const res: any = {
    statusCode,
    json: vi.fn((body: unknown) => body),
    on: vi.fn((event: string, handler: () => void) => {
      if (event === 'finish') finishHandler = handler;
    }),
  };
  return { res, flushFinish: () => finishHandler?.() };
};

describe('resolveAdminAuditContext', () => {
  it('maps every curated admin mutation route to an action and target type', () => {
    for (const key of Object.keys(ADMIN_AUDIT_ROUTES)) {
      const context = resolveAdminAuditContext(buildReq(key));
      expect(context, key).toBeTruthy();
      expect(context?.action, key).toMatch(/^[a-z0-9_]+(\.[a-z0-9_]+)*$/);
      expect(context?.targetType, key).toBeTruthy();
    }
  });

  it('returns undefined for unmapped routes', () => {
    expect(resolveAdminAuditContext(buildReq('POST /check-urls'))).toBeUndefined();
    expect(resolveAdminAuditContext(buildReq('GET /listings'))).toBeUndefined();
  });
});

describe('adminAuditMutationLogger', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('records an audit event when a mapped mutation succeeds', () => {
    const req = buildReq('PUT /listings/:id', {
      params: { id: 'listing1' },
      body: { data: { title: 'New', description: 'x' } },
    });
    const { res, flushFinish } = buildRes(200);
    const next = vi.fn();

    adminAuditMutationLogger(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    res.json({ listing: { id: 'listing1' } });
    flushFinish();

    expect(mocks.recordAdminAuditEvent).toHaveBeenCalledTimes(1);
    const payload = mocks.recordAdminAuditEvent.mock.calls[0][0];
    expect(payload.action).toBe('listing.update');
    expect(payload.targetType).toBe('listing');
    expect(payload.targetId).toBe('listing1');
    expect(payload.summary.fields).toEqual(['title', 'description']);
  });

  it('resolves grant target id from the response body', () => {
    const req = buildReq('POST /admin-grants', { body: { netid: 'target1', note: 'ok' } });
    const { res, flushFinish } = buildRes(201);
    adminAuditMutationLogger(req, res, vi.fn());
    res.json({ grant: { netid: 'target1' } });
    flushFinish();

    const payload = mocks.recordAdminAuditEvent.mock.calls[0][0];
    expect(payload.action).toBe('admin_grant.grant');
    expect(payload.targetId).toBe('target1');
    expect(payload.summary.note).toBe('ok');
  });

  it('does not record on a non-2xx response', () => {
    const req = buildReq('DELETE /listings/:id', { params: { id: 'listing1' } });
    const { res, flushFinish } = buildRes(400);
    adminAuditMutationLogger(req, res, vi.fn());
    flushFinish();

    expect(mocks.recordAdminAuditEvent).not.toHaveBeenCalled();
  });

  it('does not attach auditing to read requests', () => {
    const req = buildReq('GET /audit-events');
    const { res } = buildRes(200);
    const next = vi.fn();

    adminAuditMutationLogger(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.on).not.toHaveBeenCalled();
  });
});
