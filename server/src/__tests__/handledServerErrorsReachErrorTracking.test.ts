import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  captureServerError: vi.fn(),
  listAdminGrants: vi.fn(),
  grantAdminAccess: vi.fn(),
  listAdminAuditEvents: vi.fn(),
  buildAdminOperatorBoard: vi.fn(),
  researchAreaFind: vi.fn(),
  researchAreaFindOne: vi.fn(),
  researchAreaFindByIdAndUpdate: vi.fn(),
  researchAreaFindByIdAndDelete: vi.fn(),
  departmentFind: vi.fn(),
  departmentSave: vi.fn(),
  departmentFindByIdAndUpdate: vi.fn(),
  departmentFindByIdAndDelete: vi.fn(),
  fellowshipFind: vi.fn(),
  updateFellowship: vi.fn(),
  deleteFellowship: vi.fn(),
  addView: vi.fn(),
  getAnalytics: vi.fn(),
  getCorpusQualityDashboard: vi.fn(),
  getConfig: vi.fn(),
  searchPrograms: vi.fn(),
  readProgram: vi.fn(),
  getProgramFilterOptions: vi.fn(),
  searchResearchGroupsViaMeili: vi.fn(),
  getResearchGroupDetail: vi.fn(),
  getWatchedPrograms: vi.fn(),
  passThrough: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../utils/errorTracking', () => ({
  captureServerError: mocks.captureServerError,
}));

vi.mock('../middleware/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../middleware/auth')>()),
  isAuthenticated: mocks.passThrough,
  isAdmin: mocks.passThrough,
}));

vi.mock('../middleware/rateLimiters', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../middleware/rateLimiters')>()),
  writeLimit: mocks.passThrough,
}));

vi.mock('../middleware/adminAuditLogger', () => ({
  adminAuditMutationLogger: mocks.passThrough,
}));

vi.mock('../services/adminGrantService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/adminGrantService')>()),
  listAdminGrants: mocks.listAdminGrants,
  grantAdminAccess: mocks.grantAdminAccess,
  hasAdminAuthorityForUser: vi.fn(async () => false),
}));

vi.mock('../services/adminAuditService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/adminAuditService')>()),
  listAdminAuditEvents: mocks.listAdminAuditEvents,
}));

vi.mock('../services/adminOperatorBoardService', () => ({
  buildAdminOperatorBoard: mocks.buildAdminOperatorBoard,
}));

vi.mock('../models/researchArea', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../models/researchArea')>()),
  ResearchArea: {
    find: mocks.researchAreaFind,
    findOne: mocks.researchAreaFindOne,
    findByIdAndUpdate: mocks.researchAreaFindByIdAndUpdate,
    findByIdAndDelete: mocks.researchAreaFindByIdAndDelete,
  },
}));

vi.mock('../models/department', async (importOriginal) => {
  const FakeDepartment = function (this: Record<string, unknown>, doc: Record<string, unknown>) {
    Object.assign(this, doc);
    this.save = mocks.departmentSave;
  };
  return {
    ...(await importOriginal<typeof import('../models/department')>()),
    Department: Object.assign(FakeDepartment, {
      find: mocks.departmentFind,
      findByIdAndUpdate: mocks.departmentFindByIdAndUpdate,
      findByIdAndDelete: mocks.departmentFindByIdAndDelete,
    }),
  };
});

vi.mock('../models/fellowship', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../models/fellowship')>()),
  Fellowship: {
    find: mocks.fellowshipFind,
    countDocuments: vi.fn(async () => 0),
  },
}));

vi.mock('../services/fellowshipService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/fellowshipService')>()),
  updateFellowship: mocks.updateFellowship,
  archiveFellowship: mocks.updateFellowship,
  unarchiveFellowship: mocks.updateFellowship,
  deleteFellowship: mocks.deleteFellowship,
  addView: mocks.addView,
}));

vi.mock('../services/analyticsService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/analyticsService')>()),
  getAnalytics: mocks.getAnalytics,
  logEvent: vi.fn(async () => undefined),
}));

