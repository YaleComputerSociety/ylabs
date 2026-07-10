import { describe, expect, it, vi } from 'vitest';
import { createUser, updateUser, validateUser } from '../../services/userService';
import router from '../seed';

vi.mock('../../services/userService', () => ({
  createUser: vi.fn(),
  updateUser: vi.fn(),
  validateUser: vi.fn(),
}));

vi.mock('../../services/listingService', () => ({
  readAllListings: vi.fn(),
  updateListing: vi.fn(),
}));

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

const invokeRequireSeedToken = async (headers: Record<string, string | undefined> = {}) => {
  const layer = (router as any).stack.find(
    (candidate: any) => !candidate.route && candidate.handle?.name === 'requireSeedToken',
  );
  expect(layer).toBeTruthy();

  const req = {
    get: vi.fn((name: string) => headers[name.toLowerCase()]),
  } as any;
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
  } as any;
  const next = vi.fn();

  await layer.handle(req, res, next);
  return { res, next };
};

const invokeRequireLocalSeedRuntime = async () => {
  const layer = (router as any).stack.find(
    (candidate: any) => !candidate.route && candidate.handle?.name === 'requireLocalSeedRuntime',
  );
  expect(layer).toBeTruthy();

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
  } as any;
  const next = vi.fn();

  await layer.handle({} as any, res, next);
  return { res, next };
};

describe('seed routes', () => {
  it('validates listing ids before seed listing update handlers', () => {
    const routeLayer = (router as any).stack.find(
      (candidate: any) => candidate.route?.path === '/listings/:id' && candidate.route?.methods?.put,
    );

    expect(routeLayer).toBeTruthy();
    expect(routeLayer.route.stack.length).toBeGreaterThanOrEqual(2);
  });

  it('marks token-gated seed responses as private no-store payloads', async () => {
    expect(middlewareNames()).toContain('setPrivateSeedCacheHeaders');
    expect(middlewareNames()).toContain('requireLocalSeedRuntime');

    const { res, next } = await invokeMiddleware('setPrivateSeedCacheHeaders');

    expect(res.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'no-store, private, max-age=0',
    );
    expect(res.setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
    expect(res.setHeader).toHaveBeenCalledWith('Surrogate-Control', 'no-store');
    expect(next).toHaveBeenCalledOnce();
  });

  it('fails closed outside local development even if the seed router is mounted', async () => {
    const originalEnv = { ...process.env };
    process.env = {
      ...originalEnv,
      NODE_ENV: 'production',
      SERVER_BASE_URL: 'https://yalelabs.io',
    };

    try {
      const { res, next } = await invokeRequireLocalSeedRuntime();

      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({ error: 'Not found' });
      expect(next).not.toHaveBeenCalled();
    } finally {
      process.env = originalEnv;
    }
  });

  it('allows the seed token gate to run in true local development', async () => {
    const originalEnv = { ...process.env };
    process.env = {
      ...originalEnv,
      NODE_ENV: 'development',
      SERVER_BASE_URL: 'http://localhost:4000',
    };

    try {
      const { res, next } = await invokeRequireLocalSeedRuntime();

      expect(res.statusCode).toBe(200);
      expect(next).toHaveBeenCalledOnce();
    } finally {
      process.env = originalEnv;
    }
  });

  it('rejects oversized seed tokens before accepting token-gated routes', async () => {
    const originalSeedToken = process.env.SEED_TOKEN;
    process.env.SEED_TOKEN = 's'.repeat(32);

    try {
      const { res, next } = await invokeRequireSeedToken({
        'x-seed-token': 'x'.repeat(257),
      });

      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({ error: 'Invalid seed token' });
      expect(next).not.toHaveBeenCalled();
    } finally {
      if (originalSeedToken === undefined) delete process.env.SEED_TOKEN;
      else process.env.SEED_TOKEN = originalSeedToken;
    }
  });

  it('disables seed routes when the configured token is malformed', async () => {
    const originalSeedToken = process.env.SEED_TOKEN;
    process.env.SEED_TOKEN = 'x'.repeat(257);

    try {
      const { res, next } = await invokeRequireSeedToken({
        'x-seed-token': 'x'.repeat(257),
      });

      expect(res.statusCode).toBe(503);
      expect(res.body).toEqual({ error: 'Seed routes disabled' });
      expect(next).not.toHaveBeenCalled();
    } finally {
      if (originalSeedToken === undefined) delete process.env.SEED_TOKEN;
      else process.env.SEED_TOKEN = originalSeedToken;
    }
  });

  it('serializes seed response ids without arbitrary object string coercion', async () => {
    const routeLayer = (router as any).stack.find(
      (candidate: any) => candidate.route?.path === '/users' && candidate.route?.methods?.post,
    );
    const handler = routeLayer.route.stack.at(-1).handle;
    const maliciousId = {
      toString: () => {
        throw new Error('seed route stringified arbitrary id');
      },
    };
    vi.mocked(validateUser).mockResolvedValueOnce(null as any);
    vi.mocked(createUser).mockResolvedValueOnce({
      _id: maliciousId,
      netid: 'abc123',
      userType: 'professor',
      userConfirmed: true,
      profileVerified: true,
    } as any);

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

    await handler({ body: { netid: 'abc123' } }, res);

    expect(vi.mocked(updateUser)).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
    expect(res.body).toMatchObject({
      action: 'created',
      user: {
        _id: '',
        netid: 'abc123',
      },
    });
  });
});
