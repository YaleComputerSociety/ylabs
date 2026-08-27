import type { ResearcherProfileLink } from '../models/researcher';

export const SCHOLAR_PROFILE_LINK_URL_MAXLENGTH = 2048;

export interface LegacyScholarCandidateSource {
  scholarCandidateProfileUrls?: unknown;
}

const cleanString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export function canonicalScholarCitationUrl(value: unknown): string | undefined {
  const candidate = cleanString(value);
  if (!candidate || candidate.length > SCHOLAR_PROFILE_LINK_URL_MAXLENGTH) return undefined;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return undefined;
  }
  if (url.username || url.password) return undefined;
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  if (url.hostname !== 'scholar.google.com') return undefined;
  if (url.pathname !== '/citations') return undefined;
  const scholarUserId = url.searchParams.get('user');
  if (!scholarUserId || !/^[A-Za-z0-9_-]+$/.test(scholarUserId)) return undefined;
  return `https://scholar.google.com/citations?user=${scholarUserId}`;
}

export function selectScholarCitationUrl(
  scholarCandidateProfileUrls: unknown,
): string | undefined {
  if (!Array.isArray(scholarCandidateProfileUrls)) return undefined;
  for (const candidate of scholarCandidateProfileUrls) {
    const canonical = canonicalScholarCitationUrl(candidate);
    if (canonical) return canonical;
  }
  return undefined;
}

export function composeScholarProfileLink(
  source: LegacyScholarCandidateSource,
  verifiedAt: Date,
): ResearcherProfileLink | undefined {
  const url = selectScholarCitationUrl(source.scholarCandidateProfileUrls);
  if (!url) return undefined;
  return {
    kind: 'GOOGLE_SCHOLAR',
    purpose: 'SCHOLARLY',
    url,
    verifiedAt,
    healthStatus: 'UNKNOWN',
  };
}

export function scholarProfileLinkFillUpdate(
  existing: readonly ResearcherProfileLink[] | undefined,
  composed: ResearcherProfileLink | undefined,
): ResearcherProfileLink | undefined {
  if (!composed) return undefined;
  if (Array.isArray(existing) && existing.some((link) => link?.kind === 'GOOGLE_SCHOLAR')) {
    return undefined;
  }
  return composed;
}

export function assertBackfillPushIsScholarProfileLinkOnly(update: Record<string, unknown>): void {
  const keys = Object.keys(update);
  if (keys.length !== 1 || keys[0] !== 'profileLinks') {
    throw new Error(
      `backfill:scholar-candidate-profile-links invariant violated: push touches "${keys.join(
        ', ',
      )}" instead of only "profileLinks".`,
    );
  }
  const pushed = update.profileLinks as { kind?: unknown } | undefined;
  if (!pushed || pushed.kind !== 'GOOGLE_SCHOLAR') {
    throw new Error(
      'backfill:scholar-candidate-profile-links invariant violated: pushed link is not GOOGLE_SCHOLAR.',
    );
  }
}
