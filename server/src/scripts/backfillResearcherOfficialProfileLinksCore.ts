import type { ResearcherProfileLink } from '../models/researcher';

export const OFFICIAL_YALE_PROFILE_URL_KEYS = [
  'official',
  'medicine',
  'ysm',
  'departmental',
  'directory',
  'yalies',
] as const;

export const OFFICIAL_PROFILE_LINK_URL_MAXLENGTH = 2048;

export interface LegacyProfileUrlSource {
  profileUrls?: Record<string, unknown> | null;
}

const cleanString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export function isYaleOfficialProfileUrl(value: unknown): boolean {
  const candidate = cleanString(value);
  if (!candidate || candidate.length > OFFICIAL_PROFILE_LINK_URL_MAXLENGTH) return false;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  return url.hostname === 'yale.edu' || url.hostname.endsWith('.yale.edu');
}

export function selectOfficialYaleProfileUrl(
  profileUrls: Record<string, unknown> | undefined | null,
): string | undefined {
  if (!profileUrls || typeof profileUrls !== 'object') return undefined;
  for (const key of OFFICIAL_YALE_PROFILE_URL_KEYS) {
    const candidate = cleanString(profileUrls[key]);
    if (candidate && isYaleOfficialProfileUrl(candidate)) return candidate;
  }
  for (const candidate of Object.values(profileUrls)) {
    const cleaned = cleanString(candidate);
    if (cleaned && isYaleOfficialProfileUrl(cleaned)) return cleaned;
  }
  return undefined;
}

export function composeOfficialProfileLink(
  source: LegacyProfileUrlSource,
  verifiedAt: Date,
): ResearcherProfileLink | undefined {
  const url = selectOfficialYaleProfileUrl(source.profileUrls);
  if (!url) return undefined;
  return {
    kind: 'YALE_OFFICIAL',
    purpose: 'PRIMARY_IDENTITY',
    url,
    verifiedAt,
    healthStatus: 'UNKNOWN',
  };
}

export function officialProfileLinkFillUpdate(
  existing: readonly ResearcherProfileLink[] | undefined,
  composed: ResearcherProfileLink | undefined,
): ResearcherProfileLink | undefined {
  if (!composed) return undefined;
  if (Array.isArray(existing) && existing.some((link) => link?.kind === 'YALE_OFFICIAL')) {
    return undefined;
  }
  return composed;
}

export function assertBackfillPushIsOfficialProfileLinkOnly(update: Record<string, unknown>): void {
  const keys = Object.keys(update);
  if (keys.length !== 1 || keys[0] !== 'profileLinks') {
    throw new Error(
      `backfill:researcher-official-profile-links invariant violated: push touches "${keys.join(
        ', ',
      )}" instead of only "profileLinks".`,
    );
  }
  const pushed = update.profileLinks as { kind?: unknown } | undefined;
  if (!pushed || pushed.kind !== 'YALE_OFFICIAL') {
    throw new Error(
      'backfill:researcher-official-profile-links invariant violated: pushed link is not YALE_OFFICIAL.',
    );
  }
}
