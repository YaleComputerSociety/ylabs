import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Request } from 'express';

import { captureServerError, initializeErrorTracking } from '../errorTracking';
import * as Sentry from '@sentry/node';

vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  captureException: vi.fn(),
}));

describe('server errorTracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SENTRY_DSN;
  });

  it('does not initialize without a DSN', () => {
    expect(initializeErrorTracking({ environment: 'test' })).toBe(false);
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('passes configurable environment and release tags to Sentry', () => {
    expect(
      initializeErrorTracking({
        dsn: 'https://public@example.com/1',
        environment: 'production',
        release: 'abc123',
      }),
    ).toBe(true);

    expect(Sentry.init).toHaveBeenCalledWith({
      dsn: 'https://public@example.com/1',
      environment: 'production',
      release: 'abc123',
    });
  });

  it('captures request context without raw query strings', () => {
    process.env.SENTRY_DSN = 'https://public@example.com/1';

    const error = new Error('boom');
    const req = {
      method: 'GET',
      path: '/api/research',
      originalUrl: '/api/research?query=private-search',
      user: { netId: 'abc123' },
    } as unknown as Request;

    captureServerError(error, req);

    expect(Sentry.captureException).toHaveBeenCalledWith(error, {
      tags: {
        method: 'GET',
        path: '/api/research',
      },
      user: { id: 'abc123' },
      contexts: {
        request: {
          path: '/api/research',
          method: 'GET',
        },
      },
    });
  });
});
