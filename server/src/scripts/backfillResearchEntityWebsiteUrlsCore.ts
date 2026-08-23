import {
  isBoilerplatePlatformHostUrl,
  isFileShareOrDocumentUrl,
  isListingOrIndexUrl,
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

export function isListingPageWebsiteUrl(value: unknown): boolean {
  return isListingOrIndexUrl(value);
}

export function isBoilerplateHostWebsiteUrl(value: unknown): boolean {
  return isBoilerplatePlatformHostUrl(value);
}

export function isFileShareOrDocumentWebsiteUrl(value: unknown): boolean {
  return isFileShareOrDocumentUrl(value);
}

export function isPromotableWebsiteUrl(value: unknown): boolean {
  return (
    isPublicHttpUrl(value) &&
    !isGrantOrIdentifierUrl(value) &&
    !isContentPageUrl(value) &&
    !isProfilePageWebsiteUrl(value) &&
    !isListingPageWebsiteUrl(value) &&
    !isBoilerplateHostWebsiteUrl(value) &&
    !isFileShareOrDocumentWebsiteUrl(value)
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

export type WebsiteUrlBackfillResolution =
  | { action: 'keep' }
  | { action: 'set'; websiteUrl: string }
  | { action: 'clear' };

/**
 * Deterministic, evidence-first resolution of a website URL from the entity's
 * materialized evidence. Grant/identifier hosts, article/news content pages, Yale
 * profile / faculty-directory / people-directory pages, directory/index/roster
 * listing pages (A-Z index, `?page=N` paginated listings, faceted/section-index
 * roots, bare `/people`, `/people/faculty`, `/faculty` roots), and generic
 * CMS/platform boilerplate hosts (e.g. `wordpress.org` "Powered by" footer links)
 * and file-share/direct-document hosts (Google Drive/Docs, Dropbox, Box, OneDrive,
 * bare `.pdf`/`.doc(x)`/`.ppt(x)`/`.xls(x)` links) are never promoted, so a listing,
 * profile, boilerplate, or non-navigable file page can never beat a real lab site.
 * An entity whose existing `websiteUrl` is a listing/index page (including
 * `/people/members`, `/people/index`, and other people-roster/index subpages), a
 * boilerplate platform host, or a file-share/document link is corrected to a genuine
 * research home / lab site when one exists in its evidence, and otherwise cleared
 * (fail closed to no website rather than an off-site, directory-index, or dead/non-navigable
 * file link). A single-person
 * profile-page `websiteUrl` is corrected to a research home when one exists and
 * otherwise kept as a PI fallback. Any other usable `websiteUrl` is kept.
 * When no usable `websiteUrl` exists, the first promotable candidate (`website`
 * then ordered `sourceUrls`) is used.
 */
export function resolveBackfillWebsiteUrl(
  entity: WebsiteUrlBackfillCandidateEntity,
): WebsiteUrlBackfillResolution {
  const candidates: unknown[] = [
    entity.website,
    ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : []),
  ];
  if (hasUsableWebsiteUrl(entity)) {
    if (isListingPageWebsiteUrl(entity.websiteUrl)) {
      const researchHome = selectResearchHomeWebsiteUrl(candidates);
      return researchHome ? { action: 'set', websiteUrl: researchHome } : { action: 'clear' };
    }
    if (isBoilerplateHostWebsiteUrl(entity.websiteUrl)) {
      const researchHome = selectResearchHomeWebsiteUrl(candidates);
      return researchHome ? { action: 'set', websiteUrl: researchHome } : { action: 'clear' };
    }
    if (isFileShareOrDocumentWebsiteUrl(entity.websiteUrl)) {
      const researchHome = selectResearchHomeWebsiteUrl(candidates);
      return researchHome ? { action: 'set', websiteUrl: researchHome } : { action: 'clear' };
    }
    if (isProfilePageWebsiteUrl(entity.websiteUrl)) {
      const researchHome = selectResearchHomeWebsiteUrl(candidates);
      return researchHome ? { action: 'set', websiteUrl: researchHome } : { action: 'keep' };
    }
    return { action: 'keep' };
  }
  const promotable = candidates.find(isPromotableWebsiteUrl);
  const cleaned = promotable ? cleanString(promotable) : undefined;
  return cleaned ? { action: 'set', websiteUrl: cleaned } : { action: 'keep' };
}

export function selectBackfillWebsiteUrl(
  entity: WebsiteUrlBackfillCandidateEntity,
): string | undefined {
  const resolution = resolveBackfillWebsiteUrl(entity);
  return resolution.action === 'set' ? resolution.websiteUrl : undefined;
}