vi.mock('../services/corpusQualityDashboardService', () => ({
  getCorpusQualityDashboard: mocks.getCorpusQualityDashboard,
}));

vi.mock('../services/configService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/configService')>()),
  getConfig: mocks.getConfig,
  invalidateConfigCache: vi.fn(),
}));

vi.mock('../services/programService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/programService')>()),
  searchPrograms: mocks.searchPrograms,
  readProgram: mocks.readProgram,
  getProgramFilterOptions: mocks.getProgramFilterOptions,
}));

vi.mock('../services/researchGroupService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/researchGroupService')>()),
  searchResearchGroupsViaMeili: mocks.searchResearchGroupsViaMeili,
  getResearchGroupDetail: mocks.getResearchGroupDetail,
  resolveArchivedResearchEntityCanonicalSlug: vi.fn(async () => null),
}));

vi.mock('../services/researchPlanService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/researchPlanService')>()),
  getWatchedPrograms: mocks.getWatchedPrograms,
}));

import apiRoutes from '../routes/index';
import { errorHandler } from '../middleware/errorHandler';
import { NotFoundError } from '../utils/errors';

const LEAKY_MESSAGE = 'mongodb://user:pass@example.invalid connection lost';
const VALID_ID = '507f1f77bcf86cd799439011';

const outage = () => new Error(LEAKY_MESSAGE);
const duplicateKey = () =>
  Object.assign(new Error('E11000 duplicate key error collection: departments'), {
    name: 'MongoServerError',
    code: 11000,
  });

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { netId: 'operator1', userType: 'admin' };
    next();
  });
  app.use('/api', apiRoutes);
  app.use(errorHandler);
  return app;
};

