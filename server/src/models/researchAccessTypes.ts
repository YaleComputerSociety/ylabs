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

export const entryPathwayTypes = [
  'POSTED_ROLE',
  'RECURRING_PROGRAM',
  'COURSE_CREDIT',
  'SENIOR_THESIS',
  'FELLOWSHIP_FUNDED_PROJECT',
  'WORK_STUDY',
  'VOLUNTEER_OUTREACH',
  'EXPLORATORY_CONTACT',
  'CENTER_INTERNSHIP',
  'FACULTY_SUPERVISION',
  'STUDENT_JOB',
  'UNKNOWN',
] as const;

export type EntryPathwayType = (typeof entryPathwayTypes)[number];

export const entryPathwayStatuses = [
  'ACTIVE',
  'RECURRING',
  'PLAUSIBLE',
  'HISTORICAL',
  'NOT_CURRENTLY_AVAILABLE',
  'NO_EVIDENCE',
] as const;

export type EntryPathwayStatus = (typeof entryPathwayStatuses)[number];

export const evidenceStrengths = [
  'DIRECT',
  'STRONG',
  'MODERATE',
  'WEAK',
  'NONE',
] as const;

export type EvidenceStrength = (typeof evidenceStrengths)[number];

export const compensationTypes = [
  'PAID',
  'COURSE_CREDIT',
  'STIPEND',
  'VOLUNTEER',
  'WORK_STUDY',
  'FELLOWSHIP',
  'FELLOWSHIP_ELIGIBLE',
  'UNKNOWN',
] as const;

export type CompensationType = (typeof compensationTypes)[number];

export const postedOpportunityStatuses = [
  'OPEN',
  'CLOSED',
  'ROLLING',
  'ARCHIVED',
] as const;

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

export const contactRouteTypes = [
  'OFFICIAL_APPLICATION',
  'LAB_MANAGER',
  'PROGRAM_MANAGER',
  'FACULTY_PI',
  'DEPARTMENT_CONTACT',
  'FELLOWSHIP_OFFICE',
  'COURSE_INSTRUCTOR',
  'UNKNOWN',
] as const;

export type ContactRouteType = (typeof contactRouteTypes)[number];

export const contactRouteVisibilities = [
  'PUBLIC',
  'AUTHENTICATED',
  'ADMIN_ONLY',
] as const;

export type ContactRouteVisibility = (typeof contactRouteVisibilities)[number];

export const contactPolicies = [
  'OFFICIAL_ROUTE_PREFERRED',
  'DIRECT_CONTACT_OK',
  'APPLICATION_ONLY',
  'NO_DIRECT_CONTACT',
  'UNKNOWN',
] as const;

export type ContactPolicy = (typeof contactPolicies)[number];

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

export const ResearchGroupKindToEntityType: Record<
  ResearchGroupKind,
  ResearchEntityType
> = {
  lab: 'LAB',
  center: 'CENTER',
  institute: 'INSTITUTE',
  program: 'PROGRAM',
  initiative: 'INITIATIVE',
  group: 'GROUP',
  individual: 'INDIVIDUAL_RESEARCH',
  solo: 'INDIVIDUAL_RESEARCH',
};

export const mapResearchGroupKindToEntityType = (
  kind?: string,
): ResearchEntityType => {
  if (kind && researchGroupKinds.includes(kind as ResearchGroupKind)) {
    return ResearchGroupKindToEntityType[kind as ResearchGroupKind];
  }

  return 'LAB';
};

export const researchEntityTypeForResearchGroupKind =
  mapResearchGroupKindToEntityType;

export const ResearchEntityTypes = researchEntityTypes;
export const EntryPathwayTypes = entryPathwayTypes;
export const EntryPathwayStatuses = entryPathwayStatuses;
export const EvidenceStrengths = evidenceStrengths;
export const CompensationTypes = compensationTypes;
export const PostedOpportunityStatuses = postedOpportunityStatuses;
export const AccessSignalTypes = accessSignalTypes;
export const AccessSignalConfidences = accessSignalConfidences;
export const ContactRouteTypes = contactRouteTypes;
export const ContactRouteVisibilities = contactRouteVisibilities;
export const ContactPolicies = contactPolicies;
