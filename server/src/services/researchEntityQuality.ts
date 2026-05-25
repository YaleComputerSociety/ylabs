import { assessResearchEntityDescriptionQuality } from '../utils/researchEntityDescriptionQuality';

export type ResearchEntityDescriptionState =
  | 'source_backed'
  | 'profile_synthesis'
  | 'thin'
  | 'missing';

export type ResearchEntityLeadState = 'lead_attached' | 'lead_weak' | 'lead_missing';

export type ResearchEntityRepairFlag =
  | 'missing_description'
  | 'thin_description'
  | 'profile_fallback_only'
  | 'missing_lead'
  | 'missing_source_url';

export interface ResearchEntityQualitySummary {
  descriptionState: ResearchEntityDescriptionState;
  leadState: ResearchEntityLeadState;
  repairFlags: ResearchEntityRepairFlag[];
  score: number;
}

export interface ResearchEntityQualityInput {
  entity: Record<string, any>;
  leadMembers?: Array<Record<string, any>>;
}

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const hasSourceUrl = (entity: Record<string, any>): boolean =>
  [entity.websiteUrl, entity.website, ...(Array.isArray(entity.sourceUrls) ? entity.sourceUrls : [])]
    .some((value) => /^https?:\/\//i.test(textValue(value)));

const hasStrongLead = (member: Record<string, any>): boolean =>
  Boolean(member.userId || member.user?._id || textValue(member.name) || textValue(member.user?.netid));

function descriptionStateForEntity(entity: Record<string, any>): ResearchEntityDescriptionState {
  const quality = assessResearchEntityDescriptionQuality({
    fullDescription: entity.fullDescription,
    shortDescription: entity.shortDescription,
    sourceUrls: entity.sourceUrls,
    website: entity.website,
    websiteUrl: entity.websiteUrl,
  });
  if (quality.full.isUseful || quality.short.isUseful) return 'source_backed';
  if (textValue(entity.profileSynthesisDescription)) return 'profile_synthesis';
  if (
    textValue(entity.fullDescription) ||
    textValue(entity.shortDescription) ||
    textValue(entity.description)
  ) {
    return 'thin';
  }
  return 'missing';
}

function leadStateForMembers(leadMembers: Array<Record<string, any>>): ResearchEntityLeadState {
  if (leadMembers.some(hasStrongLead)) return 'lead_attached';
  if (leadMembers.length > 0) return 'lead_weak';
  return 'lead_missing';
}

export function buildResearchEntityQualitySummary({
  entity,
  leadMembers = [],
}: ResearchEntityQualityInput): ResearchEntityQualitySummary {
  const descriptionState = descriptionStateForEntity(entity);
  const leadState = leadStateForMembers(leadMembers);
  const repairFlags: ResearchEntityRepairFlag[] = [];

  if (descriptionState === 'missing') repairFlags.push('missing_description');
  if (descriptionState === 'thin') repairFlags.push('thin_description');
  if (descriptionState === 'profile_synthesis') repairFlags.push('profile_fallback_only');
  if (leadState !== 'lead_attached') repairFlags.push('missing_lead');
  if (!hasSourceUrl(entity)) repairFlags.push('missing_source_url');

  let score = 0;
  if (descriptionState === 'missing') score += 45;
  if (descriptionState === 'thin') score += 34;
  if (descriptionState === 'profile_synthesis') score += 22;
  if (leadState === 'lead_missing') score += 35;
  if (leadState === 'lead_weak') score += 18;
  if (!hasSourceUrl(entity)) score += 16;

  return {
    descriptionState,
    leadState,
    repairFlags,
    score,
  };
}
