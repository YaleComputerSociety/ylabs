import {
  comparePersonProfileUrls,
  isCrossSchoolDirectoryProfileUrl,
  isIdentifierRecordUrl,
  personProfileSourceRoleLabel,
  rankPersonProfileUrls,
  type PersonProfileRankingContext,
} from './personProfileRanking';
import { safeHttpUrl } from './url';

interface DetailSourceGroup {
  name?: string;
  websiteUrl?: string;
  sourceUrls?: string[];
  school?: string;
  schools?: string[];
}

interface DetailSourceSignal {
  _id?: string;
  signalType?: string;
  confidence?: string;
  confidenceScore?: number;
  sourceUrl?: string;
}

const CITABLE_ACCESS_SIGNAL_MIN_SCORE = 0.5;

export const isCitableAccessSignal = (signal: DetailSourceSignal): boolean => {
  if ((signal.confidence || '').toUpperCase() === 'LOW') return false;
  if (
    typeof signal.confidenceScore === 'number' &&
    signal.confidenceScore < CITABLE_ACCESS_SIGNAL_MIN_SCORE
  ) {
    return false;
  }
  return true;
};

interface DetailSourceUndergraduateLogistics {
  claims?: Array<{
    claimType?: string;
    state?: string;
    evidence?: { sourceUrl?: string };
  }>;
}

/**
 * The context every stored citation carried before per-field attribution was
 * served: it says a source backs the profile without saying which part of it, so
 * two profiles of one person read identically. Replaced per row wherever
 * fieldProvenance names what that URL contributed.
 */
const GENERIC_PROFILE_SOURCE_CONTEXT = 'Profile source';

export interface DetailSourceLinkHealth {
  url?: string;
  healthStatus?: string;
  httpStatusCode?: number;
  privateAddressHost?: boolean;
}

export interface DetailSourceFieldContribution {
  sourceUrl?: string;
  contributions?: string[];
}

export interface BuildResearchDetailSourcesInput {
  group?: DetailSourceGroup | null;
  accessSignals?: DetailSourceSignal[];
  undergraduateLogistics?: DetailSourceUndergraduateLogistics;
  sourceLinkHealth?: DetailSourceLinkHealth[];
  sourceFieldContributions?: DetailSourceFieldContribution[];
}

export interface ResearchDetailSource {
  url: string;
  label: string;
  contexts: string[];
  healthStatus?: string;
  httpStatusCode?: number;
  isLikelyUnavailable: boolean;
  isPrivateNetworkOnly: boolean;
}

// Mirrors RESOURCE_GONE_HTTP_STATUS_CODES in server/src/services/sourceLinkHealth.ts;
// changing the arms here requires updating that copy.
const RESOURCE_GONE_HTTP_STATUS_CODES = new Set([404, 410]);

/**
 * Only a status that asserts the resource is gone hides a link. 401/403 are
 * access control, 429 is throttling, and 5xx is an outage: none of them says the
 * page stopped existing, and suppressing on them hid live citations whenever a
 * WAF or a slow host answered the probe (#2473).
 */
export const isLikelyUnavailableSourceLink = (
  health: { healthStatus?: string; httpStatusCode?: number } | undefined,
): boolean => {
  if (!health) return false;
  if (health.healthStatus === 'UNAVAILABLE') return true;
  return (
    typeof health.httpStatusCode === 'number' &&
    RESOURCE_GONE_HTTP_STATUS_CODES.has(health.httpStatusCode)
  );
};

/**
 * Mirrors `privateAddressHost` in server/src/services/sourceLinkHealth.ts. The
 * host resolves only inside Yale's network, so a student off campus cannot open
 * it however healthy the page is. Deliberately separate from
 * `isLikelyUnavailableSourceLink`: the page is not gone, and saying so would be a
 * different and false claim.
 */
export const isPrivateNetworkOnlySourceLink = (
  health: { privateAddressHost?: boolean } | undefined,
): boolean => health?.privateAddressHost === true;

