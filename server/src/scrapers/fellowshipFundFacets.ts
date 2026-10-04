/**
 * A fund's own facets, read from its CommunityForce FundDetails page, outrank another
 * lane's inference of them (#4173).
 *
 * The fund page states Purpose, Term of Award, Current Year of Study, Citizenship and
 * Global Regions as structured fields in Yale's own application system. The fellowships
 * office lane infers the first two from page wording, so on a row it owns the inference
 * stood and the fund's statement was withheld, and the visibility gate, which reads
 * `purpose` as the catalog's own facet, suppressed funds whose page lists Research.
 *
 * The fund's observations sit under the fund's own key, which an owning lane's pass never
 * reads. So every pass over a row that cites one fund page loads that fund's facet
 * observations too, and where the fund states a facet its value replaces every other
 * lane's for that field. Both passes then resolve the same value, which makes this a
 * derivation: it writes nothing on its own and needs no lock.
 *
 * The application window is read the same way (#4412). The fund page is the window's
 * authority on another lane's row, but only the fund's own pass applied that, so a row
 * whose owning lane also states a window took whichever pass ran last.
 */
import {
  FUND_RETIREMENT_FIELD,
  YALE_FELLOWSHIP_DATABASE_SOURCE,
  fundAuthorityFieldsStated,
  fundFacetsDescribeProgram,
} from './fellowshipSourcePrecedence';

export { fundFacetsDescribeProgram };
import { slugify } from './utils/scraperHelpers';
import { isRecordSpecificApplicationPortalUrl } from '../utils/researchHomeWebsiteUrl';

const COMMUNITYFORCE_HOST = 'yale.communityforce.com';

export function normalizeFundDetailUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.protocol = 'https:';
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url;
  }
}

export function fundIdentityKey(url: string): string {
  try {
    const parsed = new URL(normalizeFundDetailUrl(url));
    const params = Array.from(parsed.searchParams.entries())
      .map(([key, value]) => `${key.toLowerCase()}=${value}`)
      .sort();
    const query = params.length > 0 ? params.join('&') : parsed.search.replace(/^\?/, '');
    return `${parsed.pathname.toLowerCase()}?${query}`;
  } catch {
    return url;
  }
}

export function sourceKeyForFund(url: string): string {
  return `${YALE_FELLOWSHIP_DATABASE_SOURCE}:${slugify(fundIdentityKey(url)).slice(0, 90)}`;
}

export function isRecordSpecificFundDetailUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.hostname.toLowerCase() !== COMMUNITYFORCE_HOST) return false;
    if (!/^\/Funds\/FundDetails\.aspx$/i.test(parsed.pathname)) return false;
    return isRecordSpecificApplicationPortalUrl(parsed.toString());
  } catch {
    return false;
  }
}

export function fundKeysCitedByFellowship(
  row: Record<string, any> | null | undefined,
): string[] {
  if (!row) return [];
  const urls = [
    row.sourceUrl,
    row.applicationLink,
    ...(Array.isArray(row.links) ? row.links.map((link: any) => link?.url) : []),
  ].filter((url): url is string => typeof url === 'string' && isRecordSpecificFundDetailUrl(url));
  return [...new Set(urls.map(sourceKeyForFund))];
}

export function fundKeyCitedByFellowship(
  row: Record<string, any> | null | undefined,
): string | null {
  const keys = fundKeysCitedByFellowship(row);
  return keys.length === 1 ? keys[0] : null;
}

const FUND_CITATION_FIELDS = ['title', 'sourceUrl', 'applicationLink', 'links'] as const;

export function fellowshipCitationsObservedIn(
  observations: readonly { field?: unknown; value?: unknown; observedAt?: unknown }[],
): Record<string, unknown> {
  const newestFirst = [...observations].sort(
    (a, b) =>
      new Date((b.observedAt as Date) || 0).getTime() -
      new Date((a.observedAt as Date) || 0).getTime(),
  );
  return Object.fromEntries(
    FUND_CITATION_FIELDS.map((field) => [
      field,
      newestFirst.find((observation) => observation.field === field)?.value,
    ]),
  );
}

export function fundSpeaksForFellowship(
  row: Record<string, any> | null | undefined,
  fundTitle: unknown,
): boolean {
  return fundKeyCitedByFellowship(row) !== null && fundFacetsDescribeProgram(row?.title, fundTitle);
}

interface FacetObservationLike {
  _id?: unknown;
  field?: unknown;
  sourceName?: unknown;
  value?: unknown;
  observedAt?: unknown;
}

export function newestFundRetirement<T extends FacetObservationLike>(
  observations: readonly T[],
): T | undefined {
  const newest = observations
    .filter(
      (observation) =>
        observation.sourceName === YALE_FELLOWSHIP_DATABASE_SOURCE &&
        observation.field === FUND_RETIREMENT_FIELD,
    )
    .sort(
      (a, b) =>
        new Date((b.observedAt as Date) || 0).getTime() -
        new Date((a.observedAt as Date) || 0).getTime(),
    )[0];
  return newest?.value === true ? newest : undefined;
}

export function preferFundFacetObservations<T extends FacetObservationLike>(
  observations: readonly T[],
  fundFacetObservations: readonly T[],
): T[] {
  const preferred = preferFundAuthorityObservations(
    observations,
    fundFacetObservations.filter((observation) => observation.field !== FUND_RETIREMENT_FIELD),
  );
  const retirement = newestFundRetirement(fundFacetObservations);
  if (!retirement) return preferred;
  return [
    ...preferred.filter((observation) => observation.field !== FUND_RETIREMENT_FIELD),
    retirement,
  ];
}

function preferFundAuthorityObservations<T extends FacetObservationLike>(
  observations: readonly T[],
  fundFacetObservations: readonly T[],
): T[] {
  const statedByFund = fundAuthorityFieldsStated(
    fundFacetObservations
      .filter((observation) => observation.sourceName === YALE_FELLOWSHIP_DATABASE_SOURCE)
      .map((observation) => String(observation.field)),
  );
  if (statedByFund.size === 0) return [...observations];
  const included = new Set(observations.map((observation) => String(observation._id)));
  const kept = observations.filter(
    (observation) =>
      !statedByFund.has(String(observation.field)) ||
      observation.sourceName === YALE_FELLOWSHIP_DATABASE_SOURCE,
  );
  const added = fundFacetObservations.filter(
    (observation) =>
      statedByFund.has(String(observation.field)) &&
      observation.sourceName === YALE_FELLOWSHIP_DATABASE_SOURCE &&
      !included.has(String(observation._id)),
  );
  return [...kept, ...added];
}
