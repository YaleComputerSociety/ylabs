import {
  isPersonScopedResearchEntity,
  isUmbrellaOrganizationName,
  namesAServiceFacility,
} from '../utils/researchHomeNameIdentityAuthority';
import { resolveBackfillWebsiteUrl } from './backfillResearchEntityWebsiteUrlsCore';

export interface OrganizationIdentityWebsite {
  slug: string;
  name?: string;
  entityType?: string;
  websiteUrl: string;
}

export interface PersonScopedWebsiteRow {
  slug?: unknown;
  name?: unknown;
  displayName?: unknown;
  entityType?: unknown;
  kind?: unknown;
  websiteUrl?: unknown;
  website?: unknown;
  sourceUrls?: unknown;
  manuallyLockedFields?: unknown;
}

/**
 * The URL the row would SERVE, which is what the lane has to judge.
 *
 * A row whose slot this lane already cleared is not repaired: the borrowed page is
 * still in its `website` field and `sourceUrls`, and `resolveBackfillWebsiteUrl`
 * promotes the first promotable candidate back into an empty slot on the next
 * materialization. Keying on the stored `websiteUrl` alone makes the lane go blind
 * on exactly the rows a previous run touched, so an unlocked clear is never
 * converged and the graft returns. Keying on what would be promoted is a probe of
 * the row's current state rather than a record of the previous run's plan.
 */
export function effectiveWebsiteUrl(row: PersonScopedWebsiteRow): string {
  const stored = typeof row.websiteUrl === 'string' ? row.websiteUrl.trim() : '';
  if (stored) return stored;
  const resolution = resolveBackfillWebsiteUrl(row as never);
  return resolution.action === 'set' ? resolution.websiteUrl : '';
}

export interface OrganizationIdentityWebsiteGraftPlan {
  graftedWebsiteUrl: string;
  ownerSlug: string;
  ownerEntityType: string;
  resolvedPageKey: string;
}

/** The final URL a candidate URL resolves to, or '' when it was never probed. */
export type ResolvedUrlLookup = (url: string) => string;

/**
 * Whether a candidate owner is an organization by NAME and not only by
 * `entityType`.
 *
 * The type alone is not enough, and this is the guard that decides whether the
 * lane is safe to run in bulk. Measured on Development, the type-only owner set
 * offered `nih-pi-<surname>` rows typed `INITIATIVE`, a `<Surname> Lab` typed
 * `CENTER`, and one person's `faculty-research-area-*` row typed `CENTER` as the
 * owner of that same person's other row: 10 of 26 planned rows. Clearing a
 * person's website in favour of another person-scoped row is a duplicate-row
 * problem wearing an organization's type, and repairing it here would hand one
 * person's research home to a mis-typed row instead of to an organization.
 *
 * `isUmbrellaOrganizationName` returns false for anything lab-headed by design, so
 * a genuine shared facility ("Yale CryoEM Resource") needs the service-noun test
 * too. Recall is deliberately partial: a real center named "<Name> Laboratory"
 * is refused, which leaves a row unrepaired rather than repairing it wrongly.
 */
export function ownerNameDenotesOrganization(name: unknown): boolean {
  return isUmbrellaOrganizationName(name) || namesAServiceFacility(name);
}

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

function parseHttpUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return /^https?:$/i.test(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

/**
 * The token that names the organization a page belongs to: its terminal path
 * segment, or its own host label when the page is a bare vanity subdomain root.
 *
 * This is only a cheap pre-filter for which rows are worth probing. It is not the
 * ownership test: `/research` is a terminal segment on hundreds of pages, so a
 * token match alone would clear a person's real research page. The decision is
 * always the resolved-page comparison below.
 */
export function organizationWebsiteIdentityToken(value: unknown): string {
  const url = parseHttpUrl(value);
  if (!url) return '';
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length > 0) return segments[segments.length - 1].toLowerCase();
  const labels = url.hostname
    .toLowerCase()
    .replace(/^www\./, '')
    .split('.');
  return labels.length > 2 ? labels[0] : '';
}

/**
 * Host plus path and query, with the scheme, `www.`, fragment and trailing slash
 * dropped, so a vanity host and the canonical path it redirects to compare equal once
 * both have been resolved.
 *
 * The query is part of the page's identity and is kept. Folding it is what the
 * vanity-host comparison needs nothing of, and dropping it would make
 * `/unit?id=5` and `/unit?id=9` one page: the lane would then clear a person's real
 * research page in favour of an organization page it is not.
 */
export function canonicalWebsitePageKey(value: unknown): string {
  const url = parseHttpUrl(value);
  if (!url) return '';
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const pathname = url.pathname.replace(/\/+$/, '');
  return `${host}${pathname}${url.search}`;
}

