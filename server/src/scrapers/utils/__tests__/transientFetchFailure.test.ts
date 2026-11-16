import { describe, expect, it } from 'vitest';

import { DevWriteLeaseStoppedError } from '../../../db/devWriteLease';
import { excludedHostRedirectError } from '../../../utils/excludedHosts';
import { SsrfBlockedError } from '../../../utils/ssrfGuard';
import { HostSlotWaitTimeoutError } from '../hostConcurrencyLimiter';
import { HttpStatusError } from '../httpFetch';
import { HostBudgetUnavailableError } from '../machineHostBudget';
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
    new SsrfBlockedError('blocked', 'private-address'),
    new HostBudgetUnavailableError('dept.example.edu', '/tmp/x', new Error('EACCES')),
    new HostSlotWaitTimeoutError('dept.example.edu', 1000),
    excludedHostRedirectError(),
    new Error('refused a private address'),
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
    new SsrfBlockedError('no record', 'unresolvable'),
    undefined,
    'a string',
  ])('treats %s as a page that is gone', (error) => {
    expect(isTransientFetchFailure(error)).toBe(false);
  });
});
