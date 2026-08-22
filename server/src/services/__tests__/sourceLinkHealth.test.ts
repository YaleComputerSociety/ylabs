import { describe, expect, it } from 'vitest';
import {
  classifySourceLinkHealth,
  isLikelyUnavailableSourceLink,
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
