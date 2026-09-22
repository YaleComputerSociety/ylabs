/**
 * External scholarly, bibliographic, and social platforms: one owner for both the
 * hosts and the brand names.
 *
 * These are places a person's work is INDEXED. None of them is a Yale research
 * home, so neither a platform's host nor its brand name can stand in for one.
 *
 * The two halves existed separately and disagreed. `researchHomeWebsiteUrl` had
 * refused these hosts as a `websiteUrl` for some time, while nothing stopped the
 * same platform's brand being stored as the entity's `name`: measured on
 * Development, three live person-keyed rows were typed `LAB` and named
 * "Google Scholar", one of them `student_ready`, because a profile page's link
 * section labels its outbound link that way. So the corpus refused the URL and
 * served the brand.
 *
 * Kept as an exact match on the whole name rather than a word-level stoplist. A
 * name that merely CONTAINS a brand is usually a real research home describing
 * where its code or output lives ("Onofrey Lab GitHub" is the live example), and a
 * word-level rule of the kind `isNonIdentifyingLinkLabelName` uses cannot separate
 * the two, because "google" and "scholar" are not generic navigation words.
 *
 * `isExternalScholarlyPlatformName` is therefore the VOCABULARY and not the name
 * guard. `isExternalScholarlyPlatformLinkLabelName` is the guard every caller
 * reaches for, because a brand wearing a research-home head noun ("Google Scholar
 * Lab") is still a link label and the exact match cannot see it (#2285).
 *
 * Calibrated against the corpus before shipping, per the repo's rule that a fuzzy
 * predicate is measured against real prose first: over 7,964 rows (`name` and
 * `displayName`), the exact-match form hit 6 field instances, all of them the
 * defect, and zero legitimate names.
 */

/**
 * Hosts that index work rather than publish a research home. `nsf.gov` and
 * `reporter.nih.gov` are funder record systems, which are the same category error
 * for a `websiteUrl` even though they are not bibliographic databases.
 */
export const EXTERNAL_SCHOLARLY_PLATFORM_HOSTS: readonly string[] = [
  'orcid.org',
  'pubmed.ncbi.nlm.nih.gov',
  'ncbi.nlm.nih.gov',
  'doi.org',
  'linkedin.com',
  'researchgate.net',
  'scholar.google.com',
  'reporter.nih.gov',
  'nsf.gov',
  'academia.edu',
  'ispu.org',
];

const HOST_SET = new Set(EXTERNAL_SCHOLARLY_PLATFORM_HOSTS);

/**
 * Matches the platform host itself or any subdomain of it, so `api.nsf.gov` and
 * `www.linkedin.com` are refused along with the bare host. A lookalike that merely
 * ends in the same letters (`notorcid.org`) is not a subdomain and is accepted,
 * which is the same boundary the suffix-anchored regex this replaced enforced.
 */
export function isExternalScholarlyPlatformHost(hostname: unknown): boolean {
  if (typeof hostname !== 'string') return false;
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (!host) return false;
  if (HOST_SET.has(host)) return true;
  return EXTERNAL_SCHOLARLY_PLATFORM_HOSTS.some((platform) => host.endsWith(`.${platform}`));
}

/**
 * Brand names for the platforms above, plus Semantic Scholar, which the corpus
 * already tracks as `semanticScholarId` without having a host entry here.
 *
 * Deliberately limited to platforms this repository already names somewhere.
 * Adding a brand with no corresponding host or stored identifier would be
 * guesswork, and only one of these has a live hit today.
 */
export const EXTERNAL_SCHOLARLY_PLATFORM_NAMES: readonly string[] = [
  'google scholar',
  'semantic scholar',
  'researchgate',
  'research gate',
  'academia edu',
  'linkedin',
  'orcid',
  'pubmed',
  'ncbi',
  'nih reporter',
  'nsf',
  'ispu',
];

const NAME_SET = new Set(EXTERNAL_SCHOLARLY_PLATFORM_NAMES);

// A leading article is dropped so "The Google Scholar" folds onto the brand, but
// only when something survives it, so a name of just "The" is left to the
// placeholder and link-label rules that own it.
const LEADING_ARTICLES = new Set(['the', 'a', 'an', 'my', 'our']);

function normalizePlatformName(value: string): string {
  const words = value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length > 1 && LEADING_ARTICLES.has(words[0])) words.shift();
  return words.join(' ');
}

/**
 * True when the whole value is an external platform's brand and nothing else, so
 * it names no research home. A name that contains a brand alongside anything else
 * is left alone.
 */
export function isExternalScholarlyPlatformName(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const normalized = normalizePlatformName(value);
  if (!normalized) return false;
  return NAME_SET.has(normalized);
}
