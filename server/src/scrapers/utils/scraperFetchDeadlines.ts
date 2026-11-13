import axios, {
  AxiosError,
  type AxiosAdapter,
  type AxiosInstance,
  type GenericAbortSignal,
  type InternalAxiosRequestConfig,
} from 'axios';
import { OUTBOUND_CONNECT_TIMEOUT_MS } from '../../utils/connectDeadlineAgents';
import { DevWriteStoppedError, devWriteStopped } from '../../db/devWriteStop';

/**
 * The three bounds every scraper HTTP request carries. Changing one also requires updating
 * the "Fetch deadlines" table in `skills/scrapers/SKILL.md`.
 *
 * - Connect: DNS, TCP and TLS, enforced by the SSRF-safe agents.
 * - Read: axios `timeout`, which is socket inactivity. A peer that trickles one byte inside every
 *   window resets it forever, which is how a roster lane once waited on one profile with no timer
 *   left that could end it.
 * - Overall: a wall clock from dispatch to settle, which is the only bound a slow trickle cannot
 *   reset.
 */
export const SCRAPER_FETCH_CONNECT_TIMEOUT_MS = OUTBOUND_CONNECT_TIMEOUT_MS;
export const SCRAPER_FETCH_READ_TIMEOUT_MS = 30_000;
export const SCRAPER_FETCH_OVERALL_DEADLINE_MS = 90_000;

export function scraperFetchReadTimeoutMs(timeout: unknown): number {
  return typeof timeout === 'number' && Number.isFinite(timeout) && timeout > 0
    ? timeout
    : SCRAPER_FETCH_READ_TIMEOUT_MS;
}

/**
 * A lane that documents a longer read timeout (a bulk grant API page) keeps it, and gets a connect
 * budget on top so the overall clock never fires before its own read timer could have.
 */
export function scraperFetchOverallDeadlineMs(readTimeoutMs: number): number {
  return Math.max(
    SCRAPER_FETCH_OVERALL_DEADLINE_MS,
    readTimeoutMs + SCRAPER_FETCH_CONNECT_TIMEOUT_MS,
  );
}

export interface ScraperFetchDeadlineOptions {
  overallDeadlineMs?: (readTimeoutMs: number) => number;
}

const deadlineExceeded = (
  config: InternalAxiosRequestConfig,
  overallMs: number,
  cause: unknown,
): AxiosError =>
  new AxiosError(
    `scraper fetch overall deadline of ${overallMs}ms exceeded`,
    AxiosError.ETIMEDOUT,
    config,
    (cause as AxiosError | undefined)?.request,
  );

const combinedSignal = (
  caller: GenericAbortSignal | undefined,
  deadline: AbortSignal,
): GenericAbortSignal => (caller ? AbortSignal.any([caller as AbortSignal, deadline]) : deadline);

/**
 * Wraps the adapter rather than adding an interceptor so the clock starts at dispatch: request
 * interceptors run first, and the host-slot limiter waits for a slot there, so a deadline armed in
 * an interceptor would also count time queued behind other lanes on the same host.
 */
export function withScraperFetchDeadline(
  adapter: AxiosAdapter,
  options: ScraperFetchDeadlineOptions = {},
): AxiosAdapter {
  const overallDeadlineMs = options.overallDeadlineMs ?? scraperFetchOverallDeadlineMs;
  return async (config) => {
    if (devWriteStopped()) throw new DevWriteStoppedError('a scraper fetch');
    config.timeout = scraperFetchReadTimeoutMs(config.timeout);
    const overallMs = overallDeadlineMs(config.timeout);
    const callerSignal = config.signal;
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(), overallMs);
    config.signal = combinedSignal(callerSignal, deadline.signal);
    try {
      return await adapter(config);
    } catch (error) {
      if (deadline.signal.aborted && !callerSignal?.aborted) {
        throw deadlineExceeded(config, overallMs, error);
      }
      throw error;
    } finally {
      clearTimeout(timer);
      config.signal = callerSignal;
    }
  };
}

export interface ScraperFetchDeadlineHandle {
  detach: () => void;
}

const installedInstances = new WeakMap<AxiosInstance, ScraperFetchDeadlineHandle>();

/**
 * Every lane and the shared `fetchPageWithPolicy` helpers send through the default axios instance,
 * so bounding its adapter bounds them all. A per-request `adapter` (a sweep page reuse hit or a
 * benchmark replay) never touches the network and is left alone.
 */
export function installScraperFetchDeadlines(
  instance: AxiosInstance = axios,
  options: ScraperFetchDeadlineOptions = {},
): ScraperFetchDeadlineHandle {
  const existing = installedInstances.get(instance);
  if (existing) return existing;
  const original = instance.defaults.adapter;
  instance.defaults.adapter = withScraperFetchDeadline(axios.getAdapter(original), options);
  const handle: ScraperFetchDeadlineHandle = {
    detach: () => {
      instance.defaults.adapter = original;
      installedInstances.delete(instance);
    },
  };
  installedInstances.set(instance, handle);
  return handle;
}
