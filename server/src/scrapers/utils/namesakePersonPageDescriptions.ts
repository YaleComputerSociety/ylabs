import {
  personPageNameTokensFromUrl,
  personProfileSourceIsADifferentPersonThanCitedOwner,
  type ResearchEntityIdentity,
} from './personProfileEntityMatch';
import { RESEARCH_PAGE_TEXT_FIELD } from './researchPageText';

export const PERSON_DESCRIPTION_EVIDENCE_FIELDS: ReadonlySet<string> = new Set([
  'fullDescription',
  'shortDescription',
  'description',
  'summary',
  'bio',
  'researchInterestSummary',
  'researchSummary',
  RESEARCH_PAGE_TEXT_FIELD,
]);

interface CitingObservation {
  field?: unknown;
  value?: unknown;
  sourceUrl?: unknown;
}

const pageUrlOf = (page: unknown): string =>
  page && typeof page === 'object' && typeof (page as { url?: unknown }).url === 'string'
    ? (page as { url: string }).url
    : '';

function citedUrlsOf(observation: CitingObservation): string[] {
  const urls = [typeof observation.sourceUrl === 'string' ? observation.sourceUrl : ''];
  if (observation.field === RESEARCH_PAGE_TEXT_FIELD && Array.isArray(observation.value)) {
    urls.push(...observation.value.map(pageUrlOf));
  }
  return urls.filter(Boolean);
}

/** Every person page the given observations cite, research page text pages included. */
export function everyCitedPersonPageUrl(observations: readonly CitingObservation[]): string[] {
  return [
    ...new Set(
      observations.flatMap(citedUrlsOf).filter((url) => personPageNameTokensFromUrl(url) !== null),
    ),
  ];
}

/**
 * The identity the namesake screen arbitrates with (#5764): every person page the row's own
 * live observations cite, beside the citations it has committed to. The committed list alone
 * can hold only the namesake's page once a lane has copied it there, and then the screen
 * finds no other owner to compare against.
 */
export function identityWithPersonPageUrls(
  entity: ResearchEntityIdentity,
  personPageUrls: readonly string[],
): ResearchEntityIdentity {
  const committed = Array.isArray(entity.citedPersonPageUrls)
    ? entity.citedPersonPageUrls
    : Array.isArray(entity.sourceUrls)
      ? entity.sourceUrls
      : [];
  return {
    ...entity,
    citedPersonPageUrls: [
      ...new Set([
        ...committed.filter((url): url is string => typeof url === 'string'),
        ...personPageUrls,
      ]),
    ],
  };
}

export const identityWithObservedPersonPages = (
  entity: ResearchEntityIdentity,
  observations: readonly CitingObservation[],
): ResearchEntityIdentity =>
  identityWithPersonPageUrls(entity, everyCitedPersonPageUrl(observations));

/**
 * A person row's description evidence without what a same-surname namesake's person page
 * states (#5764): an observation citing a person page that the row's own other person-page
 * citations show belongs to somebody else is dropped, and a research-page-text reading keeps
 * its other pages. A derivation on every read: it writes no field and no lock.
 */
export function withoutNamesakePersonPageDescriptions<T extends CitingObservation>(
  observations: readonly T[],
  entity: ResearchEntityIdentity,
  citingObservations: readonly CitingObservation[] = observations,
): T[] {
  const identity = identityWithObservedPersonPages(entity, citingObservations);
  const isNamesakePage = (url: string): boolean =>
    personProfileSourceIsADifferentPersonThanCitedOwner(url, identity);
  return observations.flatMap((observation) => {
    if (typeof observation.field !== 'string') return [observation];
    if (!PERSON_DESCRIPTION_EVIDENCE_FIELDS.has(observation.field)) return [observation];
    if (observation.field === RESEARCH_PAGE_TEXT_FIELD && Array.isArray(observation.value)) {
      const pages = observation.value.filter((page) => !isNamesakePage(pageUrlOf(page)));
      if (pages.length === observation.value.length) return [observation];
      return pages.length > 0 ? [{ ...observation, value: pages }] : [];
    }
    return typeof observation.sourceUrl === 'string' && isNamesakePage(observation.sourceUrl)
      ? []
      : [observation];
  });
}
