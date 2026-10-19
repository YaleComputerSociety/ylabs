/**
 * A lane records the API or award-search entry page it queries as the provenance of every
 * field it writes. That stays stored for audit but is never a student-facing citation: it
 * answers with a whole registry's raw JSON or an empty search form (#5261).
 *
 * Changing a lane's endpoint requires updating these lists; `laneDiscoveryEndpointUrl.test.ts`
 * pins every grant lane's endpoint constant against them.
 */
const API_HOST_PREFIX = 'api.';
const API_HOSTS = new Set(['eutils.ncbi.nlm.nih.gov']);
const API_PATH_PREFIXES = ['/api/', '/europepmc/webservices/'];
const AWARD_SEARCH_FORM_HOSTS = new Set(['pamspublic.science.energy.gov']);
const AWARD_SEARCH_FORM_LEAF = /^awardsearch[a-z]*\.aspx$/i;
const AWARD_SEARCH_HOME_HOSTS = new Set(['awardsearch.neh.gov']);

const parsedHttpUrl = (value: unknown): URL | undefined => {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : undefined;
  } catch {
    return undefined;
  }
};

const normalizedHost = (url: URL): string =>
  url.hostname
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/\.$/, '');

const isAwardSearchEntryPage = (host: string, url: URL): boolean => {
  const segments = url.pathname.split('/').filter(Boolean);
  if (AWARD_SEARCH_HOME_HOSTS.has(host)) return segments.length === 0 && !url.search;
  if (!AWARD_SEARCH_FORM_HOSTS.has(host)) return false;
  return AWARD_SEARCH_FORM_LEAF.test(segments[segments.length - 1] ?? '');
};

export function isLaneDiscoveryEndpointUrl(value: unknown): boolean {
  const url = parsedHttpUrl(value);
  if (!url) return false;
  const host = normalizedHost(url);
  if (host.startsWith(API_HOST_PREFIX) || API_HOSTS.has(host)) return true;
  const path = `${url.pathname.toLowerCase().replace(/\/+$/, '')}/`;
  if (API_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  return isAwardSearchEntryPage(host, url);
}

const GRANT_PAGE_HOST_BY_ENDPOINT_HOST: Record<string, string> = {
  'api.crossref.org': 'doi.org',
  'api.nsf.gov': 'nsf.gov',
  'api.reporter.nih.gov': 'reporter.nih.gov',
  'osti.gov': 'osti.gov',
  'awardsearch.neh.gov': 'awardsearch.neh.gov',
};

const hostOf = (value: unknown): string | undefined => {
  const url = parsedHttpUrl(value);
  return url ? normalizedHost(url) : undefined;
};

/**
 * Prefers a grant the endpoint's own lane recorded, because that lane is the one the
 * credited field came from. The DOE lane stores its award search form as every grant's
 * url, so a row whose only principal-investigator grants come from it has no page to cite.
 */
export function servedGrantPageUrl(
  recentGrants: unknown,
  endpointUrl?: string,
): string | undefined {
  if (!Array.isArray(recentGrants)) return undefined;
  const pages = recentGrants.flatMap((grant) =>
    grant?.role === 'pi' && parsedHttpUrl(grant.url) && !isLaneDiscoveryEndpointUrl(grant.url)
      ? [String(grant.url).trim()]
      : [],
  );
  const endpointHost = hostOf(endpointUrl);
  const laneHost = endpointHost ? GRANT_PAGE_HOST_BY_ENDPOINT_HOST[endpointHost] : undefined;
  return pages.find((page) => laneHost && hostOf(page) === laneHost) ?? pages[0];
}
