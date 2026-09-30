import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  __resetErrorTrackingForTests,
  captureClientError,
  initializeErrorTracking,
} from '../errorTracking';
import { scrubBreadcrumb, scrubErrorEvent } from '../errorReportScrubbing';
import * as Sentry from '@sentry/react';

vi.mock('@sentry/react', () => ({
  init: vi.fn(),
  captureException: vi.fn(),
}));

afterEach(() => {
  __resetErrorTrackingForTests();
  vi.clearAllMocks();
});

describe('client errorTracking', () => {
  it('does not initialize without a DSN', async () => {
    expect(initializeErrorTracking({ environment: 'test' })).toBe(false);
    await Promise.resolve();
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('reports nothing while no DSN has ever been configured', async () => {
    await captureClientError(new Error('synthetic failure'));

    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('reports an error raised before the SDK finished loading', async () => {
    initializeErrorTracking({ dsn: 'https://public@example.com/1', environment: 'test' });

    await captureClientError(new Error('synthetic failure'), 'at SyntheticComponent');

    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      contexts: { react: { componentStack: 'at SyntheticComponent' } },
    });
  });

  it('loads the SDK only after a DSN is configured, then passes environment and release tags', async () => {
    expect(Sentry.init).not.toHaveBeenCalled();

    expect(
      initializeErrorTracking({
        dsn: 'https://public@example.com/1',
        environment: 'staging',
        release: 'abc123',
      }),
    ).toBe(true);

    await vi.waitFor(() => expect(Sentry.init).toHaveBeenCalledTimes(1));

    expect(Sentry.init).toHaveBeenCalledWith({
      dsn: 'https://public@example.com/1',
      environment: 'staging',
      release: 'abc123',
      sendDefaultPii: false,
      beforeSend: scrubErrorEvent,
      beforeBreadcrumb: scrubBreadcrumb,
    });
  });
});
