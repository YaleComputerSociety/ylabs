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
}

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

export const entityOfficialPersonProfileDestinations = (
  entity: Record<string, any>,
): Set<string> =>
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
 * are an official person profile. When such an entity carries a lead whose own
 * official profile does not match that person, the entity's whole identity is
 * contaminated by a lead dispute and it must drop out of student discovery
 * (repair queue), not merely hide the PI card behind the detail "under review"
 * box. Absent any lead profile evidence we do not assume a conflict.
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

  const leadsWithOfficialProfile = leadMembers.filter((member) =>
    Boolean(resolveLeadOfficialProfileUrl(member)),
  );
  if (leadsWithOfficialProfile.length === 0) return false;

  const matchingLeads = leadsWithOfficialProfile.filter((member) =>
    entityDestinations.has(
      normalizeOfficialProfileDestination(resolveLeadOfficialProfileUrl(member)),
    ),
  );
  return matchingLeads.length === 0;
}
