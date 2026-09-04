import {
  isBoilerplatePlatformHostUrl,
  isFileShareOrDocumentUrl,
  isListingOrIndexUrl,
  isMultiTenantAcademicHostRootUrl,
  isPersonProfileOrDirectoryUrl,
  sourceUrlToResearchHomeWebsiteUrl,
  type ResearchEntityHostOwnerIdentity,
} from '../utils/researchHomeWebsiteUrl';

export interface WebsiteUrlBackfillCandidateEntity {
  websiteUrl?: unknown;
  website?: unknown;
  sourceUrls?: unknown;
  name?: unknown;
  displayName?: unknown;
  entityType?: unknown;
  kind?: unknown;
}

const URL_MAXLENGTH = 2048;

const GRANT_OR_IDENTIFIER_HOST =
  /(^|\.)(reporter\.nih\.gov|nih\.gov|nsf\.gov|osti\.gov|orcid\.org|scholar\.google\.com|doi\.org)$/i;

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

export function isMultiTenantHostRootWebsiteUrl(
  value: unknown,
  entity?: ResearchEntityHostOwnerIdentity,
): boolean {
  return isMultiTenantAcademicHostRootUrl(value, entity);
}

export function isPromotableWebsiteUrl(
  value: unknown,
  entity?: ResearchEntityHostOwnerIdentity,
): boolean {
  return (
    isPublicHttpUrl(value) &&
    !isGrantOrIdentifierUrl(value) &&
    !isContentPageUrl(value) &&
    !isProfilePageWebsiteUrl(value) &&
    !isListingPageWebsiteUrl(value) &&
    !isBoilerplateHostWebsiteUrl(value) &&
    !isFileShareOrDocumentWebsiteUrl(value) &&
    !isMultiTenantHostRootWebsiteUrl(value, entity)
  );
}

/**
 * A stored `websiteUrl` that can never be served as an entity's research home,
 * so it is re-picked from evidence when evidence has a real one and otherwise
 * cleared. Distinct from the profile-page case, which falls back to keeping the
 * profile as a PI link rather than clearing.
 */
export function isUnservableWebsiteUrl(
  value: unknown,
  entity?: ResearchEntityHostOwnerIdentity,
): boolean {
  return (
    isListingPageWebsiteUrl(value) ||
    isBoilerplateHostWebsiteUrl(value) ||
    isFileShareOrDocumentWebsiteUrl(value) ||
    isMultiTenantHostRootWebsiteUrl(value, entity)
  );
}

export function hasUsableWebsiteUrl(entity: WebsiteUrlBackfillCandidateEntity): boolean {
  return isPublicHttpUrl(entity.websiteUrl);
}

function selectResearchHomeWebsiteUrl(
  candidates: unknown[],
  entity?: ResearchEntityHostOwnerIdentity,
): string | undefined {
  for (const candidate of candidates) {
    if (!isPromotableWebsiteUrl(candidate, entity)) continue;
    const url = sourceUrlToResearchHomeWebsiteUrl(candidate, entity);
    if (url) return url;
  }
  return undefined;
}

const websiteUrlLedgerKey = (value: unknown): string =>
  typeof value === 'string' ? value.trim().replace(/\/+$/, '').toLowerCase() : '';

function isWebsiteUrlAlreadyCitedAsEvidence(
  entity: WebsiteUrlBackfillCandidateEntity,
  candidates: unknown[],
): boolean {
  const key = websiteUrlLedgerKey(entity.websiteUrl);
  if (!key) return false;
  return candidates.some((candidate) => websiteUrlLedgerKey(candidate) === key);
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
 * bare `.pdf`/`.doc(x)`/`.ppt(x)`/`.xls(x)` links) and the roots of shared academic
 * hosts that publish one page per tenant under `~user` are never promoted, so a
 * listing, profile, boilerplate, non-navigable file, or shared-host page can never
 * beat a real lab site.
 * An entity whose existing `websiteUrl` is unservable as a research home - a
 * listing/index page (including `/people/members`, `/people/index`, and other
 * people-roster/index subpages), a boilerplate platform host, a shared
 * multi-tenant host root, or a file-share/document link - is corrected to a genuine
 * research home / lab site when one exists in its evidence, and otherwise cleared
 * (fail closed to no website rather than an off-site, directory-index, or dead/non-navigable
 * file link). A single-person
 * profile-page `websiteUrl` is corrected to a research home when one exists; when none
 * does it is cleared if that same URL is already cited in the entity's own evidence,
 * and kept as a PI fallback only when clearing would drop the URL entirely.
 * The materializer projects a lead's official profile page onto `sourceUrls` (#613)
 * and the detail page renders that as the official-profile CTA, so a profile URL that
 * is already cited there reaches the student either way; keeping it as `websiteUrl` too
 * only made an entity advertise a "Website" that was its PI's profile page under a
 * second label (#2352). Any other usable `websiteUrl` is kept.
 * When no usable `websiteUrl` exists, the first promotable candidate (`website`
 * then ordered `sourceUrls`) is used.
 * The entity's own shape and `name`/`displayName` are consulted only so a shared
 * academic host's own organization keeps its root as its website instead of being
 * stripped along with its tenants. A person-scoped entity is never eligible, so a
 * grafted organization name cannot buy one an exemption.
 */
export function resolveBackfillWebsiteUrl(
  entity: WebsiteUrlBackfillCandidateEntity,
): WebsiteUrlBackfillResolution {
  const candidates: unknown[] = [
    entity.website,
    ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : []),
  ];
  const hostOwnerIdentity: ResearchEntityHostOwnerIdentity = {
    name: entity.name,
    displayName: entity.displayName,
    entityType: entity.entityType,
    kind: entity.kind,
  };
  if (hasUsableWebsiteUrl(entity)) {
    if (isUnservableWebsiteUrl(entity.websiteUrl, hostOwnerIdentity)) {
      const researchHome = selectResearchHomeWebsiteUrl(candidates, hostOwnerIdentity);
      return researchHome ? { action: 'set', websiteUrl: researchHome } : { action: 'clear' };
    }
    if (isProfilePageWebsiteUrl(entity.websiteUrl)) {
      const researchHome = selectResearchHomeWebsiteUrl(candidates, hostOwnerIdentity);
      if (researchHome) return { action: 'set', websiteUrl: researchHome };
      return isWebsiteUrlAlreadyCitedAsEvidence(entity, candidates)
        ? { action: 'clear' }
        : { action: 'keep' };
    }
    return { action: 'keep' };
  }
  const promotable = candidates.find((candidate) =>
    isPromotableWebsiteUrl(candidate, hostOwnerIdentity),
  );
  const cleaned = promotable ? cleanString(promotable) : undefined;
  return cleaned ? { action: 'set', websiteUrl: cleaned } : { action: 'keep' };
}

export function selectBackfillWebsiteUrl(
  entity: WebsiteUrlBackfillCandidateEntity,
): string | undefined {
  const resolution = resolveBackfillWebsiteUrl(entity);
  return resolution.action === 'set' ? resolution.websiteUrl : undefined;
}
