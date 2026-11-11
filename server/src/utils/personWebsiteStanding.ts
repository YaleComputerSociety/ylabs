import {
  isInadmissiblePersonWebsiteUrl,
  isPersonProfileOrDirectoryUrl,
} from './researchHomeWebsiteUrl';
import { normalizeWebsiteUrlIdentityKey } from './websiteUrlIdentityKey';

/**
 * How well a value serves as a person's own website (#5845). A person's profile or directory
 * page is a fallback: it fills an empty slot, but never displaces the person's own lab or
 * personal site, from the same key or from another key joining the same researcher.
 */
export const PERSON_WEBSITE_STANDING = {
  none: 0,
  profileOrDirectoryPage: 1,
  ownWebsite: 2,
} as const;

export type PersonWebsiteStanding =
  (typeof PERSON_WEBSITE_STANDING)[keyof typeof PERSON_WEBSITE_STANDING];

const nonEmptyText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function personWebsiteStanding(value: unknown): PersonWebsiteStanding {
  const text = nonEmptyText(value);
  if (!text || isInadmissiblePersonWebsiteUrl(text)) return PERSON_WEBSITE_STANDING.none;
  return isPersonProfileOrDirectoryUrl(text)
    ? PERSON_WEBSITE_STANDING.profileOrDirectoryPage
    : PERSON_WEBSITE_STANDING.ownWebsite;
}

const queryOf = (value: string): string => {
  try {
    return new URL(value).search;
  } catch {
    return '';
  }
};

/**
 * Two spellings of one site: a scheme, a leading `www.`, a trailing slash or a default
 * document differ, and nothing else does. The query string still counts, so two pages behind
 * one script path stay distinct.
 */
export function isSamePersonWebsite(left: unknown, right: unknown): boolean {
  const leftText = nonEmptyText(left);
  const rightText = nonEmptyText(right);
  if (!leftText || !rightText) return false;
  const leftKey = normalizeWebsiteUrlIdentityKey(leftText);
  return (
    Boolean(leftKey) &&
    leftKey === normalizeWebsiteUrlIdentityKey(rightText) &&
    queryOf(leftText) === queryOf(rightText)
  );
}

/**
 * The first candidate of the best standing, so ranked order still decides among peers and a
 * profile page wins only when no own website is offered.
 */
export function preferredPersonWebsiteCandidate<T extends { value: unknown }>(
  rankedCandidates: readonly T[],
): T | undefined {
  let preferred: T | undefined;
  let preferredStanding: PersonWebsiteStanding = PERSON_WEBSITE_STANDING.none;
  for (const candidate of rankedCandidates) {
    const standing = personWebsiteStanding(candidate.value);
    if (standing > preferredStanding) {
      preferred = candidate;
      preferredStanding = standing;
    }
  }
  return preferred;
}

export function websiteStandsBelowStored(candidate: unknown, stored: unknown): boolean {
  return (
    Boolean(nonEmptyText(candidate)) &&
    personWebsiteStanding(candidate) < personWebsiteStanding(stored)
  );
}

export function websiteStandsAboveStored(candidate: unknown, stored: unknown): boolean {
  const storedStanding = personWebsiteStanding(stored);
  return (
    storedStanding > PERSON_WEBSITE_STANDING.none &&
    personWebsiteStanding(candidate) > storedStanding
  );
}
