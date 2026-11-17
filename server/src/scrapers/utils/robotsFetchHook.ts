import axios, { type InternalAxiosRequestConfig } from 'axios';

import { assertPublicHttpUrl, ssrfSafeAgents } from '../../utils/ssrfGuard';
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
const ROBOTS_TXT_MAX_REDIRECTS = 3;

/**
 * Machine APIs the scrapers call. robots.txt governs crawling pages, not API endpoints, and an API
 * host's robots.txt (often `Disallow: /`) would otherwise stall its lane as not observed (#6338
 * review). A guard test fails when the source names an `https://api.` host missing from this set.
 */
export const MACHINE_API_HOSTS_EXEMPT_FROM_ROBOTS: ReadonlySet<string> = new Set([
  'api.crossref.org',
  'api.exa.ai',
  'api.nsf.gov',
  'api.openai.com',
  'api.openalex.org',
  'api.parallel.ai',
  'api.render.com',
  'api.reporter.nih.gov',
  'api.search.brave.com',
  'api.tavily.com',
  'api.yalies.io',
]);

const isRedirect = (status: number): boolean => status >= 300 && status < 400;

export { RobotsDisallowedError };

/**
 * Reads robots.txt the way every other public fetch is read: each hop is checked by the SSRF guard
 * before it is sent and connects through the SSRF-safe agents, so neither a rebinding DNS answer nor
 * a redirect can send this request, which runs before every scraper request, to a private address.
 */
export const fetchRobotsTxtOverAxios: RobotsTxtFetcher = async (host) => {
  try {
    let target = (await assertPublicHttpUrl(`https://${host}/robots.txt`)).toString();
    for (let hop = 0; ; hop += 1) {
      const response = await axios.get<string>(target, {
        responseType: 'text',
        transformResponse: (body) => body,
        timeout: ROBOTS_TXT_TIMEOUT_MS,
        maxContentLength: ROBOTS_TXT_MAX_BYTES,
        maxRedirects: 0,
        validateStatus: () => true,
        ...ssrfSafeAgents(),
        [ROBOTS_TXT_FETCH_KEY]: true,
      } as Parameters<typeof axios.get>[1]);
      const location = response.headers?.location;
      if (
        isRedirect(response.status) &&
        typeof location === 'string' &&
        hop < ROBOTS_TXT_MAX_REDIRECTS
      ) {
        target = (await assertPublicHttpUrl(new URL(location, target).toString())).toString();
        continue;
      }
      return {
        status: response.status,
        body: typeof response.data === 'string' ? response.data : '',
      } satisfies RobotsTxtFetchOutcome;
    }
  } catch (error) {
    return { error };
  }
};

const isPageReadMethod = (method: string | undefined): boolean => {
  const normalized = (method ?? 'get').toLowerCase();
  return normalized === 'get' || normalized === 'head';
};

const isRobotsExemptHost = (host: string): boolean =>
  isHostBudgetExempt(host) || MACHINE_API_HOSTS_EXEMPT_FROM_ROBOTS.has(host);

/**
 * The one robots.txt decision every fetch path takes: the axios hook, the rendered seed and the
 * rendered fetch's forward proxy (#6213, #6340). It records the host's Crawl-delay before the
 * caller takes a host slot, and refuses a disallowed page read before anything is sent.
 */
export async function enforceRobotsForPageRead(
  url: URL,
  method: string | undefined,
  fetchRobotsTxt: RobotsTxtFetcher = fetchRobotsTxtOverAxios,
): Promise<void> {
  if (!isPageReadMethod(method)) return;
  const host = url.hostname.toLowerCase();
  if (!host || isRobotsExemptHost(host)) return;
  const policy = await robotsPolicyFor(host, fetchRobotsTxt);
  recordHostCrawlDelay(host, policy.crawlDelayMs);
  const path = `${url.pathname}${url.search}`;
  if (!robotsAllows(policy, path)) throw new RobotsDisallowedError(host, path);
}

/** Records a host's Crawl-delay from its robots.txt, for a request whose path cannot be read. */
export async function recordRobotsCrawlDelay(
  host: string,
  fetchRobotsTxt: RobotsTxtFetcher = fetchRobotsTxtOverAxios,
): Promise<void> {
  const key = host.toLowerCase();
  if (!key || isRobotsExemptHost(key)) return;
  recordHostCrawlDelay(key, (await robotsPolicyFor(key, fetchRobotsTxt)).crawlDelayMs);
}

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
 * Only page reads are checked: a non-GET request and a machine API host are left alone.
 */
export function installRobotsPolicyInterceptor(
  fetchRobotsTxt: RobotsTxtFetcher = fetchRobotsTxtOverAxios,
): void {
  if (installed) return;
  installed = true;
  axios.interceptors.request.use(async (config) => {
    if ((config as unknown as Record<string, unknown>)[ROBOTS_TXT_FETCH_KEY]) return config;
    if (!isPageReadMethod(config.method)) return config;
    const host = hostnameForLimiter(config.url, config.baseURL);
    if (!host || isRobotsExemptHost(host)) return config;
    const policy = await robotsPolicyFor(host, fetchRobotsTxt);
    recordHostCrawlDelay(host, policy.crawlDelayMs);
    const path = requestPath(config);
    if (!robotsAllows(policy, path)) throw new RobotsDisallowedError(host, path);
    return config;
  });
}
