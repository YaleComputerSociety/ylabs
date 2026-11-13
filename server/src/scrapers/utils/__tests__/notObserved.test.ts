import { describe, expect, it } from 'vitest';

import { SsrfBlockedError } from '../../../utils/ssrfGuard';
import { excludedHostRedirectError } from '../../../utils/excludedHosts';
import { HostSlotWaitTimeoutError } from '../hostConcurrencyLimiter';
import { HttpStatusError } from '../httpFetch';
import { HostPausedError } from '../hostPause';
import { HostBudgetUnavailableError } from '../machineHostBudget';
import { HOST_LEVEL_OBSERVED_ERROR_CODES, isNotObserved } from '../notObserved';

const withCode = (code: string) => Object.assign(new Error(code), { code });
const wrapped = (inner: unknown) =>
  Object.assign(new Error('Redirected request failed'), {
    code: 'ERR_FR_REDIRECTION_FAILURE',
    cause: Object.assign(new Error('Redirected request failed'), { cause: inner }),
  });
const pause = new HostPausedError({
  host: 'dept.example.edu',
  until: new Date('2099-01-01T00:00:00Z'),
});

describe('isNotObserved', () => {
  it.each([
    ['a host pause', pause],
    ['a host pause wrapped twice by a redirect hook', wrapped(pause)],
    ['an SSRF guard refusal', new SsrfBlockedError('blocked', 'private-address')],
    [
      'a budget that could not be read',
      new HostBudgetUnavailableError('dept.example.edu', '/tmp/x', new Error('EACCES')),
    ],
    ['a slot wait that timed out', new HostSlotWaitTimeoutError('dept.example.edu', 1000)],
    ['an excluded-host redirect refusal', wrapped(excludedHostRedirectError())],
    [
      'a write lease held by another run',
      Object.assign(new Error('held'), { name: 'DevWriteLeaseHeldError' }),
    ],
    ['a timeout', withCode('ECONNABORTED')],
    ['a socket timeout', withCode('ETIMEDOUT')],
    ['a reset connection', withCode('ECONNRESET')],
    ['a temporary DNS failure', withCode('EAI_AGAIN')],
    ['a cancelled request', withCode('ERR_CANCELED')],
    ['an error with neither a status nor a code', new Error('something broke')],
    ['nothing at all', undefined],
  ])('treats %s as observing nothing', (_label, error) => {
    expect(isNotObserved(error)).toBe(true);
  });

  it.each([
    ['a 404', new HttpStatusError(404)],
    ['a 410', new HttpStatusError(410)],
    ['a 403 that outlasted its retries', new HttpStatusError(403)],
    [
      'an axios error carrying a response status',
      Object.assign(new Error('Request failed'), { response: { status: 500 } }),
    ],
    ['a DNS record confirmed absent', withCode('ENOTFOUND')],
    ['a refused connection', withCode('ECONNREFUSED')],
    ['an unroutable host', withCode('EHOSTUNREACH')],
    ['an unreachable network', withCode('ENETUNREACH')],
    ['a certificate that does not cover the host', withCode('ERR_TLS_CERT_ALTNAME_INVALID')],
    ['an expired certificate', withCode('CERT_HAS_EXPIRED')],
  ])('treats %s as an observation', (_label, error) => {
    expect(isNotObserved(error)).toBe(false);
  });

  it('keeps the host-level codes in step with what link-health may retire on', () => {
    expect([...HOST_LEVEL_OBSERVED_ERROR_CODES].sort()).toEqual(
      ['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND'].sort(),
    );
  });

  it('never lets the SSRF guard own unreachable refusal pass as a host-level observation', async () => {
    const { isSsrfGuardRefusal } = await import('../../../utils/ssrfGuard');
    const guardRefusals = [new SsrfBlockedError('blocked', 'private-address')];
    for (const refusal of guardRefusals) {
      expect(isSsrfGuardRefusal(refusal)).toBe(true);
      expect(isNotObserved(refusal)).toBe(true);
    }
  });
});
