import { SsrfBlockedError } from '../../utils/ssrfGuard';
import { fetchPublicHttpUrl, type PublicHttpResponse } from './httpFetch';
import type { ResolverControlOutcome } from './resolverCircuitBreaker';

/**
 * Fixed hosts the link-health corpus depends on most. They are Yale hosts on
 * purpose: if Yale's own names stop resolving, every Yale citation would be recorded
 * dead, so a Yale outage must halt the pass exactly as a local resolver outage does.
 */
export const RESOLVER_CONTROL_URLS: readonly string[] = [
  'https://www.yale.edu/robots.txt',
  'https://medicine.yale.edu/robots.txt',
];

export const RESOLVER_CONTROL_TIMEOUT_MS = 10_000;

export type ResolverControlFetch = (url: string) => Promise<Pick<PublicHttpResponse, 'status'>>;

const defaultControlFetch: ResolverControlFetch = (url) =>
  fetchPublicHttpUrl(url, { timeoutMs: RESOLVER_CONTROL_TIMEOUT_MS, maxRedirects: 0 });

const hostLabel = (url: string): string => new URL(url).hostname;

const failureCode = (error: unknown): string => {
  if (error instanceof SsrfBlockedError) return `ssrf-${error.reason}`;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'ERR_REQUEST_FAILED';
};

/**
 * Any HTTP status proves the name resolved and the network carried the request. A
 * private-address refusal also proves the resolver answered: on Yale's split-horizon
 * network these hosts resolve to `10.x`, and that is a fact about where we run.
 */
export async function probeResolverControl(
  fetchControl: ResolverControlFetch = defaultControlFetch,
  urls: readonly string[] = RESOLVER_CONTROL_URLS,
): Promise<ResolverControlOutcome> {
  const failures: string[] = [];
  for (const url of urls) {
    try {
      const response = await fetchControl(url);
      return { healthy: true, detail: `${hostLabel(url)} answered HTTP ${response.status}` };
    } catch (error) {
      if (error instanceof SsrfBlockedError && error.reason === 'private-address') {
        return { healthy: true, detail: `${hostLabel(url)} resolved to a private address` };
      }
      failures.push(`${hostLabel(url)}: ${failureCode(error)}`);
    }
  }
  return { healthy: false, detail: failures.join('; ') || 'no control host configured' };
}
