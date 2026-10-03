import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import * as Sentry from '@sentry/node';
import {
  captureServerError,
  captureServerWarning,
  getErrorTrackingConfig,
  scrubServerEvent,
  type DegradedSignal,
} from '../errorTracking';

vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  isInitialized: vi.fn(() => false),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  flush: vi.fn(),
  expressIntegration: vi.fn((options: unknown) => ({ name: 'Express', options })),
}));

const SYNTHETIC_NETID = 'zz9993';
const SYNTHETIC_EMAIL = 'synthetic.person@example.edu';
const SYNTHETIC_COOKIE = 'session=c2lnbmVkLXN5bnRoZXRpYw';
const SYNTHETIC_QUERY = 'private-synthetic-query';
const PLATFORM_REQUEST_ID = 'a1b2c3d4-e5f6-7890-abcd-ef0123456789';

const DEGRADED_SIGNALS: DegradedSignal[] = [
  'mongo_topology_lost',
  'embedding_breaker_open',
  'corpus_snapshot_failed',
  'gate_refresh_failed',
];

const requestWith = (headers: Record<string, string>): Request =>
  ({
    method: 'GET',
    originalUrl: `/api/users/${SYNTHETIC_NETID}?q=${SYNTHETIC_QUERY}`,
    baseUrl: '/api/users',
    route: { path: '/:netid' },
    headers: { cookie: SYNTHETIC_COOKIE, ...headers },
    user: { netId: SYNTHETIC_NETID, userType: 'undergraduate' },
  }) as unknown as Request;

const capturedExceptionContext = () =>
  vi.mocked(Sentry.captureException).mock.calls[0]?.[1] as { tags: Record<string, string> };

const DEGRADED_SIGNAL_REPORT_WINDOW_MS = 60_000;

vi.useFakeTimers({ toFake: ['Date'] });

beforeEach(() => {
  vi.clearAllMocks();
  vi.setSystemTime(Date.now() + 10 * DEGRADED_SIGNAL_REPORT_WINDOW_MS);
  process.env.SENTRY_DSN = 'https://public@example.com/1';
});

describe('the release an error report carries', () => {
  it('prefers an explicit SENTRY_RELEASE, then the deployed commit', () => {
    expect(
      getErrorTrackingConfig({ SENTRY_RELEASE: 'manual', RENDER_GIT_COMMIT: 'abc123' }).release,
    ).toBe('manual');
    expect(getErrorTrackingConfig({ RENDER_GIT_COMMIT: 'abc123' }).release).toBe('abc123');
    expect(
      getErrorTrackingConfig({ SENTRY_RELEASE: '', RENDER_GIT_COMMIT: 'abc123' }).release,
    ).toBe('abc123');
    expect(getErrorTrackingConfig({}).release).toBeUndefined();
  });
});

describe('the platform request id on an error report', () => {
  it('tags the report with a well-formed rndr-id', () => {
    captureServerError(new Error('boom'), requestWith({ 'rndr-id': PLATFORM_REQUEST_ID }));

    expect(capturedExceptionContext().tags.rndrId).toBe(PLATFORM_REQUEST_ID);
  });

  it('drops an rndr-id that could carry free text', () => {
    captureServerError(new Error('boom'), requestWith({ 'rndr-id': SYNTHETIC_EMAIL }));

    expect(capturedExceptionContext().tags).not.toHaveProperty('rndrId');
  });

  it('sends no netid, email, cookie or query text alongside the request id', () => {
    captureServerError(new Error('boom'), requestWith({ 'rndr-id': PLATFORM_REQUEST_ID }));

    const payload = JSON.stringify(capturedExceptionContext());
    expect(payload).not.toContain(SYNTHETIC_NETID);
    expect(payload).not.toContain(SYNTHETIC_EMAIL);
    expect(payload).not.toContain('c2lnbmVkLXN5bnRoZXRpYw');
    expect(payload).not.toContain(SYNTHETIC_QUERY);
  });
});

describe('degraded-service warnings', () => {
  it.each(DEGRADED_SIGNALS)(
    'reports %s as a warning grouped by its own name and nothing else',
    (signal) => {
      captureServerWarning(signal);

      expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
      expect(Sentry.captureMessage).toHaveBeenCalledWith(signal, {
        level: 'warning',
        fingerprint: [signal],
        tags: { signal },
      });
    },
  );

  it('sends one event per signal per window however often the signal repeats', () => {
    for (let request = 0; request < 50; request += 1) {
      captureServerWarning('mongo_topology_lost');
    }
    captureServerWarning('embedding_breaker_open');
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(2);

    vi.setSystemTime(Date.now() + DEGRADED_SIGNAL_REPORT_WINDOW_MS - 1);
    captureServerWarning('mongo_topology_lost');
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(2);

    vi.setSystemTime(Date.now() + 1);
    captureServerWarning('mongo_topology_lost');
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(3);
  });

  it('sends nothing when no DSN is configured', () => {
    delete process.env.SENTRY_DSN;

    captureServerWarning('mongo_topology_lost');

    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });

  it('strips request, user and breadcrumb data a request scope attaches to a warning', () => {
    const scrubbed = scrubServerEvent({
      type: undefined,
      level: 'warning',
      message: 'mongo_topology_lost',
      fingerprint: ['mongo_topology_lost'],
      tags: { signal: 'mongo_topology_lost' },
      user: { id: SYNTHETIC_NETID, email: SYNTHETIC_EMAIL },
      request: {
        method: 'GET',
        url: `https://example.test/api/users/${SYNTHETIC_NETID}?q=${SYNTHETIC_QUERY}`,
        query_string: `q=${SYNTHETIC_QUERY}`,
        cookies: { session: SYNTHETIC_COOKIE },
        headers: { cookie: SYNTHETIC_COOKIE },
      },
      transaction: `GET /api/users/${SYNTHETIC_NETID}`,
      breadcrumbs: [{ message: `signed in ${SYNTHETIC_EMAIL}` }],
    } as Sentry.ErrorEvent);

    const serialized = JSON.stringify(scrubbed);
    expect(scrubbed.message).toBe('mongo_topology_lost');
    expect(scrubbed.fingerprint).toStrictEqual(['mongo_topology_lost']);
    expect(serialized).not.toContain(SYNTHETIC_NETID);
    expect(serialized).not.toContain(SYNTHETIC_EMAIL);
    expect(serialized).not.toContain('c2lnbmVkLXN5bnRoZXRpYw');
    expect(serialized).not.toContain(SYNTHETIC_QUERY);
  });
});
