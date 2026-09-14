export interface LabSiteCandidateEntity {
  slug?: unknown;
  name?: unknown;
  studentVisibilityTier?: unknown;
  websiteUrl?: unknown;
  sourceUrls?: unknown;
}

export interface LabSiteLookupTarget {
  entitySlug: string;
  entityName: string;
  piName: string;
  query: string;
}

const stringEntries = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

const PROFILE_PATH = /\/(profile|people|person|directory)\//i;
const GRANT_OR_IDENTIFIER = /(nsf\.gov|api\.nsf\.gov|reporter\.nih\.gov|orcid\.org)/i;

export const isProfileCitation = (url: string): boolean => PROFILE_PATH.test(url);
export const isGrantCitation = (url: string): boolean => GRANT_OR_IDENTIFIER.test(url);

/**
 * A served lab row that cites the professor but no lab site. This is the #2652
 * population: 301 rows on Development at the time of writing.
 */
export function needsLabWebsite(entity: LabSiteCandidateEntity): boolean {
  const urls = [...stringEntries(entity.sourceUrls), entity.websiteUrl].filter(
    (url): url is string => typeof url === 'string' && /^https?:/i.test(url),
  );
  if (!urls.some(isProfileCitation)) return false;
  return urls.filter((url) => !isProfileCitation(url) && !isGrantCitation(url)).length === 0;
}

export function piNameFromEntityName(name: unknown): string {
  if (typeof name !== 'string') return '';
  return name
    .replace(/\b(lab|laboratory|research|group|the)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildLookupTarget(entity: LabSiteCandidateEntity): LabSiteLookupTarget | null {
  const entitySlug = typeof entity.slug === 'string' ? entity.slug : '';
  const entityName = typeof entity.name === 'string' ? entity.name : '';
  const piName = piNameFromEntityName(entityName);
  if (!entitySlug || piName.split(/\s+/).length < 2) return null;
  return { entitySlug, entityName, piName, query: `"${piName}" Yale lab research group` };
}

const REJECT_HOST =
  /(linkedin|twitter|x\.com|bsky\.app|facebook|instagram|researchgate|scholar\.google|pubmed|ncbi\.nlm|doi\.org|semanticscholar|orcid\.org|wikipedia|loop\.frontiersin|expertscape|doximity|healthgrades|sciprofiles|europepmc)/i;

/**
 * A search result worth fetching. Rejects the social, bibliographic and
 * physician-rating hosts that dominate a name search, and rejects a Yale profile
 * page because the row already has one - the whole point is to find the OTHER link.
 */
export function isWorthFetching(url: unknown): boolean {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (REJECT_HOST.test(parsed.hostname)) return false;
  if (isProfileCitation(url)) return false;
  if (isGrantCitation(url)) return false;
  return true;
}

export interface LabSiteVerdict {
  url: string;
  status: number;
  title: string;
  namesPi: boolean;
  mentionsYale: boolean;
  looksLikeLabSite: boolean;
}

const LAB_SITE_MARKERS =
  /\b(principal investigator|our lab|the lab|lab members|join the lab|research group|group members|positions available|our research|publications)\b/i;

export function nameTokens(piName: string): string[] {
  return piName
    .toLowerCase()
    .replace(/[^a-z ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Whether a fetched page is adoptable as this PI's lab site.
 *
 * Requires the page to name the PI AND mention Yale AND read like a lab site.
 * All three are needed because the measured failure mode is never candidate
 * supply, it is SUBJECT: `bakhoumlab.org` passed a surname-plus-Yale gate while
 * belonging to Mathieu Bakhoum rather than Christine, and `gentlelab.com` is a
 * skincare brand that passed a surname gate (#2652).
 *
 * A surname alone is not enough. Both name tokens must appear, which is what
 * separates two people who share a surname at the same university.
 */
export function isAdoptableLabSite(verdict: LabSiteVerdict, piName: string): boolean {
  if (verdict.status < 200 || verdict.status >= 400) return false;
  const tokens = nameTokens(piName);
  if (tokens.length < 2) return false;
  return verdict.namesPi && verdict.mentionsYale && verdict.looksLikeLabSite;
}

export function judgePage(
  url: string,
  status: number,
  title: string,
  body: string,
  piName: string,
): LabSiteVerdict {
  const haystack = `${title} ${body}`.replace(/<[^>]*>/g, ' ').toLowerCase();
  const tokens = nameTokens(piName);
  return {
    url,
    status,
    title,
    namesPi: tokens.length >= 2 && tokens.every((token) => haystack.includes(token)),
    mentionsYale: /\byale\b/.test(haystack),
    looksLikeLabSite: LAB_SITE_MARKERS.test(haystack),
  };
}
