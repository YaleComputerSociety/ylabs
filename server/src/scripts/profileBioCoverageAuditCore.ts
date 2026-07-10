export type ProfessorBioSourceBucket =
  | 'no_profile_url'
  | 'orcid_only'
  | 'yale_profile_url'
  | 'yale_people_or_faculty_url'
  | 'other_profile_url'
  | 'no_official_profile_url';

export type ProfessorBioHomeFallbackBucket =
  | 'same_name_contaminated'
  | 'no_trusted_research_home'
  | 'individual_or_person_named_home_only'
  | 'no_trusted_research_home_website'
  | 'no_useful_research_home_summary'
  | 'no_public_bio_despite_fallback_candidate';

export interface ProfessorBioAuditResearchHomeInput {
  name?: string;
  displayName?: string;
  role?: string;
  kind?: string;
  entityType?: string;
  website?: string;
  websiteUrl?: string;
  summary?: string;
}

export interface ProfessorBioCoverageInput {
  id?: string;
  netid?: string;
  name: string;
  title?: string;
  publicBio?: string;
  sameNameContaminated?: boolean;
  website?: string;
  websiteUrl?: string;
  profileUrls?: Record<string, string> | string[];
  researchHomes?: ProfessorBioAuditResearchHomeInput[];
}

export interface ProfessorBioCoverageAuditOptions {
  minBioLength?: number;
  maxBioLength?: number;
  sampleLimit?: number;
}

export interface ProfessorBioCoverageRow {
  id?: string;
  netid?: string;
  name: string;
  title?: string;
  bioLength: number;
  status:
    | 'decent'
    | 'missing'
    | 'short'
    | 'overlong'
    | 'same_name_contaminated'
    | 'excluded_non_professor';
  exclusionReason?: 'non_professor_title';
  sourceBucket: ProfessorBioSourceBucket;
  homeFallbackBucket?: ProfessorBioHomeFallbackBucket;
  profileUrls: string[];
  researchHomes: Array<{
    name: string;
    role?: string;
    websiteUrl?: string;
  }>;
}

export interface ProfessorBioCoverageAudit {
  counts: {
    total: number;
    decentBio: number;
    weakBio: number;
    missingBio: number;
    shortBio: number;
    overlongBio: number;
    sameNameContaminated: number;
    excludedNonProfessor: number;
  };
  sourceBuckets: Record<ProfessorBioSourceBucket, number>;
  homeFallbackBuckets: Partial<Record<ProfessorBioHomeFallbackBucket, number>>;
  rows: ProfessorBioCoverageRow[];
}

const DEFAULT_MIN_BIO_LENGTH = 120;
const DEFAULT_MAX_BIO_LENGTH = 1200;

const emptySourceBuckets = (): Record<ProfessorBioSourceBucket, number> => ({
  no_profile_url: 0,
  orcid_only: 0,
  yale_profile_url: 0,
  yale_people_or_faculty_url: 0,
  other_profile_url: 0,
  no_official_profile_url: 0,
});

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const normalizeText = (value: unknown): string =>
  textValue(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const uniqueStrings = (values: unknown[]): string[] =>
  Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === 'string')
        .map(textValue)
        .filter(Boolean),
    ),
  );

function profileUrlValues(value: ProfessorBioCoverageInput['profileUrls']): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return uniqueStrings(value);
  return uniqueStrings(Object.values(value));
}

function isOrcidUrl(url: string): boolean {
  return /(^https?:\/\/)?(www\.)?orcid\.org\//i.test(url);
}

function parsedUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function isYaleHost(url: URL): boolean {
  return /(^|\.)yale\.edu$/i.test(url.hostname);
}

