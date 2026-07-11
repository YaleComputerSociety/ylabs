/**
 * Faculty profile service for self-editing, verification, and department cascading.
 */
import { User } from '../models/user';
import { getListingModel } from '../db/connections';
import { Paper } from '../models/paper';
import { PaperAuthor } from '../models/paperAuthor';
import { FacultyMember } from '../models/facultyMember';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchGroupMember } from '../models/researchGroupMember';
import { ResearchScholarlyAttribution } from '../models/researchScholarlyAttribution';
import { ResearchScholarlyLink } from '../models/researchScholarlyLink';
import { publicStudentVisibilityTiers } from '../models/studentVisibility';
import { sanitizeProfileResearchTerms } from '../utils/profileResearchTerms';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { serializedDocumentId } from '../utils/idSerialization';
import { isPublicHttpUrl } from '../utils/urlSafety';
import {
  isLikelyPublicProfileImageUrl,
  isSharedProfileImageAcrossDifferentNames,
} from '../scripts/profileImageQualityAuditCore';

const normalizeNameToken = (value: unknown): string =>
  String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const nameTokens = (value: unknown): string[] =>
  normalizeNameToken(value)
    .split(/\s+/)
    .filter((token) => token.length > 1);

const allNameTokens = (value: unknown): string[] =>
  normalizeNameToken(value)
    .split(/\s+/)
    .filter(Boolean);

const safeObject = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      ([, url]) => typeof url === 'string' && url.trim(),
    ),
  ) as Record<string, string>;
};

const GIVEN_NAME_ALIASES: Record<string, string[]> = {
  chie: ['christina'],
  debbie: ['deborah'],
  ian: ['inhyun'],
  jacob: ['jake'],
  james: ['jim'],
  jim: ['james'],
  bill: ['william'],
  julia: ['yulia'],
  yulia: ['julia'],
  kathleen: ['kathy'],
  kathy: ['kathleen'],
  lj: ['laura'],
  magdalena: ['maggie'],
  maggie: ['magdalena', 'margaret'],
  margaret: ['maggie'],
  maripaz: ['maria'],
  william: ['bill'],
};

const givenNameAliasMatches = (firstTokens: string[], allUrlTokens: string[]): boolean =>
  firstTokens.some((token) =>
    (GIVEN_NAME_ALIASES[token] || []).some((alias) => allUrlTokens.includes(alias)),
  );

const allowsLastNameOnlyPersonUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return !/\/profile\//i.test(parsed.pathname);
  } catch {
    return false;
  }
};

const hasSurnameOnlyProfilePath = (url: string, lastTokens: string[]): boolean => {
  try {
    const pathTokens = allNameTokens(new URL(url).pathname).filter(
      (token) => !['profile', 'profiles'].includes(token),
    );
    return pathTokens.length === 1 && lastTokens.includes(pathTokens[0]);
  } catch {
    return false;
  }
};

const compoundLastNameMatchedTokens = (url: string, lastTokens: string[]): string[] => {
  if (lastTokens.length <= 1) return [];
  try {
    const pathTokens = allNameTokens(new URL(url).pathname).filter(
      (token) => !['profile', 'profiles'].includes(token),
    );
    return lastTokens.filter((token) => pathTokens.includes(token));
  } catch {
    return [];
  }
};

const hasPartialCompoundLastNameProfilePath = (
  url: string,
  firstName: string,
  lastName: string,
): boolean => {
  const lastTokens = nameTokens(lastName);
  const matchedLastTokens = compoundLastNameMatchedTokens(url, lastTokens);
  if (matchedLastTokens.length !== 1) return false;
  const firstInitials = allNameTokens(firstName).map((token) => token[0]).filter(Boolean);
  const pathTokens = (() => {
    try {
      return allNameTokens(new URL(url).pathname);
    } catch {
      return [];
    }
  })();
  if (firstInitials.some((initial) => pathTokens.includes(initial))) return false;
  const lastCompact = lastTokens.join('');
  const urlCompact = allNameTokens(url).join('');
  return lastCompact.length >= 4 && !urlCompact.includes(lastCompact);
};

export const isLikelyPersonUrl = (
  url: string,
  firstName: string,
  lastName: string,
  options: { allowSurnameOnly?: boolean } = {},
): boolean => {
  const tokens = nameTokens(url);
  const allUrlTokens = allNameTokens(url);
  const urlCompact = allUrlTokens.join('');
  const firstTokens = nameTokens(firstName);
  const allFirstTokens = allNameTokens(firstName);
  const lastTokens = nameTokens(lastName);
  if (firstTokens.length === 0 || lastTokens.length === 0) return true;

  const firstInitials = Array.from(
    new Set(allFirstTokens.map((token) => token[0]).filter(Boolean)),
  );
  const hasExplicitFirstInitial = allFirstTokens.some((token) => token.length === 1);
  const firstVariantMatches = firstTokens.some((token) =>
    allUrlTokens.some(
      (urlToken) =>
        urlToken === token ||
        (urlToken.length >= 3 && token.startsWith(urlToken)) ||
        (token.length >= 4 && urlToken.startsWith(token)),
    ),
  );
  const pathTokens = profilePathTokens(url);
  const explicitInitialMatches =
    hasExplicitFirstInitial &&
    firstInitials.some((initial) =>
      allUrlTokens.some((urlToken) => urlToken === initial || urlToken.startsWith(initial)),
    );
  const standaloneInitialMatches = firstInitials.some((initial) => pathTokens[0] === initial);
  const firstMatches =
    firstVariantMatches ||
    givenNameAliasMatches(firstTokens, allUrlTokens) ||
    firstTokens.some((token) => urlCompact.includes(token)) ||
    standaloneInitialMatches ||
    explicitInitialMatches;

  const lastCompact = lastTokens.join('');
  const allLastTokensMatch = lastTokens.every((token) => tokens.includes(token));
  const compactLastMatches = lastCompact.length >= 4 && urlCompact.includes(lastCompact);
  const longestLastToken = [...lastTokens].sort((a, b) => b.length - a.length)[0] || '';
  const matchedCompoundLastTokens = compoundLastNameMatchedTokens(url, lastTokens);
  const substantiveCompoundLastTokenMatches =
    lastTokens.length > 1 &&
    matchedCompoundLastTokens.length === 1 &&
    matchedCompoundLastTokens[0].length >= 5;
  const initialPlusLongestLastMatches =
    longestLastToken.length >= 5 &&
    tokens.includes(longestLastToken) &&
    firstInitials.some((initial) => allUrlTokens.includes(initial));
  const pathCompact = (() => {
    try {
      return allNameTokens(new URL(url).pathname)
        .filter((token) => !['profile', 'profiles', 'people', 'faculty', 'directory'].includes(token))
        .join('');
    } catch {
      return urlCompact;
    }
  })();
  const compactUrlWithoutTrailingDigits = pathCompact.replace(/\d+$/g, '');
  const compactInitialPlusLastMatches =
    longestLastToken.length >= 4 &&
    compactUrlWithoutTrailingDigits.endsWith(longestLastToken) &&
    (() => {
      const prefix = compactUrlWithoutTrailingDigits.slice(0, -longestLastToken.length);
      return (
        prefix.length >= 1 &&
        prefix.length <= 3 &&
        firstInitials.some((initial) => prefix.includes(initial))
      );
    })();

  const lastMatches =
    allLastTokensMatch ||
    compactLastMatches ||
    (firstMatches && substantiveCompoundLastTokenMatches) ||
    initialPlusLongestLastMatches ||
    compactInitialPlusLastMatches;

  if ((firstMatches && lastMatches) || compactInitialPlusLastMatches) return true;

  if (options.allowSurnameOnly !== false && hasSurnameOnlyProfilePath(url, lastTokens)) return true;

  return options.allowSurnameOnly !== false && lastMatches && allowsLastNameOnlyPersonUrl(url);
};

const profilePathTokens = (urlValue: string): string[] => {
  try {
    return allNameTokens(new URL(urlValue).pathname).filter(
      (token) => !['profile', 'profiles', 'people', 'faculty', 'directory'].includes(token),
    );
  } catch {
    return allNameTokens(urlValue);
  }
};

const isAmbiguousInitialLastProfileUrl = (
  url: string,
  firstName: string,
  lastName: string,
): boolean => {
  const pathTokens = profilePathTokens(url);
  const firstTokens = nameTokens(firstName);
  const allFirstTokens = allNameTokens(firstName);
  const lastTokens = nameTokens(lastName);
  if (pathTokens.length < 2 || firstTokens.length === 0 || lastTokens.length === 0) return false;

  const firstInitials = Array.from(
    new Set(allFirstTokens.map((token) => token[0]).filter(Boolean)),
  );
  if (!firstInitials.some((initial) => pathTokens.includes(initial))) return false;

  const hasExplicitFirstName = firstTokens.some((firstToken) =>
    pathTokens.some(
      (pathToken) =>
        pathToken === firstToken ||
        (pathToken.length >= 3 && firstToken.startsWith(pathToken)) ||
        (firstToken.length >= 4 && pathToken.startsWith(firstToken)),
    ),
  );
  if (hasExplicitFirstName) return false;

  const pathCompact = pathTokens.join('');
  const lastCompact = lastTokens.join('');
  return (
    lastTokens.every((token) => pathTokens.includes(token)) ||
    (lastCompact.length >= 4 && pathCompact.includes(lastCompact))
  );
};

const profileBioStartsWithKnownUserName = (user: Record<string, any>): boolean => {
  const rawBio = String(user.bio || '')
    .replace(/^bio(?:graphy)?\s*:\s*/i, '')
    .trim();
  const bio = normalizeNameToken(rawBio);
  if (!bio) return false;

  const candidateNames = [
    user.displayName,
    user.name,
    [user.fname, user.lname].filter(Boolean).join(' '),
  ]
    .map((name) => normalizeNameToken(name))
    .filter((name) => name.length >= 5);

  if (candidateNames.some((name) => bio.startsWith(name))) return true;

  const bioTokens = allNameTokens(rawBio);
  const firstTokens = allNameTokens(user.fname || user.firstName);
  const lastTokens = allNameTokens(user.lname || user.lastName);
  if (bioTokens.length < 3 || firstTokens.length === 0 || lastTokens.length === 0) return false;

  let index = 0;
  for (const token of firstTokens) {
    if (bioTokens[index] !== token) return false;
    index += 1;
  }
  while (index < bioTokens.length && /^[a-z]$/.test(bioTokens[index])) {
    index += 1;
  }
  return lastTokens.every((token) => bioTokens[index++] === token);
};

const profileBioStartsWithKnownUserNameVariant = (user: Record<string, any>): boolean => {
  const bioTokens = allNameTokens(
    String(user.bio || '')
      .replace(/^bio(?:graphy)?\s*:\s*/i, '')
      .trim(),
  );
  if (['dr', 'professor', 'prof'].includes(bioTokens[0] || '')) bioTokens.shift();
  if (bioTokens.length < 2) return false;

  const firstTokens = allNameTokens(user.fname || user.firstName);
  const lastTokens = allNameTokens(user.lname || user.lastName);
  if (firstTokens.length < 2 || lastTokens.length === 0) return false;

  const candidates = [
    [...firstTokens.slice(1), ...lastTokens],
    [firstTokens.at(-1), ...lastTokens].filter(Boolean),
  ].filter((tokens) => tokens.length >= 2 && tokens.join('').length >= 6);

  return candidates.some((candidate) =>
    candidate.every((token, index) => bioTokens[index] === token),
  );
};

