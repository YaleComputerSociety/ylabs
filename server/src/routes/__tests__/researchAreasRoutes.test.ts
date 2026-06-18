import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  researchAreaFind: vi.fn(),
  researchAreaFindOne: vi.fn(),
  researchAreaSave: vi.fn(),
}));

vi.mock('../../models/researchArea', () => {
  const ResearchField = {
    COMPUTING_AI: 'Computing & Artificial Intelligence',
    LIFE_SCIENCES: 'Life Sciences & Biology',
    PHYSICAL_SCIENCES: 'Physical Sciences & Engineering',
    HEALTH_MEDICINE: 'Health & Medicine',
    SOCIAL_SCIENCES: 'Social Sciences',
    HUMANITIES_ARTS: 'Humanities & Arts',
    ENVIRONMENTAL: 'Environmental Sciences',
    ECONOMICS: 'Economics',
    MATHEMATICS: 'Mathematics',
  };
  const ResearchArea = vi.fn(function (this: any, doc: Record<string, unknown>) {
    Object.assign(this, doc);
    this.save = mocks.researchAreaSave;
  });
  Object.assign(ResearchArea, {
    find: mocks.researchAreaFind,
    findOne: mocks.researchAreaFindOne,
  });

  return {
    ResearchArea,
    ResearchField,
    fieldColorKeys: Object.fromEntries(Object.values(ResearchField).map((field) => [field, 'gray'])),
  };
});

vi.mock('../../services/configService', () => ({
  invalidateConfigCache: vi.fn(),
}));

import router from '../researchAreas';

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

const routesByPath = (path: string) =>
  (router as any).stack.map((layer: any) => layer.route).filter((route: any) => route?.path === path);

const routeHandlerNames = (route: any): string[] =>
  (route?.stack || [])
    .map((layer: any) => layer.handle?.name)
    .filter(Boolean);

const invokeRouteHandler = async (path: string, method: string, request: any = {}) => {
  const route = routesByPath(path).find((candidate: any) => candidate.methods?.[method]);
  expect(route).toBeTruthy();
  const handler = route.stack[route.stack.length - 1].handle;
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    status: vi.fn(function (this: any, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: vi.fn(function (this: any, body: unknown) {
      this.body = body;
      return this;
    }),
  } as any;

  await handler(
    {
      body: {},
      query: {},
      user: { netId: 'faculty1' },
      ...request,
    },
    response,
  );
  return response;
};

describe('research area routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps shared research-area creation limited to faculty-style users', () => {
    const createRoutes = routesByPath('/');
    const postRoute = createRoutes.find((route: any) => route.methods?.post);

    expect(postRoute).toBeTruthy();
    expect(routeHandlerNames(postRoute)).toEqual(
      expect.arrayContaining(['isAuthenticated', 'isProfessor']),
    );
  });

  it('marks authenticated research-area responses as private no-store payloads', async () => {
    expect(middlewareNames()).toContain('setPrivateResearchAreaCacheHeaders');

    const { res, next } = await invokeMiddleware('setPrivateResearchAreaCacheHeaders');

    expect(res.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'no-store, private, max-age=0',
    );
    expect(res.setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects oversized research area names before duplicate lookup', async () => {
    const res = await invokeRouteHandler('/', 'post', {
      body: {
        name: 'a'.repeat(121),
        field: 'Computing & Artificial Intelligence',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ message: 'Research area name is too long' });
    expect(mocks.researchAreaFindOne).not.toHaveBeenCalled();
  });

  it('normalizes research area names before duplicate lookup and persistence', async () => {
    mocks.researchAreaFindOne.mockResolvedValue(null);

    const res = await invokeRouteHandler('/', 'post', {
      body: {
        name: '  Applied\n\nPrivacy\tResearch  ',
        field: 'Computing & Artificial Intelligence',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(mocks.researchAreaFindOne).toHaveBeenCalledWith({
      name: { $regex: /^Applied Privacy Research$/i },
    });
    expect(mocks.researchAreaSave.mock.instances?.[0]).toMatchObject({
      name: 'Applied Privacy Research',
      field: 'Computing & Artificial Intelligence',
    });
    expect(res.body).toMatchObject({
      researchArea: {
        name: 'Applied Privacy Research',
        field: 'Computing & Artificial Intelligence',
      },
    });
  });

  it('rejects research area names that embed direct contact information', async () => {
    const res = await invokeRouteHandler('/', 'post', {
      body: {
        name: 'AI outreach ada@example.edu',
        field: 'Computing & Artificial Intelligence',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      message: 'Research area name cannot include contact information',
    });
    expect(mocks.researchAreaFindOne).not.toHaveBeenCalled();
  });

  it('rejects oversized research area search queries before lookup', async () => {
    const res = await invokeRouteHandler('/search', 'get', {
      query: { query: 'a'.repeat(121) },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ message: 'Search query is too long' });
    expect(mocks.researchAreaFind).not.toHaveBeenCalled();
  });

  it('rejects blank research area search queries before lookup', async () => {
    const res = await invokeRouteHandler('/search', 'get', {
      query: { query: '   ' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ message: 'Search query is required' });
    expect(mocks.researchAreaFind).not.toHaveBeenCalled();
  });
});
