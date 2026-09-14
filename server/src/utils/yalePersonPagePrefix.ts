export interface HostPersonPagePrefixes {
  /** Live person-page path prefixes, canonical first. `''` means the host root. */
  readonly current: readonly string[];
  /** Prefixes the host has migrated away from, whose URLs now 404. */
  readonly legacy?: readonly string[];
}

/**
 * Which path prefix each Yale host puts a person's own page under.
 *
 * Derived from stored citations whose URL leaf matches the citing entity's own
 * person name, then live-probed: 108 of 108 sampled URLs returned a page naming
 * the right person (#2621).
 *
 * Two selection rules are load-bearing, because each produced a wrong entry on a
 * first pass and would have been hardcoded:
 *
 * - Ranking by citation frequency picks the legacy or the roster prefix. On
 *   `classics.yale.edu` the legacy `/people/` still has more stored citations
 *   than the live `/profile/`, and on `ysph.yale.edu` the most frequent prefix is
 *   the faculty roster, which is not a person page at all.
 * - Ranking by lowest dead fraction picks a small clean sub-namespace over the
 *   main one, which chose `medicine.yale.edu` `/bbs/profile/` over `/profile/`.
 *
 * Only hosts with at least 10 person-matched citations are listed. A host with
 * fewer is one site restructure away from being silently wrong, so it is left to
 * runtime verification instead. `quantuminstitute.yale.edu` is deliberately
 * absent: it answers 200 for person pages that do not exist, so a mapped rewrite
 * there would manufacture a confidently wrong link.
 */
export const YALE_PERSON_PAGE_PREFIXES: Readonly<Record<string, HostPersonPagePrefixes>> = {
  'americanstudies.yale.edu': { current: ['people'] },
  'anthropology.yale.edu': { current: ['profile'] },
  'applied.math.yale.edu': { current: ['people'] },
  'arthistory.yale.edu': { current: ['people'] },
  'astronomy.yale.edu': { current: ['people'] },
  'blackstudies.yale.edu': { current: ['people'] },
  'campuspress.yale.edu': { current: [''] },
  'chem.yale.edu': { current: ['profile'] },
  'classics.yale.edu': { current: ['profile'], legacy: ['people'] },
  'complit.yale.edu': { current: ['profile'] },
  'divinity.yale.edu': { current: ['profile'] },
  'eall.yale.edu': { current: ['people'] },
  'earth.yale.edu': { current: ['profile'] },
  'economics.yale.edu': { current: ['people'] },
  'eeb.yale.edu': { current: ['people/faculty'] },
  'engineering.yale.edu': { current: ['research-and-faculty/faculty-directory'] },
  'english.yale.edu': { current: ['people/tenured-and-tenure-track-faculty-professors'] },
  'environment.yale.edu': { current: ['directory/faculty'] },
  'erm.yale.edu': { current: ['people'] },
  'faculty.som.yale.edu': { current: [''] },
  'filmstudies.yale.edu': { current: ['people'] },
  'french.yale.edu': { current: ['profile'] },
  'history.yale.edu': { current: ['people'] },
  'hshm.yale.edu': { current: ['people'] },
  'jackson.yale.edu': { current: ['directory'], legacy: ['person'] },
  'jewishstudies.yale.edu': { current: ['profile'] },
  'law.yale.edu': { current: [''] },
  'ling.yale.edu': { current: ['profile'] },
  'math.yale.edu': { current: ['profile'] },
  'mcdb.yale.edu': { current: ['profile'] },
  'medicine.yale.edu': { current: ['profile', 'cancer/profile', 'bbs/profile'] },
  'nelc.yale.edu': { current: ['people'] },
  'nursing.yale.edu': { current: ['faculty-research/faculty-directory'] },
  'physics.yale.edu': { current: ['profile'], legacy: ['people'] },
  'politicalscience.yale.edu': { current: ['people'] },
  'psychology.yale.edu': { current: ['people'] },
  'religiousstudies.yale.edu': { current: ['profile'] },
  'slavic.yale.edu': { current: ['people'] },
  'sociology.yale.edu': { current: ['profile'], legacy: ['people'] },
  'som.yale.edu': { current: ['faculty-research/faculty-directory'] },
  'span-port.yale.edu': { current: ['people'] },
  'statistics.yale.edu': { current: ['profile'] },
  'wgss.yale.edu': { current: ['people'] },
  'yalemusic.yale.edu': { current: ['people'] },
  'ysph.yale.edu': { current: ['profile'] },
};

const splitPath = (pathname: string): string[] => pathname.split('/').filter(Boolean);

const joinPersonPageUrl = (url: URL, prefix: string, leaf: string): string => {
  const next = new URL(url.toString());
  next.pathname = prefix ? `/${prefix}/${leaf}` : `/${leaf}`;
  next.hash = '';
  next.search = '';
  return next.toString();
};

const parseHttpUrl = (value: unknown): URL | undefined => {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    return /^https?:$/i.test(url.protocol) ? url : undefined;
  } catch {
    return undefined;
  }
};

export function personPagePrefixesForHost(host: string): HostPersonPagePrefixes | undefined {
  return YALE_PERSON_PAGE_PREFIXES[host.toLowerCase()];
}

/**
 * Whether the URL sits under a prefix the host has migrated away from, so its
 * leaf can be re-pointed at the host's current person-page prefix.
 */
export function isLegacyPersonPageUrl(value: unknown): boolean {
  const url = parseHttpUrl(value);
  if (!url) return false;
  const entry = personPagePrefixesForHost(url.hostname);
  if (!entry?.legacy?.length) return false;
  const parts = splitPath(url.pathname);
  if (parts.length < 2) return false;
  const prefix = parts.slice(0, -1).join('/').toLowerCase();
  return entry.legacy.includes(prefix);
}

/**
 * The same person's page under the host's current prefix, or `undefined` when the
 * host is unmapped, the URL is not on a legacy prefix, or the leaf is missing.
 *
 * Returns a candidate only. The caller adopts it after confirming the fetched
 * page names the person, because a Yale host can answer 200 for a person page
 * that does not exist.
 */
export function canonicalPersonPageUrlCandidate(value: unknown): string | undefined {
  const url = parseHttpUrl(value);
  if (!url) return undefined;
  const entry = personPagePrefixesForHost(url.hostname);
  if (!entry) return undefined;
  const parts = splitPath(url.pathname);
  if (parts.length < 2) return undefined;
  const prefix = parts.slice(0, -1).join('/').toLowerCase();
  const leaf = parts[parts.length - 1];
  if (!leaf) return undefined;
  if (entry.current.some((current) => current.toLowerCase() === prefix)) return undefined;
  if (!entry.legacy?.includes(prefix)) return undefined;
  return joinPersonPageUrl(url, entry.current[0], leaf);
}

/**
 * Whether the URL already sits on one of the host's current person-page prefixes.
 * A host mapped to the root (`law.yale.edu/<name>`) matches a single-segment path.
 */
export function isCurrentPersonPageUrl(value: unknown): boolean {
  const url = parseHttpUrl(value);
  if (!url) return false;
  const entry = personPagePrefixesForHost(url.hostname);
  if (!entry) return false;
  const parts = splitPath(url.pathname);
  if (parts.length === 0) return false;
  const prefix = parts.length === 1 ? '' : parts.slice(0, -1).join('/').toLowerCase();
  return entry.current.some((current) => current.toLowerCase() === prefix);
}