export const isLikelySameNameContaminatedProfile = (user: Record<string, any>): boolean => {
  const firstName = user.fname || '';
  const lastName = user.lname || '';
  const fullName = normalizeNameToken(`${firstName} ${lastName}`);
  if (!fullName) return false;

  const bio = typeof user.bio === 'string' ? user.bio.trim() : '';
  const possessiveWebsiteMatch = bio.match(/^(.{2,80}?)[’']s\s+website\b/i);
  if (possessiveWebsiteMatch) {
    const bioName = normalizeNameToken(possessiveWebsiteMatch[1]);
    if (bioName && bioName !== fullName) return true;
  }

  const profileUrls = safeObject(user.profileUrls || user.profile_urls);
  const profileUrlValues = Object.entries(profileUrls)
    .filter(([key]) => key !== 'orcid')
    .map(([, url]) => url);
  if (profileUrlValues.length > 0) {
    const allProfileUrlsAreAmbiguousInitialLast = profileUrlValues.every((url) =>
      isAmbiguousInitialLastProfileUrl(url, firstName, lastName),
    );
    if (bio.length === 0 && allProfileUrlsAreAmbiguousInitialLast) return true;

    const allProfileUrlsFailNameMatch = profileUrlValues.every(
      (url) => !isLikelyPersonUrl(url, firstName, lastName, { allowSurnameOnly: false }),
    );
    return (
      allProfileUrlsFailNameMatch &&
      !profileBioStartsWithKnownUserName(user) &&
      !profileBioStartsWithKnownUserNameVariant(user)
    );
  }

  return false;
};

export const cleanProfileUrlsForPerson = (user: Record<string, any>): Record<string, string> => {
  const profileUrls = safeObject(user.profileUrls || user.profile_urls);
  return Object.fromEntries(
    Object.entries(profileUrls)
      .map(([key, url]) => [key, cleanPublicHttpUrl(url)] as const)
      .filter(([key, url]) =>
        Boolean(url) &&
        (key === 'orcid' ||
          (isLikelyPersonUrl(url, user.fname || '', user.lname || '') &&
            !hasPartialCompoundLastNameProfilePath(url, user.fname || '', user.lname || ''))),
      ),
  );
};

const publicProfileImageUrl = (user: Record<string, any>): string => {
  const imageUrl = user.imageUrl || user.image_url || '';
  return isLikelyPublicProfileImageUrl(imageUrl) ? imageUrl : '';
};

const withPublicProfileImageGuards = async (user: Record<string, any>) => {
  const imageUrl = publicProfileImageUrl(user);
  if (!imageUrl) return { ...user, imageUrl: '', image_url: '' };

  const sameImageUsers = await User.find({ imageUrl })
    .select('_id netid fname lname email imageUrl')
    .limit(50)
    .lean();

  if (isSharedProfileImageAcrossDifferentNames({ ...user, imageUrl }, sameImageUsers as any[])) {
    return { ...user, imageUrl: '', image_url: '' };
  }

  return { ...user, imageUrl, image_url: imageUrl };
};

export const paperToScholarlyLink = (paper: Record<string, any>, _userId?: unknown) => {
  const doi = typeof paper.doi === 'string' ? paper.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '') : '';
  const doiUrl = doi ? `https://doi.org/${doi}` : '';
  const url = doiUrl || paper.landingPageUrl || paper.openAccessUrl || paper.url || paper.pdfUrl || '';
  const freeFullTextUrl =
    paper.pdfUrl && paper.pdfUrl !== url
      ? paper.pdfUrl
      : paper.openAccessUrl && paper.openAccessUrl !== url
        ? paper.openAccessUrl
        : undefined;
  const scholarlyLinkIdSource =
    serializedDocumentId(doiUrl) ||
    serializedDocumentId(url) ||
    serializedDocumentId(paper.openAlexId) ||
    serializedDocumentId(paper.arxivId) ||
    serializedDocumentId(paper.title) ||
    'research-activity';

  return {
    _id: scholarlyLinkIdSource
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 160),
    title: paper.title || 'Untitled research activity',
    url,
    destinationKind: doiUrl ? 'DOI' : paper.openAccessUrl || paper.pdfUrl ? 'OPENALEX' : 'OTHER',
    displaySource: doiUrl ? 'DOI' : paper.openAccessUrl || paper.pdfUrl ? 'Open access' : 'Paper',
    freeFullTextUrl,
    freeFullTextLabel: freeFullTextUrl ? 'Free full text' : undefined,
    discoveredVia: paper.sources?.includes('orcid') ? 'ORCID' : 'OPENALEX',
    openAccessStatus: paper.openAccessStatus || paper.open_access_status || undefined,
    year: paper.year,
    venue: paper.venue,
    confidence: 0.9,
    observedAt: paper.lastObservedAt?.toISOString?.() || paper.updatedAt?.toISOString?.(),
    externalIds: {
      doi: doi || undefined,
      openAlexId: paper.openAlexId,
      arxivId: paper.arxivId,
    },
  };
};

const normalizeDiscoveredVia = (value: unknown): 'OPENALEX' | 'ORCID' | 'OFFICIAL_PROFILE' | 'MANUAL' => {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'OPENALEX' || normalized === 'ORCID' || normalized === 'OFFICIAL_PROFILE') {
    return normalized;
  }
  return 'MANUAL';
};

const dateToIso = (value: unknown): string | undefined => {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

const cleanUrl = (value: unknown): string => String(value || '').trim();

const cleanPublicHttpUrl = (value: unknown): string => {
  const raw = cleanUrl(value);
  if (!raw) return '';

  try {
    const url = new URL(raw);
    return isPublicHttpUrl(raw) ? url.toString() : '';
  } catch {
    return '';
  }
};

const normalizeUrlBaseForCompare = (value: unknown): string => {
  const raw = cleanUrl(value);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.hash = '';
    url.searchParams.sort();
    return url.toString().replace(/\/+$/, '').toLowerCase();
  } catch {
    return raw.split('#')[0].replace(/\/+$/, '').toLowerCase();
  }
};

const urlHash = (value: unknown): string => {
  try {
    return new URL(cleanUrl(value)).hash;
  } catch {
    const hashIndex = cleanUrl(value).indexOf('#');
    return hashIndex >= 0 ? cleanUrl(value).slice(hashIndex) : '';
  }
};

const normalizedDoiUrl = (value: unknown): string => {
  const doi = cleanUrl(value).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '');
  return doi ? `https://doi.org/${doi}` : '';
};

const publicScholarlyLinkId = (link: Record<string, any>, url?: string, doiUrl?: string): string =>
  String(
    doiUrl ||
      url ||
      cleanPublicHttpUrl(link.freeFullTextUrl) ||
      link.externalIds?.openAlexId ||
      link.externalIds?.arxivId ||
      link.externalIds?.pmid ||
      link.externalIds?.pmcid ||
      cleanScholarlyTitle(link.title) ||
      'scholarly-link',
  )
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);

const publicScholarlyExternalIds = (externalIds: unknown): Record<string, string | undefined> => {
  const source =
    externalIds && typeof externalIds === 'object' && !Array.isArray(externalIds)
      ? (externalIds as Record<string, unknown>)
      : {};
  const publicId = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const text = redactDirectContactInfo(value).trim().slice(0, 200);
    return text || undefined;
  };
  return {
    doi: publicId(source.doi),
    openAlexId: publicId(source.openAlexId),
    arxivId: publicId(source.arxivId),
    pmid: publicId(source.pmid),
    pmcid: publicId(source.pmcid),
  };
};

const isGeneratedOfficialProfilePublicationAnchor = (link: Record<string, any>): boolean => {
  const url = cleanUrl(link.url);
  if (!url || !/^#publication-/i.test(urlHash(url))) return false;
  const officialSourceUrl = cleanUrl(link.externalIds?.officialProfileSourceUrl || link.sourceUrl);
  if (!officialSourceUrl) return false;
  return normalizeUrlBaseForCompare(url) === normalizeUrlBaseForCompare(officialSourceUrl);
};

const PUBLIC_PROFILE_BASE_FIELDS = [
  'netid',
  'fname',
  'lname',
  'userType',
  'profileVerified',
  'profileVerificationRequestedAt',
  'title',
  'bio',
  // Direct contact/location fields are intentionally excluded from public
  // profiles: email, phone, physicalLocation, buildingDesk, and mailingAddress.
  'departments',
  'college',
  'year',
  'major',
  'unit',
  'primaryDepartment',
  'secondaryDepartments',
  'imageUrl',
  'researchInterests',
  'topics',
  'hIndex',
  'orcid',
  'openAlexId',
] as const;

const MAX_PUBLIC_PROFILE_BASE_TEXT_LENGTH = 500;
const MAX_PUBLIC_PROFILE_BASE_ARRAY_ITEMS = 50;
const PUBLIC_PROFILE_BASE_TEXT_FIELDS = new Set<string>([
  'netid',
  'fname',
  'lname',
  'userType',
  'title',
  'bio',
  'college',
  'year',
  'major',
  'unit',
  'primaryDepartment',
  'orcid',
  'openAlexId',
]);
const PUBLIC_PROFILE_BASE_ARRAY_FIELDS = new Set<string>([
  'departments',
  'secondaryDepartments',
  'researchInterests',
  'topics',
]);

const publicProfileText = (value: unknown): string | undefined => {
  const text = String(value || '').trim();
  const redacted = redactDirectContactInfo(text).slice(0, MAX_PUBLIC_PROFILE_BASE_TEXT_LENGTH);
  return redacted ? redacted : undefined;
};

const publicProfileTitleText = (value: unknown): string | undefined => {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  if (/^(?:Research\s*\/\s*Faculty|Related Research|Faculty Research)$/i.test(text)) return undefined;
  const navMatches = text.match(
    /\b(?:home|about|research|academics|people|media|events|outreach|opportunities|belonging|prospectives|contact|news)\b/gi,
  );
  if ((navMatches?.length || 0) >= 5 && !/\b(?:professor|lecturer|instructor|scientist|investigator|director|dean)\b/i.test(text)) {
    return undefined;
  }
  if (
    /(?:[\w.+-]+@[\w.-]+\.[a-z]{2,}|new haven,?\s*ct|po box|room\s+\w+|prospect street|phone|fax|\+\d[\d\s().-]{6,})/i.test(
      text,
    )
  ) {
    return undefined;
  }
  return publicProfileText(text);
};

const publicProfileTextArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
        .slice(0, MAX_PUBLIC_PROFILE_BASE_ARRAY_ITEMS)
        .map(publicProfileText)
        .filter((item): item is string => Boolean(item))
    : [];

const publicProfileBase = (user: Record<string, any>): Record<string, any> => {
  const profile: Record<string, any> = {};
  for (const field of PUBLIC_PROFILE_BASE_FIELDS) {
    const value = user[field];
    if (value === undefined) continue;
    if (PUBLIC_PROFILE_BASE_TEXT_FIELDS.has(field)) {
      const text = field === 'title' ? publicProfileTitleText(value) : publicProfileText(value);
      if (text !== undefined) profile[field] = text;
    } else if (PUBLIC_PROFILE_BASE_ARRAY_FIELDS.has(field)) {
      profile[field] = publicProfileTextArray(value);
    } else if (field === 'profileVerified') {
      profile[field] = value === true;
    } else if (field === 'profileVerificationRequestedAt') {
      const requestedAt = new Date(value);
      if (!Number.isNaN(requestedAt.getTime())) profile[field] = requestedAt.toISOString();
    } else if (field === 'hIndex') {
      const hIndex = typeof value === 'number' ? value : Number(value);
      if (Number.isFinite(hIndex) && hIndex >= 0) profile[field] = Math.trunc(hIndex);
    } else if (field === 'imageUrl') {
      const imageUrl = publicProfileImageUrl(user);
      if (imageUrl) profile[field] = imageUrl;
    }
  }
  return profile;
};

const publicProfileHttpUrls = (value: unknown): string[] =>
  Array.from(
    new Set(
      (Array.isArray(value) ? value : [value])
        .map(cleanPublicHttpUrl)
        .filter(Boolean),
    ),
  );

const profileDocumentId = (value: unknown): string => serializedDocumentId(value) || '';

const hasProfileDirectoryLabelContamination = (value: string): boolean =>
  /\b(?:research areas?|teaching interests?|fields? of interest|interests)\s*:/i.test(value);

const isAffiliationOnlyResearchSummary = (value: string): boolean =>
  /\b(?:is|was)\s+affiliated\s+with\b/i.test(value) &&
  !hasResearchDescriptionVerb(textWithoutAcademicStudiesUnitNames(value));

const publicResearchSummaryText = (value: unknown): string | undefined => {
  const text = publicProfileText(value);
  if (!text) return undefined;
  if (hasProfileDirectoryLabelContamination(text)) return undefined;
  if (isAffiliationOnlyResearchSummary(text)) return undefined;
  return text;
};

const publicProfileResearchEntity = (entity: Record<string, any>): Record<string, any> => {
  const {
    _bioFullDescription,
    _bioSourceUrls,
    _bioWebsite,
    _bioWebsiteUrl,
    ...publicEntity
  } = entity || {};
  const publicId = (
    publicProfileText(publicEntity.slug) || publicProfileText(publicEntity.name) || ''
  )
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  if (publicId) {
    publicEntity._id = publicId;
    publicEntity.id = publicId;
  } else {
    delete publicEntity._id;
    delete publicEntity.id;
  }
  const textFields = [
    'name',
    'displayName',
    'kind',
    'entityType',
    'shortDescription',
    'description',
    'role',
  ];

  for (const field of textFields) {
    if (publicEntity[field] !== undefined) {
      const text = ['shortDescription', 'description'].includes(field)
        ? publicResearchSummaryText(publicEntity[field])
        : publicProfileText(publicEntity[field]);
      if (text) publicEntity[field] = text;
      else delete publicEntity[field];
    }
  }

  for (const field of ['departments', 'researchAreas']) {
    if (publicEntity[field] !== undefined) {
      const values = publicProfileTextArray(publicEntity[field]);
      publicEntity[field] = field === 'researchAreas' ? sanitizeProfileResearchTerms(values) : values;
    }
  }

  for (const field of ['website', 'websiteUrl', 'sourceUrl']) {
    if (publicEntity[field] !== undefined) {
      const url = cleanPublicHttpUrl(publicEntity[field]);
      if (url) publicEntity[field] = url;
      else delete publicEntity[field];
    }
  }

  if (publicEntity.sourceUrls !== undefined) {
    const sourceUrls = publicProfileHttpUrls(publicEntity.sourceUrls);
    if (sourceUrls.length > 0) publicEntity.sourceUrls = sourceUrls;
    else delete publicEntity.sourceUrls;
  }

  return publicEntity;
};

const isOfficialProfileSourcePagePublicationPointer = (link: Record<string, any>): boolean => {
  const url = cleanUrl(link.url);
  if (!url) return false;
  const officialSourceUrl = cleanUrl(link.externalIds?.officialProfileSourceUrl || link.sourceUrl);
  if (!officialSourceUrl) return false;
  if (!isOfficialProfileScholarlyLink(link)) return false;
  return normalizeUrlBaseForCompare(url) === normalizeUrlBaseForCompare(officialSourceUrl);
};

const htmlEntityMap: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  nbsp: ' ',
  '#39': "'",
};

