import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestMock = vi.fn();

vi.mock('axios', () => ({
  default: { request: (...args: unknown[]) => requestMock(...args) },
}));

vi.mock('../../utils/ssrfGuard', () => ({
  assertPublicHttpUrl: async (url: string) => new URL(url),
  ssrfSafeAgents: () => ({ httpAgent: undefined, httpsAgent: undefined }),
}));

import {
  classifySourceLinkHealth,
  isLikelyUnavailableSourceLink,
  probeSourceLink,
} from '../sourceLinkHealth';

describe('classifySourceLinkHealth', () => {
  it('treats 2xx responses as healthy', () => {
    expect(classifySourceLinkHealth({ status: 200 })).toEqual({
      healthStatus: 'HEALTHY',
      httpStatusCode: 200,
    });
  });

  it('treats 3xx responses as redirected but reachable', () => {
    expect(classifySourceLinkHealth({ status: 301 })).toEqual({
      healthStatus: 'REDIRECTED',
      httpStatusCode: 301,
    });
  });

  it('treats 4xx and 5xx responses as unavailable with their status', () => {
    expect(classifySourceLinkHealth({ status: 404 })).toEqual({
      healthStatus: 'UNAVAILABLE',
      httpStatusCode: 404,
    });
    expect(classifySourceLinkHealth({ status: 503 })).toEqual({
      healthStatus: 'UNAVAILABLE',
      httpStatusCode: 503,
    });
  });

  it('treats dead-domain network errors as unavailable without a status', () => {
    expect(classifySourceLinkHealth({ errorCode: 'ENOTFOUND' })).toEqual({
      healthStatus: 'UNAVAILABLE',
    });
    expect(classifySourceLinkHealth({ errorCode: 'ECONNREFUSED' })).toEqual({
      healthStatus: 'UNAVAILABLE',
    });
  });

  it('leaves ambiguous failures (timeout, blocked) as unknown so temporary blips are not marked', () => {
    expect(classifySourceLinkHealth({ errorCode: 'ECONNABORTED' })).toEqual({
      healthStatus: 'UNKNOWN',
    });
    expect(classifySourceLinkHealth({ errorCode: 'ERR_SSRF_BLOCKED' })).toEqual({
      healthStatus: 'UNKNOWN',
    });
    expect(classifySourceLinkHealth({})).toEqual({ healthStatus: 'UNKNOWN' });
  });
});

describe('probeSourceLink', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  const headOnlyStatus = (status: number) => {
    requestMock.mockResolvedValueOnce({ status });
  };

  it('uses the HEAD status directly when HEAD succeeds', async () => {
    headOnlyStatus(200);
    await expect(probeSourceLink('https://example.com/paper')).resolves.toEqual({
      status: 200,
    });
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(requestMock.mock.calls[0][0]).toMatchObject({ method: 'HEAD' });
  });

  it.each([400, 403, 405, 501, 500])(
    'falls back to GET when HEAD returns %i and reports the GET status',
    async (headStatus) => {
      const destroy = vi.fn();
      requestMock
        .mockResolvedValueOnce({ status: headStatus })
        .mockResolvedValueOnce({ status: 200, data: { destroy } });

      await expect(probeSourceLink('https://example.com/paper')).resolves.toEqual({
        status: 200,
      });
      expect(requestMock).toHaveBeenCalledTimes(2);
      expect(requestMock.mock.calls[1][0]).toMatchObject({ method: 'GET' });
      expect(destroy).toHaveBeenCalledTimes(1);
    },
  );

  it('reports the GET status when the GET fallback also fails', async () => {
    requestMock
      .mockResolvedValueOnce({ status: 501 })
      .mockResolvedValueOnce({ status: 404, data: { destroy: vi.fn() } });

    await expect(probeSourceLink('https://example.com/paper')).resolves.toEqual({
      status: 404,
    });
  });
});

describe('isLikelyUnavailableSourceLink', () => {
  it('is true for UNAVAILABLE health or any status at or above 400', () => {
    expect(isLikelyUnavailableSourceLink({ healthStatus: 'UNAVAILABLE' })).toBe(true);
    expect(isLikelyUnavailableSourceLink({ healthStatus: 'UNKNOWN', httpStatusCode: 404 })).toBe(
      true,
    );
    expect(isLikelyUnavailableSourceLink({ healthStatus: 'HEALTHY', httpStatusCode: 410 })).toBe(
      true,
    );
  });

  it('is false for healthy, redirected, unknown, or missing health', () => {
    expect(isLikelyUnavailableSourceLink({ healthStatus: 'HEALTHY', httpStatusCode: 200 })).toBe(
      false,
    );
    expect(isLikelyUnavailableSourceLink({ healthStatus: 'REDIRECTED', httpStatusCode: 301 })).toBe(
      false,
    );
    expect(isLikelyUnavailableSourceLink({ healthStatus: 'UNKNOWN' })).toBe(false);
    expect(isLikelyUnavailableSourceLink(undefined)).toBe(false);
  });
});
