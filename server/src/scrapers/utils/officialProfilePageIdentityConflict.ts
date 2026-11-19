import { isCanonicalCmsProfileUrl } from '../../scripts/backfillResearcherOfficialProfileLinksCore';
import { normalizeOfficialProfileDestination } from '../../services/leadProfileIdentity';
import { personPageLeafNameTokens } from './personProfileEntityMatch';
import { givenNamesAgree } from './piNameMatch';

interface PersonPage {
  host: string;
  destination: string;
  surname: string;
  givenTokens: string[];
}

const personPage = (url: string): PersonPage | undefined => {
  if (!isCanonicalCmsProfileUrl(url)) return undefined;
  const destination = normalizeOfficialProfileDestination(url).toLowerCase();
  const segments = destination.split('/');
  const tokens = personPageLeafNameTokens(segments.at(-1));
  if (!tokens) return undefined;
  return {
    host: segments[0],
    destination,
    surname: tokens[tokens.length - 1],
    givenTokens: tokens.slice(0, -1),
  };
};

const givenNamesCanBeOnePerson = (left: string[], right: string[]): boolean =>
  left.join('') === right.join('') || left.some((a) => right.some((b) => givenNamesAgree(a, b)));

/**
 * Whether an observed person page and a researcher's own official page are two different
 * people's pages on one site: distinct canonical CMS profile pages on the same host whose
 * slugs share a surname and share no given name, short form, or concatenated spelling.
 *
 * A name-only join has no per-person identifier behind it, so this is the evidence that
 * overrules it. Both pages must be name-shaped: a netid slug or a bare initial names nobody
 * the comparison can read, and a page that cannot be read must not refuse a join.
 */
export function personPagesNameDifferentPeople(
  observedUrls: readonly string[],
  storedUrls: readonly string[],
): boolean {
  const stored = storedUrls.map(personPage).filter((page): page is PersonPage => Boolean(page));
  if (stored.length === 0) return false;
  return observedUrls
    .map(personPage)
    .filter((page): page is PersonPage => Boolean(page))
    .some((observed) =>
      stored.some(
        (own) =>
          own.host === observed.host &&
          own.destination !== observed.destination &&
          own.surname === observed.surname &&
          !givenNamesCanBeOnePerson(own.givenTokens, observed.givenTokens),
      ),
    );
}