const cleanScholarlyTitle = (value: unknown): string => {
  const cleaned = String(value || '')
    .replace(/&(?:amp|lt|gt|quot|nbsp|#39);/gi, (entity) => {
      const key = entity.slice(1, -1).toLowerCase();
      return htmlEntityMap[key] || ' ';
    })
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:amp|lt|gt|quot|nbsp|#39);/gi, (entity) => {
      const key = entity.slice(1, -1).toLowerCase();
      return htmlEntityMap[key] || ' ';
    })
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'Untitled research activity';
};

const cleanPublicSourceLabel = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const cleaned = redactDirectContactInfo(value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
  return cleaned || undefined;
};

const RESEARCH_CONTEXT_SUMMARY_MAX_LENGTH = 480;
const RESEARCH_CONTEXT_SUMMARY_MIN_EXTRA_WORDS = 4;

// Generated entity descriptions often just announce the topic list ("Studies
// X.", "Research fields include X, Y, Z."), which is identical information to
// the research-area tag chips. Strip that lead-in so we can detect when the
// remainder adds nothing beyond the tags.
const RESEARCH_SUMMARY_TAG_RESTATEMENT_LEADIN =
  /^(?:research(?:\s+(?:fields?|interests?|areas?|focus(?:es)?))?\s*(?:includes?|including|on|in|:)?|studies|specializations?:?|focuses\s+on|investigates|examines|explores|researches|analyzes)\s+/i;

const RESEARCH_SUMMARY_STOPWORDS = new Set([
  'research', 'studies', 'study', 'field', 'fields', 'interest', 'interests',
  'area', 'areas', 'include', 'includes', 'including', 'focus', 'focuses',
  'focused', 'work', 'works', 'with', 'that', 'this', 'their', 'from', 'into',
  'across', 'using', 'based', 'also', 'such', 'have', 'related', 'various',
  'particularly', 'broadly', 'generally', 'these', 'those', 'about', 'between',
]);

const researchSummaryContentTokens = (value: string): Set<string> =>
  new Set(
    String(value || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 4 && !RESEARCH_SUMMARY_STOPWORDS.has(word)),
  );

// True when a candidate summary, after dropping its lead-in, contributes almost
// no content words beyond the research-area tags — i.e. it would be redundant
// shown next to the chips.
const summaryRestatesResearchAreas = (summary: string, researchAreas: unknown): boolean => {
  const stripped = summary.replace(RESEARCH_SUMMARY_TAG_RESTATEMENT_LEADIN, '');
  const summaryTokens = researchSummaryContentTokens(stripped);
  if (summaryTokens.size === 0) return true;
  const areaTokens = researchSummaryContentTokens(
    (Array.isArray(researchAreas) ? researchAreas : []).join(' '),
  );
  let extra = 0;
  for (const token of summaryTokens) {
    if (!areaTokens.has(token)) extra += 1;
  }
  return extra < RESEARCH_CONTEXT_SUMMARY_MIN_EXTRA_WORDS;
};

const PROFILE_SENTENCE_TITLE_ABBREVIATION =
  /(?:^|\s)(?:Dr|Prof|Mr|Mrs|Ms|Mx|St|Jr|Sr|Hon|Rev|Fr|Gen|Col|Lt|Capt|Sgt)\.$/i;

// Split prose into sentences without breaking on title abbreviations ("Dr.")
// or single-letter initials.
const splitProfileSentences = (text: string): string[] => {
  const sentenceEnds = Array.from(text.matchAll(/[.!?](?=\s|$)/g)).filter((match) => {
    if (typeof match.index !== 'number') return false;
    const candidate = text.slice(0, match.index + 1).trim();
    return (
      !PROFILE_SENTENCE_TITLE_ABBREVIATION.test(candidate) && !/(?:^|\s)[A-Z]\.$/.test(candidate)
    );
  });
  const sentences: string[] = [];
  let start = 0;
  for (const match of sentenceEnds) {
    const end = (match.index as number) + 1;
    const sentence = text.slice(start, end).trim();
    if (sentence) sentences.push(sentence);
    start = end;
  }
  const tail = text.slice(start).trim();
  if (tail) sentences.push(tail);
  return sentences;
};

// Lead with the research content: when prose opens with appointment/title
// sentences ("Dr. X is the … Professor of …") and a later sentence actually
// describes the research, drop the leading credentials so the context
// paragraph is about the work, not the CV.
const trimToResearchLead = (text: string): string => {
  const sentences = splitProfileSentences(text);
  if (sentences.length < 2) return text;
  if (!isAppointmentOnlyProfileBio(sentences[0]) || hasResearchDescriptionVerb(sentences[0])) {
    return text;
  }
  const researchIndex = sentences.findIndex((sentence) => hasResearchDescriptionVerb(sentence));
  if (researchIndex <= 0) return text;
  return sentences.slice(researchIndex).join(' ').trim();
};

// A short context paragraph for the Research Interests section: the first
// entity's REAL descriptive prose (`fullDescription`), never the generated
// `shortDescription` ("Studies <areas>.") which only restates the tag chips.
// Returns '' when the only available text just restates the research areas, so
// the section renders the tags alone rather than a redundant sentence.
const researchInterestContextSummary = (researchEntities: any[]): string => {
  const leadEntities = researchEntities.filter((entity) => isLeadRole(entity?.role));
  const orderedEntities = leadEntities.length > 0
    ? leadEntities
    : researchEntities;

  for (const entity of orderedEntities) {
    const cleaned = cleanResearchHomeSummaryForBio(
      String(entity?.fullDescription || entity?._bioFullDescription || entity?.description || ''),
    );
    if (cleaned.length < TRUSTED_RESEARCH_HOME_BIO_MIN_SUMMARY_LENGTH) continue;
    if (summaryRestatesResearchAreas(cleaned, entity?.researchAreas)) continue;
    return clipPublicProfileBio(trimToResearchLead(cleaned), RESEARCH_CONTEXT_SUMMARY_MAX_LENGTH, 200);
  }
  return '';
};

const researchAreasFromResearchEntities = (researchEntities: any[]): string[] =>
  Array.from(
    new Set(
      researchEntities
        .flatMap((entity) => (Array.isArray(entity?.researchAreas) ? entity.researchAreas : []))
        .map((area) => String(area || '').trim())
        .filter(Boolean),
    ),
  );

const supportedPublicProfileTopics = (topics: unknown, supportedTerms: string[]): string[] => {
  const cleanedTopics = sanitizeProfileResearchTerms(topics);
  if (cleanedTopics.length === 0 || supportedTerms.length === 0) return [];

  const supportedKeys = new Set(supportedTerms.map((term) => term.toLowerCase()));
  return cleanedTopics.filter((topic) => supportedKeys.has(topic.toLowerCase()));
};

const isIndividualResearchEntity = (entity: Record<string, any>): boolean =>
  entity.kind === 'individual' ||
  entity.kind === 'solo' ||
  entity.entityType === 'FACULTY_RESEARCH_AREA' ||
  entity.entityType === 'INDIVIDUAL_RESEARCH';

const isLeadRole = (role: unknown): boolean =>
  ['pi', 'principal_investigator', 'principal-investigator', 'lead', 'faculty_lead'].includes(
    String(role || '').toLowerCase(),
  );

const entityNameMatchesUser = (entity: Record<string, any>, user: Record<string, any>): boolean => {
  const entityTokens = new Set(nameTokens([entity.name, entity.displayName, entity.slug].join(' ')));
  const firstTokens = nameTokens(user.fname || user.firstName);
  const lastTokens = nameTokens(user.lname || user.lastName);
  if (firstTokens.length === 0 || lastTokens.length === 0) return false;
  return firstTokens.every((token) => entityTokens.has(token)) &&
    lastTokens.every((token) => entityTokens.has(token));
};

export const dedupeProfileResearchEntities = (
  researchEntities: Array<Record<string, any>>,
  user: Record<string, any>,
): Array<Record<string, any>> => {
  const hasConcreteLeadHome = researchEntities.some(
    (entity) => !isIndividualResearchEntity(entity) && isLeadRole(entity.role),
  );
  if (!hasConcreteLeadHome) return researchEntities;

  return researchEntities.filter(
    (entity) => !(isIndividualResearchEntity(entity) && entityNameMatchesUser(entity, user)),
  );
};

const hasResearchDescriptionVerb = (value: string): boolean =>
  /\b(studies|investigates|examines|explores|focuses on|works on|develops|combines|integrates|applies|uses|employs|researches|analyzes|models|writes? (?:about|on)|publishes? (?:about|on))\b/i.test(
    value,
  ) || /\b(?:is|was)\s+(?:the\s+|an?\s+)?author\s+of\b/i.test(value);

