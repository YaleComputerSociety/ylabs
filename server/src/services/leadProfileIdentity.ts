import { isPublicHttpUrl } from '../utils/urlSafety';
import type { ResearcherProfileLink } from '../models/researcher';

const GENERIC_PERSON_DIRECTORY_SEGMENTS = new Set([
  'directory',
  'directories',
  'faculty',
  'faculty-directory',
  'members',
  'people',
  'person',
  'profiles',
  'staff',
]);
const GENERIC_PROFILE_CATEGORY_SEGMENTS = new Set([
  'active',
  'adjunct',
  'affiliated',
  'affiliate',
  'all',
  'clinical',
  'emeriti',
  'emeritus',
  'instructional',
  'ladder',
  'postdoctoral',
  'postdocs',
  'primary',
  'research',
  'secondary',
  'visiting',
]);

export const hasSpecificOfficialPersonPathSegment = (
  pathSegments: string[],
  label: string,
): boolean => {
  const index = pathSegments.indexOf(label);
  if (index < 0) return false;
  const nextSegment = pathSegments[index + 1] || '';
  return (
    Boolean(nextSegment) &&
    !GENERIC_PERSON_DIRECTORY_SEGMENTS.has(nextSegment) &&
    !GENERIC_PROFILE_CATEGORY_SEGMENTS.has(nextSegment)
  );
};

export const isLikelyOfficialPersonProfileUrl = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();

  try {
    if (!isPublicHttpUrl(trimmed)) return false;
    const parsed = new URL(trimmed);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    const pathSegments = parsed.pathname
      .toLowerCase()
      .split('/')
      .map((segment) => segment.trim())
      .filter(Boolean);
    const isYaleOwned = host === 'yale.edu' || host.endsWith('.yale.edu') || host === 'yalies.io';
    if (!isYaleOwned) return false;
    if (host === 'yalies.io') return true;

    return (
      hasSpecificOfficialPersonPathSegment(pathSegments, 'profile') ||
      hasSpecificOfficialPersonPathSegment(pathSegments, 'profiles') ||
      hasSpecificOfficialPersonPathSegment(pathSegments, 'people') ||
      hasSpecificOfficialPersonPathSegment(pathSegments, 'person') ||
      hasSpecificOfficialPersonPathSegment(pathSegments, 'faculty') ||
      hasSpecificOfficialPersonPathSegment(pathSegments, 'faculty-directory')
    );
  } catch {
    return false;
  }
};