export const normalizeSourceUrl = (url?: string | null): string | null => {
  const safe = safeHttpUrl(url);
  if (!safe) return null;

  try {
    const parsed = new URL(safe);
    parsed.hash = '';
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    const query = parsed.search;
    parsed.search = '';
    const base = parsed.toString().replace(/\/$/, '');
    return `${base}${query}`;
  } catch {
    return null;
  }
};

/**
 * Reduce a URL to a `host+path+query` key that ignores the cosmetic differences
 * the source list renders identically (scheme, `www.`, host case), while keeping
 * distinct paths and query identifiers apart. Two links that render the same host
 * and label collapse onto one source row instead of appearing twice.
 */
export const sourceLedgerKey = (url?: string | null): string | null => {
  const normalized = normalizeSourceUrl(url);
  if (!normalized) return null;

  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${host}${path}${parsed.search}`;
  } catch {
    return normalized;
  }
};

/**
 * Reduce a URL to a `host+path` destination key (scheme/www/query/hash/trailing
 * slash stripped) so two links that point at the same place compare equal. Used
 * to de-duplicate the professor/contact action links on the research detail page.
 */
export const normalizeActionDestination = (url?: string | null): string | null => {
  const normalized = normalizeSourceUrl(url);
  if (!normalized) return null;

  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${host}${path}`;
  } catch {
    return normalized
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .replace(/\/+$/, '')
      .toLowerCase();
  }
};

export const labelizeResearchDetailValue = (value?: string): string =>
  (value || 'Unknown')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[_\s.-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const DIRECTORY_LOADER_SEGMENT_PATH = /\/load_[a-z0-9_]+(?:\/|$)/i;

const DEPARTMENT_FACULTY_ROSTER_PATH = /^\/people\/faculty(?:-|\/|$)/i;

const FACULTY_DIRECTORY_ROOT_PATH = /^\/research-and-faculty\/faculty-directory$/i;

const ROSTER_COLLECTIVE_LEAF_TOKEN =
  /^(?:faculty|faculties|staff|professor|professors|lecturer|lecturers|instructor|instructors|people|persons|humans|member|members|membership|fellow|fellows|affiliate|affiliates|associates|scholars|researchers|team|teams|directory|listing|roster|index|primary|emeriti|emeritus)$/i;

const MAX_ROSTER_LEAF_TOKEN_COUNT = 5;

/**
 * Yale department sites name a whole-roster page with a collective noun that is
 * routinely prefixed by the department or a rank - `/people/linguistics-faculty`,
 * `/people/core-faculty`, `/people/ladder-faculty`, `/people/professors`,
 * `/about/faculty-directory` - so the fixed `/people/faculty` shape above misses
 * most of them and one shared roster ends up offered as every colleague's own
 * profile. Person slugs are name-shaped and never carry a collective noun, so the
 * leaf's token vocabulary separates the two; the token-count bound keeps long
 * article slugs (`/news/professor-ian-ayres-aims-to-foster-...`) from reading as a
 * roster. Mirrors `isSharedPeopleRosterUrl` on the server.
 */
const hasRosterCollectiveLeaf = (path: string): boolean => {
  const segments = path.split('/').filter(Boolean);
  const leaf = segments[segments.length - 1];
  if (!leaf || /\.[a-z0-9]{2,5}$/.test(leaf)) return false;
  const tokens = leaf.split('-');
  return (
    tokens.length <= MAX_ROSTER_LEAF_TOKEN_COUNT &&
    tokens.some((token) => ROSTER_COLLECTIVE_LEAF_TOKEN.test(token))
  );
};

const DIRECTORY_ROSTER_ROOT_PATH =
  /\/directory\/(?:faculty(?:-fellows|-directory|-and-staff|-staff|-affiliates)?|staff|people|members|fellows|affiliates)$/i;

export const isDirectoryRosterRootUrl = (url?: string | null): boolean => {
  const normalized = normalizeSourceUrl(url);
  if (!normalized) return false;

  try {
    const path = new URL(normalized).pathname.toLowerCase().replace(/\/+$/, '');
    return DIRECTORY_ROSTER_ROOT_PATH.test(path);
  } catch {
    return false;
  }
};

// Mirrored by `isDepartmentRosterProvenanceUrl` in server/src/utils/researchHomeWebsiteUrl.ts,
// which gates the server from clearing a cited link this predicate refuses to re-render;
// changing the arms here requires updating that copy.
export const isDepartmentRosterProvenanceUrl = (url?: string | null): boolean => {
  const normalized = normalizeSourceUrl(url);
  if (!normalized) return false;

  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.replace(/^www\./, '');
    const path = parsed.pathname.toLowerCase().replace(/\/+$/, '');
    if (!host.endsWith('yale.edu')) return false;

    return (
      DIRECTORY_LOADER_SEGMENT_PATH.test(path) ||
      DEPARTMENT_FACULTY_ROSTER_PATH.test(path) ||
      FACULTY_DIRECTORY_ROOT_PATH.test(path) ||
      hasRosterCollectiveLeaf(path)
    );
  } catch {
    return false;
  }
};