const PUBLIC_PROFILE_BIO_MAX_LENGTH = 1200;

const isAppointmentOnlyProfileBio = (value: string): boolean =>
  /\b(?:assistant|associate|full|adjunct|clinical|visiting)?\s*professor\b/i.test(value) ||
  /\b(?:assistant|associate|senior)?\s*research scientist\b/i.test(value) ||
  /\b(?:deputy\s+)?director\b/i.test(value) ||
  /\b(?:chair|dean|lecturer|instructor|affiliated faculty)\b/i.test(value);

const degreeTokenCount = (value: string): number =>
  (
    value.match(
      /(?:ph\.?\s*d\.?|m\.?\s*a\.?|m\.?\s*s\.?|m\.?\s*sc\.?|m\.?\s*fa\.?|m\.?\s*phil\.?|b\.?\s*a\.?|b\.?\s*s\.?|b\.?\s*sc\.?|d\.?\s*phil\.?|j\.?\s*d\.?|m\.?\s*d\.?)(?=[^a-z]|$)/gi,
    ) || []
  ).length;

const isCredentialOnlyEducationBlock = (value: string): boolean =>
  value.length < 220 &&
  /^\s*(?:ph\.?\s*d\.?|m\.?\s*a\.?|m\.?\s*s\.?|m\.?\s*sc\.?|m\.?\s*fa\.?|m\.?\s*phil\.?|b\.?\s*a\.?|b\.?\s*s\.?|b\.?\s*sc\.?|d\.?\s*phil\.?|j\.?\s*d\.?|m\.?\s*d\.?)(?=[^a-z]|$)/i.test(
    value,
  ) &&
  degreeTokenCount(value) >= 1 &&
  /\b(?:university|college|school|institute)\b/i.test(value) &&
  !hasResearchDescriptionVerb(value);

