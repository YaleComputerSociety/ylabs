import dns from 'dns/promises';
import mongoose from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  grantAdminAccess: vi.fn(),
  revokeAdminAccess: vi.fn(),
  getListingModel: vi.fn(),
  userFind: vi.fn(),
  fellowshipFind: vi.fn(),
  listAccessReviewEntities: vi.fn(),
}));

vi.mock('../../services/adminGrantService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/adminGrantService')>()),
  grantAdminAccess: mocks.grantAdminAccess,
  revokeAdminAccess: mocks.revokeAdminAccess,
}));

vi.mock('../../services/adminAccessReviewService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/adminAccessReviewService')>()),
  listAccessReviewEntities: mocks.listAccessReviewEntities,
}));

vi.mock('../../db/connections', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../db/connections')>()),
  getListingModel: mocks.getListingModel,
}));

vi.mock('../../models/user', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../models/user')>()),
  User: {
    find: mocks.userFind,
    countDocuments: vi.fn(),
    findOne: vi.fn(),
  },
}));

vi.mock('../../models/fellowship', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../models/fellowship')>()),
  Fellowship: {
    find: mocks.fellowshipFind,
    countDocuments: vi.fn(),
  },
}));

import router, {
  checkAdminUrlReachability,
  isPrivateAddress,
  isPublicHostname,
  MAX_ADMIN_URL_CHECK_URL_LENGTH,
  MAX_ADMIN_URL_CHECK_URLS,
  MAX_ADMIN_DEPARTMENT_ABBREVIATION_LENGTH,
  MAX_ADMIN_DEPARTMENT_CATEGORIES,
  MAX_ADMIN_TAXONOMY_LABEL_LENGTH,
  adminAccessReviewRecordUpdateDto,
  adminDepartmentDto,
  adminFellowshipDto,
  adminListingDto,
  adminProfileDto,
  adminResearchAreaDto,
  normalizeAdminObjectId,
  normalizeAdminSearchTerm,
  normalizeAdminDepartmentCategories,
  normalizeAdminTaxonomyLabel,
  normalizeAdminPagination,
  resolveAdminSortField,
  ssrfSafeLookup,
} from '../admin';

const routeByPath = (path: string) =>
  (router as any).stack.map((layer: any) => layer.route).find((route: any) => route?.path === path);

const routeByPathAndMethod = (path: string, method: string) =>
  (router as any).stack
    .map((layer: any) => layer.route)
    .find((route: any) => route?.path === path && route.methods?.[method]);

const middlewareNames = () =>
  (router as any).stack
    .filter((layer: any) => !layer.route)
    .map((layer: any) => layer.handle?.name)
    .filter(Boolean);

const invokeMiddleware = async (name: string) => {
  const layer = (router as any).stack.find(
    (candidate: any) => !candidate.route && candidate.handle?.name === name,
  );
  expect(layer).toBeTruthy();

  const res = {
    setHeader: vi.fn(),
  } as any;
  const next = vi.fn();

  await layer.handle({} as any, res, next);
  return { res, next };
};

const invokeRouteHandler = async (path: string, req: Record<string, any>, method = 'post') => {
  const route = routeByPathAndMethod(path, method) || routeByPath(path);
  const stack = route?.stack || [];
  const handler = stack[stack.length - 1]?.handle;
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };

  await handler(req, res);
  return res;
};

const invokeSafeLookup = (hostname: string) =>
  new Promise<{ error: NodeJS.ErrnoException | null; address?: string; family?: number }>((resolve) => {
    (ssrfSafeLookup as any)(
      hostname,
      {},
      (error: NodeJS.ErrnoException | null, address?: string, family?: number) =>
        resolve({ error, address, family }),
    );
  });