const RAW_DATA_API_HOSTS = new Set(['api.nsf.gov', 'api.reporter.nih.gov']);

export const isRawDataApiSourceUrl = (url?: string | null): boolean => {
  const normalized = normalizeSourceUrl(url);
  if (!normalized) return false;

  try {
    const host = new URL(normalized).hostname.replace(/^www\./, '').toLowerCase();
    return RAW_DATA_API_HOSTS.has(host);
  } catch {
    return false;
  }
};

// Kept in sync with the server-side GRANT_OR_IDENTIFIER_HOST set in
// scripts/backfillResearchEntityWebsiteUrlsCore.ts; changing one requires updating the other.
const IDENTIFIER_OR_GRANT_DB_HOST =
  /(^|\.)(reporter\.nih\.gov|nih\.gov|nsf\.gov|orcid\.org|scholar\.google\.com|doi\.org)$/i;

export const isIdentifierOrGrantDbSourceUrl = (url?: string | null): boolean => {
  const normalized = normalizeSourceUrl(url);
  if (!normalized) return false;

  try {
    const host = new URL(normalized).hostname.replace(/^www\./, '').toLowerCase();
    return IDENTIFIER_OR_GRANT_DB_HOST.test(host);
  } catch {
    return false;
  }
};

const DOCUMENT_FILE_PATH = /\.(?:pdf|docx?|pptx?|xlsx?|csv|rtf|txt|zip)$/i;

export const isNonContactableDocumentSourceUrl = (url?: string | null): boolean => {
  const normalized = normalizeSourceUrl(url);
  if (!normalized) return false;

  try {
    return DOCUMENT_FILE_PATH.test(new URL(normalized).pathname.toLowerCase());
  } catch {
    return false;
  }
};

const FILE_SHARE_HOSTS = new Set([
  'drive.google.com',
  'docs.google.com',
  'dropbox.com',
  'onedrive.live.com',
  '1drv.ms',
  'box.com',
  'app.box.com',
  'wetransfer.com',
]);

export const isFileShareSourceUrl = (url?: string | null): boolean => {
  const normalized = normalizeSourceUrl(url);
  if (!normalized) return false;

  try {
    const host = new URL(normalized).hostname.replace(/^www\./, '').toLowerCase();
    return FILE_SHARE_HOSTS.has(host);
  } catch {
    return false;
  }
};

const PROFILE_LIKE_PATH = /(?:^|[/-])(?:profile|profiles|people|faculty)(?:[/-]|$)/i;

export const isProfileLikeSourceUrl = (url?: string | null): boolean =>
  PROFILE_LIKE_PATH.test(url || '');

