import { safeRouteSegment } from './url';

const PERSON_PUBLIC_KEY_PATTERN = /^[0-9a-f]{24}(?:-|$)/;

/**
 * A served member/lead public key aggregates to a person page only when it
 * carries a canonical person identity: `publicMemberKeyForResearchDetail`
 * builds it as `slug(personId:role)`, so a personId-backed key opens with the
 * 24-char ObjectId hex. Display-name-only keys have no stable identity and the
 * server fails those closed, so they must not be linked.
 */
export const researcherPersonPagePath = (publicKey: string | undefined): string | undefined => {
  if (typeof publicKey !== 'string') return undefined;
  const normalized = publicKey.trim().toLowerCase();
  if (!PERSON_PUBLIC_KEY_PATTERN.test(normalized)) return undefined;
  const segment = safeRouteSegment(normalized);
  return segment ? `/research/person/${segment}` : undefined;
};