describe('handled server errors reach error tracking', () => {
  let server: Server;
  let baseUrl: string;

  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, text, body: text ? JSON.parse(text) : undefined };
  };

  beforeAll(async () => {
    server = await new Promise<Server>((resolve) => {
      const listening = buildApp().listen(0, () => resolve(listening));
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  const expectCapturedServerError = (result: { status: number; text: string; body: unknown }) => {
    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: 'Internal server error' });
    expect(result.text).not.toContain('user:pass');
    expect(mocks.captureServerError).toHaveBeenCalledOnce();
    expect(mocks.captureServerError.mock.calls[0][0].message).toBe(LEAKY_MESSAGE);
  };

  const outageCases: Array<{
    name: string;
    method: string;
    path: string;
    body?: unknown;
    arrange: () => void;
  }> = [
    {
      name: 'research search',
      method: 'POST',
      path: '/api/research/search',
      body: { q: 'neuro' },
      arrange: () => mocks.searchResearchGroupsViaMeili.mockRejectedValue(outage()),
    },
    {
      name: 'research detail',
      method: 'GET',
      path: '/api/research/some-lab',
      arrange: () => mocks.getResearchGroupDetail.mockRejectedValue(outage()),
    },
    {
      name: 'program search',
      method: 'GET',
      path: '/api/programs/search',
      arrange: () => mocks.searchPrograms.mockRejectedValue(outage()),
    },
    {
      name: 'program detail',
      method: 'GET',
      path: `/api/programs/${VALID_ID}`,
      arrange: () => mocks.readProgram.mockRejectedValue(outage()),
    },
    {
      name: 'program filters',
      method: 'GET',
      path: '/api/programs/filters',
      arrange: () => mocks.getProgramFilterOptions.mockRejectedValue(outage()),
    },
    {
      name: 'watched programs',
      method: 'GET',
      path: '/api/users/watchedPrograms',
      arrange: () => mocks.getWatchedPrograms.mockRejectedValue(outage()),
    },
    {
      name: 'fellowship view count',
      method: 'PUT',
      path: `/api/fellowships/${VALID_ID}/addView`,
      arrange: () => mocks.addView.mockRejectedValue(outage()),
    },
    {
      name: 'analytics overview',
      method: 'GET',
      path: '/api/analytics',
      arrange: () => mocks.getAnalytics.mockRejectedValue(outage()),
    },
    {
      name: 'corpus quality',
      method: 'GET',
      path: '/api/analytics/corpus-quality',
      arrange: () => mocks.getCorpusQualityDashboard.mockRejectedValue(outage()),
    },
    {
      name: 'config',
      method: 'GET',
      path: '/api/config',
      arrange: () => mocks.getConfig.mockRejectedValue(outage()),
    },
    {
      name: 'admin research area creation',
      method: 'POST',
      path: '/api/admin/research-areas',
      body: { name: 'Synthetic Topic', field: 'Computing & Artificial Intelligence' },
      arrange: () => mocks.researchAreaFindOne.mockRejectedValue(outage()),
    },
    {
      name: 'admin grant list',
      method: 'GET',
      path: '/api/admin/admin-grants',
      arrange: () => mocks.listAdminGrants.mockRejectedValue(outage()),
    },
    {
      name: 'admin grant creation',
      method: 'POST',
      path: '/api/admin/admin-grants',
      body: { netid: 'target1', note: 'synthetic note' },
      arrange: () => mocks.grantAdminAccess.mockRejectedValue(outage()),
    },
    {
      name: 'admin audit events',
      method: 'GET',
      path: '/api/admin/audit-events',
      arrange: () => mocks.listAdminAuditEvents.mockRejectedValue(outage()),
    },
    {
      name: 'admin operator board',
      method: 'GET',
      path: '/api/admin/operator-board',
      arrange: () => mocks.buildAdminOperatorBoard.mockRejectedValue(outage()),
    },
    {
      name: 'admin research area list',
      method: 'GET',
      path: '/api/admin/research-areas',
      arrange: () =>
        mocks.researchAreaFind.mockReturnValue({
          sort: () => ({ lean: () => Promise.reject(outage()) }),
        }),
    },
    {
      name: 'admin research area update',
      method: 'PUT',
      path: `/api/admin/research-areas/${VALID_ID}`,
      body: { name: 'Synthetic Topic' },
      arrange: () => mocks.researchAreaFindByIdAndUpdate.mockRejectedValue(outage()),
    },
    {
      name: 'admin research area delete',
      method: 'DELETE',
      path: `/api/admin/research-areas/${VALID_ID}`,
      arrange: () => mocks.researchAreaFindByIdAndDelete.mockRejectedValue(outage()),
    },
    {
      name: 'admin department list',
      method: 'GET',
      path: '/api/admin/departments',
      arrange: () =>
        mocks.departmentFind.mockReturnValue({
          sort: () => ({ lean: () => Promise.reject(outage()) }),
        }),
    },
    {
      name: 'admin department creation',
      method: 'POST',
      path: '/api/admin/departments',
      body: { abbreviation: 'SYN', name: 'Synthetic Studies', primaryCategory: 'Life Sciences' },
      arrange: () => mocks.departmentSave.mockRejectedValue(outage()),
    },
    {
      name: 'admin department update',
      method: 'PUT',
      path: `/api/admin/departments/${VALID_ID}`,
      body: { name: 'Synthetic Studies' },
      arrange: () => mocks.departmentFindByIdAndUpdate.mockRejectedValue(outage()),
    },
    {
      name: 'admin department delete',
      method: 'DELETE',
      path: `/api/admin/departments/${VALID_ID}`,
      arrange: () => mocks.departmentFindByIdAndDelete.mockRejectedValue(outage()),
    },
    {
      name: 'admin fellowship list',
      method: 'GET',
      path: '/api/admin/fellowships',
      arrange: () =>
        mocks.fellowshipFind.mockReturnValue({
          sort: () => ({
            skip: () => ({ limit: () => ({ lean: () => Promise.reject(outage()) }) }),
          }),
        }),
    },
    {
      name: 'admin fellowship update',
      method: 'PUT',
      path: `/api/admin/fellowships/${VALID_ID}`,
      body: { data: { title: 'Synthetic Fellowship' } },
      arrange: () => mocks.updateFellowship.mockRejectedValue(outage()),
    },
    {
      name: 'admin fellowship archive',
      method: 'PUT',
      path: `/api/admin/fellowships/${VALID_ID}/archive`,
      arrange: () => mocks.updateFellowship.mockRejectedValue(outage()),
    },
    {
      name: 'admin fellowship unarchive',
      method: 'PUT',
      path: `/api/admin/fellowships/${VALID_ID}/unarchive`,
      arrange: () => mocks.updateFellowship.mockRejectedValue(outage()),
    },
    {
      name: 'admin fellowship delete',
      method: 'DELETE',
      path: `/api/admin/fellowships/${VALID_ID}`,
      arrange: () => mocks.deleteFellowship.mockRejectedValue(outage()),
    },
  ];

  it.each(outageCases)(
    'answers a $name outage with a sanitized 500 and captures it',
    async ({ method, path, body, arrange }) => {
      arrange();
      expectCapturedServerError(await call(method, path, body));
    },
  );

  it('answers invalid admin taxonomy input with its bounded 400 message and no capture', async () => {
    const result = await call('PUT', `/api/admin/research-areas/${VALID_ID}`, { name: 42 });

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: 'Invalid research area name' });
    expect(mocks.researchAreaFindByIdAndUpdate).not.toHaveBeenCalled();
    expect(mocks.captureServerError).not.toHaveBeenCalled();
  });

  it('answers an invalid admin department category with a 400 and no capture', async () => {
    const result = await call('POST', '/api/admin/departments', {
      abbreviation: 'SYN',
      name: 'Synthetic Studies',
      primaryCategory: '__proto__',
    });

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: 'Invalid department category' });
    expect(mocks.departmentSave).not.toHaveBeenCalled();
    expect(mocks.captureServerError).not.toHaveBeenCalled();
  });

  it('answers a mongoose validation failure on an admin write with a 400 and no capture', async () => {
    mocks.departmentFindByIdAndUpdate.mockRejectedValue(new mongoose.Error.ValidationError());

    const result = await call('PUT', `/api/admin/departments/${VALID_ID}`, {
      name: 'Synthetic Studies',
    });

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: 'Validation error' });
    expect(mocks.captureServerError).not.toHaveBeenCalled();
  });

  it('answers a duplicate key on an admin write with a 409 and no capture', async () => {
    mocks.departmentSave.mockRejectedValue(duplicateKey());

    const result = await call('POST', '/api/admin/departments', {
      abbreviation: 'SYN',
      name: 'Synthetic Studies',
      primaryCategory: 'Life Sciences',
    });

    expect(result.status).toBe(409);
    expect(result.text).not.toContain('departments');
    expect(mocks.captureServerError).not.toHaveBeenCalled();
  });

  it('answers a missing fellowship on an admin write with a 404 and no capture', async () => {
    mocks.updateFellowship.mockRejectedValue(new NotFoundError('Fellowship not found'));

    const result = await call('PUT', `/api/admin/fellowships/${VALID_ID}/archive`);

    expect(result.status).toBe(404);
    expect(mocks.captureServerError).not.toHaveBeenCalled();
  });

  it('keeps analytics request validation a 400 with no capture', async () => {
    const result = await call('GET', '/api/analytics/users?limit=abc');

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: 'Invalid analytics request' });
    expect(mocks.captureServerError).not.toHaveBeenCalled();
  });

  it('keeps a missing program a 404 with its message and no capture', async () => {
    mocks.readProgram.mockRejectedValue(new NotFoundError('Program not found'));

    const result = await call('GET', `/api/programs/${VALID_ID}`);

    expect(result.status).toBe(404);
    expect(result.body).toEqual({ error: 'Program not found' });
    expect(mocks.captureServerError).not.toHaveBeenCalled();
  });

  it('keeps a missing research entity a 404 with its message and no capture', async () => {
    mocks.getResearchGroupDetail.mockResolvedValue(null);

    const result = await call('GET', '/api/research/some-lab');

    expect(result.status).toBe(404);
    expect(result.body).toEqual({ error: 'Research entity not found' });
    expect(mocks.captureServerError).not.toHaveBeenCalled();
  });
});
