import type { ResearcherProfileLink } from '../models/researcher';

/**
 * A link the verification lane probed and found gone (404/410) must not be
 * offered to a student as the person's official profile. `UNKNOWN` still serves:
 * it means unprobed or a department site that would not answer us, not dead.
 */
export function isServableOfficialProfileLink(link: ResearcherProfileLink | undefined): boolean {
  if (!link) return false;
  return link.healthStatus !== 'UNAVAILABLE';
}
