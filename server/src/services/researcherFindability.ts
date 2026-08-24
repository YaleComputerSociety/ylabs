import type { ResearcherProfileLink, ResearcherStatus } from '../models/researcher';
import {
  personNameCarriesLifespan,
  stripTrailingPersonNameLifespan,
} from '../utils/researchEntityDeceasedLead';

export const PRIMARY_IDENTITY_PROFILE_LINK_KINDS: readonly ResearcherProfileLink['kind'][] = [
  'YALE_OFFICIAL',
  'LAB_ABOUT',
  'PERSONAL_ACADEMIC',
];

export const PUBLICLY_FINDABLE_RESEARCHER_STATUSES: readonly ResearcherStatus[] = [
  'ACTIVE',
  'UNKNOWN',
];

export const researcherHasPrimaryIdentityLink = (
  profileLinks: readonly ResearcherProfileLink[] | undefined,
): boolean =>
  Array.isArray(profileLinks) &&
  profileLinks.some(
    (link) =>
      link != null &&
      PRIMARY_IDENTITY_PROFILE_LINK_KINDS.includes(link.kind) &&
      typeof link.url === 'string' &&
      link.url.trim().length > 0,
  );

export const publiclyFindableResearcherDisplayName = (
  rawDisplayName: string | undefined,
): string | undefined => {
  if (typeof rawDisplayName !== 'string') return undefined;
  if (personNameCarriesLifespan(rawDisplayName)) return undefined;
  const displayName = stripTrailingPersonNameLifespan(rawDisplayName).trim();
  return displayName.length > 0 ? displayName : undefined;
};

export interface ResearcherFindabilityInput {
  archived?: boolean;
  status?: ResearcherStatus;
  displayName?: string;
  servableHomeCount: number;
  hasPrimaryIdentityLink: boolean;
}

export const researcherIsPubliclyFindable = (input: ResearcherFindabilityInput): boolean => {
  if (input.archived === true) return false;
  if (input.status !== undefined && !PUBLICLY_FINDABLE_RESEARCHER_STATUSES.includes(input.status)) {
    return false;
  }
  if (!publiclyFindableResearcherDisplayName(input.displayName)) return false;
  return input.servableHomeCount > 0 || input.hasPrimaryIdentityLink;
};
