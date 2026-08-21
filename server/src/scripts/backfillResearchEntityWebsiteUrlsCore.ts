import {
  isProfileOrDirectoryPageUrl,
  resolveSourceUrlResearchHomeUrl,
} from '../scrapers/utils/researchHomeUrlClassification';

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
  return isPublicHttpUrl(value) && isProfileOrDirectoryPageUrl(cleanString(value));
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

/**
 * Resolves a candidate to the canonical real research-home site URL to promote, or
 * undefined. Layers the coarse promotable gate (rejects non-http, grant/identifier,
 * article/news content, and profile/directory pages) over the shared research-home
 * resolver (which additionally rejects membership/opportunity listings and generic
 * pages, and canonicalizes the URL), so a promoted `websiteUrl` is always a real site.
 */
function resolvePromotableWebsiteUrl(value: unknown): string | undefined {
  if (!isPromotableWebsiteUrl(value)) return undefined;
  return resolveSourceUrlResearchHomeUrl(value) || undefined;
}

function firstPromotableCandidate(entity: WebsiteUrlBackfillCandidateEntity): string | undefined {
  const candidates: unknown[] = [
    entity.website,
    ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : []),
  ];
  for (const candidate of candidates) {
    const resolved = resolvePromotableWebsiteUrl(candidate);
    if (resolved) return resolved;
  }
  return undefined;
}

/**
 * Deterministic, evidence-first selection of a website URL already present in the
 * entity's materialized evidence. Prefers the `website` field, then the ordered
 * `sourceUrls`. Grant/identifier hosts, article/news content pages, and Yale
 * profile / faculty-directory / people-directory pages are never promoted, so a
 * real lab site wins over a profile page regardless of ordering. An entity that
 * already has a usable `websiteUrl` is left untouched.
 */
export function selectBackfillWebsiteUrl(
  entity: WebsiteUrlBackfillCandidateEntity,
): string | undefined {
  if (hasUsableWebsiteUrl(entity)) return undefined;
  return firstPromotableCandidate(entity);
}

/**
 * Corrective selection for an entity whose current `websiteUrl` is a Yale profile /
 * faculty-directory / people-directory page. Returns the first real lab-site candidate
 * from the entity's evidence so the profile URL can be demoted in favor of it. Returns
 * undefined when the current `websiteUrl` is not a profile page or when no better
 * candidate exists.
 */
export function selectCorrectiveWebsiteUrl(
  entity: WebsiteUrlBackfillCandidateEntity,
): string | undefined {
  if (!isProfilePageWebsiteUrl(entity.websiteUrl)) return undefined;
  return firstPromotableCandidate(entity);
}