const OFFICIAL_PERSON_PROFILE_PATH =
  /\/(?:profile|profiles|bio|person|people|faculty)\/([a-z0-9][a-z0-9%._-]*)$/i;

const NON_PERSON_PROFILE_LEAF =
  /^(?:faculty|staff|people|members|fellows|affiliates|directory|index|all|list|search)$/i;

export const isLikelyOfficialPersonProfileUrl = (url?: string | null): boolean => {
  const normalized = normalizeSourceUrl(url);
  if (!normalized) return false;
  if (isIdentifierOrGrantDbSourceUrl(normalized)) return false;
  if (isDirectoryRosterRootUrl(normalized)) return false;
  if (isDepartmentRosterProvenanceUrl(normalized)) return false;

  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    if (!host.endsWith('yale.edu')) return false;
    const match = parsed.pathname.replace(/\/+$/, '').match(OFFICIAL_PERSON_PROFILE_PATH);
    return Boolean(match) && !NON_PERSON_PROFILE_LEAF.test(match![1]);
  } catch {
    return false;
  }
};

const PERSON_PROFILE_MIRROR_PATH =
  /\/(profile|profiles|bio|person|people|faculty)\/([a-z0-9][a-z0-9%._-]*)$/i;

export const officialProfileMirrorKey = (url?: string | null): string | null => {
  const normalized = normalizeSourceUrl(url);
  if (!normalized) return null;
  if (isIdentifierOrGrantDbSourceUrl(normalized)) return null;
  if (isDirectoryRosterRootUrl(normalized)) return null;
  if (isDepartmentRosterProvenanceUrl(normalized)) return null;

  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    if (!host.endsWith('yale.edu')) return null;
    const match = parsed.pathname.replace(/\/+$/, '').match(PERSON_PROFILE_MIRROR_PATH);
    if (!match) return null;
    const profileType = match[1].toLowerCase();
    const slug = match[2].toLowerCase();
    if (NON_PERSON_PROFILE_LEAF.test(slug)) return null;
    return `${host}\u0000${profileType}\u0000${slug}`;
  } catch {
    return null;
  }
};

const sourceDedupeKey = (url?: string | null): string | null =>
  officialProfileMirrorKey(url) || sourceLedgerKey(url);

const actionDedupeKey = (url?: string | null): string | null =>
  officialProfileMirrorKey(url) || normalizeActionDestination(url);

export const isSameActionDestination = (first?: string | null, second?: string | null): boolean => {
  const firstKey = actionDedupeKey(first);
  return Boolean(firstKey) && firstKey === actionDedupeKey(second);
};