const likelyPersonNameListSegment = (value: string): boolean =>
  /^\s*(?:[A-Z][A-Za-z'.-]*\.?\s+){1,4}[A-Z][A-Za-z'.-]*\.?\*?\s*$/.test(value);

const isCitationLikePublicationList = (value: string): boolean => {
  const commaCount = (value.match(/,/g) || []).length;
  if (commaCount < 5 || hasResearchDescriptionVerb(value)) return false;
  const leadingSegments = value.slice(0, 240).split(',').slice(0, 8);
  const leadingPersonNameSegments = leadingSegments.filter(likelyPersonNameListSegment).length;
  if (leadingPersonNameSegments < 4) return false;
  return /(?:\*|"|“|”|\bet al\.?\b|\bdoi\b|\bjournal\b|\bproceedings\b|\bnature\b|\bscience\b|\bmaterials\b|\bpublication\b)/i.test(
    value,
  );
};

const isSingleCitationLikePublication = (value: string): boolean => {
  if (hasResearchDescriptionVerb(value)) return false;
  if (!/^\s*[\p{Lu}][\p{L}'.-]+(?:\s+[\p{Lu}][\p{L}'.-]+){0,3},\s+[\p{Lu}][\p{L}'.-]+/u.test(value)) {
    return false;
  }
  if (!/(?:\*|"|“|”|\bet al\.?\b)/i.test(value)) return false;
  if (!/\b(?:19|20)\d{2}\b/.test(value)) return false;
  return /\b(?:journal|proceedings|current opinion|nature|science|cell|materials|chemistry|physics)\b|\b\d+\s*:\s*\d/i.test(
    value,
  );
};

const isGrantMetadataProfileBlock = (value: string): boolean =>
  /^(?:NIH|NSF|[A-Z]{1,3}\s*\d{2}|[RPUK]\d{2}\b)/i.test(value.trim()) &&
  /\b(?:PI\s*:|Title\s*:|Goals?\s*:|Project\s*:)/i.test(value);

const isSingleStudyClinicalTrialAbstract = (value: string): boolean =>
  /\bwe\s+(?:previously\s+)?conducted\s+(?:a\s+|an\s+)?(?:(?:single-|two-|multi-|[a-z]+\s+)?institution\s+)?phase\s+\d\s+trial\b/i.test(
    value,
  ) && /\b(?:patients?|trial|NCT\d{8}|bevacizumab|pembrolizumab|nivolumab)\b/i.test(value);

const appointmentTitleCount = (value: string): number =>
  (
    value.match(
      /\b(?:assistant|associate|full|adjunct|clinical|visiting)?\s*professor\b|\b(?:assistant|associate|senior)?\s*research scientist\b|\b(?:deputy\s+)?director\b|\b(?:chair|dean|lecturer|instructor|affiliated faculty)\b/gi,
    ) || []
  ).length;

const textWithoutAcademicStudiesUnitNames = (value: string): string =>
  value.replace(
    /\b(?:Institution for\s+)?(?:[A-Z][A-Za-z&-]*(?:\s+| and | & )){0,5}Studies\b/g,
    '',
  );

const isAppointmentListOnlyProfileBio = (value: string): boolean =>
  appointmentTitleCount(value) >= 2 &&
  !hasResearchDescriptionVerb(textWithoutAcademicStudiesUnitNames(value)) &&
  /^[^.!?]+$/.test(value.replace(/\b[A-Z]\./g, 'A').trim());

const PUBLIC_PROFILE_EMAIL_PATTERN =
  String.raw`\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.(?:edu|com|org|net|gov|mil|io|co|uk|ca|au|de|fr|jp|cn|info|biz|us)(?=Phone\b|\b|[^A-Z0-9])`;

const hasPublicProfileEmail = (value: string): boolean =>
  new RegExp(PUBLIC_PROFILE_EMAIL_PATTERN, 'i').test(value);

const normalizeContactStrippedBio = (value: string): string =>
  value
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\s+/g, ' ')
    .trim();

const stripContactChromeFromPublicProfileBio = (value: string): string => {
  let text = value.replace(/\.(edu|com|org|net|gov|mil|io|co|us)Phone\s*:/gi, '.$1 Phone:');
  text = text.replace(new RegExp(`\\s*\\([^)]{0,240}${PUBLIC_PROFILE_EMAIL_PATTERN}[^)]{0,240}\\)\\s*`, 'gi'), ' ');
  text = normalizeContactStrippedBio(text);

  const leadingContact = text.match(
    new RegExp(`^.{0,240}?\\bEmail\\s*:\\s*${PUBLIC_PROFILE_EMAIL_PATTERN}(?:\\s*Phone\\s*:\\s*[\\d().+\\-\\s]{3,30})?\\s*`, 'i'),
  );
  if (!leadingContact) return text;

  const candidate = normalizeContactStrippedBio(text.slice(leadingContact[0].length));
  if (
    /^(?:Dr\.?|Prof\.?|Professor)\s+[A-Z]/.test(candidate) ||
    /^[A-Z][\p{L}\p{M}'.-]+(?:\s+[A-Z][\p{L}\p{M}'.-]+){0,3}\s+(?:stud(?:y|ies)|research(?:es)?|investigates?|develops?|focuses\s+on|works\s+on|uses?|explores?|is|was|leads?)\b/u.test(
      candidate,
    )
  ) {
    return candidate;
  }

  return text;
};

const stripOfficialProfileCtaChromeFromPublicProfileBio = (value: string): string =>
  normalizeContactStrippedBio(
    value
      .replace(/\bWatch\s+a\s+video\s+with\s+Dr\.?\s+[^>]{2,120}>>\s*/gi, '')
      .replace(/\bLearn\s+more\s+about\s+Dr\.?\s+[^>]{2,120}>>\s*/gi, ''),
  );

const isGroupResearchPublicBio = (value: string): boolean =>
  /\b(?:our|the)\s+(?:group|lab|laboratory)\b/i.test(value.replace(/\s+/g, ' ').trim());

const isNonBiographicalPublicBio = (value: string): boolean => {
  const text = value.replace(/\s+/g, ' ').trim();
  const compact = text.toLowerCase().replace(/[^a-z0-9]+/g, '');

  if (!text) return true;
  if (isGroupResearchPublicBio(text)) return true;
  if (/\bofficial Yale profile (?:lists research (?:interests|areas)|summarizes (?:their )?research(?: focus)?(?: in)?)\b/i.test(text)) return true;
  if (hasPublicProfileEmail(text)) return true;
  if (
    /(po box|mailing address|contact info)/i.test(text) ||
    [
      'klinetower',
      'prospectstreet',
      'cedarstreet',
      'newhavenct',
      'westcampusdrive',
      'campusoffice',
      'medicalschooloffice',
      'firstfloor',
    ].some((token) => compact.includes(token))
  ) {
    return true;
  }
  if (
    /^(?:see my webpage|this professor is accepting)\b/i.test(text) ||
    /^view this doctor'?s clinical profile\b/i.test(text) ||
    compact.startsWith('medicalresearchinterests') ||
    /^department of\b/i.test(text) ||
    /^(?:courses?\b|undergraduate\s*:)/i.test(text) ||
    /\b(?:up-to-date list of publications|please click here|citations\/paper|web of science)\b/i.test(
      text,
    )
  ) {
    return true;
  }
  if (
    text.length < 140 &&
    /^(?:program for\b|west campus\b)/i.test(text) &&
    !hasResearchDescriptionVerb(text)
  ) {
    return true;
  }
  if (text.length < 140 && isAppointmentOnlyProfileBio(text) && !hasResearchDescriptionVerb(text)) {
    return true;
  }
  if (isAppointmentListOnlyProfileBio(text)) {
    return true;
  }
  if (isCredentialOnlyEducationBlock(text)) {
    return true;
  }
  if (isGrantMetadataProfileBlock(text)) {
    return true;
  }
  if (/^background\s*:/i.test(text)) {
    return true;
  }
  if (isSingleStudyClinicalTrialAbstract(text)) {
    return true;
  }
  if (isCitationLikePublicationList(text) || isSingleCitationLikePublication(text)) {
    return true;
  }
  if (
    text.length < 140 &&
    /\b(?:selected publications?|wins?|elected|awards?|awarded|prize|faculty research awards?|yale engineering|yale engineers|roberts innovation fund|seed funding|nsf grant|faculty pave|kcity|industry partnerships|why that matters)\b/i.test(
      text,
    ) &&
    !hasResearchDescriptionVerb(text)
  ) {
    return true;
  }
  return /^copy link$/i.test(text);
};

const clipPublicProfileBio = (
  value: string,
  maxLength: number = PUBLIC_PROFILE_BIO_MAX_LENGTH,
  minSentenceIndex = 300,
): string => {
  const text = stripTrailingOfficialProfileUpdateMetadata(value.replace(/\s+/g, ' ').trim());
  if (text.length <= maxLength) return text;

  const prefix = text.slice(0, maxLength).trim();
  const sentenceEnds = Array.from(prefix.matchAll(/[.!?](?=\s|$)/g)).filter((match) => {
    if (typeof match.index !== 'number') return false;
    const candidate = prefix.slice(0, match.index + 1).trim();
    return (
      !/(?:^|\s)(?:Dr|Prof|Mr|Mrs|Ms|Mx|St|Jr|Sr|Hon|Rev|Fr|Gen|Col|Lt|Capt|Sgt)\.$/i.test(
        candidate,
      ) && !/(?:^|\s)[A-Z]\.$/.test(candidate)
    );
  });
  const lastSentenceEnd = sentenceEnds.at(-1);
  if (
    lastSentenceEnd &&
    typeof lastSentenceEnd.index === 'number' &&
    lastSentenceEnd.index >= minSentenceIndex
  ) {
    return prefix.slice(0, lastSentenceEnd.index + 1).trim();
  }

  const wordBoundary = prefix.replace(/\s+\S*$/, '').replace(/[,;:\-–—]+$/g, '').trim();
  return wordBoundary ? `${wordBoundary}.` : prefix;
};

export const stripTrailingOfficialProfileUpdateMetadata = (value: string): string =>
  value
    .replace(/\s*\b(?:Last Updated|Updated)(?: on)? [A-Za-z]+ \d{1,2}, \d{4}\.?\s*$/i, '')
    .replace(/([a-z])Last\s*$/i, '$1.')
    .trim();

const parseProfileUrl = (value: unknown): URL | null => {
  const text = String(value || '').trim();
  if (!text) return null;
  try {
    return new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
};

const isYaleHost = (url: URL): boolean => /(^|\.)yale\.edu$/i.test(url.hostname);

const pathSegments = (url: URL): string[] =>
  url.pathname
    .split('/')
    .map((part) => decodeURIComponent(part).toLowerCase().trim())
    .filter(Boolean);

const hasPersonScopedYaleDirectoryPath = (url: URL): boolean => {
  const segments = pathSegments(url);
  const profileSegmentIndex = segments.findIndex((segment) =>
    ['people', 'faculty', 'faculty-directory'].includes(segment),
  );
  if (profileSegmentIndex < 0) return false;
  const personSlug = segments[profileSegmentIndex + 1] || '';
  return Boolean(personSlug && !['people', 'faculty', 'faculty-directory', 'staff'].includes(personSlug));
};

const isOfficialYaleProfileUrlForUser = (value: unknown, user: Record<string, any>): boolean => {
  const url = parseProfileUrl(value);
  if (!url || !isYaleHost(url)) return false;

  const firstName = user.fname || user.firstName || '';
  const lastName = user.lname || user.lastName || '';
  if (!firstName || !lastName) return false;
  if (/\/profile\//i.test(url.pathname)) {
    const lastSegment = decodeURIComponent(pathSegments(url).at(-1) || '').toLowerCase();
    const netid = String(user.netid || '').toLowerCase();
    if (netid && lastSegment === netid) return true;
    return isLikelyPersonUrl(String(value || ''), firstName, lastName);
  }
  if (!hasPersonScopedYaleDirectoryPath(url)) return false;
  return isLikelyPersonUrl(String(value || ''), firstName, lastName);
};

const hasOfficialYaleProfileUrl = (user: Record<string, any>): boolean => {
  const profileUrls = Object.values(safeObject(user.profileUrls || user.profile_urls));
  const urls = [
    user.website,
    user.websiteUrl,
    user.website_url,
    ...profileUrls,
  ].map((url) => String(url || ''));
  return urls.some((url) => isOfficialYaleProfileUrlForUser(url, user));
};

const officialYaleProfileUrlForUser = (user: Record<string, any>): string => {
  const profileUrls = Object.values(safeObject(user.profileUrls || user.profile_urls));
  return (
    profileUrls
      .map(cleanPublicHttpUrl)
      .find((url) => isOfficialYaleProfileUrlForUser(url, user)) || ''
  );
};

const isLabOrResearchGroupUrl = (value: unknown): boolean => {
  const url = parseProfileUrl(value);
  if (!url) return false;
  const text = `${url.hostname} ${url.pathname}`.toLowerCase();
  return /\b(?:lab|laboratory|research[-\s]?group|group)\b/.test(text) || /lab[./-]/.test(text);
};

const websiteUrlMatchesUserName = (value: unknown, user: Record<string, any>): boolean =>
  isLikelyPersonUrl(
    String(value || ''),
    user.fname || user.firstName || '',
    user.lname || user.lastName || '',
  );

const publicProfileWebsiteUrl = (user: Record<string, any>): string | undefined => {
  const website = cleanPublicHttpUrl(user.website);
  const officialProfileUrl = officialYaleProfileUrlForUser(user);
  if (!user.website && officialProfileUrl) return officialProfileUrl;
  if (
    officialProfileUrl &&
    website &&
    (isLabOrResearchGroupUrl(website) || !websiteUrlMatchesUserName(website, user))
  ) {
    return officialProfileUrl;
  }
  return website || undefined;
};

const publicProfileDisplayName = (user: Record<string, any>): string =>
  [user.fname || user.firstName, user.lname || user.lastName].filter(Boolean).join(' ') ||
  String(user.displayName || user.name || '').trim();

const formatPublicBioList = (values: string[]): string => {
  const cleaned = values.map((value) => String(value || '').replace(/[.;:,]+$/g, '').trim()).filter(Boolean);
  if (cleaned.length <= 1) return cleaned[0] || '';
  if (cleaned.length === 2) return `${cleaned[0]} and ${cleaned[1]}`;
  return `${cleaned.slice(0, -1).join(', ')}, and ${cleaned.at(-1)}`;
};

const TRUSTED_RESEARCH_HOME_BIO_MIN_SUMMARY_LENGTH = 80;

const isGrantOrCitationSourceUrl = (url: unknown): boolean =>
  /(?:orcid\.org|reporter\.nih\.gov|api\.nsf\.gov|nsf\.gov\/awardsearch|pubmed\.ncbi\.nlm\.nih\.gov|openalex\.org|api\.openalex\.org)/i.test(
    String(url || ''),
  );

const isTrustedResearchHomeWebsiteUrl = (url: unknown): boolean => {
  const text = String(url || '').trim();
  return /^https?:\/\//i.test(text) && !isGrantOrCitationSourceUrl(text) && !/\/profile\//i.test(text);
};

const trustedResearchHomeBioWebsiteUrls = (entity: Record<string, any>): string[] =>
  [entity.website, entity.websiteUrl, entity._bioWebsite, entity._bioWebsiteUrl]
    .map((url) => String(url || '').trim())
    .filter(isTrustedResearchHomeWebsiteUrl);

const looksLikePersonOnlyResearchHomeName = (value: unknown): boolean =>
  /,\s*(?:ph\.?d\.?|m\.?d\.?|md|mph|jd)\b/i.test(String(value || ''));

const isUsefulResearchHomeBioSummary = (value: string): boolean => {
  const text = cleanResearchHomeSummaryForBio(value);
  if (text.length < TRUSTED_RESEARCH_HOME_BIO_MIN_SUMMARY_LENGTH) return false;
  if (!hasResearchDescriptionVerb(text)) return false;
  if (/\b(?:i have|my research|my lab|my group|our research|our lab|our group)\b/i.test(text)) {
    return false;
  }
  if (/^studies\s+i\b/i.test(text)) return false;
  return !isNonBiographicalPublicBio(text);
};

const cleanResearchHomeSummaryForBio = (value: string): string => {
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (!/\b[A-Za-z]+-[A-Za-z]{0,3}$/.test(text) && !/\b(?:and|or|to|of|for|with|in|on|by|combat)$/i.test(text)) {
    return text;
  }

  const sentenceEnds = Array.from(text.matchAll(/[.!?](?=\s|$)/g));
  const lastSentenceEnd = sentenceEnds.at(-1);
  if (!lastSentenceEnd || typeof lastSentenceEnd.index !== 'number') return '';

  return text.slice(0, lastSentenceEnd.index + 1).trim();
};

const capitalizeSentenceStart = (value: string): string =>
  value.replace(/^([a-z])/, (letter) => letter.toUpperCase());

const sentenceWithPeriod = (value: string): string => {
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return /[.!?]$/.test(text) ? text : `${text}.`;
};

const publicResearchHomeName = (value: string): string => {
  const name = value.replace(/\s+/g, ' ').trim();
  if (!name) return '';
  if (/^the\b/i.test(name)) return name;
  if (/\b(?:lab|laboratory|center|centre|institute|program|initiative|team|group|clinic)\b/i.test(name)) {
    return `the ${name}`;
  }
  return name;
};

const researchHomeSummarySentence = (entityName: string, rawSummary: string): string => {
  const summary = sentenceWithPeriod(rawSummary);
  if (!summary) return '';

  const subject = publicResearchHomeName(entityName);
  const replacements: Array<[RegExp, string]> = [
    [/^studies\s+/i, `${subject} studies `],
    [/^focuses\s+on\s+/i, `${subject} focuses on `],
    [/^investigates\s+/i, `${subject} investigates `],
    [/^examines\s+/i, `${subject} examines `],
    [/^explores\s+/i, `${subject} explores `],
    [/^develops\s+/i, `${subject} develops `],
    [/^uses\s+/i, `${subject} uses `],
    [/^employs\s+/i, `${subject} employs `],
    [/^researches\s+/i, `${subject} researches `],
    [/^analyzes\s+/i, `${subject} analyzes `],
    [/^models\s+/i, `${subject} models `],
    [/^the\s+lab\b/i, subject],
    [/^this\s+lab\b/i, subject],
    [/^the\s+group\b/i, subject],
    [/^this\s+group\b/i, subject],
  ];

  for (const [pattern, replacement] of replacements) {
    if (pattern.test(summary)) {
      return sentenceWithPeriod(capitalizeSentenceStart(summary.replace(pattern, replacement)));
    }
  }

  return capitalizeSentenceStart(summary);
};

const trustedLeadResearchHomeBioFallback = (
  user: Record<string, any>,
  researchEntities: any[],
): string => {
  const displayName = publicProfileDisplayName(user);
  if (!displayName) return '';

  for (const entity of researchEntities) {
    const entityName = String(entity?.displayName || entity?.name || '').replace(/\s+/g, ' ').trim();
    const summary = cleanResearchHomeSummaryForBio(String(
      entity?.shortDescription ||
        entity?.fullDescription ||
        entity?._bioFullDescription ||
        entity?.description ||
        '',
    ));

    if (!entityName || looksLikePersonOnlyResearchHomeName(entityName)) continue;
    if (isIndividualResearchEntity(entity) || !isLeadRole(entity.role)) continue;
    if (trustedResearchHomeBioWebsiteUrls(entity).length === 0) continue;
    if (!isUsefulResearchHomeBioSummary(summary)) continue;

    const leadPhrase = ['co-pi', 'co-director'].includes(String(entity.role || '').toLowerCase())
      ? 'helps lead'
      : 'leads';
    return clipPublicProfileBio(
      `${displayName} ${leadPhrase} ${publicResearchHomeName(entityName)}. ${researchHomeSummarySentence(
        entityName,
        summary,
      )}`,
    );
  }

  return '';
};

const expandedResearchAreasPublicBio = (user: Record<string, any>, rawBio: string): string => {
  if (!/^research\s+areas?\b/i.test(rawBio.trim())) return '';
  if (!hasOfficialYaleProfileUrl(user)) return '';

  const lines = rawBio
    .split(/[\n\r]+/)
    .map((line, index) =>
      index === 0 ? line.replace(/^research\s+areas?\s*:?\s*/i, '').trim() : line.trim(),
    )
    .filter(Boolean);
  const terms = sanitizeProfileResearchTerms(lines).slice(0, 5);
  const displayName = publicProfileDisplayName(user);
  if (!displayName || terms.length < 2) return '';

  return `${displayName}'s official Yale profile lists research areas in ${formatPublicBioList(
    terms,
  )}, based on Yale's official profile data.`;
};

export const cleanPublicProfileBio = (user: Record<string, any>): string => {
  const rawBioText = String(user.bio || '').trim();
  if (!rawBioText) return '';

  const expandedResearchAreasBio = expandedResearchAreasPublicBio(user, rawBioText);
  if (expandedResearchAreasBio) return '';

  const rawBio = stripOfficialProfileCtaChromeFromPublicProfileBio(
    stripContactChromeFromPublicProfileBio(stripTrailingOfficialProfileUpdateMetadata(rawBioText)),
  );

  const hadBiographicalSketchPrefix = /^biographical\s+sketch\s*:/i.test(rawBio);
  const withoutSketchPrefix = rawBio.replace(/^biographical\s+sketch\s*:\s*/i, '').trim();
  const withoutBioPrefix = withoutSketchPrefix.replace(/^bio(?:graphy)?\s*:\s*/i, '').trim();
  const hadResponsibilitiesPrefix = /^responsibilities\s*:/i.test(withoutBioPrefix);
  const cleaned = withoutBioPrefix.replace(/^responsibilities\s*:\s*/i, '').trim();
  if (!cleaned) return '';
  if (isGroupResearchPublicBio(cleaned)) return '';
  if (isNonBiographicalPublicBio(cleaned)) {
    return '';
  }

  const normalizedCleaned = normalizeNameToken(cleaned);
  const normalizedTitle = normalizeNameToken(user.title || '');
  if (normalizedTitle && normalizedCleaned === normalizedTitle) {
    return '';
  }

  if (
    (hadBiographicalSketchPrefix || hadResponsibilitiesPrefix) &&
    isAppointmentOnlyProfileBio(cleaned) &&
    !hasResearchDescriptionVerb(cleaned)
  ) {
    return '';
  }

  return clipPublicProfileBio(cleaned);
};

export const isDatasetLikeScholarlyLink = (link: Record<string, any>): boolean => {
  const title = String(link.title || '').toLowerCase();
  const venue = String(link.venue || '').toLowerCase();
  const url = String(link.url || '').toLowerCase();
  const doi = String(link.externalIds?.doi || '').toLowerCase();
  return (
    venue.includes('mendeley data') ||
    venue.includes('figshare') ||
    venue.includes('zenodo') ||
    doi.startsWith('10.17632/') ||
    url.includes('doi.org/10.17632/') ||
    /^raw data\b/.test(title) ||
    /^data from\b/.test(title) ||
    /^figure\s+s?\d+\s+from\b/.test(title) ||
    /\b(dataset|data set|supplementary data)\b/.test(title)
  );
};

const normalizeOpenAccessStatus = (link: Record<string, any>): string => {
  const raw =
    link.openAccessStatus ||
    link.open_access_status ||
    link.openAccess?.oaStatus ||
    link.open_access?.oa_status ||
    link.openAccess?.status ||
    link.open_access?.status ||
    '';
  return String(raw).trim().toLowerCase();
};

const hasInspectableOpenAlexDestination = (link: Record<string, any>): boolean => {
  const destinationKind = String(link.destinationKind || '').toUpperCase();
  if (destinationKind !== 'OPENALEX') return true;

  const openAccessStatus = normalizeOpenAccessStatus(link);
  if (openAccessStatus === 'closed') return false;

  const url = String(link.url || '').trim();
  const hasNonOpenAlexPrimaryUrl = Boolean(url) && !/^https?:\/\/(?:www\.)?openalex\.org\//i.test(url);
  return Boolean(
    hasNonOpenAlexPrimaryUrl ||
      link.freeFullTextUrl ||
      link.externalIds?.doi ||
      link.externalIds?.pmid ||
      link.externalIds?.pmcid,
  );
};

export const isPublicResearchPaperLink = (link: Record<string, any>): boolean =>
  !isDatasetLikeScholarlyLink(link) &&
  !isGeneratedOfficialProfilePublicationAnchor(link) &&
  !isOfficialProfileSourcePagePublicationPointer(link) &&
  hasInspectableOpenAlexDestination(link) &&
  Boolean(
    cleanPublicHttpUrl(link.url) ||
      cleanPublicHttpUrl(link.freeFullTextUrl) ||
      cleanUrl(link.externalIds?.doi)
  );

const isOfficialProfileScholarlyLink = (link: Record<string, any>): boolean =>
  String(link.discoveredVia || '').toUpperCase() === 'OFFICIAL_PROFILE' ||
  String(link.destinationKind || '').toUpperCase() === 'OFFICIAL_PROFILE' ||
  /\bofficial\b.*\bprofile\b/i.test(String(link.displaySource || link.sourceName || ''));

const publicScholarlyLinkText = (value: unknown): string | undefined => {
  const text = redactDirectContactInfo(String(value || '').trim()).slice(0, 500);
  return text || undefined;
};

const publicScholarlyLinkYear = (value: unknown): number | undefined => {
  const year = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(year) || year < 1800 || year > 2200) return undefined;
  return year;
};

const publicScholarlyLinkConfidence = (value: unknown): number | undefined => {
  const confidence = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return undefined;
  return confidence;
};

const PUBLIC_SCHOLARLY_DESTINATION_KINDS = new Set([
  'DOI',
  'OPENALEX',
  'ORCID',
  'ARXIV',
  'PMID',
  'PMCID',
  'OFFICIAL_PROFILE',
  'OTHER',
]);
const PUBLIC_OPEN_ACCESS_STATUSES = new Set([
  'open',
  'closed',
  'gold',
  'green',
  'hybrid',
  'bronze',
  'unknown',
]);

const publicScholarlyDestinationKind = (value: unknown): string => {
  const kind = String(value || '').trim().toUpperCase();
  return PUBLIC_SCHOLARLY_DESTINATION_KINDS.has(kind) ? kind : 'OTHER';
};

const publicOpenAccessStatus = (link: Record<string, any>): string | undefined => {
  const status = normalizeOpenAccessStatus(link);
  return PUBLIC_OPEN_ACCESS_STATUSES.has(status) ? status : undefined;
};

export const orderProfileScholarlyLinks = (links: Record<string, any>[]): Record<string, any>[] =>
  [...links].sort((a, b) => {
    const officialDelta = Number(isOfficialProfileScholarlyLink(b)) - Number(isOfficialProfileScholarlyLink(a));
    if (officialDelta !== 0) return officialDelta;
    const yearDelta = Number(b.year || 0) - Number(a.year || 0);
    if (yearDelta !== 0) return yearDelta;
    const bObserved = new Date(String(b.observedAt || b.updatedAt || 0)).getTime() || 0;
    const aObserved = new Date(String(a.observedAt || a.updatedAt || 0)).getTime() || 0;
    return bObserved - aObserved;
  });

export const scholarlyLinkToPublicLink = (
  link: Record<string, any>,
  options: {
    userId?: unknown;
    researchEntityId?: unknown;
    relationshipBasis?: string;
    evidenceLabel?: string;
    confidence?: number;
    observedAt?: unknown;
    sourceName?: string;
    sourceUrl?: string;
  } = {},
) => {
  const doiUrl = normalizedDoiUrl(link.externalIds?.doi);
  const rawUrl = cleanPublicHttpUrl(link.url);
  const url =
    !isGeneratedOfficialProfilePublicationAnchor(link) &&
    !isOfficialProfileSourcePagePublicationPointer(link)
      ? rawUrl || doiUrl
      : doiUrl;
  const freeFullTextUrl = cleanPublicHttpUrl(link.freeFullTextUrl);
  const confidence = publicScholarlyLinkConfidence(options.confidence ?? link.confidence);
  const observedAt = dateToIso(options.observedAt || link.observedAt || link.updatedAt);
  return {
    _id: publicScholarlyLinkId(link, url, doiUrl),
    title: cleanScholarlyTitle(link.title),
    url,
    destinationKind: publicScholarlyDestinationKind(link.destinationKind),
    displaySource:
      cleanPublicSourceLabel(link.displaySource || options.sourceName || link.destinationKind) ||
      'Scholarly link',
    freeFullTextUrl: freeFullTextUrl || undefined,
    freeFullTextLabel: freeFullTextUrl
      ? publicScholarlyLinkText(link.freeFullTextLabel) || 'Free full text'
      : undefined,
    discoveredVia: normalizeDiscoveredVia(cleanPublicSourceLabel(link.discoveredVia || options.sourceName)),
    openAccessStatus: publicOpenAccessStatus(link),
    year: publicScholarlyLinkYear(link.year),
    venue: publicScholarlyLinkText(link.venue),
    confidence,
    observedAt,
    externalIds: publicScholarlyExternalIds(link.externalIds),
    relationshipBasis: publicScholarlyLinkText(options.relationshipBasis),
    evidenceLabel: publicScholarlyLinkText(options.evidenceLabel),
  };
};

export const normalizePublicProfile = (
  user: Record<string, any>,
  extras: {
    scholarlyLinks?: any[];
    researchEntities?: any[];
    trustedResearchEntities?: boolean;
  } = {},
): Record<string, any> => {
  const contaminated = isLikelySameNameContaminatedProfile(user);
  const rawResearchInterests = user.researchInterests || user.research_interests || [];
  const researchInterests = sanitizeProfileResearchTerms(rawResearchInterests);
  const scholarlyLinks = contaminated ? [] : extras.scholarlyLinks || [];
  const researchEntities =
    contaminated && !extras.trustedResearchEntities ? [] : extras.researchEntities || [];
  const cleanedBio = contaminated ? '' : cleanPublicProfileBio(user);
  const rawBioWasGroupResearchProse = isGroupResearchPublicBio(String(user.bio || ''));
  const bio =
    cleanedBio ||
    (!contaminated && extras.trustedResearchEntities && !rawBioWasGroupResearchProse
      ? trustedLeadResearchHomeBioFallback(user, researchEntities)
      : '');
  const publicResearchEntities = researchEntities.map(publicProfileResearchEntity);
  const derivedResearchInterests =
    researchInterests.length > 0 ? researchInterests : researchAreasFromResearchEntities(researchEntities);
  const publicTopics = supportedPublicProfileTopics(user.topics, derivedResearchInterests);
  const rawResearchInterestSummary =
    user.researchInterestSummary ||
    user.research_interest_summary ||
    researchInterestContextSummary(researchEntities);
  const researchInterestSummary = publicResearchSummaryText(rawResearchInterestSummary) || '';
  const hasSupportedResearchIdentity =
    (!contaminated || (extras.trustedResearchEntities && researchEntities.length > 0)) &&
    Boolean(
      derivedResearchInterests.length > 0 ||
        researchInterestSummary ||
        researchEntities.length > 0 ||
        user.openAlexId ||
        user.openalex_id ||
        scholarlyLinks.length > 0,
    );

  const imageUrl = publicProfileImageUrl(user);

  return {
    ...publicProfileBase(user),
    bio,
    website: publicProfileWebsiteUrl(user),
    imageUrl,
    image_url: imageUrl,
    primary_department: user.primaryDepartment || user.primary_department || '',
    secondary_departments: user.secondaryDepartments || user.secondary_departments || [],
    h_index: !hasSupportedResearchIdentity ? undefined : user.hIndex || user.h_index,
    openalex_id:
      !hasSupportedResearchIdentity ? undefined : user.openAlexId || user.openalex_id,
    profile_urls: contaminated ? {} : cleanProfileUrlsForPerson(user),
    research_interests: derivedResearchInterests,
    research_interest_summary: researchInterestSummary,
    topics: !hasSupportedResearchIdentity ? [] : publicTopics,
    scholarlyLinks,
    researchEntities: publicResearchEntities,
  };
};

const loadProfileScholarlyLinks = async (user: Record<string, any>) => {
  const userId = user._id;
  if (!userId) return [];

  const attributionRows = await ResearchScholarlyAttribution.find({
    targetUserId: userId,
    archived: { $ne: true },
  })
    .select('scholarlyLinkId relationshipBasis evidenceLabel confidence observedAt sourceName sourceUrl')
    .sort({ observedAt: -1, updatedAt: -1 })
    .limit(50)
    .lean();
  const scholarlyLinkIds = [
    ...new Set(attributionRows.map((row: any) => profileDocumentId(row.scholarlyLinkId)).filter(Boolean)),
  ];

  const [attributedLinks, directLinks] = await Promise.all([
    scholarlyLinkIds.length
      ? ResearchScholarlyLink.find({ _id: { $in: scholarlyLinkIds }, archived: { $ne: true } })
          .select(
            '_id userId researchEntityId title url destinationKind displaySource freeFullTextUrl freeFullTextLabel discoveredVia year venue confidence observedAt sourceUrl externalIds updatedAt',
          )
          .limit(50)
          .lean()
      : Promise.resolve([]),
    ResearchScholarlyLink.find({ userId, archived: { $ne: true } })
      .select(
        '_id userId researchEntityId title url destinationKind displaySource freeFullTextUrl freeFullTextLabel discoveredVia year venue confidence observedAt sourceUrl externalIds updatedAt',
      )
      .sort({ observedAt: -1, year: -1, updatedAt: -1 })
      .limit(20)
      .lean(),
  ]);

  const linksById = new Map(
    (attributedLinks as any[]).flatMap((link) => {
      const id = profileDocumentId(link._id);
      return id ? [[id, link] as const] : [];
    }),
  );
  const seen = new Set<string>();
  const scholarlyLinks = [
    ...attributionRows
      .flatMap((row: any) => {
        const link = linksById.get(profileDocumentId(row.scholarlyLinkId));
        if (!link) return [];
        return [scholarlyLinkToPublicLink(link, {
          userId,
          relationshipBasis: row.relationshipBasis || 'identity_authorship',
          evidenceLabel: row.evidenceLabel || 'Authored by a verified Yale faculty identity',
          confidence: row.confidence,
          observedAt: row.observedAt,
          sourceName: row.sourceName,
          sourceUrl: row.sourceUrl,
        })];
      }),
    ...(directLinks as any[]).map((link) =>
      scholarlyLinkToPublicLink(link, {
        userId,
        relationshipBasis: 'direct_user_link',
        evidenceLabel: 'Linked to this Yale faculty profile',
      }),
    ),
  ].filter((link: any) => {
    const key = profileDocumentId(link?._id);
    if (!key || seen.has(key) || !isPublicResearchPaperLink(link)) return false;
    seen.add(key);
    return true;
  });

  if (scholarlyLinks.length > 0) return orderProfileScholarlyLinks(scholarlyLinks).slice(0, 10);

  const authorIdentityClauses: Record<string, unknown>[] = [{ userId }];
  if (user.facultyMemberId) authorIdentityClauses.push({ facultyMemberId: user.facultyMemberId });

  const authorRows = await PaperAuthor.find({ $or: authorIdentityClauses })
    .select('paperId')
    .sort({ lastObservedAt: -1, updatedAt: -1 })
    .limit(50)
    .lean();
  const paperIds = [...new Set(authorRows.map((row: any) => profileDocumentId(row.paperId)).filter(Boolean))];
  if (paperIds.length === 0) return [];

  const papers = await Paper.find({ _id: { $in: paperIds }, archived: { $ne: true } })
    .select(
      '_id title doi openAlexId arxivId url openAccessUrl landingPageUrl pdfUrl year venue citationCount publishedAt postedAt versionDate sources lastObservedAt updatedAt',
    )
    .sort({ publishedAt: -1, year: -1, citationCount: -1 })
    .limit(10)
    .lean();

  return papers.map((paper: any) => paperToScholarlyLink(paper, userId));
};

export const buildProfileResearchMembershipFilter = (
  user: Record<string, any>,
  facultyMemberIds: unknown[] = [],
) => {
  const userId = user._id;
  const clauses: Record<string, unknown>[] = [];

  if (userId) clauses.push({ userId });

  const linkedFacultyMemberIds = [
    user.facultyMemberId,
    ...facultyMemberIds,
  ]
    .map((id) => profileDocumentId(id))
    .filter(Boolean);
  const uniqueFacultyMemberIds = [...new Set(linkedFacultyMemberIds)];
  if (uniqueFacultyMemberIds.length > 0) {
    clauses.push({ facultyMemberId: { $in: uniqueFacultyMemberIds } });
  }

  if (clauses.length === 0) return null;

  return {
    $or: clauses,
    isCurrentMember: { $ne: false },
    researchEntityId: { $exists: true, $ne: null },
  };
};

const loadProfileResearchEntities = async (user: Record<string, any>) => {
  const userId = user._id;
  if (!userId) return [];

  const facultyIdentityClauses: Record<string, unknown>[] = [];
  if (user.facultyMemberId) facultyIdentityClauses.push({ _id: user.facultyMemberId });
  if (userId) facultyIdentityClauses.push({ userId });
  if (user.netid) facultyIdentityClauses.push({ netid: user.netid });
  if (user.email) facultyIdentityClauses.push({ email: user.email });
  const linkedFacultyMembers = facultyIdentityClauses.length
    ? await FacultyMember.find({
        $or: facultyIdentityClauses,
        archived: { $ne: true },
      })
        .select('_id')
        .lean()
    : [];
  const membershipFilter = buildProfileResearchMembershipFilter(
    user,
    linkedFacultyMembers.map((faculty: any) => faculty._id),
  );
  if (!membershipFilter) return [];

  const memberships = await ResearchGroupMember.find(membershipFilter)
    .select('researchEntityId role')
    .lean();
  const entityIds = [
    ...new Set(
      memberships
        .map((membership: any) => profileDocumentId(membership.researchEntityId))
        .filter(Boolean),
    ),
  ];
  if (entityIds.length === 0) return [];

  const roleByEntityId = new Map(
    memberships.map((membership: any) => [
      profileDocumentId(membership.researchEntityId),
      membership.role,
    ]),
  );
  const entities = await ResearchEntity.find({
    _id: { $in: entityIds },
    archived: { $ne: true },
    studentVisibilityTier: { $in: publicStudentVisibilityTiers },
  })
    .select(
      '_id slug name displayName kind entityType shortDescription fullDescription description departments researchAreas sourceUrls website websiteUrl',
    )
    .limit(12)
    .lean();

  return dedupeProfileResearchEntities(
    entities.map((entity: any) => ({
      _id: profileDocumentId(entity._id),
      slug: entity.slug || '',
      name: entity.name || '',
      displayName: entity.displayName || '',
      kind: entity.kind || '',
      entityType: entity.entityType || '',
      shortDescription: entity.shortDescription || '',
      description: entity.description || '',
      departments: entity.departments || [],
      researchAreas: entity.researchAreas || [],
      _bioFullDescription: entity.fullDescription || '',
      _bioSourceUrls: entity.sourceUrls || [],
      _bioWebsite: entity.website || '',
      _bioWebsiteUrl: entity.websiteUrl || '',
      role: roleByEntityId.get(profileDocumentId(entity._id)) || '',
    })),
    user,
  );
};

/**
 * Cascade a professor's department data to all their listings.
 * - For owned listings: set departments from owner's profile
 * - For co-PI listings: merge departments from all PIs (owner's primary first)
 */
export const cascadeDepartmentsToListings = async (netid: string) => {
  const user = await User.findOne({ netid }).lean();
  if (!user) return;

  const userDepts = [
    (user as any).primaryDepartment,
    ...((user as any).secondaryDepartments || []),
  ].filter(Boolean);

  const ownedListings = await getListingModel().find({ ownerId: netid }).lean();

  for (const listing of ownedListings) {
    const coPIIds = (listing.professorIds || []).filter((id: string) => id !== netid);

    let finalDepts: string[];

    if (coPIIds.length > 0) {
      const coPIs = await User.find({ netid: { $in: coPIIds } })
        .select('primaryDepartment secondaryDepartments')
        .lean();

      const allDepts = new Set<string>(userDepts);
      for (const pi of coPIs) {
        if ((pi as any).primaryDepartment) allDepts.add((pi as any).primaryDepartment);
        for (const d of (pi as any).secondaryDepartments || []) {
          allDepts.add(d);
        }
      }
      finalDepts = Array.from(allDepts);
    } else {
      finalDepts = userDepts;
    }

    await getListingModel().findByIdAndUpdate(listing._id, {
      departments: finalDepts,
      ownerPrimaryDepartment: (user as any).primaryDepartment || '',
      ownerTitle: (user as any).title || '',
    });
  }

  const coPIListings = await getListingModel()
    .find({ professorIds: netid, ownerId: { $ne: netid } })
    .lean();

  for (const listing of coPIListings) {
    const allPIIds = [listing.ownerId, ...(listing.professorIds || [])];
    const uniqueIds = [...new Set(allPIIds)];

    const allPIs = await User.find({ netid: { $in: uniqueIds } })
      .select('primaryDepartment secondaryDepartments')
      .lean();

    const owner = allPIs.find((p: any) => p.netid === listing.ownerId);
    const ownerPrimary = (owner as any)?.primaryDepartment;

    const allDepts = new Set<string>();
    if (ownerPrimary) allDepts.add(ownerPrimary);

    for (const pi of allPIs) {
      if ((pi as any).primaryDepartment) allDepts.add((pi as any).primaryDepartment);
      for (const d of (pi as any).secondaryDepartments || []) {
        allDepts.add(d);
      }
    }

    await getListingModel().findByIdAndUpdate(listing._id, {
      departments: Array.from(allDepts),
    });
  }
};

/**
 * Get a faculty profile by netid, optionally including publications.
 */
export const getProfileByNetid = async (netid: string, includePublications = false) => {
  let query = User.findOne({ netid });
  if (includePublications) {
    query = query.select('+publications');
  }
  const user = await query.lean();
  if (!user) return user;

  const [scholarlyLinks, researchEntities] = await Promise.all([
    loadProfileScholarlyLinks(user as any),
    loadProfileResearchEntities(user as any),
  ]);

  const publicUser = await withPublicProfileImageGuards(user as any);

  return normalizePublicProfile(publicUser as any, {
    scholarlyLinks,
    researchEntities,
    trustedResearchEntities: true,
  });
};

/**
 * Update allowed profile fields for a professor.
 * Returns the updated user.
 */
const ALLOWED_SELF_UPDATE_FIELDS = [
  'bio',
  'primaryDepartment',
  'secondaryDepartments',
  'researchInterests',
  'topics',
  'imageUrl',
  'profileUrls',
  'website',
];

const MAX_SELF_PROFILE_TEXT_LENGTH = 2000;
const MAX_SELF_PROFILE_ARRAY_ITEMS = 50;
const MAX_SELF_PROFILE_ARRAY_VALUE_LENGTH = 120;
const MAX_SELF_PROFILE_URLS = 20;
const MAX_SELF_PROFILE_URL_KEY_LENGTH = 80;
const MAX_SELF_PROFILE_URL_LENGTH = 2048;
const MAX_ADMIN_PROFILE_PUBLICATIONS = 100;
const MAX_ADMIN_PROFILE_PUBLICATION_TEXT_LENGTH = 500;
const MAX_ADMIN_PROFILE_PUBLICATION_CITATIONS = 1_000_000;
const SAFE_PROFILE_URL_KEY_RE = /^[A-Za-z0-9 _-]{1,80}$/;

const selfProfileValidationError = (message: string): Error => {
  const error = new Error(message);
  error.name = 'ValidationError';
  return error;
};

const isProfileUpdatePayload = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const boundedProfileString = (value: unknown, maxLength: number): string | undefined => {
  if (typeof value !== 'string') return undefined;
  return value.trim().slice(0, maxLength);
};

const boundedProfileStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_SELF_PROFILE_ARRAY_ITEMS)
    .flatMap((item) => {
      const normalized = boundedProfileString(item, MAX_SELF_PROFILE_ARRAY_VALUE_LENGTH);
      return normalized ? [normalized] : [];
    });
};

