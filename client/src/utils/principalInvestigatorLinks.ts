import { safeHttpUrl, safeRouteSegment } from './url';

export interface PrincipalInvestigatorLink {
  href: string;
  external: boolean;
}

const PROFILE_URL_MAP_PRIORITY = [
  'official',
  'medicine',
  'ysm',
  'ysph',
  'department',
  'departmental',
  'directory',
  'faculty',
  'faculty-directory',
  'people',
  'yale',
];

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

const hasSpecificPersonPathSegment = (pathSegments: string[], label: string): boolean => {
  const index = pathSegments.indexOf(label);
  if (index < 0) return false;
  const nextSegment = pathSegments[index + 1] || '';
  return (
    Boolean(nextSegment) &&
    !GENERIC_PERSON_DIRECTORY_SEGMENTS.has(nextSegment) &&
    !GENERIC_PROFILE_CATEGORY_SEGMENTS.has(nextSegment)
  );
};

const isOfficialYaleProfileUrl = (href: string): boolean => {
  try {
    const url = new URL(href);
    const host = url.hostname.toLowerCase();
    const pathSegments = url.pathname
      .toLowerCase()
      .split('/')
      .map((segment) => segment.trim())
      .filter(Boolean);
    return (
      /(^|\.)yale\.edu$/.test(host) &&
      (hasSpecificPersonPathSegment(pathSegments, 'profile') ||
        hasSpecificPersonPathSegment(pathSegments, 'profiles') ||
        hasSpecificPersonPathSegment(pathSegments, 'people') ||
        hasSpecificPersonPathSegment(pathSegments, 'person') ||
        hasSpecificPersonPathSegment(pathSegments, 'faculty') ||
        hasSpecificPersonPathSegment(pathSegments, 'faculty-directory'))
    );
  } catch {
    return false;
  }
};

const profileUrlMapValues = (value: unknown): unknown[] => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const map = value as Record<string, unknown>;
  const values: unknown[] = [];
  for (const key of PROFILE_URL_MAP_PRIORITY) {
    values.push(map[key]);
  }
  for (const [key, url] of Object.entries(map)) {
    if (!PROFILE_URL_MAP_PRIORITY.includes(key)) values.push(url);
  }
  return values;
};

const profileUrlFromCandidates = (
  candidates: Array<unknown>,
): PrincipalInvestigatorLink | undefined => {
  for (const candidate of candidates) {
    const href = safeHttpUrl(candidate);
    if (!href) continue;
    if (isOfficialYaleProfileUrl(href)) {
      return { href, external: true };
    }
  }
  return undefined;
};

const websiteLinkFromCandidates = (
  candidates: Array<unknown>,
): PrincipalInvestigatorLink | undefined => {
  for (const candidate of candidates) {
    const href = safeHttpUrl(candidate);
    if (href) return { href, external: true };
  }
  return undefined;
};

const internalProfilePathFromCandidates = (
  candidates: Array<unknown>,
): PrincipalInvestigatorLink | undefined => {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    const match = /^\/profile\/([^/?#]+)$/.exec(trimmed);
    if (!match) continue;
    const segment = safeRouteSegment(match[1]);
    if (segment) return { href: `/profile/${segment}`, external: false };
  }
  return undefined;
};

export const principalInvestigatorLinkFromMemberUser = (
  user: Record<string, unknown> | undefined,
): PrincipalInvestigatorLink | undefined => {
  if (!user) return undefined;
  const officialProfileLink = profileUrlFromCandidates([
    ...profileUrlMapValues(user.profileUrls),
    ...profileUrlMapValues(user.profile_urls),
    user.websiteUrl,
    user.website,
  ]);
  return (
    officialProfileLink ||
    internalProfilePathFromCandidates([user.internalProfilePath, user.internal_profile_path]) ||
    websiteLinkFromCandidates([user.websiteUrl, user.website])
  );
};

export const principalInvestigatorLinkFromResearchEntity = (
  entity: Record<string, unknown> | undefined,
): PrincipalInvestigatorLink | undefined => {
  if (!entity) return undefined;
  return profileUrlFromCandidates([
    ...profileUrlMapValues(entity.profileUrls),
    ...profileUrlMapValues(entity.profile_urls),
    entity.websiteUrl,
    entity.website,
    ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : []),
  ]);
};
