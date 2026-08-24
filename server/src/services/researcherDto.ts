import mongoose from 'mongoose';
import type { PublicResearchEntityDto } from './researchEntityDto';
import type { ResearcherDisplayProfile, ResearcherProfileLink } from '../models/researcher';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { isPublicHttpUrl } from '../utils/urlSafety';
import {
  personNameCarriesLifespan,
  stripTrailingPersonNameLifespan,
} from '../utils/researchEntityDeceasedLead';

export interface PublicResearcherProfile {
  publicKey: string;
  displayName: string;
  title?: string;
  primaryDepartment?: string;
  school?: string;
  officialProfileUrl?: string;
  scholarUrl?: string;
  orcidUrl?: string;
  homes: PublicResearchEntityDto[];
}

export const MAX_PUBLIC_RESEARCHER_TEXT_LENGTH = 240;
export const MAX_AGGREGATED_RESEARCHER_HOMES = 50;

const PRIMARY_IDENTITY_LINK_KINDS: readonly ResearcherProfileLink['kind'][] = [
  'YALE_OFFICIAL',
  'LAB_ABOUT',
  'PERSONAL_ACADEMIC',
];

export const publicResearcherText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const cleaned = redactDirectContactInfo(value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_PUBLIC_RESEARCHER_TEXT_LENGTH);
  return cleaned || undefined;
};

const publicProfileLinkUrl = (
  links: readonly ResearcherProfileLink[] | undefined,
  kinds: readonly ResearcherProfileLink['kind'][],
): string | undefined => {
  if (!Array.isArray(links)) return undefined;
  for (const kind of kinds) {
    const match = links.find(
      (link) =>
        link?.kind === kind && typeof link?.url === 'string' && isPublicHttpUrl(link.url.trim()),
    );
    if (match) return match.url.trim();
  }
  return undefined;
};

export const researcherHasPrimaryIdentityLink = (
  links: readonly ResearcherProfileLink[] | undefined,
): boolean => Boolean(publicProfileLinkUrl(links, PRIMARY_IDENTITY_LINK_KINDS));

export const publicResearcherDisplayName = (displayName: unknown): string | undefined => {
  if (typeof displayName !== 'string') return undefined;
  if (personNameCarriesLifespan(displayName)) return undefined;
  return publicResearcherText(stripTrailingPersonNameLifespan(displayName));
};

const mostCommonSchool = (homes: readonly PublicResearchEntityDto[]): string | undefined => {
  const counts = new Map<string, number>();
  for (const home of homes) {
    const school = typeof home.school === 'string' ? home.school.trim() : '';
    if (school) counts.set(school, (counts.get(school) || 0) + 1);
  }
  let best: string | undefined;
  let bestCount = 0;
  for (const [school, count] of counts) {
    if (count > bestCount) {
      best = school;
      bestCount = count;
    }
  }
  return best;
};

export interface ResearcherDtoInput {
  id: mongoose.Types.ObjectId | string;
  displayName?: string;
  profile?: ResearcherDisplayProfile;
  profileLinks?: ResearcherProfileLink[];
  homes: PublicResearchEntityDto[];
}

/**
 * Read-only, fail-closed public projection of a Researcher. A researcher is only
 * ever surfaced when it is a genuinely public identity: it must have a usable
 * display name and either at least one public research home or a verified
 * primary-identity profile link. Contact fields are never copied and every
 * served string is contact-redacted, mirroring the entity DTO's contract.
 */
export function toPublicResearcherDto(input: ResearcherDtoInput): PublicResearcherProfile | null {
  const displayName = publicResearcherDisplayName(input.displayName);
  if (!displayName) return null;

  const homes = input.homes.slice(0, MAX_AGGREGATED_RESEARCHER_HOMES);
  if (homes.length === 0 && !researcherHasPrimaryIdentityLink(input.profileLinks)) return null;

  const title = publicResearcherText(input.profile?.title);
  const primaryDepartment = publicResearcherText(input.profile?.primaryDepartment);
  const officialProfileUrl = publicProfileLinkUrl(input.profileLinks, PRIMARY_IDENTITY_LINK_KINDS);
  const scholarUrl = publicProfileLinkUrl(input.profileLinks, ['GOOGLE_SCHOLAR']);
  const orcidUrl = publicProfileLinkUrl(input.profileLinks, ['ORCID']);
  const school = mostCommonSchool(homes);

  return {
    publicKey: String(input.id),
    displayName,
    ...(title ? { title } : {}),
    ...(primaryDepartment ? { primaryDepartment } : {}),
    ...(school ? { school } : {}),
    ...(officialProfileUrl ? { officialProfileUrl } : {}),
    ...(scholarUrl ? { scholarUrl } : {}),
    ...(orcidUrl ? { orcidUrl } : {}),
    homes,
  };
}