const pathSegmentCount = (url: string): number => {
  try {
    return new URL(url).pathname.split('/').filter(Boolean).length;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
};

const isMoreCanonicalSourceUrl = (candidate: string, current: string): boolean => {
  const candidateIsHttps = candidate.startsWith('https://');
  const currentIsHttps = current.startsWith('https://');
  if (candidateIsHttps !== currentIsHttps) return candidateIsHttps;
  return pathSegmentCount(candidate) < pathSegmentCount(current);
};

const ORG_ENGAGEMENT_PATH =
  /(^|[-/])(get[-_]?involved|join(?:[-_]us)?|involvement|participate|membership|become[-_]a[-_]member|connect|contact(?:[-_]us)?|volunteer|opportunities)([-/]|$)/i;

export const isOrgEngagementSourceUrl = (url?: string | null): boolean => {
  const normalized = normalizeSourceUrl(url);
  if (!normalized) return false;
  if (isProfileLikeSourceUrl(normalized)) return false;

  try {
    const path = new URL(normalized).pathname.toLowerCase().replace(/\/+$/, '');
    return ORG_ENGAGEMENT_PATH.test(path);
  } catch {
    return false;
  }
};

const ORG_UMBRELLA_ENTITY_TYPES = new Set(['CENTER', 'INSTITUTE', 'INITIATIVE']);

export const resolveOutreachOfficialSource = (
  sources: ResearchDetailSource[],
  claimedActionUrls: Array<string | undefined>,
  leadIdentityUnderReview: boolean,
  entityType?: string,
  rankingContext: PersonProfileRankingContext = {},
): ResearchDetailSource | undefined => {
  /**
   * `actionDedupeKey` rather than `normalizeActionDestination`: the latter compares
   * host plus path, so `/bbs/profile/<slug>` and `/profile/<slug>` on one host read
   * as two destinations and the second takes a slot the page already links. The
   * mirror key collapses them, and `isSameActionDestination` already answers this
   * exact question elsewhere, so the slot was the only caller using the weaker key
   * (#2854).
   */
  const claimedDestinations = new Set(
    claimedActionUrls.map((url) => actionDedupeKey(url)).filter(Boolean),
  );
  const claimsAPersonProfile = claimedActionUrls.some(
    (url) => url && isLikelyOfficialPersonProfileUrl(url),
  );

  const eligible = sources.filter((source) => {
    if (source.isLikelyUnavailable) return false;
    if (source.isPrivateNetworkOnly) return false;
    if (!safeHttpUrl(source.url)) return false;
    if (isIdentifierOrGrantDbSourceUrl(source.url)) return false;
    if (isNonContactableDocumentSourceUrl(source.url)) return false;
    if (leadIdentityUnderReview && isProfileLikeSourceUrl(source.url)) return false;
    /**
     * This slot means "this research's own website". Once the page links a person's
     * profile, another profile is the wrong KIND of thing for it, not merely a
     * worse-ranked one, so no dedupe key can rescue the cases the key cannot
     * collapse: the same person under two path types on one host, or on two hosts
     * entirely, which is the genuine joint-appointment case. Empty beats a second
     * door to a room the card already opens (#2835, #2854).
     */
    if (
      claimsAPersonProfile &&
      (isLikelyOfficialPersonProfileUrl(source.url) ||
        isCrossSchoolDirectoryProfileUrl(source.url, rankingContext.schools))
    )
      return false;
    const destination = actionDedupeKey(source.url);
    return Boolean(destination) && !claimedDestinations.has(destination);
  });

  if (eligible.length === 0) return undefined;

  if (entityType && ORG_UMBRELLA_ENTITY_TYPES.has(entityType)) {
    const engagementSource = eligible.find((source) => isOrgEngagementSourceUrl(source.url));
    if (engagementSource) return engagementSource;
  }

  const officialPersonProfileSource = eligible.find((source) =>
    isLikelyOfficialPersonProfileUrl(source.url),
  );
  if (officialPersonProfileSource) return officialPersonProfileSource;

  return eligible[0];
};

interface DecisionProfileGroup {
  leadIdentityStatus?: string;
  websiteUrl?: string;
  website?: string;
  sourceUrls?: unknown;
  school?: string;
  schools?: unknown;
}

const entityRankingContext = (
  group?: { school?: string; schools?: unknown } | null,
): PersonProfileRankingContext => ({
  schools: [group?.school, ...(Array.isArray(group?.schools) ? group.schools : [])].filter(
    (school): school is string => typeof school === 'string',
  ),
});

export const resolveDecisionProfileUrl = (
  fallbackSourceUrl: string | undefined,
  group?: DecisionProfileGroup | null,
  corroboratedLeadProfileUrl?: string,
): string | undefined => {
  if (group?.leadIdentityStatus === 'under_review') return undefined;

  const labWebsiteDestinations = new Set(
    [group?.websiteUrl, group?.website]
      .filter((url) => url && !isProfileLikeSourceUrl(url))
      .map((url) => normalizeActionDestination(url))
      .filter(Boolean),
  );
  const candidateUrls = [
    fallbackSourceUrl,
    ...(Array.isArray(group?.sourceUrls) ? group.sourceUrls : []),
  ];
  const entitySourceDestinations = new Set(
    candidateUrls
      .filter((url): url is string => typeof url === 'string')
      .map((url) => normalizeActionDestination(url))
      .filter(Boolean),
  );
  const corroboratedDestination = normalizeActionDestination(corroboratedLeadProfileUrl);
  if (corroboratedDestination && entitySourceDestinations.has(corroboratedDestination)) {
    return corroboratedLeadProfileUrl;
  }

  const eligibleProfileUrls = candidateUrls.filter((url): url is string => {
    if (typeof url !== 'string') return false;
    if (!isProfileLikeSourceUrl(url) || isDepartmentRosterProvenanceUrl(url)) return false;
    if (isRawDataApiSourceUrl(url) || isIdentifierOrGrantDbSourceUrl(url)) return false;
    const destination = normalizeActionDestination(url);
    return Boolean(destination) && !labWebsiteDestinations.has(destination);
  });
  const [bestProfileUrl] = rankPersonProfileUrls(eligibleProfileUrls, entityRankingContext(group));
  if (bestProfileUrl) return normalizeSourceUrl(bestProfileUrl) || corroboratedLeadProfileUrl;
  return corroboratedLeadProfileUrl;
};

export const prefersOrgEngagementOutreach = (
  entityType: string | undefined,
  officialSource: ResearchDetailSource | undefined,
  leadIsGenuinePrincipalInvestigator: boolean,
): boolean => {
  if (!officialSource) return false;
  if (!entityType || !ORG_UMBRELLA_ENTITY_TYPES.has(entityType)) return false;
  if (leadIsGenuinePrincipalInvestigator) return false;
  return isOrgEngagementSourceUrl(officialSource.url);
};

const DRUPAL_FACET_QUERY = /[?&]f(?:\[|%5b)\d+(?:\]|%5d)=/i;

const SECTION_INDEX_ROOT_PATH =
  /^\/(?:cores|centers|centers-institutes|centers-initiatives|research\/centers)$/i;

export const isFacetedOrSectionIndexSourceUrl = (url?: string | null): boolean => {
  const normalized = normalizeSourceUrl(url);
  if (!normalized) return false;

  try {
    const parsed = new URL(normalized);
    const path = parsed.pathname.toLowerCase().replace(/\/+$/, '');
    return DRUPAL_FACET_QUERY.test(parsed.search) || SECTION_INDEX_ROOT_PATH.test(path);
  } catch {
    return false;
  }
};

const BOILERPLATE_PLATFORM_HOSTS = new Set([
  'wordpress.org',
  'wordpress.com',
  'wp.com',
  'w.org',
  'automattic.com',
  'jetpack.com',
  'gravatar.com',
  'drupal.org',
  'joomla.org',
  'squarespace.com',
  'wix.com',
  'weebly.com',
  'godaddy.com',
]);

export const isBoilerplatePlatformSourceUrl = (url?: string | null): boolean => {
  const normalized = normalizeSourceUrl(url);
  if (!normalized) return false;

  try {
    const host = new URL(normalized).hostname.replace(/^www\./, '').toLowerCase();
    return BOILERPLATE_PLATFORM_HOSTS.has(host);
  } catch {
    return false;
  }
};

export const isSuppressedResearchWebsiteCtaUrl = (url?: string | null): boolean =>
  isFacetedOrSectionIndexSourceUrl(url) ||
  isBoilerplatePlatformSourceUrl(url) ||
  isDirectoryRosterRootUrl(url) ||
  isNonContactableDocumentSourceUrl(url) ||
  isFileShareSourceUrl(url);

export const isUnavailableResearchWebsiteCtaUrl = (
  url: string | null | undefined,
  sourceLinkHealth: DetailSourceLinkHealth[] = [],
): boolean => {
  const key = sourceLedgerKey(url);
  if (!key) return false;
  const health = sourceLinkHealth.find((entry) => sourceLedgerKey(entry.url) === key);
  return isLikelyUnavailableSourceLink(health);
};

export const isPrivateNetworkOnlyResearchWebsiteCtaUrl = (
  url: string | null | undefined,
  sourceLinkHealth: DetailSourceLinkHealth[] = [],
): boolean => {
  const key = sourceLedgerKey(url);
  if (!key) return false;
  return isPrivateNetworkOnlySourceLink(
    sourceLinkHealth.find((entry) => sourceLedgerKey(entry.url) === key),
  );
};

/**
 * Whether the research-website CTA must not offer this URL as an ordinary link,
 * because the student it is offered to cannot open it: the page is known gone, or
 * its host is reachable only from inside Yale's network (#2556). The citation
 * itself survives in the Sources list, qualified, because it is real provenance.
 */
export const isUnreachableResearchWebsiteCtaUrl = (
  url: string | null | undefined,
  sourceLinkHealth: DetailSourceLinkHealth[] = [],
): boolean =>
  isUnavailableResearchWebsiteCtaUrl(url, sourceLinkHealth) ||
  isPrivateNetworkOnlyResearchWebsiteCtaUrl(url, sourceLinkHealth);

const titleFromPath = (path: string): string => {
  const parts = path.split('/').filter(Boolean);
  const rawLeaf = parts[parts.length - 1];
  const leaf = rawLeaf ? decodeURIComponent(rawLeaf) : '';
  if (!leaf) return 'Official source';
  if (/\.pdf$/i.test(leaf)) {
    return `${labelizeResearchDetailValue(leaf.replace(/\.pdf$/i, ''))} PDF`;
  }
  return `${labelizeResearchDetailValue(leaf)} page`;
};

export const sourceLabelForUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    const path = parsed.pathname.toLowerCase();

    if (host === 'wti.yale.edu' && path.includes('/initiatives/undergraduate')) {
      return 'Undergraduate initiatives page';
    }
    if (host === 'nsf.gov' && path.startsWith('/awardsearch')) {
      return 'NSF Award Search';
    }
    if (host.endsWith('yale.edu')) {
      return titleFromPath(parsed.pathname);
    }
    return `${host} source`;
  } catch {
    return 'Official source';
  }
};