const boundedProfileUrlKey = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_SELF_PROFILE_URL_KEY_LENGTH) return undefined;
  if (!SAFE_PROFILE_URL_KEY_RE.test(normalized)) return undefined;
  return normalized;
};

const boundedPublicProfileUrl = (value: unknown): string | undefined => {
  const url = cleanPublicHttpUrl(value);
  return url && url.length <= MAX_SELF_PROFILE_URL_LENGTH ? url : undefined;
};

const boundedHttpsProfileImageUrl = (value: unknown): string | undefined => {
  const url = boundedPublicProfileUrl(value);
  if (!url) return undefined;
  try {
    return new URL(url).protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
};

const boundedPublicationText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const text = redactDirectContactInfo(value).trim().slice(0, MAX_ADMIN_PROFILE_PUBLICATION_TEXT_LENGTH);
  return text || undefined;
};

const boundedPublicationNumber = (
  value: unknown,
  { min = 0, max = Number.MAX_SAFE_INTEGER }: { min?: number; max?: number } = {},
): number | undefined => {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(number) || number < min || number > max) return undefined;
  return Math.trunc(number);
};

const normalizeAdminProfilePublications = (value: unknown): Record<string, any>[] => {
  if (!Array.isArray(value)) return [];

  return value.slice(0, MAX_ADMIN_PROFILE_PUBLICATIONS).flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const title = boundedPublicationText(record.title);
    if (!title) return [];

    const publication: Record<string, any> = { title };
    const doi = boundedPublicationText(record.doi);
    const venue = boundedPublicationText(record.venue);
    const source = boundedPublicationText(record.source);
    const year = boundedPublicationNumber(record.year, { min: 1700, max: 2200 });
    const citedByCount = boundedPublicationNumber(record.citedByCount ?? record.cited_by_count, {
      max: MAX_ADMIN_PROFILE_PUBLICATION_CITATIONS,
    });
    const openAccessUrl = boundedPublicProfileUrl(record.openAccessUrl ?? record.open_access_url);

    if (doi !== undefined) publication.doi = doi;
    if (year !== undefined) publication.year = year;
    if (venue !== undefined) publication.venue = venue;
    if (citedByCount !== undefined) publication.citedByCount = citedByCount;
    if (openAccessUrl !== undefined) publication.openAccessUrl = openAccessUrl;
    if (source !== undefined) publication.source = source;

    return [publication];
  });
};

