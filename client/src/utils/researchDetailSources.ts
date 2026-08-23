import { safeHttpUrl } from './url';

interface DetailSourceGroup {
  name?: string;
  websiteUrl?: string;
  sourceUrls?: string[];
}

interface DetailSourceSignal {
  _id?: string;
  signalType?: string;
  sourceUrl?: string;
}

interface DetailSourceUndergraduateLogistics {
  claims?: Array<{
    claimType?: string;
    state?: string;
    evidence?: { sourceUrl?: string };
  }>;
}

export interface DetailSourceLinkHealth {
  url?: string;
  healthStatus?: string;
  httpStatusCode?: number;
}

export interface BuildResearchDetailSourcesInput {
  group?: DetailSourceGroup | null;
  accessSignals?: DetailSourceSignal[];
  undergraduateLogistics?: DetailSourceUndergraduateLogistics;
  sourceLinkHealth?: DetailSourceLinkHealth[];
}

export interface ResearchDetailSource {
  url: string;
  label: string;
  contexts: string[];
  healthStatus?: string;
  httpStatusCode?: number;
  isLikelyUnavailable: boolean;
}

export const isLikelyUnavailableSourceLink = (
  health: { healthStatus?: string; httpStatusCode?: number } | undefined,
): boolean => {
  if (!health) return false;
  return (
    health.healthStatus === 'UNAVAILABLE' ||
    (typeof health.httpStatusCode === 'number' && health.httpStatusCode >= 400)
  );
};

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
      FACULTY_DIRECTORY_ROOT_PATH.test(path)
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
): ResearchDetailSource | undefined => {
  const claimedDestinations = new Set(
    claimedActionUrls.map((url) => normalizeActionDestination(url)).filter(Boolean),
  );

  const eligible = sources.filter((source) => {
    if (source.isLikelyUnavailable) return false;
    if (!safeHttpUrl(source.url)) return false;
    if (isIdentifierOrGrantDbSourceUrl(source.url)) return false;
    if (isNonContactableDocumentSourceUrl(source.url)) return false;
    if (leadIdentityUnderReview && isProfileLikeSourceUrl(source.url)) return false;
    const destination = normalizeActionDestination(source.url);
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
  isDirectoryRosterRootUrl(url);

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

export const buildResearchDetailSources = ({
  group,
  accessSignals = [],
  undergraduateLogistics,
  sourceLinkHealth = [],
}: BuildResearchDetailSourcesInput): ResearchDetailSource[] => {
  const sources = new Map<string, ResearchDetailSource>();
  const healthByKey = new Map<string, { healthStatus?: string; httpStatusCode?: number }>();

  sourceLinkHealth.forEach((entry) => {
    const key = sourceLedgerKey(entry.url);
    if (!key) return;
    healthByKey.set(key, {
      healthStatus: entry.healthStatus,
      httpStatusCode: entry.httpStatusCode,
    });
  });

  const addSource = (url: string | undefined, context: string) => {
    const normalized = normalizeSourceUrl(url);
    if (!normalized) return;
    if (isDepartmentRosterProvenanceUrl(normalized)) return;
    if (isDirectoryRosterRootUrl(normalized)) return;
    if (isFacetedOrSectionIndexSourceUrl(normalized)) return;
    if (isBoilerplatePlatformSourceUrl(normalized)) return;
    if (isRawDataApiSourceUrl(normalized)) return;

    const key = sourceLedgerKey(normalized);
    if (!key) return;

    const existing = sources.get(key);
    if (existing) {
      if (!existing.contexts.includes(context)) existing.contexts.push(context);
      if (existing.url.startsWith('http://') && normalized.startsWith('https://')) {
        existing.url = normalized;
      }
      return;
    }

    const health = healthByKey.get(key);
    sources.set(key, {
      url: normalized,
      label: context === 'Profile website' ? 'Research website' : sourceLabelForUrl(normalized),
      contexts: [context],
      ...(health?.healthStatus ? { healthStatus: health.healthStatus } : {}),
      ...(typeof health?.httpStatusCode === 'number'
        ? { httpStatusCode: health.httpStatusCode }
        : {}),
      isLikelyUnavailable: isLikelyUnavailableSourceLink(health),
    });
  };

  addSource(group?.websiteUrl, 'Profile website');
  group?.sourceUrls?.forEach((url) => addSource(url, 'Profile source'));

  accessSignals.forEach((signal) => {
    addSource(signal.sourceUrl, `${labelizeResearchDetailValue(signal.signalType)} evidence`);
  });

  undergraduateLogistics?.claims?.forEach((claim) => {
    if (claim.state !== 'known') return;
    addSource(
      claim.evidence?.sourceUrl,
      `${labelizeResearchDetailValue(claim.claimType)} logistics evidence`,
    );
  });

  return Array.from(sources.values()).sort(
    (left, right) => Number(left.isLikelyUnavailable) - Number(right.isLikelyUnavailable),
  );
};
