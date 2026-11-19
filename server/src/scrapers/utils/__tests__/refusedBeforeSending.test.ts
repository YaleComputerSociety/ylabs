import axios from 'axios';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  HostRateLimiter,
  fetchPageWithPolicy,
  isRefusedBeforeSending,
  isReusedResponse,
} from '../httpFetch';
import { HostPausedError } from '../hostPause';
import { HostBudgetUnavailableError } from '../machineHostBudget';
import {
  HostSlotWaitTimeoutError,
  installScraperHostConcurrencyInterceptor,
  type HostSlotLimiter,
} from '../hostConcurrencyLimiter';
import { recordHostBackoff, resetHostPauseStateForTests } from '../hostPauseState';

const FUTURE = new Date('2099-11-20T07:32:40Z');
const HOST = 'dept.example.edu';

const slotTimeout = () => new HostSlotWaitTimeoutError(HOST, 10);
const budgetUnavailable = () =>
  new HostBudgetUnavailableError(HOST, '/tmp/ylabs-host-budget', new Error('EACCES'));
const paused = () => new HostPausedError({ host: HOST, until: FUTURE });

let nextSlotError: unknown;
const throwingSlots: HostSlotLimiter = {
  acquire: async () => {
    if (nextSlotError) throw nextSlotError;
    return () => {};
  },
};

beforeAll(() => {
  installScraperHostConcurrencyInterceptor(throwingSlots, { acquireTimeoutMs: 50 });
});

afterEach(() => {
  nextSlotError = undefined;
  resetHostPauseStateForTests();
});

const policyFetch = (machineWide: () => HostSlotLimiter | undefined) =>
  fetchPageWithPolicy(`https://${HOST}/people/a`, {
    assertUrl: async (url: string) => new URL(url),
    limiter: new HostRateLimiter({ minIntervalMs: 0, sleep: async () => {}, machineWide }),
    sleep: async () => {},
    jitter: () => 0,
    maxRetries: 1,
    request: async () => ({ status: 200, data: '<p>page</p>', finalUrl: '' }),
  });

describe('an error that means the request never left this machine', () => {
  it('is recognised through fetchPageWithPolicy for a pause, no slot and an unreadable budget', async () => {
    await recordHostBackoff(HOST, { status: 403, statedUntil: FUTURE });
    const onPause = await policyFetch(() => undefined).catch((error: unknown) => error);
    expect(isRefusedBeforeSending(onPause)).toBe(true);
    resetHostPauseStateForTests();

    for (const make of [slotTimeout, budgetUnavailable]) {
      const refusal = await policyFetch(() => ({
        acquire: async () => {
          throw make();
        },
      })).catch((error: unknown) => error);

      expect((refusal as Error).name).toBe(make().name);
      expect(isRefusedBeforeSending(refusal)).toBe(true);
    }
  });

  it('is recognised through the raw axios interceptor for all three', async () => {
    await recordHostBackoff(HOST, { status: 403, statedUntil: FUTURE });
    const onPause = await axios.get(`https://${HOST}/people/a`).catch((error: unknown) => error);
    expect(isRefusedBeforeSending(onPause)).toBe(true);
    resetHostPauseStateForTests();

    for (const make of [slotTimeout, budgetUnavailable]) {
      nextSlotError = make();
      const refusal = await axios.get(`https://${HOST}/people/a`).catch((error: unknown) => error);

      expect(isRefusedBeforeSending(refusal)).toBe(true);
    }
  });

  it('is found behind a wrapper, because axios rewraps what a redirect hook threw', async () => {
    expect(isRefusedBeforeSending(new Error('wrapped', { cause: paused() }))).toBe(true);
    expect(
      isRefusedBeforeSending(new Error('twice', { cause: new Error('once', { cause: paused() }) })),
    ).toBe(true);
  });

  it('is not claimed for a page the host answered or for a connection it refused', async () => {
    const status = await fetchPageWithPolicy(`https://${HOST}/people/a`, {
      assertUrl: async (url: string) => new URL(url),
      limiter: new HostRateLimiter({ minIntervalMs: 0, sleep: async () => {} }),
      sleep: async () => {},
      jitter: () => 0,
      maxRetries: 0,
      request: async () => ({ status: 404, data: '', finalUrl: '' }),
    }).catch((error: unknown) => error);
    expect(isRefusedBeforeSending(status)).toBe(false);

    const transport = await axios.get('http://127.0.0.1:1/a').catch((error: unknown) => error);
    expect(isRefusedBeforeSending(transport)).toBe(false);
  });

  it('reads the reuse flag only from a result that carries it', () => {
    expect(isReusedResponse({ reused: true })).toBe(true);
    expect(isReusedResponse({})).toBe(false);
    expect(isReusedResponse(undefined)).toBe(false);
  });
});