const sanitizeSelfEditableProfileTextFields = (update: Record<string, any>) => {
  if ('bio' in update) {
    const bio = boundedProfileString(update.bio, MAX_SELF_PROFILE_TEXT_LENGTH);
    if (bio !== undefined) update.bio = bio;
    else delete update.bio;
  }

  if ('primaryDepartment' in update) {
    const primaryDepartment = boundedProfileString(
      update.primaryDepartment,
      MAX_SELF_PROFILE_ARRAY_VALUE_LENGTH,
    );
    if (primaryDepartment !== undefined) update.primaryDepartment = primaryDepartment;
    else delete update.primaryDepartment;
  }

  for (const field of ['secondaryDepartments', 'researchInterests', 'topics']) {
    if (field in update) update[field] = boundedProfileStringArray(update[field]);
  }
};

const sanitizeSelfEditableProfileUrlFields = (update: Record<string, any>) => {
  if ('website' in update) {
    const website = boundedPublicProfileUrl(update.website);
    if (website) update.website = website;
    else delete update.website;
  }

  if ('imageUrl' in update) {
    if (update.imageUrl === '') {
      update.imageUrl = '';
    } else {
      const imageUrl = boundedPublicProfileUrl(update.imageUrl);
      if (!imageUrl) {
        delete update.imageUrl;
      } else {
        update.imageUrl = imageUrl;
      }
    }
  }

  if ('profileUrls' in update) {
    const profileUrlsSource =
      update.profileUrls && typeof update.profileUrls === 'object' && !Array.isArray(update.profileUrls)
        ? (update.profileUrls as Record<string, unknown>)
        : undefined;
    const profileUrls =
      profileUrlsSource
        ? Object.fromEntries(
            Object.keys(profileUrlsSource)
              .slice(0, MAX_SELF_PROFILE_URLS)
              .flatMap((key) => {
                const url = profileUrlsSource[key];
                const normalizedKey = boundedProfileUrlKey(key);
                const normalizedUrl = boundedPublicProfileUrl(url);
                return normalizedKey && normalizedUrl ? [[normalizedKey, normalizedUrl] as const] : [];
              })
          )
        : {};

    if (Object.keys(profileUrls).length > 0) update.profileUrls = profileUrls;
    else delete update.profileUrls;
  }
};