/**
 * What one person-scoped row needs in order to stop serving an organization's own
 * identity page as its research website.
 *
 * The organization has to already exist in the corpus as its own entity: until it
 * does, clearing the link drops the corpus's only edge to a real research home
 * (#2385), which is exactly why #2529 held these rows back rather than repairing
 * them. Once the organization is a first-class row, the student reaches it there
 * and the person row is free of a website that was never its own.
 *
 * A manually locked `websiteUrl` is left alone: it is either an operator decision, or
 * this lane's own `engine_gap_workaround` lock from a previous apply, which is what
 * makes a second run plan nothing.
 */
export function planOrganizationIdentityWebsiteGraft(
  row: PersonScopedWebsiteRow,
  organizationsByToken: Map<string, OrganizationIdentityWebsite[]>,
  resolvedUrl: ResolvedUrlLookup,
): OrganizationIdentityWebsiteGraftPlan | null {
  const websiteUrl = effectiveWebsiteUrl(row);
  if (!websiteUrl) return null;
  if (!isPersonScopedResearchEntity(row)) return null;
  if (stringList(row.manuallyLockedFields).includes('websiteUrl')) return null;

  const token = organizationWebsiteIdentityToken(websiteUrl);
  if (!token) return null;
  const rowPageKey = canonicalWebsitePageKey(resolvedUrl(websiteUrl) || websiteUrl);
  if (!rowPageKey) return null;

  const owner = (organizationsByToken.get(token) || []).find(
    (organization) =>
      organization.slug !== row.slug &&
      ownerNameDenotesOrganization(organization.name) &&
      canonicalWebsitePageKey(resolvedUrl(organization.websiteUrl) || organization.websiteUrl) ===
        rowPageKey,
  );
  if (!owner) return null;

  return {
    graftedWebsiteUrl: websiteUrl,
    ownerSlug: owner.slug,
    ownerEntityType: owner.entityType || '',
    resolvedPageKey: rowPageKey,
  };
}

/**
 * The observation fields that can put a URL in a row's `websiteUrl` slot.
 * `officialProfilePiBackfillScraper` emits `website` and `websiteUrl` as a pair with
 * the same value, and `resolveBackfillWebsiteUrl` promotes `website` into the slot
 * once `websiteUrl` is empty, so querying only `websiteUrl` leaves half the
 * assertion live.
 */
export const ORGANIZATION_IDENTITY_WEBSITE_OBSERVATION_FIELDS = ['websiteUrl', 'website'] as const;

/**
 * Whether a stored observation is an assertion that puts the organization's page in
 * this row's `websiteUrl` slot. Clearing the document field alone leaves the
 * assertion live and the next materialize pass re-projects it (#2542).
 *
 * Decided on the resolved page rather than on the stored string, for the reason the
 * whole lane exists: a row can carry a live vanity-host assertion and a live
 * canonical-path assertion for one page, and superseding only the current confidence
 * winner hands the slot to the runner-up on the next pass.
 */
export function isOrganizationIdentityWebsiteObservation(
  field: unknown,
  value: unknown,
  plan: OrganizationIdentityWebsiteGraftPlan,
  resolvedUrl: ResolvedUrlLookup,
): boolean {
  if (
    typeof field !== 'string' ||
    !(ORGANIZATION_IDENTITY_WEBSITE_OBSERVATION_FIELDS as readonly string[]).includes(field)
  ) {
    return false;
  }
  const url = typeof value === 'string' ? value.trim() : '';
  if (!url) return false;
  if (url === plan.graftedWebsiteUrl) return true;
  return canonicalWebsitePageKey(resolvedUrl(url) || url) === plan.resolvedPageKey;
}

/**
 * The URLs the lane must probe: every candidate row website whose identity token
 * matches an organization's, plus those organizations' own websites.
 *
 * Mirrors every refusal `planOrganizationIdentityWebsiteGraft` applies before it
 * compares resolved pages, the locked slot included. Probing is a serial network walk,
 * so a refusal the probe set does not share means each row this lane has already
 * locked is fetched again on every later run and then plans nothing.
 */
export function urlsToResolve(
  rows: PersonScopedWebsiteRow[],
  organizationsByToken: Map<string, OrganizationIdentityWebsite[]>,
): string[] {
  const urls = new Set<string>();
  for (const row of rows) {
    const websiteUrl = effectiveWebsiteUrl(row);
    if (!websiteUrl || !isPersonScopedResearchEntity(row)) continue;
    if (stringList(row.manuallyLockedFields).includes('websiteUrl')) continue;
    const owners = organizationsByToken.get(organizationWebsiteIdentityToken(websiteUrl)) || [];
    if (owners.every((organization) => organization.slug === row.slug)) continue;
    urls.add(websiteUrl);
    for (const organization of owners) urls.add(organization.websiteUrl);
  }
  return [...urls];
}

export function organizationsByIdentityToken(
  organizations: OrganizationIdentityWebsite[],
): Map<string, OrganizationIdentityWebsite[]> {
  const byToken = new Map<string, OrganizationIdentityWebsite[]>();
  for (const organization of organizations) {
    const token = organizationWebsiteIdentityToken(organization.websiteUrl);
    if (!token) continue;
    byToken.set(token, [...(byToken.get(token) || []), organization]);
  }
  return byToken;
}
