import { describe, expect, it } from 'vitest';

import { DevWriteLeaseStoppedError } from '../../../db/devWriteLease';
import { HttpStatusError } from '../httpFetch';
import { isTransientFetchFailure } from '../transientFetchFailure';

const withCode = (code: string) => Object.assign(new Error(code), { code });

describe('isTransientFetchFailure', () => {
  it.each([
    new HttpStatusError(403),
    new HttpStatusError(429),
    new HttpStatusError(502),
    Object.assign(new Error('Request failed'), { response: { status: 503 } }),
    withCode('ETIMEDOUT'),
    withCode('ECONNRESET'),
    withCode('EAI_AGAIN'),
    new DevWriteLeaseStoppedError('host:example.edu'),
  ])('treats %s as transient', (error) => {
    expect(isTransientFetchFailure(error)).toBe(true);
  });

  it.each([
    new HttpStatusError(404),
    new HttpStatusError(410),
    Object.assign(new Error('Request failed'), { response: { status: 401 } }),
    withCode('ECONNREFUSED'),
    withCode('EHOSTUNREACH'),
    withCode('ENETUNREACH'),
    withCode('ENOTFOUND'),
    withCode('CERT_HAS_EXPIRED'),
    new Error('refused a private address'),
    undefined,
    'a string',
  ])('treats %s as a page that is gone', (error) => {
    expect(isTransientFetchFailure(error)).toBe(false);
  });
});
