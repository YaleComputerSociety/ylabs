/**
 * Which row owns a research-home URL that several rows store as their own
 * `websiteUrl` (#3290).
 *
 * Ownership cannot be read off which row currently serves. The visibility gate's
 * canonical score carries an 80-point already-public term, so incumbency decides
 * there, and 17 of 25 contested owners were measured on the suppressed side. This
 * asks the corpus instead, and abstains rather than guessing.
 */
export type ResearchHomeUrlOwnershipBasis =
  | 'index_authority'
  | 'name_matches_url_label'
  | 'joint_label_abstained'
  | 'undecidable';

export interface ResearchHomeUrlOwnershipCandidate {
  id: string;
  name?: string;
  indexAuthorityUrl?: string;
}

export interface ResearchHomeUrlOwnershipDecision {
  ownerId: string | null;
  basis: ResearchHomeUrlOwnershipBasis;
}

const MIN_LABEL_TOKEN = 4;

export function normalizeOwnershipUrlKey(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '');
}

export function researchHomeUrlLabel(value: unknown): string {
  try {
    const segments = new URL(String(value ?? '').trim()).pathname.split('/').filter(Boolean);
    return (segments[segments.length - 1] ?? '').toLowerCase();
  } catch {
    return '';
  }
}

export function nameTokens(value: unknown): string[] {
  return String(value ?? '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((token) => token.length >= MIN_LABEL_TOKEN);
}

/**
 * A label that is a portmanteau of two members' surnames names a JOINT lab, and both
 * members are legitimately associated with it. Measured at roughly 1 in 4 of the
 * name-decided groups, so the rule abstains instead of picking one: `lusking` carries
 * `lusk` as a substring, so a row named for Lusk and a row named LusKing both relate
 * to the label and neither is the borrower.
 */
export function urlLabelIsJointlyClaimed(
  label: string,
  candidates: readonly ResearchHomeUrlOwnershipCandidate[],
  exactOwnerId: string,
): boolean {
  if (!label) return false;
  return candidates.some(
    (candidate) =>
      candidate.id !== exactOwnerId &&
      nameTokens(candidate.name).some(
        (token) => token !== label && token.length >= MIN_LABEL_TOKEN && label.includes(token),
      ),
  );
}

export function decideResearchHomeUrlOwner(
  url: string,
  candidates: readonly ResearchHomeUrlOwnershipCandidate[],
): ResearchHomeUrlOwnershipDecision {
  const key = normalizeOwnershipUrlKey(url);
  if (!key || candidates.length === 0) return { ownerId: null, basis: 'undecidable' };

  const byAuthority = candidates.filter(
    (candidate) => normalizeOwnershipUrlKey(candidate.indexAuthorityUrl) === key,
  );
  if (byAuthority.length === 1) return { ownerId: byAuthority[0].id, basis: 'index_authority' };

  const label = researchHomeUrlLabel(url);
  if (!label) return { ownerId: null, basis: 'undecidable' };
  const byName = candidates.filter((candidate) => nameTokens(candidate.name).includes(label));
  if (byName.length !== 1) return { ownerId: null, basis: 'undecidable' };
  if (urlLabelIsJointlyClaimed(label, candidates, byName[0].id)) {
    return { ownerId: null, basis: 'joint_label_abstained' };
  }
  return { ownerId: byName[0].id, basis: 'name_matches_url_label' };
}
