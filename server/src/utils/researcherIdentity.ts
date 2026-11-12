import { isPlausiblePersonOrcid } from './orcid';

export interface ResearcherIdentitySource {
  identifiers?: { netid?: unknown; email?: unknown } | null;
}

const trimmedText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function researcherNetid(researcher: ResearcherIdentitySource): string {
  return trimmedText(researcher.identifiers?.netid);
}

export function researcherEmail(researcher: ResearcherIdentitySource): string {
  return trimmedText(researcher.identifiers?.email);
}

/**
 * Whether a researcher is backed by a Yale directory record rather than only a name or a
 * netid a lane resolved. That record used to be the linked account; #5000 copied its email
 * onto `identifiers.email`, and accounts are environment-local since #5088, so the email is
 * the researcher-side copy of the record.
 */
export function researcherHoldsDirectoryIdentity(researcher: ResearcherIdentitySource): boolean {
  return trimmedText(researcher.identifiers?.email).length > 0;
}

export interface ResearcherIdentityEvidenceSource {
  identifiers?: { netid?: unknown; email?: unknown; orcid?: unknown } | null;
  profileLinks?: ReadonlyArray<{ kind?: unknown } | null> | null;
}

/**
 * Whether a researcher carries any identity beyond a name: a netid, a directory email, a
 * plausible ORCID, or a Yale official profile link. A roster listing that two name-agreeing records
 * share resolves to the one carrying identity, never to its name-only twin (#5592).
 */
export function researcherCarriesIdentityEvidence(
  researcher: ResearcherIdentityEvidenceSource,
): boolean {
  const identifiers = researcher.identifiers ?? {};
  if (
    [identifiers.netid, identifiers.email].some((value) => trimmedText(value)) ||
    isPlausiblePersonOrcid(identifiers.orcid)
  ) {
    return true;
  }
  return (researcher.profileLinks ?? []).some((link) => link?.kind === 'YALE_OFFICIAL');
}
