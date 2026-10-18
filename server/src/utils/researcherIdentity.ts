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
