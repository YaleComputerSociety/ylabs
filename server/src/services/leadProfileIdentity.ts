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
  'assistant',
  'associate',
  'clinical',
  'emeriti',
  'emeritus',
  'instructional',
  'ladder',
  'lecturers',
  'postdoctoral',
  'postdocs',
  'primary',
  'professors',
  'research',
  'secondary',
  'tenure',
  'tenured',
  'track',
  'visiting',
]);

// A department roster/listing page (`/people/linguistics-faculty`,
// `/people/professors`, `/people/tenured-and-tenure-track-faculty-assistant-professors`)
// names a whole category of people, not one specific person, even when the
// category is spelled as a hyphenated compound rather than one of the exact
// generic words above. Tokenizing on hyphens catches the compound form
// without having to enumerate every department's phrasing.
const isGenericProfileCategorySegment = (segment: string): boolean =>
  GENERIC_PERSON_DIRECTORY_SEGMENTS.has(segment) ||
  GENERIC_PROFILE_CATEGORY_SEGMENTS.has(segment) ||
  segment
    .split('-')
    .some(
      (token) =>
        GENERIC_PERSON_DIRECTORY_SEGMENTS.has(token) || GENERIC_PROFILE_CATEGORY_SEGMENTS.has(token),
    );

export const hasSpecificOfficialPersonPathSegment = (
  pathSegments: string[],
  label: string,
): boolean => {
  const index = pathSegments.indexOf(label);
  if (index < 0) return false;
  const nextSegment = pathSegments[index + 1] || '';
  return Boolean(nextSegment) && !isGenericProfileCategorySegment(nextSegment);
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

const orderedNameTokensFrom = (value: unknown): string[] =>
  String(value ?? '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);

interface LeadDirectoryIdentity {
  netid: string;
  nameTokens: Set<string>;
  nameTokenList: string[];
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

const WEB_PAGE_FILE_EXTENSIONS = new Set([
  'php',
  'htm',
  'html',
  'asp',
  'aspx',
  'cfm',
  'jsp',
  'jspx',
  'shtml',
  'do',
]);

// A profile served as a static page keeps its file extension in the slug
// (e.g. `VSchultz.htm`, `dfischer.php`), which would otherwise defeat an
// exact netid/name-token match against a lead. Strip only recognized page
// extensions so a real hyphen-then-suffix slug is left intact.
const stripWebPageFileExtension = (slug: string): string => {
  const match = slug.match(/^(.+)\.([a-z0-9]{2,5})$/i);
  return match && WEB_PAGE_FILE_EXTENSIONS.has(match[2].toLowerCase()) ? match[1] : slug;
};

const personProfileSlugFromDestination = (destination: string): string => {
  const segments = destination.split('/').filter(Boolean);
  for (let index = segments.length - 2; index >= 1; index -= 1) {
    if (PERSON_PROFILE_PATH_SEGMENTS.includes(segments[index]) && segments[index + 1]) {
      const slug = stripWebPageFileExtension(segments[index + 1]);
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
    nameTokenList: orderedNameTokensFrom(nameSource),
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

const MIN_ABBREVIATED_GIVEN_NAME_LENGTH = 2;

// An abbreviated given name is the SAME name shortened (Doug/Douglas, La/Laurie),
// not a different one: the shorter form must be a genuine prefix of the longer.
// This never clears a foreign same-surname graft, which spells out a distinct
// given name that is not a prefix of the lead's (Mary vs John).
const givenNamesAbbreviationMatch = (slugGiven: string, leadGiven: string): boolean => {
  if (!slugGiven || !leadGiven) return false;
  if (slugGiven === leadGiven) return true;
  const [shorter, longer] =
    slugGiven.length <= leadGiven.length ? [slugGiven, leadGiven] : [leadGiven, slugGiven];
  return shorter.length >= MIN_ABBREVIATED_GIVEN_NAME_LENGTH && longer.startsWith(shorter);
};

// A first-initial + surname slug (`dfischer`, `e-gordon`) names only an initial,
// never a competing given name, so it corroborates when both the lead's given
// initial and full surname line up.
const firstInitialSurnameMatch = (
  normalizedSlug: string,
  nameTokenList: string[],
): boolean => {
  if (nameTokenList.length < 2) return false;
  const given = nameTokenList[0];
  const surname = nameTokenList[nameTokenList.length - 1];
  if (!given || !surname) return false;
  return normalizedSlug === `${given[0]}${surname}`;
};

const MIN_SURNAME_ONLY_SLUG_LENGTH = 3;

const profileSlugCorroboratesLead = (
  slug: string,
  identity: LeadDirectoryIdentity,
  { allowSurnameOnly = false }: { allowSurnameOnly?: boolean } = {},
): boolean => {
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
  if (sharedNameTokenCount(slug, identity.nameTokens) >= MIN_SHARED_NAME_TOKENS_TO_CORROBORATE) {
    return true;
  }

  // A genuine self-profile whose slug is not a full first+last name (#1060):
  // initials, abbreviations, nicknames, or a surname-only home for a single
  // unique lead. Each rule stays fail-closed against a different given name
  // sharing the surname, which is the only true graft (#468/#677).
  const { nameTokenList } = identity;
  if (nameTokenList.length === 0) return false;
  const leadGiven = nameTokenList[0];
  const leadSurname = nameTokenList[nameTokenList.length - 1];

  if (firstInitialSurnameMatch(normalizedSlug, nameTokenList)) return true;

  const slugTokens = orderedNameTokensFrom(slug);
  if (slugTokens.length >= 2) {
    const slugGiven = slugTokens[0];
    const slugSurname = slugTokens[slugTokens.length - 1];
    if (slugSurname === leadSurname && givenNamesAbbreviationMatch(slugGiven, leadGiven)) {
      return true;
    }
  }

  return (
    allowSurnameOnly &&
    slugTokens.length === 1 &&
    slugTokens[0] === leadSurname &&
    leadSurname.length >= MIN_SURNAME_ONLY_SLUG_LENGTH
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

  // A surname-only slug (e.g. `/profile/graedel`) may corroborate only when
  // there is exactly one lead and one person-profile home, so no competing
  // same-surname person could be the real subject of the profile.
  const allowSurnameOnly = leadIdentities.length === 1 && entityPersonSlugs.length === 1;

  const corroborated = entityPersonSlugs.some((slug) =>
    leadIdentities.some((identity) =>
      profileSlugCorroboratesLead(slug, identity, { allowSurnameOnly }),
    ),
  );
  return !corroborated;
}
