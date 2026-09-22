import { isExternalScholarlyPlatformHost } from '../utils/externalScholarlyPlatforms';
import {
  isBoilerplatePlatformHostUrl,
  isDepartmentRosterProvenanceUrl,
  isFileShareOrDocumentUrl,
  isInstitutionalAdvancementUrl,
  isListingOrIndexUrl,
  isMultiTenantAcademicHostRootUrl,
  isPersonProfileOrDirectoryUrl,
  isProgrammePageCitedByPerson,
  isSharedPeopleRosterUrl,
  isUmbrellaPageCitedByPerson,
  sourceUrlToResearchHomeWebsiteUrl,
  type ResearchEntityHostOwnerIdentity,
} from '../utils/researchHomeWebsiteUrl';
import { normalizeWebsiteUrlIdentityKey } from './researchEntityPiDedupeCore';

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

export function isInstitutionalAdvancementWebsiteUrl(value: unknown): boolean {
  return isInstitutionalAdvancementUrl(value);
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

const PERSON_SCOPED_RESEARCH_HOME_TYPES: ReadonlySet<string> = new Set([
  'LAB',
  'FACULTY_RESEARCH_AREA',
  'FACULTY_PROJECT',
  'FACULTY_RESEARCH',
  'INDIVIDUAL_RESEARCH',
]);

/**
 * A faculty roster or members list is legitimate evidence about the department or
 * centre that publishes it, and a graft on a person's row. `retireGraftedDirectoryUrls`
 * removes these, but the promotion path never refused them, so the engine restored the
 * value on the next materialization and the repair had to run again: a churn loop
 * rather than a fix (#2708).
 *
 * Refusing 0 of the 1,976 stored `websiteUrl` values on Development, so this is
 * preventive only. It blocks the two rows a dry run would otherwise have pointed at
 * one institute's members list.
 */
export function isRosterPageWebsiteUrlForPerson(
  value: unknown,
  entity?: ResearchEntityHostOwnerIdentity,
): boolean {
  const entityType = typeof entity?.entityType === 'string' ? entity.entityType : '';
  if (!PERSON_SCOPED_RESEARCH_HOME_TYPES.has(entityType)) return false;
  const url = cleanString(value);
  if (!url) return false;
  return isSharedPeopleRosterUrl(url) || isDepartmentRosterProvenanceUrl(url);
}

export function isPromotableWebsiteUrl(
  value: unknown,
  entity?: ResearchEntityHostOwnerIdentity,
): boolean {
  return (
    isPublicHttpUrl(value) &&
    !isGrantOrIdentifierUrl(value) &&
    !isContentPageUrl(value) &&
    !isInstitutionalAdvancementWebsiteUrl(value) &&
    !isProfilePageWebsiteUrl(value) &&
    !isListingPageWebsiteUrl(value) &&
    !isBoilerplateHostWebsiteUrl(value) &&
    !isFileShareOrDocumentWebsiteUrl(value) &&
    !isMultiTenantHostRootWebsiteUrl(value, entity) &&
    !isRosterPageWebsiteUrlForPerson(value, entity) &&
    // A department's programme or training-opportunities page describes what the
    // department offers, and is a graft on a person's row. Already scoped by who cites
    // it, so the page stays valid evidence for the department itself (#2708).
    !isProgrammePageCitedByPerson(value, entity) &&
    // A research group's host root or a department's audience-recruitment page names a
    // collective. The serve-time gate hides one, but promotion is where the value comes
    // from: without this arm the resolver re-fills a cleared slot from `sourceUrls` on
    // the next materialization and the repair undoes itself (#2579, #2708).
    !isUmbrellaPageCitedByPerson(value, entity)
  );
}

/**
 * A stored `websiteUrl` that can never be served as an entity's research home,
 * so it is re-picked from evidence when evidence has a real one and otherwise
 * cleared unconditionally. Distinct from the profile-page case, which clears only
 * when the entity already cites the same destination and otherwise keeps the
 * profile as a PI link.
 */
export function isUnservableWebsiteUrl(
  value: unknown,
  entity?: ResearchEntityHostOwnerIdentity,
): boolean {
  return (
    isListingPageWebsiteUrl(value) ||
    isInstitutionalAdvancementWebsiteUrl(value) ||
    isBoilerplateHostWebsiteUrl(value) ||
    isFileShareOrDocumentWebsiteUrl(value) ||
    isExternalScholarlyPlatformWebsiteUrl(value) ||
    isMultiTenantHostRootWebsiteUrl(value, entity) ||
    isUmbrellaPageCitedByPerson(value, entity)
  );
}

/**
 * A citation index or social profile is where a person's output is listed, never
 * the research home itself.
 *
 * `sourceUrlToResearchHomeWebsiteUrl` has refused these hosts as a PROMOTION
 * candidate for some time, so one could never be picked out of `sourceUrls`. It was
 * still reachable as a stored value, because a `websiteUrl` observation goes to the
 * resolver without passing through that function: `ysm-faculty-directory` and
 * `official-profile-pi-backfill` both emit the profile's Google Scholar link as a
 * `websiteUrl`, and on Development 3 live entities stored one. Listing it here is
 * what makes a stored one get re-picked from evidence or cleared (#2285).
 */
function isExternalScholarlyPlatformWebsiteUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    return isExternalScholarlyPlatformHost(new URL(value.trim()).hostname);
  } catch {
    return false;
  }
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

const websiteUrlDestinationKey = (value: unknown): string =>
  typeof value === 'string' ? normalizeWebsiteUrlIdentityKey(value).toLowerCase() : '';

/**
 * Whether clearing `websiteUrl` still leaves the student a way to that destination.
 * Only `sourceUrls` counts as a citation: the detail page renders `websiteUrl` and
 * `sourceUrls`, never the legacy `website` field, so a `website`-only match would
 * drop the URL off the page entirely. A department-roster provenance shape does not
 * count either, because the detail page drops those from both the Sources list and
 * the official-profile CTA.
 */
function isWebsiteUrlAlreadyCitedAsRenderedEvidence(
  entity: WebsiteUrlBackfillCandidateEntity,
): boolean {
  if (isDepartmentRosterProvenanceUrl(entity.websiteUrl)) return false;
  const key = websiteUrlDestinationKey(entity.websiteUrl);
  if (!key) return false;
  const sourceUrls = Array.isArray(entity.sourceUrls) ? entity.sourceUrls : [];
  return sourceUrls.some((candidate) => websiteUrlDestinationKey(candidate) === key);
}

export type WebsiteUrlBackfillResolution =
  { action: 'keep' } | { action: 'set'; websiteUrl: string } | { action: 'clear' };

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
 * does it is cleared if the same destination is already cited in the entity's own
 * `sourceUrls`, and kept as a PI fallback only when clearing would drop the URL entirely.
 * The materializer projects a lead's official profile page onto `sourceUrls` (#613)
 * and the detail page renders that as the official-profile CTA, so a profile URL that
 * is already cited there reaches the student either way; keeping it as `websiteUrl` too
 * only made an entity advertise a "Website" that was its PI's profile page under a
 * second label (#2352). The citation match folds scheme, `www.`, trailing slash, and
 * case, and it ignores citations the detail page refuses to render (the legacy `website`
 * field, department-roster provenance pages) so clearing never leaves an entity with no
 * link at all. Any other usable `websiteUrl` is kept.
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
      return isWebsiteUrlAlreadyCitedAsRenderedEvidence(entity)
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
