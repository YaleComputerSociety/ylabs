import { afterEach, describe, expect, it, vi } from 'vitest';

const axiosMock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../axios', () => ({ default: axiosMock }));

import { SESSION_CSRF_HEADER, SESSION_CSRF_TOKEN_PATH, sessionCsrfHeaders } from '../sessionCsrf';

afterEach(() => {
  vi.clearAllMocks();
});

describe('sessionCsrfHeaders', () => {
  it("fetches this session's token from the general route and returns it as the header", async () => {
    axiosMock.get.mockResolvedValue({ data: { csrfToken: 'e'.repeat(64) } });

    await expect(sessionCsrfHeaders()).resolves.toEqual({ 'X-CSRF-Token': 'e'.repeat(64) });
    expect(SESSION_CSRF_HEADER).toBe('X-CSRF-Token');
    expect(SESSION_CSRF_TOKEN_PATH).toBe('/users/me/csrf-token');
    expect(axiosMock.get).toHaveBeenCalledWith('/users/me/csrf-token', undefined);
  });

  it('passes a route and request options through', async () => {
    axiosMock.get.mockResolvedValue({ data: {} });

    await expect(
      sessionCsrfHeaders('/users/me/deletion-csrf-token', { skipAuthRequiredEvent: true }),
    ).resolves.toEqual({ 'X-CSRF-Token': '' });
    expect(axiosMock.get).toHaveBeenCalledWith('/users/me/deletion-csrf-token', {
      skipAuthRequiredEvent: true,
    });
  });
});