describe('admin routes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the operator board behind the admin router guards', () => {
    const guardNames = middlewareNames();

    expect(guardNames).toEqual(expect.arrayContaining(['isAuthenticated', 'isAdmin']));
    expect(routeByPath('/operator-board')).toBeTruthy();
    expect(routeByPath('/release-queue')).toBeTruthy();
  });

  it('marks admin responses as private no-store payloads', async () => {
    expect(middlewareNames()).toContain('setPrivateAdminCacheHeaders');

    const { res, next } = await invokeMiddleware('setPrivateAdminCacheHeaders');

    expect(res.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'no-store, private, max-age=0',
    );
    expect(res.setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
    expect(next).toHaveBeenCalledOnce();
  });

  it('exposes admin grant management routes for the analytics admin access section', () => {
    expect(routeByPath('/admin-grants')).toBeTruthy();
    expect(routeByPath('/admin-grants/:netid/revoke')).toBeTruthy();
  });

  it('does not leak internal messages from admin grant failures', async () => {
    mocks.grantAdminAccess.mockRejectedValue(
      new Error('mongodb://user:pass@example.invalid admin grant failed'),
    );

    const res = await invokeRouteHandler('/admin-grants', {
      user: { netId: 'admin123' },
      body: { netid: 'target123' },
    });

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to grant admin access' });
  });

  it('does not leak raw validation text from admin grant failures', async () => {
    mocks.grantAdminAccess.mockRejectedValue(
      new Error('Invalid netid mongodb://user:pass@example.invalid leaked'),
    );

    const res = await invokeRouteHandler('/admin-grants', {
      user: { netId: 'admin123' },
      body: { netid: 'target123' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid admin grant request' });
  });

  it('does not stringify malformed admin actor principals in grant handlers', async () => {
    mocks.grantAdminAccess.mockResolvedValue({ netid: 'target123' });
    const actor = {
      toString: () => {
        throw new Error('admin route stringified actor principal');
      },
    };

    const res = await invokeRouteHandler('/admin-grants', {
      user: { netId: actor },
      body: { netid: 'target123' },
    });

    expect(mocks.grantAdminAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        actorNetid: '',
      }),
    );
    expect(res.statusCode).toBe(201);
  });

  it('does not leak internal messages from admin grant revoke failures', async () => {
    mocks.revokeAdminAccess.mockRejectedValue(
      new Error('mongodb://user:pass@example.invalid admin revoke failed'),
    );

    const res = await invokeRouteHandler('/admin-grants/:netid/revoke', {
      user: { netId: 'admin123' },
      params: { netid: 'target123' },
      body: {},
    });

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to revoke admin access' });
  });

  it('bounds URL checker fan-out before doing outbound work', async () => {
    const res = await invokeRouteHandler('/check-urls', {
      body: { urls: Array.from({ length: MAX_ADMIN_URL_CHECK_URLS + 1 }, (_, i) => `example${i}.com`) },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      error: `At most ${MAX_ADMIN_URL_CHECK_URLS} URLs can be checked at once`,
    });
  });

  it('rejects malformed URL checker batches before doing outbound work', async () => {
    const res = await invokeRouteHandler('/check-urls', {
      body: { urls: ['https://example.com', 42] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Each URL must be a string' });
  });

  it('rejects ambiguous URL checker input before doing outbound work', async () => {
    const res = await invokeRouteHandler('/check-urls', {
      body: { urls: ['https://example.com/a b'] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Each URL must be a canonical HTTP(S) URL' });
  });

  it('bounds direct admin URL reachability inputs before URL parsing or DNS work', async () => {
    const lookup = vi.spyOn(dns, 'lookup');

    await expect(
      checkAdminUrlReachability('https://example.com/' + 'a'.repeat(MAX_ADMIN_URL_CHECK_URL_LENGTH)),
    ).resolves.toMatchObject({
      url: expect.stringMatching(/^https:\/\/example\.com\//),
      status: 0,
      reachable: false,
      error: 'URL too long',
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('rejects ambiguous direct admin URL reachability inputs before DNS work', async () => {
    const lookup = vi.spyOn(dns, 'lookup');

    await expect(checkAdminUrlReachability('https://example.com\\@127.0.0.1/')).resolves.toMatchObject({
      status: 0,
      reachable: false,
      error: 'Invalid URL',
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('bounds and strips control characters from admin URL check display values', async () => {
    await expect(
      checkAdminUrlReachability(`\nhttps://example.com/${'a'.repeat(MAX_ADMIN_URL_CHECK_URL_LENGTH)}\r`),
    ).resolves.toMatchObject({
      url: expect.not.stringMatching(/[\r\n]/),
      status: 0,
      reachable: false,
      error: 'URL too long',
    });
  });

  it('allowlists admin sort fields before building Mongo sort objects', () => {
    const allowed = new Set(['createdAt', 'title', 'descriptionLength', 'redFlags']);

    expect(resolveAdminSortField('title', allowed, 'createdAt')).toBe('title');
    expect(resolveAdminSortField('descriptionLength', allowed, 'createdAt')).toBe(
      'descriptionLength',
    );
    expect(resolveAdminSortField('$where', allowed, 'createdAt')).toBe('createdAt');
    expect(resolveAdminSortField('__proto__', allowed, 'createdAt')).toBe('createdAt');
    expect(resolveAdminSortField('embedding', allowed, 'createdAt')).toBe('createdAt');
    expect(resolveAdminSortField(['title'], allowed, 'createdAt')).toBe('createdAt');
  });

  it('normalizes admin ObjectId params without arbitrary object coercion', () => {
    const id = '507f1f77bcf86cd799439011';

    expect(normalizeAdminObjectId(id)).toBe(id);
    expect(
      normalizeAdminObjectId({
        toString: () => {
          throw new Error('admin route stringified arbitrary id');
        },
      }),
    ).toBeUndefined();
  });

  it('serializes admin DTO ids without arbitrary object string coercion', () => {
    const maliciousId = {
      toString: () => {
        throw new Error('admin DTO stringified arbitrary id');
      },
    };

    expect(adminListingDto({ _id: maliciousId })).toMatchObject({ _id: '', id: '' });
    expect(adminFellowshipDto({ _id: maliciousId })).toMatchObject({ _id: '', id: '' });
    expect(adminResearchAreaDto({ _id: maliciousId })).toMatchObject({ _id: '' });
    expect(adminDepartmentDto({ _id: maliciousId })).toMatchObject({ _id: '' });
    expect(adminAccessReviewRecordUpdateDto({ _id: maliciousId })).toMatchObject({
      _id: '',
      id: '',
    });
  });

  it('serializes admin listings through an allowlist payload', () => {
    const rawListing = {
      _id: new mongoose.Types.ObjectId('507f1f77bcf86cd799439011'),
      ownerId: 'abc123',
      ownerFirstName: 'Ada',
      ownerLastName: 'Lovelace',
      ownerEmail: 'ada@example.edu',
      ownerTitle: 'Professor',
      ownerPrimaryDepartment: 'Computer Science',
      professorIds: ['abc123'],
      professorNames: ['Ada Lovelace'],
      departments: ['Computer Science'],
      emails: ['lab@example.edu'],
      websites: [
        'https://example.edu/lab',
        'http://localhost/admin',
        'https://user:pass@example.edu/private',
      ],
      title: 'Research Lab',
      hiringStatus: 1,
      description: 'A useful research description',
      applicantDescription: 'Apply with a short note',
      researchAreas: ['AI'],
      keywords: ['systems'],
      views: 12,
      favorites: 3,
      archived: false,
      confirmed: true,
      audited: true,
      descriptionLength: 29,
      redFlagScore: 0,
      researchEntityId: 'entity-1',
      researchGroupId: 'group-1',
      createdByUserId: 'user-1',
      sourceEvidenceIds: ['source-1'],
      embedding: [0.1, 0.2],
      archivedAt: new Date('2026-01-01T00:00:00.000Z'),
      __v: 7,
    };

    const serialized = adminListingDto(rawListing) as Record<string, unknown>;

    expect(serialized).toMatchObject({
      _id: '507f1f77bcf86cd799439011',
      id: '507f1f77bcf86cd799439011',
      ownerId: 'abc123',
      ownerFirstName: 'Ada',
      ownerLastName: 'Lovelace',
      ownerEmail: 'ada@example.edu',
      ownerTitle: 'Professor',
      ownerPrimaryDepartment: 'Computer Science',
      professorIds: ['abc123'],
      professorNames: ['Ada Lovelace'],
      departments: ['Computer Science'],
      emails: ['lab@example.edu'],
      websites: ['https://example.edu/lab'],
      title: 'Research Lab',
      hiringStatus: 1,
      description: 'A useful research description',
      applicantDescription: 'Apply with a short note',
      researchAreas: ['AI'],
      keywords: ['systems'],
      views: 12,
      favorites: 3,
      archived: false,
      confirmed: true,
      audited: true,
      descriptionLength: 29,
      redFlagScore: 0,
    });
    expect(serialized).not.toHaveProperty('researchEntityId');
    expect(serialized).not.toHaveProperty('researchGroupId');
    expect(serialized).not.toHaveProperty('createdByUserId');
    expect(serialized).not.toHaveProperty('sourceEvidenceIds');
    expect(serialized).not.toHaveProperty('embedding');
    expect(serialized).not.toHaveProperty('archivedAt');
    expect(serialized).not.toHaveProperty('__v');
  });

  it('serializes admin fellowships through an allowlist payload', () => {
    const rawFellowship = {
      _id: new mongoose.Types.ObjectId('507f1f77bcf86cd799439012'),
      title: 'Summer Research Program',
      competitionType: 'Application',
      summary: 'Short summary',
      description: 'Full description',
      applicationInformation: 'Apply online',
      eligibility: 'Undergraduates',
      restrictionsToUseOfAward: 'Research use',
      additionalInformation: 'More information',
      links: [
        { label: 'Program', url: 'https://example.edu/program' },
        { label: 'Local', url: 'http://localhost/admin' },
      ],
      applicationLink: 'https://example.edu/apply',
      awardAmount: '$5,000',
      isAcceptingApplications: true,
      contactName: 'Program Office',
      contactEmail: 'program@example.edu',
      contactPhone: '203-555-0100',
      contactOffice: 'Office of Research',
      yearOfStudy: ['Sophomore'],
      termOfAward: ['Summer'],
      purpose: ['Research'],
      globalRegions: ['United States'],
      citizenshipStatus: ['Any'],
      archived: false,
      audited: true,
      views: 10,
      favorites: 4,
      sourceKey: 'private-source-key',
      sourceFingerprint: 'fingerprint',
      sourceLastVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
      studentVisibilityTier: 'PUBLIC',
      studentVisibilityReviewedByUserId: 'reviewer-1',
      studentVisibilityReasons: ['reason'],
      __v: 9,
    };

    const serialized = adminFellowshipDto(rawFellowship) as Record<string, unknown>;

    expect(serialized).toMatchObject({
      _id: '507f1f77bcf86cd799439012',
      id: '507f1f77bcf86cd799439012',
      title: 'Summer Research Program',
      competitionType: 'Application',
      summary: 'Short summary',
      description: 'Full description',
      applicationInformation: 'Apply online',
      eligibility: 'Undergraduates',
      restrictionsToUseOfAward: 'Research use',
      additionalInformation: 'More information',
      links: [{ label: 'Program', url: 'https://example.edu/program' }],
      applicationLink: 'https://example.edu/apply',
      awardAmount: '$5,000',
      isAcceptingApplications: true,
      contactName: 'Program Office',
      contactEmail: 'program@example.edu',
      contactPhone: '203-555-0100',
      contactOffice: 'Office of Research',
      yearOfStudy: ['Sophomore'],
      termOfAward: ['Summer'],
      purpose: ['Research'],
      globalRegions: ['United States'],
      citizenshipStatus: ['Any'],
      archived: false,
      audited: true,
      views: 10,
      favorites: 4,
    });
    expect(serialized).not.toHaveProperty('sourceKey');
    expect(serialized).not.toHaveProperty('sourceFingerprint');
    expect(serialized).not.toHaveProperty('sourceLastVerifiedAt');
    expect(serialized).not.toHaveProperty('studentVisibilityTier');
    expect(serialized).not.toHaveProperty('studentVisibilityReviewedByUserId');
    expect(serialized).not.toHaveProperty('studentVisibilityReasons');
    expect(serialized).not.toHaveProperty('__v');
  });

  it('rejects invalid access-review record types before review update work', async () => {
    const res = await invokeRouteHandler('/access-review/records/:type/:recordId/review', {
      params: {
        type: '$where',
        recordId: '507f1f77bcf86cd799439011',
      },
      body: {
        status: 'reviewed',
      },
    }, 'put');

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid review record type' });
  });

  it('minimizes access-review record update responses', () => {
    const payload = adminAccessReviewRecordUpdateDto({
      _id: new mongoose.Types.ObjectId('507f1f77bcf86cd799439013'),
      archived: true,
      review: {
        status: 'approved',
        reviewedByUserId: 'internal-reviewer-id',
        reviewedAt: '2026-06-11T12:00:00.000Z',
        note: 'Reviewed note',
        lockedFields: ['bestNextStep', 'sourceEvidenceIds'],
      },
      sourceEvidenceIds: ['evidence-1'],
      sourceEvidenceId: 'evidence-2',
      observationId: 'observation-1',
      sourceUrls: ['https://example.edu/source'],
      sourceName: 'Private Source',
      email: 'person@example.edu',
      personName: 'Private Person',
      evidenceItems: [{ excerpt: 'private evidence excerpt' }],
      confidenceByField: { label: 0.2 },
      manuallyLockedFields: ['sourceName'],
      __v: 3,
    }) as Record<string, unknown>;

    expect(payload).toEqual({
      _id: '507f1f77bcf86cd799439013',
      id: '507f1f77bcf86cd799439013',
      archived: true,
      review: {
        status: 'approved',
        reviewedAt: '2026-06-11T12:00:00.000Z',
        note: 'Reviewed note',
        lockedFields: ['bestNextStep', 'sourceEvidenceIds'],
      },
    });
    expect(JSON.stringify(payload)).not.toContain('internal-reviewer-id');
    expect(JSON.stringify(payload)).not.toContain('evidence-1');
    expect(JSON.stringify(payload)).not.toContain('person@example.edu');
    expect(JSON.stringify(payload)).not.toContain('private evidence excerpt');
  });

  it('caps admin list pagination before building Mongo skip and limit values', () => {
    expect(normalizeAdminPagination('999999999', '500')).toEqual({
      page: 1000,
      pageSize: 100,
    });
    expect(normalizeAdminPagination('-20', 'not-a-number')).toEqual({
      page: 1,
      pageSize: 25,
    });
    expect(
      normalizeAdminPagination({ toString: () => '999999999' }, ['500']),
    ).toEqual({
      page: 1,
      pageSize: 25,
    });
    expect(normalizeAdminPagination('9'.repeat(17), '5'.repeat(17))).toEqual({
      page: 1,
      pageSize: 25,
    });
  });

  it('rejects oversized admin search before trimming', () => {
    expect(normalizeAdminSearchTerm(' '.repeat(121))).toEqual({
      searchTerm: '',
      errorCode: 'tooLong',
    });
    expect(normalizeAdminSearchTerm(['research'])).toEqual({
      searchTerm: '',
      errorCode: 'notString',
    });
  });

  it('bounds admin taxonomy labels before persistence', () => {
    expect(normalizeAdminTaxonomyLabel('  Molecular    Biology  ', 'department name')).toBe(
      'Molecular Biology',
    );
    expect(() =>
      normalizeAdminTaxonomyLabel('x'.repeat(MAX_ADMIN_TAXONOMY_LABEL_LENGTH + 1), 'department name'),
    ).toThrow('Invalid department name');
    expect(() =>
      normalizeAdminTaxonomyLabel(
        'MCDB contact pi@example.edu',
        'department name',
      ),
    ).toThrow('Invalid department name');
    expect(() =>
      normalizeAdminTaxonomyLabel(
        'x'.repeat(MAX_ADMIN_DEPARTMENT_ABBREVIATION_LENGTH + 1),
        'department abbreviation',
        MAX_ADMIN_DEPARTMENT_ABBREVIATION_LENGTH,
      ),
    ).toThrow('Invalid department abbreviation');
  });

  it('bounds admin department category arrays before persistence', () => {
    expect(normalizeAdminDepartmentCategories(undefined, 'Life Sciences' as any)).toEqual([
      'Life Sciences',
    ]);
    expect(normalizeAdminDepartmentCategories(['Life Sciences', 'Life Sciences'])).toEqual([
      'Life Sciences',
    ]);
    expect(() => normalizeAdminDepartmentCategories(['__proto__'])).toThrow(
      'Invalid department category',
    );
    expect(() =>
      normalizeAdminDepartmentCategories(
        Array.from({ length: MAX_ADMIN_DEPARTMENT_CATEGORIES + 1 }, () => 'Life Sciences'),
      ),
    ).toThrow('Invalid department categories');
  });

  it('rejects oversized admin search terms before model lookup', async () => {
    for (const path of ['/listings', '/profiles', '/fellowships']) {
      const res = await invokeRouteHandler(
        path,
        {
          query: { search: 'a'.repeat(121) },
        },
        'get',
      );

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'Search query is too long' });
    }

    expect(mocks.getListingModel).not.toHaveBeenCalled();
    expect(mocks.userFind).not.toHaveBeenCalled();
    expect(mocks.fellowshipFind).not.toHaveBeenCalled();
  });

  it('does not expose private account state on admin profile management payloads', () => {
    const payload = adminProfileDto(
      {
        _id: 'internal-user-id',
        netid: 'prof123',
        fname: 'Ada',
        lname: 'Lovelace',
        email: 'ada@yale.edu',
        userType: 'professor',
        userConfirmed: true,
        profileVerified: true,
        primaryDepartment: 'Computer Science',
        secondaryDepartments: ['Applied Math'],
        researchInterests: ['Computation'],
        hIndex: 42,
        orcid: '0000-0000-0000-0000',
        openAlexId: 'A123',
        imageUrl: 'https://example.edu/ada.jpg',
        profileUrls: { official: 'https://example.edu/ada' },
        topics: ['algorithms'],
        ownListings: ['listing1', 'listing2'],
        favListings: ['private-favorite-listing'],
        favFellowships: ['private-favorite-fellowship'],
        favPathways: ['private-favorite-pathway'],
        savedPathwayPlans: { pathway1: { note: 'private note' } },
        confidenceByField: { email: 0.1 },
        manuallyLockedFields: ['email'],
        dedupedIntoUserId: 'merged-user',
        dedupeReason: 'duplicate',
        publications: Array.from({ length: 501 }, (_, index) => ({ title: `Paper ${index}` })),
      },
      true,
    );

    expect(payload).toMatchObject({
      netid: 'prof123',
      primaryDepartment: 'Computer Science',
      primary_department: 'Computer Science',
      ownListingCount: 2,
      hIndex: 42,
      h_index: 42,
    });
    expect((payload.publications as unknown[])).toHaveLength(500);
    expect(payload).not.toHaveProperty('_id');
    expect(payload).not.toHaveProperty('ownListings');
    expect(payload).not.toHaveProperty('favListings');
    expect(payload).not.toHaveProperty('favFellowships');
    expect(payload).not.toHaveProperty('favPathways');
    expect(payload).not.toHaveProperty('savedPathwayPlans');
    expect(payload).not.toHaveProperty('confidenceByField');
    expect(payload).not.toHaveProperty('manuallyLockedFields');
    expect(payload).not.toHaveProperty('dedupedIntoUserId');
    expect(payload).not.toHaveProperty('dedupeReason');
    expect(JSON.stringify(payload)).not.toContain('private note');
    expect(JSON.stringify(payload)).not.toContain('private-favorite');
  });

  it('minimizes admin taxonomy management payloads', () => {
    const areaPayload = adminResearchAreaDto({
      _id: new mongoose.Types.ObjectId('507f1f77bcf86cd799439014'),
      name: 'AI Safety',
      field: 'Computing & Artificial Intelligence',
      colorKey: 'blue',
      isDefault: false,
      addedBy: 'faculty123',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-02',
      __v: 7,
    });
    const deptPayload = adminDepartmentDto({
      _id: new mongoose.Types.ObjectId('507f1f77bcf86cd799439015'),
      abbreviation: 'CPSC',
      name: 'Computer Science',
      displayName: 'CPSC - Computer Science',
      categories: ['Computing & AI'],
      primaryCategory: 'Computing & AI',
      colorKey: 0,
      isActive: true,
      aliases: ['Private alias'],
      sourceRecords: [{ sourceUrl: 'https://private.example/source' }],
      codeSystem: 'ycps_subject',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-02',
      __v: 7,
    });

    expect(areaPayload).toEqual({
      _id: '507f1f77bcf86cd799439014',
      name: 'AI Safety',
      field: 'Computing & Artificial Intelligence',
      colorKey: 'blue',
      isDefault: false,
    });
    expect(deptPayload).toEqual({
      _id: '507f1f77bcf86cd799439015',
      abbreviation: 'CPSC',
      name: 'Computer Science',
      displayName: 'CPSC - Computer Science',
      categories: ['Computing & AI'],
      primaryCategory: 'Computing & AI',
      colorKey: 0,
      isActive: true,
    });
    expect(JSON.stringify(areaPayload)).not.toContain('faculty123');
    expect(JSON.stringify(deptPayload)).not.toContain('sourceRecords');
    expect(JSON.stringify(deptPayload)).not.toContain('ycps_subject');
  });

  it('returns a client error for oversized access-review search terms', async () => {
    mocks.listAccessReviewEntities.mockRejectedValue(new Error('Search query is too long'));

    const res = await invokeRouteHandler(
      '/access-review',
      {
        query: { search: 'a'.repeat(121) },
      },
      'get',
    );

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Search query is too long' });
  });

  it('classifies private and special-use addresses as blocked', () => {
    for (const address of [
      '0.0.0.0',
      '10.1.2.3',
      '100.64.0.1',
      '127.0.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '192.168.0.1',
      '198.18.0.1',
      '224.0.0.1',
      '::',
      '::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '[::ffff:7f00:1]',
      '64:ff9b::127.0.0.1',
      'fc00::1',
      'fe80::1',
      'ff00::1',
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }

    expect(isPrivateAddress('8.8.8.8')).toBe(false);
    expect(isPrivateAddress('2606:4700:4700::1111')).toBe(false);
  });

  it('rejects hostnames when any DNS answer is private', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ] as any);

    await expect(isPublicHostname('rebind.example')).resolves.toBe(false);
  });

  it('allows hostnames only when every DNS answer is public', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ] as any);

    await expect(isPublicHostname('public.example')).resolves.toBe(true);
  });

  it('blocks private DNS answers during the actual outbound connection lookup', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue({ address: '169.254.169.254', family: 4 } as any);

    const result = await invokeSafeLookup('rebind.example');

    expect(result.error?.code).toBe('EHOSTUNREACH');
  });

  it('rejects admin URL checks for non-public hosts and unsafe URL forms before connect', async () => {
    await expect(checkAdminUrlReachability('http://169.254.169.254/latest/meta-data')).resolves.toEqual({
      url: 'http://169.254.169.254/latest/meta-data',
      status: 0,
      reachable: false,
      error: 'Blocked host',
    });

    await expect(checkAdminUrlReachability('http://[::ffff:127.0.0.1]')).resolves.toEqual({
      url: 'http://[::ffff:127.0.0.1]',
      status: 0,
      reachable: false,
      error: 'Blocked host',
    });

    await expect(checkAdminUrlReachability('https://example.com:8443')).resolves.toEqual({
      url: 'https://example.com:8443',
      status: 0,
      reachable: false,
      error: 'Unsupported port',
    });

    await expect(checkAdminUrlReachability('https://user:pass@example.com/private')).resolves.toEqual({
      url: 'https://example.com/private',
      status: 0,
      reachable: false,
      error: 'Credentials not supported',
    });
  });
});
