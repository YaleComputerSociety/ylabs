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

const profileSlugCorroboratesLead = (slug: string, identity: LeadDirectoryIdentity): boolean => {
  const normalizedSlug = normalizeIdentityToken(slug);
  if (identity.netid && normalizedSlug === identity.netid) return true;
  if (identity.profileSlugs.has(normalizedSlug)) return true;
  // A lead's own official profile page is authoritative: when we have one, a
  // different person page under the entity is a conflict even if it shares a
  // surname with a different person. Only fall back to the softer
  // name-token overlap when the lead offers no profile page to compare against.
  if (identity.profileSlugs.size > 0) return false;
  return nameTokensFrom(slug).some((token) => identity.nameTokens.has(token));
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
 * lead identity at all we do not assume a conflict.
 */
export function detectProfileIdentityRisk({
  entity,
  leadMembers = [],
}: {
  entity: Record<string, any>;
  leadMembers?: Array<LeadProfileIdentityLead>;
}): boolean {
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
