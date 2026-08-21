import {
  isPersonProfileOrDirectoryUrl,
  sourceUrlToResearchHomeWebsiteUrl,
} from '../utils/researchHomeWebsiteUrl';

export interface WebsiteUrlBackfillCandidateEntity {
  websiteUrl?: unknown;
  website?: unknown;
  sourceUrls?: unknown;
}

const URL_MAXLENGTH = 2048;

const GRANT_OR_IDENTIFIER_HOST =
  /(^|\.)(reporter\.nih\.gov|nih\.gov|nsf\.gov|orcid\.org|scholar\.google\.com|doi\.org)$/i;

const CONTENT_PAGE_PATH =
  /(^|[-/])(blog|blogs|news|events|calendar|newsletter|article|stories|press|podcast|video|webinar)([-/]|$)/i;

const cleanString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= URL_MAXLENGTH ? trimmed : undefined;
};

const parsePublicHttpUrl = (value: unknown): URL | undefined => {
  const candidate = cleanString(value);
  if (!candidate) return undefined;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  if (url.username || url.password) return undefined;
  return url;
};

export function isPublicHttpUrl(value: unknown): boolean {
  return parsePublicHttpUrl(value) !== undefined;
}

export function isGrantOrIdentifierUrl(value: unknown): boolean {
  const url = parsePublicHttpUrl(value);
  if (!url) return false;
  return GRANT_OR_IDENTIFIER_HOST.test(url.hostname);
}

export function isContentPageUrl(value: unknown): boolean {
  const url = parsePublicHttpUrl(value);
  if (!url) return false;
  return CONTENT_PAGE_PATH.test(url.pathname);
}

export function isProfilePageWebsiteUrl(value: unknown): boolean {
  return isPersonProfileOrDirectoryUrl(value);
}

export function isPromotableWebsiteUrl(value: unknown): boolean {
  return (
    isPublicHttpUrl(value) &&
    !isGrantOrIdentifierUrl(value) &&
    !isContentPageUrl(value) &&
    !isProfilePageWebsiteUrl(value)
  );
}

export function hasUsableWebsiteUrl(entity: WebsiteUrlBackfillCandidateEntity): boolean {
  return isPublicHttpUrl(entity.websiteUrl);
}

function selectResearchHomeWebsiteUrl(candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (!isPromotableWebsiteUrl(candidate)) continue;
    const url = sourceUrlToResearchHomeWebsiteUrl(candidate);
    if (url) return url;
  }
  return undefined;
}

/**
 * Deterministic, evidence-first selection of a website URL already present in the
 * entity's materialized evidence. Grant/identifier hosts, article/news content
 * pages, and Yale profile / faculty-directory / people-directory pages are never
 * promoted, so a profile page can never beat a real lab site. An entity whose
 * existing `websiteUrl` is a profile page is corrected only to a genuine research
 * home / lab site (never to a directory or opportunities page) when one exists in
 * its evidence; any other usable `websiteUrl` is left untouched. When no usable
 * `websiteUrl` exists, the first promotable candidate (`website` then ordered
 * `sourceUrls`) is used.
 */
export function selectBackfillWebsiteUrl(
  entity: WebsiteUrlBackfillCandidateEntity,
): string | undefined {
  const candidates: unknown[] = [
    entity.website,
    ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : []),
  ];
  if (hasUsableWebsiteUrl(entity)) {
    if (isProfilePageWebsiteUrl(entity.websiteUrl)) {
      return selectResearchHomeWebsiteUrl(candidates);
    }
    return undefined;
  }
  const promotable = candidates.find(isPromotableWebsiteUrl);
  return promotable ? cleanString(promotable) : undefined;
}