export const normalizeOfficialProfileDestination = (url?: string | null): string => {
  const value = String(url || '').trim();
  if (!value) return '';

  try {
    const parsed = new URL(value);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${host}${path}`;
  } catch {
    return value
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .replace(/\/+$/, '')
      .toLowerCase();
  }
};

const OFFICIAL_PROFILE_URL_KEYS = [
  'official',
  'medicine',
  'ysm',
  'departmental',
  'directory',
  'yalies',
];

const safeProfileUrlObject = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([, url]) => isPublicHttpUrl(url)),
  ) as Record<string, string>;
};

export interface LeadProfileIdentityLead {
  user?: Record<string, any> | null;
  row?: Record<string, any> | null;
  name?: unknown;
  netid?: unknown;
}

const PERSON_PROFILE_PATH_SEGMENTS = [
  'profile',
  'profiles',
  'people',
  'person',
  'faculty',
  'faculty-directory',
];

const normalizeIdentityToken = (value: unknown): string =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

const nameTokensFrom = (value: unknown): string[] =>
  String(value ?? '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((token) => token.length >= 2);

interface LeadDirectoryIdentity {
  netid: string;
  nameTokens: Set<string>;
  profileSlugs: Set<string>;
}

const GROUP_LIKE_SLUG_TOKENS = new Set([
  'lab',
  'labs',
  'laboratory',
  'group',
  'center',
  'centre',
  'institute',
  'program',
  'programme',
  'core',
  'consortium',
  'initiative',
  'project',
]);

const isGroupLikeProfileSlug = (slug: string): boolean =>
  slug
    .toLowerCase()
    .split(/[^a-z]+/)
    .some((token) => GROUP_LIKE_SLUG_TOKENS.has(token));

const personProfileSlugFromDestination = (destination: string): string => {
  const segments = destination.split('/').filter(Boolean);
  for (let index = segments.length - 2; index >= 1; index -= 1) {
    if (PERSON_PROFILE_PATH_SEGMENTS.includes(segments[index]) && segments[index + 1]) {
      const slug = segments[index + 1];
      return isGroupLikeProfileSlug(slug) ? '' : slug;
    }
  }
  return '';
};

const leadOfficialProfileSlugs = (lead: LeadProfileIdentityLead): string[] => {
  const profileUrls = safeProfileUrlObject(lead.user?.profileUrls || lead.user?.profile_urls);
  return [
    ...Object.values(profileUrls),
    lead.user?.websiteUrl,
    lead.user?.website,
    lead.row?.sourceUrl,
  ]
    .filter(isLikelyOfficialPersonProfileUrl)
    .map((url) =>
      personProfileSlugFromDestination(normalizeOfficialProfileDestination(String(url))),
    )
    .filter(Boolean)
    .map((slug) => normalizeIdentityToken(slug));
};

const resolveLeadDirectoryIdentity = (lead: LeadProfileIdentityLead): LeadDirectoryIdentity => {
  const user = (lead.user && typeof lead.user === 'object' ? lead.user : {}) as Record<string, any>;
  const row = (lead.row && typeof lead.row === 'object' ? lead.row : {}) as Record<string, any>;
  const netid = normalizeIdentityToken(user.netid ?? user.netId ?? lead.netid);
  const nameSource =
    user.displayName ||
    [user.fname, user.lname].filter(Boolean).join(' ') ||
    user.name ||
    lead.name ||
    row.name ||
    '';
  return {
    netid,
    nameTokens: new Set(nameTokensFrom(nameSource)),
    profileSlugs: new Set(leadOfficialProfileSlugs(lead)),
  };
};

const hasResolvableLeadIdentity = (identity: LeadDirectoryIdentity): boolean =>
  Boolean(identity.netid) || identity.nameTokens.size > 0 || identity.profileSlugs.size > 0;

const ORGANIZATIONAL_OR_PROGRAM_ENTITY_TYPES = new Set([
  'CENTER',
  'INSTITUTE',
  'INITIATIVE',
  'CORE_FACILITY',
  'PROGRAM',
]);

const textValue = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

// An organizational/program home's own identity is institutional, not
// personal (mirrors the no-attached-PI lead exemption in
// studentVisibilityTier.ts). A center or program whose websiteUrl happens to
// resolve to an unrelated person's official profile - e.g. a stale or
// mis-scraped link - is not "person-derived": that mismatch is a data-quality
// issue on the entity's own link, not a contested identity between two
// people, so it must never trip this gate.
const isOrganizationalOrProgramEntity = (entity: Record<string, any>): boolean =>
  textValue(entity.kind).toLowerCase() === 'program' ||
  ORGANIZATIONAL_OR_PROGRAM_ENTITY_TYPES.has(textValue(entity.entityType).toUpperCase());

const MIN_SHARED_NAME_TOKENS_TO_CORROBORATE = 2;

const sharedNameTokenCount = (slug: string, nameTokens: Set<string>): number => {
  const slugTokens = new Set(nameTokensFrom(slug));
  let shared = 0;
  for (const token of slugTokens) {
    if (nameTokens.has(token)) shared += 1;
  }
  return shared;
};

const profileSlugCorroboratesLead = (slug: string, identity: LeadDirectoryIdentity): boolean => {
  const normalizedSlug = normalizeIdentityToken(slug);
  if (identity.netid && normalizedSlug === identity.netid) return true;
  if (identity.profileSlugs.has(normalizedSlug)) return true;
  // A shared surname alone stitches a foreign, same-named person's profile onto
  // a different lead (issue #468), so a single overlapping name token can never
  // corroborate. Corroborate on the lead's full directory name instead: the
  // entity's person-profile slug and the lead name must share at least two name
  // tokens (typically given plus family). This one symmetric rule replaces the
  // asymmetric behavior that held same-person slug variants when the lead had
  // its own profile URL, yet cleared surname-only collisions when it did not.
  return (
    sharedNameTokenCount(slug, identity.nameTokens) >= MIN_SHARED_NAME_TOKENS_TO_CORROBORATE
  );
};

export const resolveLeadOfficialProfileUrl = (lead: LeadProfileIdentityLead): string => {
  const profileUrls = safeProfileUrlObject(lead.user?.profileUrls || lead.user?.profile_urls);
  const orderedKeys = [
    ...OFFICIAL_PROFILE_URL_KEYS,
    ...Object.keys(profileUrls).filter((key) => !OFFICIAL_PROFILE_URL_KEYS.includes(key)),
  ];

  for (const key of orderedKeys) {
    const url = profileUrls[key];
    if (isLikelyOfficialPersonProfileUrl(url)) return url.trim();
  }

  const fallbackUrls = [lead.user?.websiteUrl, lead.user?.website, lead.row?.sourceUrl];
  return fallbackUrls.find(isLikelyOfficialPersonProfileUrl)?.trim() || '';
};

const YALE_OFFICIAL_PROFILE_LINK_KINDS = new Set<ResearcherProfileLink['kind']>(['YALE_OFFICIAL']);

export const officialProfileUrlFromRosterEntry = (entry: {
  profileLinks?: readonly ResearcherProfileLink[];
  websiteUrl?: string;
}): string => {
  const links = Array.isArray(entry.profileLinks) ? entry.profileLinks : [];
  for (const link of links) {
    if (
      link &&
      YALE_OFFICIAL_PROFILE_LINK_KINDS.has(link.kind) &&
      isLikelyOfficialPersonProfileUrl(link.url)
    ) {
      return link.url.trim();
    }
  }
  return isLikelyOfficialPersonProfileUrl(entry.websiteUrl) ? String(entry.websiteUrl).trim() : '';
};

export const entityOfficialPersonProfileDestinations = (entity: Record<string, any>): Set<string> =>
  new Set(
    [
      entity.websiteUrl,
      entity.website,
      ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : []),
      ...Object.values(safeProfileUrlObject(entity.profileUrls || entity.profile_urls)),
    ]
      .filter(isLikelyOfficialPersonProfileUrl)
      .map((url) => normalizeOfficialProfileDestination(String(url)))
      .filter(Boolean),
  );

/**
 * A person-derived entity is one whose own identity links (name/site/sources)
 * are an official person profile. Its identity is contested when its official
 * person-profile home resolves to a different person than the lead we attached.
 * We corroborate the entity's profile-home person against each lead by that
 * lead's own official profile-page person, netid, or name tokens - so the same
 * person on two hosts (e.g. chem vs medicine `/profile/drew-fixture`) is not a
 * conflict, while `/profile/qz990` under a `ch51` lead is (issue
 * #468: name-only matching stitched a foreign Yale profile onto a same-named
 * PI). A contested entity must drop out of student discovery (repair queue),
 * not merely hide the PI card behind the detail "under review" box. Absent any
 * lead identity at all we do not assume a conflict. Organizational/program
 * homes (centers, institutes, initiatives, core facilities, programs) are
 * exempt: their own identity is never a person, so a person-profile-shaped
 * link on them is a data-quality issue, not a contested identity.
 */
export function detectProfileIdentityRisk({
  entity,
  leadMembers = [],
}: {
  entity: Record<string, any>;
  leadMembers?: Array<LeadProfileIdentityLead>;
}): boolean {
  if (isOrganizationalOrProgramEntity(entity)) return false;

  const entityDestinations = entityOfficialPersonProfileDestinations(entity);
  if (entityDestinations.size === 0) return false;
  if (leadMembers.length === 0) return false;

  const entityPersonSlugs = [...entityDestinations]
    .map(personProfileSlugFromDestination)
    .filter(Boolean);
  if (entityPersonSlugs.length === 0) return false;

  const leadIdentities = leadMembers
    .map(resolveLeadDirectoryIdentity)
    .filter(hasResolvableLeadIdentity);
  if (leadIdentities.length === 0) return false;

  const corroborated = entityPersonSlugs.some((slug) =>
    leadIdentities.some((identity) => profileSlugCorroboratesLead(slug, identity)),
  );
  return !corroborated;
}