/**
 * A source row the profile ranking may reorder and name by role: a person profile
 * or an identifier record, never a lab page or an evidence citation, whose label
 * still has to describe the page a student is about to open.
 */
const isRankableProfileSource = (url: string): boolean =>
  isProfileLikeSourceUrl(url) || isIdentifierRecordUrl(url);

const personProfileRoleLabelForSource = (url: string): string | undefined =>
  isRankableProfileSource(url) ? personProfileSourceRoleLabel(url) : undefined;

/**
 * Reorder the profile rows among themselves while every other row, and the
 * unavailable-last grouping, stays exactly where the caller put it. Ranking the
 * whole list instead would let an evidence citation or a dead link change place.
 */
const withPersonProfilesRanked = <T extends { url: string; isLikelyUnavailable: boolean }>(
  sources: T[],
  context: PersonProfileRankingContext,
): T[] => {
  const ranked = [...sources];
  [false, true].forEach((unavailable) => {
    const positions = ranked
      .map((source, index) => ({ source, index }))
      .filter(
        ({ source }) =>
          source.isLikelyUnavailable === unavailable && isRankableProfileSource(source.url),
      );
    const ordered = positions
      .map(({ source }) => source)
      .sort((left, right) => comparePersonProfileUrls(left.url, right.url, context));
    positions.forEach(({ index }, position) => {
      ranked[index] = ordered[position];
    });
  });
  return ranked;
};