export const updateOwnProfile = async (netid: string, data: any) => {
  if (!isProfileUpdatePayload(data)) {
    throw selfProfileValidationError('Invalid profile update payload');
  }

  const update: Record<string, any> = {};

  for (const field of ALLOWED_SELF_UPDATE_FIELDS) {
    const value = (data as Record<string, unknown>)[field];
    if (value !== undefined) {
      update[field] = value;
    }
  }
  if (
    update.imageUrl !== undefined &&
    update.imageUrl !== '' &&
    !boundedHttpsProfileImageUrl(update.imageUrl)
  ) {
    throw selfProfileValidationError('Profile image URL must be a public HTTPS URL');
  }
  sanitizeSelfEditableProfileTextFields(update);
  sanitizeSelfEditableProfileUrlFields(update);

  const current = await User.findOne({ netid }).lean();
  if (update.primaryDepartment !== undefined || update.secondaryDepartments !== undefined) {
    const primary = update.primaryDepartment ?? (current as any)?.primaryDepartment ?? '';
    const secondary = update.secondaryDepartments ?? (current as any)?.secondaryDepartments ?? [];
    update.departments = [primary, ...secondary].filter(Boolean);
  }

  const completedProfile = {
    ...(current as any),
    ...update,
  };
  const shouldRequestVerification =
    !completedProfile.profileVerified &&
    !completedProfile.profileVerificationRequestedAt &&
    String(completedProfile.primaryDepartment || '').trim() &&
    Array.isArray(completedProfile.researchInterests) &&
    completedProfile.researchInterests.length > 0 &&
    String(completedProfile.bio || '').trim() &&
    String(completedProfile.imageUrl || '').trim();

  const user = await User.findOneAndUpdate({ netid }, update, {
    new: true,
    runValidators: true,
  }).lean();

  if (shouldRequestVerification) {
    const requested = await User.findOneAndUpdate(
      {
        netid,
        profileVerified: { $ne: true },
        profileVerificationRequestedAt: { $exists: false },
      },
      { $set: { profileVerificationRequestedAt: new Date() } },
      { new: true, runValidators: true },
    ).lean();
    return requested || user;
  }

  return user;
};

/**
 * Admin: update any profile field.
 */
const ADMIN_UPDATE_FIELDS = [
  ...ALLOWED_SELF_UPDATE_FIELDS,
  'fname',
  'lname',
  'email',
  'title',
  'hIndex',
  'orcid',
  'openAlexId',
  'profileVerified',
  'userType',
  'userConfirmed',
];

const MAX_ADMIN_PROFILE_NAME_LENGTH = 120;
const MAX_ADMIN_PROFILE_EMAIL_LENGTH = 254;
const MAX_ADMIN_PROFILE_TITLE_LENGTH = 300;
const MAX_ADMIN_PROFILE_IDENTIFIER_LENGTH = 300;
const MAX_ADMIN_PROFILE_H_INDEX = 1_000_000;
// Must match the AdminProfileEditModal <select> options exactly (admin/
// professor/faculty/graduate/undergraduate/unknown) — 'student' was never
// actually offered by that UI and is never assigned to a real account
// (every real student is 'undergraduate' or 'graduate'), so keeping it here
// instead of the real values silently dropped every admin edit that picked
// faculty/graduate/undergraduate/unknown from the dropdown.
const ADMIN_PROFILE_USER_TYPES = new Set([
  'admin',
  'professor',
  'faculty',
  'undergraduate',
  'graduate',
  'unknown',
]);

const boundedAdminProfileText = (value: unknown, maxLength: number): string | undefined => {
  const text = boundedProfileString(value, maxLength);
  return text === undefined ? undefined : redactDirectContactInfo(text);
};

const boundedAdminProfileNumber = (
  value: unknown,
  { min = 0, max = MAX_ADMIN_PROFILE_H_INDEX }: { min?: number; max?: number } = {},
): number | undefined => {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(number) || number < min || number > max) return undefined;
  return Math.trunc(number);
};

const boundedAdminProfileEmail = (value: unknown): string | undefined => {
  const email = boundedProfileString(value, MAX_ADMIN_PROFILE_EMAIL_LENGTH);
  if (!email || /[\r\n]/.test(email)) return undefined;
  return email.toLowerCase();
};

const sanitizeAdminProfileTextFields = (update: Record<string, any>) => {
  if ('bio' in update) {
    const bio = boundedAdminProfileText(update.bio, MAX_SELF_PROFILE_TEXT_LENGTH);
    if (bio !== undefined) update.bio = bio;
    else delete update.bio;
  }

  if ('primaryDepartment' in update) {
    const primaryDepartment = boundedAdminProfileText(
      update.primaryDepartment,
      MAX_SELF_PROFILE_ARRAY_VALUE_LENGTH,
    );
    if (primaryDepartment !== undefined) update.primaryDepartment = primaryDepartment;
    else delete update.primaryDepartment;
  }

  for (const field of ['secondaryDepartments', 'researchInterests', 'topics']) {
    if (field in update) {
      update[field] = boundedProfileStringArray(update[field])
        .map((value) => redactDirectContactInfo(value))
        .filter(Boolean);
    }
  }
};

const sanitizeAdminProfileScalarFields = (update: Record<string, any>) => {
  for (const field of ['fname', 'lname']) {
    if (field in update) {
      const value = boundedAdminProfileText(update[field], MAX_ADMIN_PROFILE_NAME_LENGTH);
      if (value !== undefined) update[field] = value;
      else delete update[field];
    }
  }

  if ('email' in update) {
    const email = boundedAdminProfileEmail(update.email);
    if (email !== undefined) update.email = email;
    else delete update.email;
  }

  if ('title' in update) {
    const title = boundedAdminProfileText(update.title, MAX_ADMIN_PROFILE_TITLE_LENGTH);
    if (title !== undefined) update.title = title;
    else delete update.title;
  }

  for (const field of ['orcid', 'openAlexId']) {
    if (field in update) {
      const value = boundedProfileString(update[field], MAX_ADMIN_PROFILE_IDENTIFIER_LENGTH);
      if (value !== undefined) update[field] = value;
      else delete update[field];
    }
  }

  if ('hIndex' in update) {
    const hIndex = boundedAdminProfileNumber(update.hIndex);
    if (hIndex !== undefined) update.hIndex = hIndex;
    else delete update.hIndex;
  }

  for (const field of ['profileVerified', 'userConfirmed']) {
    if (field in update && typeof update[field] !== 'boolean') delete update[field];
  }

  if ('userType' in update) {
    const userType = boundedProfileString(update.userType, MAX_ADMIN_PROFILE_NAME_LENGTH)?.toLowerCase();
    if (userType && ADMIN_PROFILE_USER_TYPES.has(userType)) update.userType = userType;
    else delete update.userType;
  }
};

export const adminUpdateProfile = async (netid: string, data: any) => {
  const source =
    data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, any>) : {};
  const update: Record<string, any> = {};

  for (const field of ADMIN_UPDATE_FIELDS) {
    if (source[field] !== undefined) {
      update[field] = source[field];
    }
  }
  sanitizeAdminProfileTextFields(update);
  sanitizeSelfEditableProfileUrlFields(update);
  sanitizeAdminProfileScalarFields(update);

  if (update.primaryDepartment !== undefined || update.secondaryDepartments !== undefined) {
    const current = await User.findOne({ netid }).lean();
    const primary = update.primaryDepartment ?? (current as any)?.primaryDepartment ?? '';
    const secondary = update.secondaryDepartments ?? (current as any)?.secondaryDepartments ?? [];
    update.departments = [primary, ...secondary].filter(Boolean);
  }

  if (source.publications !== undefined) {
    update.publications = normalizeAdminProfilePublications(source.publications);
  }

  const user = await User.findOneAndUpdate({ netid }, update, {
    new: true,
    runValidators: true,
  })
    .select('+publications')
    .lean();

  return user;
};
