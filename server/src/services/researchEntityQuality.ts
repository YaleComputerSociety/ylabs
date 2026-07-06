import { assessResearchEntityDescriptionQuality } from '../utils/researchEntityDescriptionQuality';

export type ResearchEntityDescriptionState =
  | 'source_backed'
  | 'profile_synthesis'
  | 'thin'
  | 'missing';

export type ResearchEntityLeadState =
  | 'lead_attached'
  | 'lead_weak'
  | 'lead_missing'
  | 'lead_conflict';

export type ResearchEntityRepairFlag =
  | 'missing_description'
  | 'thin_description'
  | 'profile_fallback_only'
  | 'missing_card_description'
  | 'missing_lead'
  | 'pi_identity_conflict'
  | 'missing_source_url'
  | 'duplicate_risk';

export interface ResearchEntityQualitySummary {
  descriptionState: ResearchEntityDescriptionState;
  cardState: 'complete' | 'sparse';
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

const visibilityReasonsForEntity = (entity: Record<string, any>): string[] =>
  [
    ...(Array.isArray(entity.studentVisibilityReasons) ? entity.studentVisibilityReasons : []),
    ...(Array.isArray(entity.studentVisibilityComputedReasons)
      ? entity.studentVisibilityComputedReasons
      : []),
  ].map(textValue);

const hasStrongLead = (member: Record<string, any>): boolean =>
  Boolean(
    member.userId ||
      member.user?._id ||
      member.facultyMemberId ||
      member.facultyMember?._id ||
      textValue(member.name) ||
      textValue(member.user?.netid),
  );

const hasLeadIdentityConflict = (member: Record<string, any>): boolean => {
  const rowFacultyId = textValue(member.facultyMemberId);
  if (!rowFacultyId) return false;

  const userFacultyId = textValue(member.user?.facultyMemberId);
  if (member.userId && userFacultyId && userFacultyId !== rowFacultyId) return true;

  const facultyUserId = textValue(member.facultyMember?.userId);
  if (member.userId && facultyUserId && facultyUserId !== textValue(member.userId)) return true;

  return false;
};

function descriptionQualityForEntity(entity: Record<string, any>) {
  return assessResearchEntityDescriptionQuality({
    fullDescription: entity.fullDescription,
    shortDescription: entity.shortDescription,
    sourceUrls: entity.sourceUrls,
    website: entity.website,
    websiteUrl: entity.websiteUrl,
  });
}

function descriptionStateForEntity(entity: Record<string, any>): ResearchEntityDescriptionState {
  const quality = descriptionQualityForEntity(entity);
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
  if (leadMembers.some(hasLeadIdentityConflict)) return 'lead_conflict';
  if (leadMembers.some(hasStrongLead)) return 'lead_attached';
  if (leadMembers.length > 0) return 'lead_weak';
  return 'lead_missing';
}

export function buildResearchEntityQualitySummary({
  entity,
  leadMembers = [],
}: ResearchEntityQualityInput): ResearchEntityQualitySummary {
  const descriptionQuality = descriptionQualityForEntity(entity);
  const descriptionState = descriptionStateForEntity(entity);
  const cardState = descriptionQuality.cardState;
  const leadState = leadStateForMembers(leadMembers);
  const repairFlags: ResearchEntityRepairFlag[] = [];

  if (descriptionState === 'missing') repairFlags.push('missing_description');
  if (descriptionState === 'thin') repairFlags.push('thin_description');
  if (descriptionState === 'profile_synthesis') repairFlags.push('profile_fallback_only');
  if (descriptionState === 'source_backed' && cardState !== 'complete') {
    repairFlags.push('missing_card_description');
  }
  if (leadState === 'lead_conflict') repairFlags.push('pi_identity_conflict');
  if (leadState !== 'lead_attached') repairFlags.push('missing_lead');
  if (!hasSourceUrl(entity)) repairFlags.push('missing_source_url');
  if (visibilityReasonsForEntity(entity).includes('duplicate_risk')) repairFlags.push('duplicate_risk');

  let score = 0;
  if (descriptionState === 'missing') score += 45;
  if (descriptionState === 'thin') score += 34;
  if (descriptionState === 'profile_synthesis') score += 22;
  if (descriptionState === 'source_backed' && cardState !== 'complete') score += 12;
  if (leadState === 'lead_missing') score += 35;
  if (leadState === 'lead_weak') score += 18;
  if (leadState === 'lead_conflict') score += 44;
  if (!hasSourceUrl(entity)) score += 16;
  if (repairFlags.includes('duplicate_risk')) score += 14;

  return {
    descriptionState,
    cardState,
    leadState,
    repairFlags,
    score,
  };
}
