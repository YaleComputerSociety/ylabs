import fs from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HostRateLimiter, fetchPageWithPolicy, type HttpRequestResult } from '../httpFetch';
import { MachineHostBudgetLimiter } from '../machineHostBudget';
import {
  HOST_BACKOFF_QUIET_RESET_MS,
  hostBackoffState,
  hostPausedUntil,
  recordHostBackoff,
  resetHostPauseStateForTests,
  setHostPauseStateForTests,
} from '../hostPauseState';

const HOST = 'dept.example.edu';
const URL_UNDER_TEST = `https://${HOST}/people/a`;
const reusedPage = { status: 200, data: '<p>page</p>', finalUrl: '', reused: true as const };
const freshPage = { status: 200, data: '<p>page</p>', finalUrl: '' };

let directory: string;
let budget: MachineHostBudgetLimiter;
let limiter: HostRateLimiter;

beforeEach(() => {
  directory = fs.mkdtempSync('/tmp/ylhreuse-');
  budget = new MachineHostBudgetLimiter({
    env: { SCRAPER_MACHINE_HOST_SLOTS: 'on', SCRAPER_MACHINE_HOST_SLOT_DIR: directory },
    warn: () => {},
  });
  limiter = new HostRateLimiter({
    minIntervalMs: 0,
    sleep: async () => {},
    machineWide: () => budget,
  });
});

afterEach(() => {
  resetHostPauseStateForTests();
  fs.rmSync(directory, { recursive: true, force: true });
});

const fetchOnce = (result: HttpRequestResult) =>
  fetchPageWithPolicy(URL_UNDER_TEST, {
    assertUrl: async (url: string) => new URL(url),
    limiter,
    sleep: async () => {},
    jitter: () => 0,
    request: vi.fn(async () => result),
  });

describe('a page replayed from a local cache', () => {
  it('spends none of the host budget, so the next real request is not spaced behind it', async () => {
    await expect(fetchOnce(reusedPage)).resolves.toMatchObject({ status: 200, reused: true });

    expect(budget.readState(HOST)).toMatchObject({
      lastGrantAt: Number.MIN_SAFE_INTEGER,
      nextGrantAt: 0,
      slots: [],
    });
    expect(budget.readState(HOST)?.lastReleaseAt).toBeUndefined();
  });

  it('spends the budget for a page the host really answered', async () => {
    const before = Date.now();

    await expect(fetchOnce(freshPage)).resolves.toMatchObject({ status: 200 });

    const state = budget.readState(HOST);
    expect(state?.lastGrantAt).toBeGreaterThanOrEqual(before);
    expect(state?.nextGrantAt).toBeGreaterThan(before);
  });

  it('never clears the host pause a refusal recorded, where a real page does', async () => {
    let at = Date.UTC(2026, 10, 13, 12);
    setHostPauseStateForTests({ now: () => new Date(at), random: () => 0.5 });
    await recordHostBackoff(HOST, { status: 429 });
    at = (hostPausedUntil(HOST) as Date).getTime() + HOST_BACKOFF_QUIET_RESET_MS + 1;

    await expect(fetchOnce(reusedPage)).resolves.toMatchObject({ reused: true });
    expect(hostBackoffState(HOST)).toBeDefined();

    await expect(fetchOnce(freshPage)).resolves.toMatchObject({ status: 200 });
    expect(hostBackoffState(HOST)).toBeUndefined();
  });
});
