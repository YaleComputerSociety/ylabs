import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { Sentry, sdkChunk } = vi.hoisted(() => ({
  Sentry: { init: vi.fn(), captureException: vi.fn() },
  sdkChunk: { fails: false },
}));

vi.mock('@sentry/react', () => ({
  get init() {
    if (sdkChunk.fails) throw new Error('synthetic chunk load failure');
    return Sentry.init;
  },
  captureException: Sentry.captureException,
}));

const loadErrorTracking = () => import('../errorTracking');

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  sdkChunk.fails = false;
  vi.clearAllMocks();
});

describe('client errorTracking', () => {
  it('does not initialize without a DSN', async () => {
    const { initializeErrorTracking } = await loadErrorTracking();

    expect(initializeErrorTracking({ environment: 'test' })).toBe(false);
    await Promise.resolve();
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('reports nothing while no DSN has ever been configured', async () => {
    const { captureClientError } = await loadErrorTracking();

    await captureClientError(new Error('synthetic failure'));

    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('reports an error raised before the SDK finished loading', async () => {
    const { captureClientError, initializeErrorTracking } = await loadErrorTracking();
    initializeErrorTracking({ dsn: 'https://public@example.com/1', environment: 'test' });

    await captureClientError(new Error('synthetic failure'), 'at SyntheticComponent');

    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      contexts: { react: { componentStack: 'at SyntheticComponent' } },
    });
  });

  it('drops a capture without rejecting when the SDK fails to load', async () => {
    sdkChunk.fails = true;
    const { captureClientError, initializeErrorTracking } = await loadErrorTracking();
    initializeErrorTracking({ dsn: 'https://public@example.com/1', environment: 'test' });

    await expect(captureClientError(new Error('synthetic failure'))).resolves.toBeUndefined();
    await expect(captureClientError(new Error('synthetic failure'))).resolves.toBeUndefined();
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('loads the SDK only after a DSN is configured, then passes environment and release tags', async () => {
    const { initializeErrorTracking } = await loadErrorTracking();
    const { scrubBreadcrumb, scrubErrorEvent } = await import('../errorReportScrubbing');
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
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: { request: { allow: ['User-Agent'] }, response: false },
        httpBodies: [],
        urlQueryParams: false,
        graphQL: { document: false, variables: false },
        genAI: { inputs: false, outputs: false },
        databaseQueryData: false,
        queues: false,
        stackFrameVariables: false,
      },
      attachStacktrace: false,
      beforeSend: scrubErrorEvent,
      beforeBreadcrumb: scrubBreadcrumb,
    });
  });
});
