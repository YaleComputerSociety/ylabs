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

const parsedYaleProfileUrl = (value: unknown): URL | undefined => {
  if (!isYaleOfficialProfileUrl(value)) return undefined;
  try {
    return new URL(cleanString(value) as string);
  } catch {
    return undefined;
  }
};

const normalizedProfilePath = (url: URL): string => url.pathname.replace(/\/+$/, '').toLowerCase();

const isCmsProfilePath = (url: URL): boolean =>
  /^\/profile\/[^/]+$/.test(normalizedProfilePath(url));

/**
 * A Yale department site is the authority on its own person-page path, so when a
 * site moves a person from a directory path onto the canonical CMS `/profile/<slug>`
 * page the stored link is a dead end and must yield. The move is only ever accepted
 * in that direction on the same host, which keeps two roster pages on different
 * hosts from overwriting each other's link every sweep.
 */
export function supersedesOfficialProfileUrl(priorUrl: unknown, nextUrl: unknown): boolean {
  const prior = parsedYaleProfileUrl(priorUrl);
  const next = parsedYaleProfileUrl(nextUrl);
  if (!prior || !next) return false;
  if (prior.hostname.toLowerCase() !== next.hostname.toLowerCase()) return false;
  if (normalizedProfilePath(prior) === normalizedProfilePath(next)) return false;
  return isCmsProfilePath(next) && !isCmsProfilePath(prior);
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
