import axios, { type InternalAxiosRequestConfig } from 'axios';

import { isHostBudgetExempt } from './hostBudgetExempt';
import { hostnameForLimiter } from './hostConcurrencyLimiter';
import { recordHostCrawlDelay } from './hostThrottlePolicy';
import { RobotsDisallowedError } from './robotsDisallowedError';
import {
  robotsPolicyFor,
  type RobotsTxtFetcher,
  type RobotsTxtFetchOutcome,
} from './robotsPolicyCache';
import { ROBOTS_TXT_MAX_BYTES, robotsAllows } from './robotsTxt';

export const ROBOTS_TXT_FETCH_KEY = '__ylabsRobotsTxtFetch';

const ROBOTS_TXT_TIMEOUT_MS = 10_000;

export { RobotsDisallowedError };

export const fetchRobotsTxtOverAxios: RobotsTxtFetcher = async (host) => {
  try {
    const response = await axios.get<string>(`https://${host}/robots.txt`, {
      responseType: 'text',
      transformResponse: (body) => body,
      timeout: ROBOTS_TXT_TIMEOUT_MS,
      maxContentLength: ROBOTS_TXT_MAX_BYTES,
      maxRedirects: 3,
      validateStatus: () => true,
      [ROBOTS_TXT_FETCH_KEY]: true,
    } as Parameters<typeof axios.get>[1]);
    return {
      status: response.status,
      body: typeof response.data === 'string' ? response.data : '',
    } satisfies RobotsTxtFetchOutcome;
  } catch (error) {
    return { error };
  }
};

function requestPath(config: InternalAxiosRequestConfig): string {
  try {
    const url = new URL(axios.getUri(config));
    return `${url.pathname}${url.search}`;
  } catch {
    return '/';
  }
}

let installed = false;

/**
 * Reads the host's robots.txt (at most once a day, `robotsPolicyFor`) before a request takes a
 * host slot. A disallowed path is refused before sending, and the host's `Crawl-delay`, clamped
 * to 10 seconds, lengthens its spacing in both the process and the machine budget. The robots.txt
 * request itself skips this check but still passes every other hook, so it is paced and paused
 * like any other request, and a robots.txt that cannot be read falls back to default pacing.
 */
export function installRobotsPolicyInterceptor(
  fetchRobotsTxt: RobotsTxtFetcher = fetchRobotsTxtOverAxios,
): void {
  if (installed) return;
  installed = true;
  axios.interceptors.request.use(async (config) => {
    if ((config as unknown as Record<string, unknown>)[ROBOTS_TXT_FETCH_KEY]) return config;
    const host = hostnameForLimiter(config.url, config.baseURL);
    if (!host || isHostBudgetExempt(host)) return config;
    const policy = await robotsPolicyFor(host, fetchRobotsTxt);
    recordHostCrawlDelay(host, policy.crawlDelayMs);
    const path = requestPath(config);
    if (!robotsAllows(policy, path)) throw new RobotsDisallowedError(host, path);
    return config;
  });
}
