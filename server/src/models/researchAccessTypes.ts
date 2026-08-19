/**
 * Shared string enums for the Yale Research access/pathway model.
 *
 * Keep these values stable: they are persisted in MongoDB and will eventually
 * become search/filter facets.
 */

export const researchEntityTypes = [
  'LAB',
  'CENTER',
  'INSTITUTE',
  'FACULTY_RESEARCH_AREA',
  'FACULTY_PROJECT',
  'DIGITAL_HUMANITIES_PROJECT',
  'COLLECTIONS_INITIATIVE',
  'RA_PROGRAM',
  'FELLOWSHIP_PROGRAM',
  'COURSE_SEQUENCE',
  'ARCHIVE_OR_MUSEUM_PROJECT',
  'PROGRAM',
  'INITIATIVE',
  'GROUP',
  'INDIVIDUAL_RESEARCH',
] as const;

export type ResearchEntityType = (typeof researchEntityTypes)[number];

export const postedOpportunityStatuses = ['OPEN', 'CLOSED', 'ROLLING', 'ARCHIVED'] as const;

export type PostedOpportunityStatus = (typeof postedOpportunityStatuses)[number];

export const accessSignalTypes = [
  'POSTED_OPENING',
  'RECURRING_PROGRAM',
  'CREDIT_FORMALIZATION_POSSIBLE',
  'COURSE_CREDIT_PATHWAY',
  'PAST_UNDERGRADS',
  'CURRENT_UNDERGRADS',
  'FACULTY_SUPERVISES_STUDENT_PROJECTS',
  'FELLOWSHIP_COMPATIBLE',
  'REACH_OUT_PLAUSIBLE',
  'APPLICATION_FORM_EXISTS',
  'CONTACT_INSTRUCTIONS_EXIST',
  'LAB_MANAGER_LISTED',
  'PROGRAM_MANAGER_LISTED',
  'APPLICATION_ONLY',
  'NOT_CURRENTLY_AVAILABLE',
  'NO_EVIDENCE',
] as const;

export type AccessSignalType = (typeof accessSignalTypes)[number];

export const accessSignalConfidences = ['HIGH', 'MEDIUM', 'LOW'] as const;

export type AccessSignalConfidence = (typeof accessSignalConfidences)[number];

export const undergraduateLogisticsSignalTypes = [
  'STUDENT_LEVEL',
  'COMPENSATION',
  'TIME_COMMITMENT',
  'MODALITY',
  'CURRENT_AVAILABILITY',
] as const;

export type UndergraduateLogisticsSignalType = (typeof undergraduateLogisticsSignalTypes)[number];

export const signalTypes = [...accessSignalTypes, ...undergraduateLogisticsSignalTypes] as const;

export type SignalType = (typeof signalTypes)[number];

export const signalConfidences = accessSignalConfidences;

export type SignalConfidence = AccessSignalConfidence;

export const signalStatuses = ['KNOWN', 'STALE_UNDER_REVIEW', 'CONFLICTING_WITHHELD'] as const;

export type SignalStatus = (typeof signalStatuses)[number];

export const researchGroupKinds = [
  'lab',
  'center',
  'institute',
  'program',
  'initiative',
  'group',
  'individual',
  'solo',
] as const;

export type ResearchGroupKind = (typeof researchGroupKinds)[number];

export const ResearchGroupKindToEntityType: Record<ResearchGroupKind, ResearchEntityType> = {
  lab: 'LAB',
  center: 'CENTER',
  institute: 'INSTITUTE',
  program: 'PROGRAM',
  initiative: 'INITIATIVE',
  group: 'GROUP',
  individual: 'INDIVIDUAL_RESEARCH',
  solo: 'INDIVIDUAL_RESEARCH',
};

export const mapResearchGroupKindToEntityType = (kind?: string): ResearchEntityType => {
  if (kind && researchGroupKinds.includes(kind as ResearchGroupKind)) {
    return ResearchGroupKindToEntityType[kind as ResearchGroupKind];
  }

  return 'LAB';
};

export const researchEntityTypeForResearchGroupKind = mapResearchGroupKindToEntityType;

export const ResearchEntityTypes = researchEntityTypes;
export const PostedOpportunityStatuses = postedOpportunityStatuses;
export const AccessSignalTypes = accessSignalTypes;
export const AccessSignalConfidences = accessSignalConfidences;
export const SignalTypes = signalTypes;
export const SignalConfidences = signalConfidences;
export const SignalStatuses = signalStatuses;
export const UndergraduateLogisticsSignalTypes = undergraduateLogisticsSignalTypes;
