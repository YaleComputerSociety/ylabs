// Imports nothing, so the machine budget can read these while it loads without a cycle through
// the host pause modules that hostConcurrencyLimiter.ts depends on.
export const DEFAULT_PER_HOST_CONCURRENCY = 4;

export interface HostThrottle {
  concurrency: number;
  minIntervalMs: number;
}

export interface HostRetryBudget {
  maxRetries: number;
  maxBackoffMs: number;
  maxTotalBackoffMs: number;
}

export interface HostPoliteness extends HostThrottle {
  retryBudget?: HostRetryBudget;
}

// These hosts refuse 30-50% of single requests at random (measured 2026-10-03), so a page
// fails every attempt with probability p^(maxRetries + 1): 0.5^4 = 6% under the default
// three retries, 0.5^9 = 0.2% under eight. The waits stay inside the slot throttle, and
// maxTotalBackoffMs bounds one page even when every refusal names a long Retry-After.
export const REFUSAL_THROTTLED_HOST_RETRY_BUDGET: HostRetryBudget = {
  maxRetries: 8,
  maxBackoffMs: 15_000,
  maxTotalBackoffMs: 90_000,
};

// This host's own flood control paused this machine for seven days after one morning of lane
// and link-health traffic (#6166). Every refused request counts against it, so it gets one request
// at a time, spaced well apart, and fewer retries than the default rather than more.
export const BAN_PRONE_HOST_RETRY_BUDGET: HostRetryBudget = {
  maxRetries: 1,
  maxBackoffMs: 15_000,
  maxTotalBackoffMs: 15_000,
};

export const HOST_THROTTLE_OVERRIDES: Readonly<Record<string, HostPoliteness>> = {
  'medicine.yale.edu': {
    concurrency: 3,
    minIntervalMs: 400,
    retryBudget: REFUSAL_THROTTLED_HOST_RETRY_BUDGET,
  },
  'ysph.yale.edu': {
    concurrency: 2,
    minIntervalMs: 400,
    retryBudget: REFUSAL_THROTTLED_HOST_RETRY_BUDGET,
  },
  'economics.yale.edu': {
    concurrency: 1,
    minIntervalMs: 1_500,
    retryBudget: BAN_PRONE_HOST_RETRY_BUDGET,
  },
};

// Yale hosts answered about 2 requests a second with 403s (ysph, hold 3i), so any Yale host
// without its own override gets one request at a time, 1.5 s apart, across the whole machine.
export const YALE_HOST_DEFAULT_THROTTLE: HostThrottle = {
  concurrency: 1,
  minIntervalMs: 1_500,
};

/**
 * How the request under a slot turned out, for the layers that keep a shared ledger. `reused` means
 * a local cache answered and nothing reached the host, so the slot gives its spacing back (#6195).
 */
export interface HostSlotOutcome {
  reused?: boolean;
}

export type HostSlotRelease = (outcome?: HostSlotOutcome) => void;

export interface HostSlotLimiter {
  acquire(host: string): Promise<HostSlotRelease>;
}

/**
 * The longest a request waits for a host slot before it fails instead. A slot that is never
 * released, or a lease acquire that never answers, would otherwise hold every later request to
 * that host forever, with no fetch deadline running because the wait happens before dispatch.
 * Changing it also requires updating the "Fetch deadlines" table in `skills/scrapers/SKILL.md`.
 */
export const HOST_SLOT_WAIT_TIMEOUT_MS = 10 * 60_000;

export class HostSlotWaitTimeoutError extends Error {
  readonly code = 'ETIMEDOUT';

  constructor(host: string, timeoutMs: number) {
    super(`no host slot for ${host} within ${timeoutMs} ms`);
    this.name = 'HostSlotWaitTimeoutError';
  }
}
