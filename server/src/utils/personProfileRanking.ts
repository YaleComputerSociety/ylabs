/**
 * Which Yale host is a school-wide directory, and which school it belongs to.
 *
 * These hosts publish a profile for anyone the school touches, including people
 * whose appointment lives in another school entirely: 408 of the 3,939 stored
 * `medicine.yale.edu` person profiles sit on a row that lists no School of
 * Medicine appointment, and every other school host measures the same 6-12%
 * (#2835). Departmental hosts do not do this, so the split is the signal.
 *
 * Mirrored by client/src/utils/personProfileRanking.ts and pinned by
 * contracts/personProfileRanking.cases.json; changing the arms here requires
 * updating that copy. Host person-page path shapes live in
 * ./yalePersonPagePrefix.ts.
 */
const SCHOOL_DIRECTORY_HOST_SCHOOL: Readonly<Record<string, string>> = {
  'divinity.yale.edu': 'Divinity School',
  'engineering.yale.edu': 'School of Engineering & Applied Science',
  'environment.yale.edu': 'School of the Environment',
  'faculty.som.yale.edu': 'School of Management',
  'law.yale.edu': 'Law School',
  'medicine.yale.edu': 'School of Medicine',
  'nursing.yale.edu': 'School of Nursing',
  'som.yale.edu': 'School of Management',
  'ysm.yale.edu': 'School of Medicine',
  'ysph.yale.edu': 'School of Public Health',
};

const IDENTIFIER_PROFILE_LABEL: Readonly<Record<string, string>> = {
  'orcid.org': 'ORCID record',
  'scholar.google.com': 'Google Scholar profile',
};

const IDENTIFIER_RECORD_HOST =
  /(^|\.)(orcid\.org|scholar\.google\.com|doi\.org|nih\.gov|reporter\.nih\.gov|nsf\.gov)$/i;

export interface PersonProfileRankingContext {
  schools?: ReadonlyArray<string | null | undefined>;
  provenanceUrls?: ReadonlyArray<string | null | undefined>;
}

const parseHttpUrl = (value: unknown): URL | undefined => {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    return /^https?:$/i.test(url.protocol) ? url : undefined;
  } catch {
    return undefined;
  }
};

const hostOf = (value: unknown): string | undefined =>
  parseHttpUrl(value)
    ?.hostname.replace(/^www\./i, '')
    .toLowerCase();

export const schoolForDirectoryProfileHost = (url: unknown): string | undefined => {
  const host = hostOf(url);
  return host ? SCHOOL_DIRECTORY_HOST_SCHOOL[host] : undefined;
};

export const isSchoolDirectoryProfileUrl = (url: unknown): boolean =>
  Boolean(schoolForDirectoryProfileHost(url));

export const isIdentifierRecordUrl = (url: unknown): boolean => {
  const host = hostOf(url);
  return Boolean(host && IDENTIFIER_RECORD_HOST.test(host));
};

const namedSchools = (schools: PersonProfileRankingContext['schools']): string[] =>
  (schools || [])
    .filter((school): school is string => typeof school === 'string' && school.trim().length > 0)
    .map((school) => school.toLowerCase());

/**
 * A school directory profile on a row that never claims that school. Requires at
 * least one named school: with no school on the row every directory host would
 * read as a mismatch, which would demote a person's own school profile.
 */
export const isCrossSchoolDirectoryProfileUrl = (
  url: unknown,
  schools: PersonProfileRankingContext['schools'],
): boolean => {
  const school = schoolForDirectoryProfileHost(url);
  if (!school) return false;
  const named = namedSchools(schools);
  if (named.length === 0) return false;
  return !named.some((candidate) => candidate.includes(school.toLowerCase()));
};

export const personProfileSourceRoleLabel = (url: unknown): string | undefined => {
  const host = hostOf(url);
  if (!host) return undefined;
  if (IDENTIFIER_PROFILE_LABEL[host]) return IDENTIFIER_PROFILE_LABEL[host];
  if (SCHOOL_DIRECTORY_HOST_SCHOOL[host]) return 'School directory profile';
  if (host.endsWith('yale.edu')) return 'Department profile';
  return undefined;
};

const pathSegmentCount = (url: unknown): number => {
  const parsed = parseHttpUrl(url);
  if (!parsed) return Number.MAX_SAFE_INTEGER;
  return parsed.pathname.split('/').filter(Boolean).length;
};

const rankingKey = (url: string, context: PersonProfileRankingContext): number[] => {
  const provenanceHosts = new Set(
    (context.provenanceUrls || []).map((candidate) => hostOf(candidate)).filter(Boolean),
  );
  const host = hostOf(url);
  return [
    isIdentifierRecordUrl(url) ? 1 : 0,
    host && host.endsWith('yale.edu') ? 0 : 1,
    isCrossSchoolDirectoryProfileUrl(url, context.schools) ? 1 : 0,
    host && provenanceHosts.has(host) ? 0 : 1,
    parseHttpUrl(url)?.protocol === 'https:' ? 0 : 1,
    pathSegmentCount(url),
  ];
};

/**
 * Order person-profile URLs by how well each one belongs to the entity, most
 * canonical first: an official Yale page before a personal site before an
 * identifier record, the entity's own school before a cross-school mirror, a host
 * the entity's own provenance already cites before an unrelated one, then `https`
 * and the shallower path. Ties keep caller order, so an unranked list is returned
 * unchanged rather than reshuffled.
 */
export const comparePersonProfileUrls = (
  first: string,
  second: string,
  context: PersonProfileRankingContext = {},
): number => {
  const firstKey = rankingKey(first, context);
  const secondKey = rankingKey(second, context);
  for (let index = 0; index < firstKey.length; index += 1) {
    if (firstKey[index] !== secondKey[index]) return firstKey[index] - secondKey[index];
  }
  return 0;
};

export const rankPersonProfileUrls = (
  urls: ReadonlyArray<string>,
  context: PersonProfileRankingContext = {},
): string[] => [...urls].sort((first, second) => comparePersonProfileUrls(first, second, context));