function isYaleProfileUrl(value: string): boolean {
  const url = parsedUrl(value);
  return Boolean(url && isYaleHost(url) && /\/profile\//i.test(url.pathname));
}

function pathSegments(url: URL): string[] {
  return url.pathname
    .split('/')
    .map((part) => decodeURIComponent(part).toLowerCase().trim())
    .filter(Boolean);
}

function isYalePeopleOrFacultyUrl(value: string): boolean {
  const url = parsedUrl(value);
  if (!url || !isYaleHost(url) || /\/profile\//i.test(url.pathname)) return false;
  const segments = pathSegments(url);
  const profileSegmentIndex = segments.findIndex((segment) =>
    ['people', 'faculty', 'faculty-directory'].includes(segment),
  );
  if (profileSegmentIndex < 0) return false;
  const personSlug = segments[profileSegmentIndex + 1] || '';
  return Boolean(personSlug && !['people', 'faculty', 'faculty-directory', 'staff'].includes(personSlug));
}

function sourceBucketForProfile(profile: ProfessorBioCoverageInput): ProfessorBioSourceBucket {
  const urls = uniqueStrings([
    profile.website,
    profile.websiteUrl,
    ...profileUrlValues(profile.profileUrls),
  ]);
  if (urls.length === 0) return 'no_profile_url';

  const nonOrcidUrls = urls.filter((url) => !isOrcidUrl(url));
  if (nonOrcidUrls.length === 0) return 'orcid_only';
  if (nonOrcidUrls.some(isYaleProfileUrl)) return 'yale_profile_url';
  if (nonOrcidUrls.some(isYalePeopleOrFacultyUrl)) return 'yale_people_or_faculty_url';
  if (nonOrcidUrls.some((url) => /\/(?:profile|people|faculty|faculty-directory)\//i.test(url))) {
    return 'other_profile_url';
  }
  return 'no_official_profile_url';
}

function isLeadRole(role: unknown): boolean {
  return ['pi', 'principal_investigator', 'principal-investigator', 'lead', 'director', 'co-pi', 'co-director'].includes(
    String(role || '').toLowerCase(),
  );
}

function isIndividualResearchHome(home: ProfessorBioAuditResearchHomeInput, profileName: string): boolean {
  const kind = String(home.kind || '').toLowerCase();
  const entityType = String(home.entityType || '').toUpperCase();
  if (
    kind === 'individual' ||
    kind === 'solo' ||
    entityType === 'FACULTY_RESEARCH_AREA' ||
    entityType === 'INDIVIDUAL_RESEARCH'
  ) {
    return true;
  }

  const homeName = normalizeText(home.displayName || home.name);
  const normalizedProfileName = normalizeText(profileName);
  if (!homeName || !normalizedProfileName || !homeName.includes(normalizedProfileName)) return false;
  return !/\b(?:lab|laboratory|center|centre|institute|program|initiative)\b/i.test(
    textValue(home.displayName || home.name),
  );
}

function isTrustedResearchHomeWebsite(url: unknown): boolean {
  const value = textValue(url);
  return (
    /^https?:\/\//i.test(value) &&
    !/\/profile\//i.test(value) &&
    !/(?:orcid\.org|reporter\.nih\.gov|api\.nsf\.gov|nsf\.gov\/awardsearch|pubmed\.ncbi\.nlm\.nih\.gov|openalex\.org|api\.openalex\.org)/i.test(
      value,
    )
  );
}

function hasUsefulResearchSummary(value: unknown): boolean {
  const summary = textValue(value);
  if (summary.length < 80) return false;
  if (/\b(?:i have|my research|my lab|my group|our research|our lab|our group)\b/i.test(summary)) {
    return false;
  }
  return /\b(studies|investigates|examines|explores|focuses on|works on|develops|combines|integrates|applies|uses|employs|researches|analyzes|models)\b/i.test(
    summary,
  );
}

function homeFallbackBucketForProfile(
  profile: ProfessorBioCoverageInput,
): ProfessorBioHomeFallbackBucket {
  if (profile.sameNameContaminated) return 'same_name_contaminated';

  const homes = profile.researchHomes || [];
  if (homes.length === 0) return 'no_trusted_research_home';
  if (homes.every((home) => isIndividualResearchHome(home, profile.name))) {
    return 'individual_or_person_named_home_only';
  }

  const concreteLeadHomes = homes.filter(
    (home) => isLeadRole(home.role) && !isIndividualResearchHome(home, profile.name),
  );
  if (concreteLeadHomes.length === 0) return 'no_trusted_research_home';
  const homesWithWebsite = concreteLeadHomes.filter((home) =>
    isTrustedResearchHomeWebsite(home.websiteUrl || home.website),
  );
  if (homesWithWebsite.length === 0) return 'no_trusted_research_home_website';
  if (!homesWithWebsite.some((home) => hasUsefulResearchSummary(home.summary))) {
    return 'no_useful_research_home_summary';
  }

  return 'no_public_bio_despite_fallback_candidate';
}

function nonProfessorTitleExclusionReason(
  profile: ProfessorBioCoverageInput,
): ProfessorBioCoverageRow['exclusionReason'] | undefined {
  const title = textValue(profile.title);
  if (!title) return undefined;
  if (/\bprofessor\b/i.test(title)) return undefined;
  const normalizedTitle = title.toLowerCase();
  if (
    /\b(?:postdoctoral|postdoc)\b/i.test(title) ||
    /^research affiliates?\b/.test(normalizedTitle) ||
    /^(?:associate |assistant |senior )?research scientist\b/.test(normalizedTitle) ||
    /^(?:senior |full-part-time )?lecturer\b/.test(normalizedTitle) ||
    /^visiting undergrad\b/.test(normalizedTitle) ||
    /^(?:undergraduate|graduate|medical) student\b/.test(normalizedTitle) ||
    /^student researcher\b/.test(normalizedTitle)
  ) {
    return 'non_professor_title';
  }
  return undefined;
}

function statusForProfile(
  profile: ProfessorBioCoverageInput,
  minBioLength: number,
  maxBioLength: number,
): ProfessorBioCoverageRow['status'] {
  if (profile.sameNameContaminated) return 'same_name_contaminated';
  const bioLength = textValue(profile.publicBio).length;
  if (bioLength === 0) return 'missing';
  if (bioLength < minBioLength) return 'short';
  if (bioLength > maxBioLength) return 'overlong';
  return 'decent';
}

export function buildProfessorBioCoverageAudit(
  profiles: ProfessorBioCoverageInput[],
  options: ProfessorBioCoverageAuditOptions = {},
): ProfessorBioCoverageAudit {
  const minBioLength = options.minBioLength ?? DEFAULT_MIN_BIO_LENGTH;
  const maxBioLength = options.maxBioLength ?? DEFAULT_MAX_BIO_LENGTH;
  const sampleLimit = options.sampleLimit ?? 25;
  const sourceBuckets = emptySourceBuckets();
  const homeFallbackBuckets: Partial<Record<ProfessorBioHomeFallbackBucket, number>> = {};
  const rows: ProfessorBioCoverageRow[] = [];
  const counts = {
    total: 0,
    decentBio: 0,
    weakBio: 0,
    missingBio: 0,
    shortBio: 0,
    overlongBio: 0,
    sameNameContaminated: 0,
    excludedNonProfessor: 0,
  };

  for (const profile of profiles) {
    const exclusionReason = nonProfessorTitleExclusionReason(profile);
    if (exclusionReason) {
      counts.excludedNonProfessor += 1;
      const sourceBucket = sourceBucketForProfile(profile);
      if (rows.length < sampleLimit) {
        rows.push({
          id: profile.id,
          netid: profile.netid,
          name: profile.name,
          title: textValue(profile.title) || undefined,
          bioLength: textValue(profile.publicBio).length,
          status: 'excluded_non_professor',
          exclusionReason,
          sourceBucket,
          profileUrls: uniqueStrings([
            profile.website,
            profile.websiteUrl,
            ...profileUrlValues(profile.profileUrls),
          ]),
          researchHomes: (profile.researchHomes || []).slice(0, 5).map((home) => ({
            name: textValue(home.displayName || home.name),
            role: home.role,
            websiteUrl: textValue(home.websiteUrl || home.website) || undefined,
          })),
        });
      }
      continue;
    }

    counts.total += 1;
    const status = statusForProfile(profile, minBioLength, maxBioLength);
    if (status === 'decent') {
      counts.decentBio += 1;
      continue;
    }

    counts.weakBio += 1;
    if (status === 'missing') counts.missingBio += 1;
    if (status === 'short') counts.shortBio += 1;
    if (status === 'overlong') counts.overlongBio += 1;
    if (status === 'same_name_contaminated') {
      counts.sameNameContaminated += 1;
      counts.missingBio += 1;
    }

    const sourceBucket = sourceBucketForProfile(profile);
    sourceBuckets[sourceBucket] += 1;
    const homeFallbackBucket =
      status === 'missing' || status === 'same_name_contaminated'
        ? homeFallbackBucketForProfile(profile)
        : undefined;
    if (homeFallbackBucket) {
      homeFallbackBuckets[homeFallbackBucket] =
        (homeFallbackBuckets[homeFallbackBucket] || 0) + 1;
    }

    if (rows.length < sampleLimit) {
      rows.push({
        id: profile.id,
        netid: profile.netid,
        name: profile.name,
        title: textValue(profile.title) || undefined,
        bioLength: textValue(profile.publicBio).length,
        status,
        sourceBucket,
        homeFallbackBucket,
        profileUrls: uniqueStrings([
          profile.website,
          profile.websiteUrl,
          ...profileUrlValues(profile.profileUrls),
        ]),
        researchHomes: (profile.researchHomes || []).slice(0, 5).map((home) => ({
          name: textValue(home.displayName || home.name),
          role: home.role,
          websiteUrl: textValue(home.websiteUrl || home.website) || undefined,
        })),
      });
    }
  }

  return { counts, sourceBuckets, homeFallbackBuckets, rows };
}
