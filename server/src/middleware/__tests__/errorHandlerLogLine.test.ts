import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

vi.mock('../../utils/errorTracking', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/errorTracking')>()),
  captureServerError: vi.fn(),
  captureServerWarning: vi.fn(),
}));

import { errorHandler } from '../errorHandler';

const SYNTHETIC_NETID = 'zz9993';
const SYNTHETIC_EMAIL = 'synthetic.person@example.edu';
const SYNTHETIC_SESSION_COOKIE = 'session=c2lnbmVkLXN5bnRoZXRpYw; session.sig=abc123';
const SYNTHETIC_QUERY = 'private-synthetic-query';
const PLATFORM_REQUEST_ID = 'a1b2c3d4-e5f6-7890-abcd-ef0123456789';

const createResponse = () =>
  ({
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  }) as unknown as Response;

const parameterisedRequest = (headers: Record<string, string> = {}): Request =>
  ({
    method: 'GET',
    originalUrl: `/api/users/${SYNTHETIC_NETID}?q=${SYNTHETIC_QUERY}&email=${SYNTHETIC_EMAIL}`,
    baseUrl: '/api/users',
    route: { path: '/:netid' },
    params: { netid: SYNTHETIC_NETID },
    headers: { cookie: SYNTHETIC_SESSION_COOKIE, ...headers },
    session: { passport: { user: { netId: SYNTHETIC_NETID } } },
    user: { netId: SYNTHETIC_NETID, userType: 'undergraduate' },
  }) as unknown as Request;

const loggedLines = (consoleError: ReturnType<typeof vi.spyOn>): string[] =>
  consoleError.mock.calls.map((call: unknown[]) => call.map(String).join(' '));

const serverErrorEntry = (consoleError: ReturnType<typeof vi.spyOn>) => {
  const line = loggedLines(consoleError).find((candidate) => candidate.startsWith('{'));
  expect(line).toBeTruthy();
  return JSON.parse(line as string) as Record<string, unknown>;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the server error log line', () => {
  it('is one JSON line naming the route template and the platform request id', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    errorHandler(
      new Error('lookup failed'),
      parameterisedRequest({ 'rndr-id': PLATFORM_REQUEST_ID }),
      createResponse(),
      vi.fn() as unknown as NextFunction,
    );

    expect(serverErrorEntry(consoleError)).toStrictEqual({
      event: 'server_error',
      method: 'GET',
      route: '/api/users/:netid',
      rndrId: PLATFORM_REQUEST_ID,
      message: 'lookup failed',
    });
  });

  it('omits the request id when the platform did not send one', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    errorHandler(
      new Error('lookup failed'),
      parameterisedRequest(),
      createResponse(),
      vi.fn() as unknown as NextFunction,
    );

    expect(serverErrorEntry(consoleError)).not.toHaveProperty('rndrId');
  });

  it('refuses a request id that is not a short run of letters, digits and hyphens', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    errorHandler(
      new Error('lookup failed'),
      parameterisedRequest({ 'rndr-id': SYNTHETIC_EMAIL }),
      createResponse(),
      vi.fn() as unknown as NextFunction,
    );
    errorHandler(
      new Error('lookup failed'),
      parameterisedRequest({ 'rndr-id': 'a'.repeat(65) }),
      createResponse(),
      vi.fn() as unknown as NextFunction,
    );

    for (const line of loggedLines(consoleError).filter((entry) => entry.startsWith('{'))) {
      expect(JSON.parse(line)).not.toHaveProperty('rndrId');
    }
  });

  it('carries no netid, email, session cookie, session id or query text', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    errorHandler(
      new Error(`lookup failed for ${SYNTHETIC_EMAIL}`),
      parameterisedRequest({ 'rndr-id': PLATFORM_REQUEST_ID }),
      createResponse(),
      vi.fn() as unknown as NextFunction,
    );

    const logged = loggedLines(consoleError).join('\n');
    expect(logged).not.toContain(SYNTHETIC_NETID);
    expect(logged).not.toContain(SYNTHETIC_EMAIL);
    expect(logged).not.toContain('c2lnbmVkLXN5bnRoZXRpYw');
    expect(logged).not.toContain('abc123');
    expect(logged).not.toContain(SYNTHETIC_QUERY);
  });
});