export const buildResearchDetailSources = ({
  group,
  accessSignals = [],
  undergraduateLogistics,
  sourceLinkHealth = [],
  sourceFieldContributions = [],
}: BuildResearchDetailSourcesInput): ResearchDetailSource[] => {
  const sources = new Map<string, ResearchDetailSource>();
  const contributionsByLedgerKey = new Map<string, string[]>();

  sourceFieldContributions.forEach((entry) => {
    const key = sourceLedgerKey(entry.sourceUrl);
    const labels = (entry.contributions || []).filter(
      (label): label is string => typeof label === 'string' && label.trim().length > 0,
    );
    if (!key || labels.length === 0) return;
    const existing = contributionsByLedgerKey.get(key);
    if (existing) labels.forEach((label) => existing.includes(label) || existing.push(label));
    else contributionsByLedgerKey.set(key, [...labels]);
  });
  const healthByLedgerKey = new Map<string, DetailSourceLinkHealth>();

  sourceLinkHealth.forEach((entry) => {
    const key = sourceLedgerKey(entry.url);
    if (!key) return;
    healthByLedgerKey.set(key, {
      healthStatus: entry.healthStatus,
      httpStatusCode: entry.httpStatusCode,
      privateAddressHost: entry.privateAddressHost,
    });
  });

  const contextsFor = (normalizedUrl: string, context: string): string[] => {
    if (context !== GENERIC_PROFILE_SOURCE_CONTEXT) return [context];
    const contributed = contributionsByLedgerKey.get(sourceLedgerKey(normalizedUrl) || '');
    return contributed && contributed.length ? contributed : [context];
  };

  const addSource = (url: string | undefined, context: string) => {
    const normalized = normalizeSourceUrl(url);
    if (!normalized) return;
    if (isDepartmentRosterProvenanceUrl(normalized)) return;
    if (isDirectoryRosterRootUrl(normalized)) return;
    if (isFacetedOrSectionIndexSourceUrl(normalized)) return;
    if (isBoilerplatePlatformSourceUrl(normalized)) return;
    if (isRawDataApiSourceUrl(normalized)) return;

    const key = sourceDedupeKey(normalized);
    if (!key) return;

    const contexts = contextsFor(normalized, context);
    const existing = sources.get(key);
    if (existing) {
      contexts.forEach((entry) => {
        if (!existing.contexts.includes(entry)) existing.contexts.push(entry);
      });
      if (isMoreCanonicalSourceUrl(normalized, existing.url)) {
        existing.url = normalized;
      }
      return;
    }

    sources.set(key, {
      url: normalized,
      label:
        context === 'Profile website'
          ? 'Research website'
          : personProfileRoleLabelForSource(normalized) || sourceLabelForUrl(normalized),
      contexts,
      isLikelyUnavailable: false,
      isPrivateNetworkOnly: false,
    });
  };

  addSource(group?.websiteUrl, 'Profile website');
  group?.sourceUrls?.forEach((url) => addSource(url, GENERIC_PROFILE_SOURCE_CONTEXT));

  accessSignals.forEach((signal) => {
    if (!isCitableAccessSignal(signal)) return;
    addSource(signal.sourceUrl, `${labelizeResearchDetailValue(signal.signalType)} evidence`);
  });

  undergraduateLogistics?.claims?.forEach((claim) => {
    if (claim.state !== 'known') return;
    addSource(
      claim.evidence?.sourceUrl,
      `${labelizeResearchDetailValue(claim.claimType)} logistics evidence`,
    );
  });

  const withHealth = Array.from(sources.values())
    .map((source) => {
      const health = healthByLedgerKey.get(sourceLedgerKey(source.url) || '');
      return {
        ...source,
        ...(health?.healthStatus ? { healthStatus: health.healthStatus } : {}),
        ...(typeof health?.httpStatusCode === 'number'
          ? { httpStatusCode: health.httpStatusCode }
          : {}),
        isLikelyUnavailable: isLikelyUnavailableSourceLink(health),
        isPrivateNetworkOnly: isPrivateNetworkOnlySourceLink(health),
      };
    })
    .sort(
      (left, right) =>
        Number(left.isLikelyUnavailable || left.isPrivateNetworkOnly) -
        Number(right.isLikelyUnavailable || right.isPrivateNetworkOnly),
    );

  return withPersonProfilesRanked(withHealth, entityRankingContext(group));
};
