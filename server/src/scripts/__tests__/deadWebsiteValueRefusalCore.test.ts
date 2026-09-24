/**
 * "Unreachable" is four verdicts rather than one, and only one of them is a claim
 * about the page (#3191). The RED arms are the point of this suite: a name that does
 * not resolve, a certificate error, an egress refusal and a private-address host must
 * all fail to license a refusal, because each describes the probe rather than the
 * resource. A TLS failure in particular means a server answered.
 */
import { describe, expect, it } from 'vitest';
import {
  DEAD_WEBSITE_VALUE_REFUSAL_RULE,
  deadValueRefusalNote,
  deadValueRefusalVerdict,
  revivedValueWithdrawal,
} from '../deadWebsiteValueRefusalCore';
import { parseRefuseDeadWebsiteValuesArgs } from '../refuseDeadWebsiteValues';

describe('a probe that licenses a dead-value refusal', () => {
  it.each([404, 410])('accepts an explicit HTTP %s from the server', (status) => {
    const verdict = deadValueRefusalVerdict({
      status,
      requestedUrl: 'https://example.org/lab/',
      finalUrl: 'https://example.org/lab/',
    });

    expect(verdict).toEqual({ eligible: true, httpStatusCode: status });
  });

  it('names the rule the record carries', () => {
    expect(DEAD_WEBSITE_VALUE_REFUSAL_RULE).toBe('confirmed_dead_page');
  });

  it('dates the evidence, so staleness is judgeable later', () => {
    expect(
      deadValueRefusalNote({ httpStatusCode: 404, probedAt: new Date('2026-09-24T12:00:00Z') }),
    ).toContain('HTTP 404 when probed on 2026-09-24');
  });
});

describe('probes that must NOT license a refusal', () => {
  const inconclusive: Array<[string, Parameters<typeof deadValueRefusalVerdict>[0], RegExp]> = [
    ['a name that does not resolve', { errorCode: 'ENOTFOUND' }, /describes the request/],
    ['a refused connection', { errorCode: 'ECONNREFUSED' }, /describes the request/],
    ['an expired certificate', { errorCode: 'CERT_HAS_EXPIRED' }, /describes the request/],
    [
      'a certificate that does not cover the host',
      { errorCode: 'ERR_TLS_CERT_ALTNAME_INVALID' },
      /describes the request/,
    ],
    ['a reset connection', { errorCode: 'ECONNRESET' }, /describes the request/],
    ['an egress refusal', { errorCode: 'ERR_SSRF_BLOCKED' }, /describes the request/],
    ['a throttled request', { status: 429 }, /not a claim that the page is gone/],
    ['an access-controlled page', { status: 403 }, /not a claim that the page is gone/],
    ['a server outage', { status: 503 }, /not a claim that the page is gone/],
    ['a probe that learned nothing', {}, /no status and no error/],
  ];

  it.each(inconclusive)('refuses to call %s dead', (_label, probe, because) => {
    const verdict = deadValueRefusalVerdict(probe);

    expect(verdict.eligible).toBe(false);
    expect((verdict as { because: string }).because).toMatch(because);
  });

  it('refuses a private-address host even when it answers 404', () => {
    const verdict = deadValueRefusalVerdict({ status: 404, privateAddressHost: true });

    expect(verdict.eligible).toBe(false);
    expect((verdict as { because: string }).because).toMatch(/private-address/);
  });
});

describe('withdrawing the record when the page answers again', () => {
  it('withdraws on a clean 200 for the resource itself', () => {
    expect(
      revivedValueWithdrawal({
        status: 200,
        requestedUrl: 'https://example.org/lab/',
        finalUrl: 'https://example.org/lab/',
      }),
    ).toEqual({ revived: true, httpStatusCode: 200 });
  });

  /**
   * A 2xx that lands somewhere else is the soft-404 shape. Re-admitting a dead value
   * on it would undo the refusal on an inference, which is what this module avoids.
   */
  it('does not withdraw on a 200 that lands away from what was requested', () => {
    const verdict = revivedValueWithdrawal({
      status: 200,
      requestedUrl: 'https://medicine.yale.edu/lab/fixture/',
      finalUrl: 'https://medicine.yale.edu/',
    });

    expect(verdict.revived).toBe(false);
  });

  it('does not withdraw on a still-dead or inconclusive probe', () => {
    expect(revivedValueWithdrawal({ status: 404 }).revived).toBe(false);
    expect(revivedValueWithdrawal({ errorCode: 'ENOTFOUND' }).revived).toBe(false);
    expect(revivedValueWithdrawal({ status: 200, privateAddressHost: true }).revived).toBe(false);
  });
});

describe('the runner refuses to write without an explicit confirmation', () => {
  it('rejects --apply on its own', () => {
    expect(() => parseRefuseDeadWebsiteValuesArgs(['--apply'])).toThrow(
      /--confirm-dead-website-value-refusal/,
    );
  });

  it('accepts a confirmed apply and defaults to a dry run', () => {
    expect(
      parseRefuseDeadWebsiteValuesArgs(['--apply', '--confirm-dead-website-value-refusal']),
    ).toMatchObject({ apply: true, revive: false });
    expect(parseRefuseDeadWebsiteValuesArgs([])).toMatchObject({ apply: false, slugs: [] });
  });

  it('collects repeated slugs and reads the revive mode', () => {
    expect(
      parseRefuseDeadWebsiteValuesArgs(['--slug=a', '--slug=b', '--slug=a', '--revive']),
    ).toMatchObject({ slugs: ['a', 'b'], revive: true });
  });

  it('refuses an argument it does not recognise rather than ignoring it', () => {
    expect(() => parseRefuseDeadWebsiteValuesArgs(['--slugs=a'])).toThrow(/Unknown/);
  });
});
