export interface ResearcherIdentitySource {
  accountId?: unknown;
  identifiers?: { netid?: unknown; email?: unknown } | null;
}

export interface LinkedAccountIdentity {
  netid?: unknown;
  email?: unknown;
}

const trimmedText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function researcherNetid(
  researcher: ResearcherIdentitySource,
  linkedAccount?: LinkedAccountIdentity | null,
): string {
  return trimmedText(researcher.identifiers?.netid) || trimmedText(linkedAccount?.netid);
}

export function researcherEmail(
  researcher: ResearcherIdentitySource,
  linkedAccount?: LinkedAccountIdentity | null,
): string {
  return trimmedText(researcher.identifiers?.email) || trimmedText(linkedAccount?.email);
}

/**
 * Whether a researcher is backed by a Yale directory record rather than only a name or a
 * netid a lane resolved. That record used to be the linked account, and #5000 copies its
 * email onto `identifiers.email` before the accounts nobody signed into are deleted, so the
 * email is the researcher-side copy of the account and stands in for it.
 */
export function researcherHoldsDirectoryIdentity(researcher: ResearcherIdentitySource): boolean {
  if (researcher.accountId !== undefined && researcher.accountId !== null) return true;
  return trimmedText(researcher.identifiers?.email).length > 0;
}
