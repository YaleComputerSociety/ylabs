import {
  publicStudentVisibilityTiers,
  type StudentVisibilityTier,
} from '../models/studentVisibility';
import { buildResearchEntityQualitySummary } from './researchEntityQuality';

export const STUDENT_VISIBILITY_VERSION = 'student-visibility-v1';

export interface StudentVisibilityResult {
  tier: StudentVisibilityTier;
  computedTier: StudentVisibilityTier;
  reasons: string[];
}

export interface ResearchEntityStudentVisibilityInput {
  entity: Record<string, any>;
  leadMembers?: Array<Record<string, any>>;
  accessSignalCount?: number;
  actionablePathwayCount?: number;
  openPostedOpportunityCount?: number;
  duplicateRisk?: boolean;
  contentPageRisk?: boolean;
}

export interface ProgramStudentVisibilityInput extends Record<string, any> {
  title?: string;
  studentFacingCategory?: string;
  sourceUrl?: string;
  applicationLink?: string;
  links?: Array<{ url?: string }>;
  undergraduateOnly?: boolean;
  yaleCollegeOnly?: boolean;
}

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const hasHttpUrl = (value: unknown): boolean => /^https?:\/\//i.test(textValue(value));

const hasAnyHttpUrl = (values: unknown[]): boolean => values.some(hasHttpUrl);

const overrideTier = (record: Record<string, any>): StudentVisibilityTier | null => {
  const tier = record.studentVisibilityOverrideTier;
  if (
    tier === 'student_ready' ||
    tier === 'limited_but_safe' ||
    tier === 'operator_review' ||
    tier === 'suppressed'
  ) {
    return tier;
  }
  return null;
};

const withOverride = (
  record: Record<string, any>,
  computedTier: StudentVisibilityTier,
  reasons: string[],
): StudentVisibilityResult => {
  const override = overrideTier(record);
  if (!override) {
    return { tier: computedTier, computedTier, reasons };
  }

  return {
    tier: override,
    computedTier,
    reasons: Array.from(new Set([...reasons, 'operator_override'])),
  };
};

export const isPublicStudentVisibilityTier = (tier: unknown): tier is StudentVisibilityTier =>
  publicStudentVisibilityTiers.includes(tier as StudentVisibilityTier);

export function computeResearchEntityStudentVisibility({
  entity,
  leadMembers = [],
  accessSignalCount = 0,
  actionablePathwayCount = 0,
  openPostedOpportunityCount = 0,
  duplicateRisk = false,
  contentPageRisk = false,
}: ResearchEntityStudentVisibilityInput): StudentVisibilityResult {
  const quality = buildResearchEntityQualitySummary({ entity, leadMembers });
  const reasons: string[] = [];

  if (entity.activeAtYaleCache === false) reasons.push('inactive_at_yale');
  if (duplicateRisk) reasons.push('duplicate_risk');
  if (contentPageRisk) reasons.push('content_page_risk');
  if (quality.descriptionState === 'source_backed') reasons.push('source_backed_description');
  if (quality.descriptionState === 'profile_synthesis') reasons.push('profile_fallback_only');
  if (quality.descriptionState === 'thin') reasons.push('thin_description');
  if (quality.descriptionState === 'missing') reasons.push('missing_description');
  if (quality.leadState !== 'lead_attached') reasons.push('missing_lead');
  if (quality.repairFlags.includes('missing_source_url')) reasons.push('missing_source_url');

  const hasActionEvidence =
    openPostedOpportunityCount > 0 || accessSignalCount > 0 || actionablePathwayCount > 0;
  if (hasActionEvidence) reasons.push('concrete_next_step');
  else reasons.push('missing_action_evidence');

  let computedTier: StudentVisibilityTier = 'operator_review';
  if (entity.activeAtYaleCache === false || contentPageRisk) {
    computedTier = 'suppressed';
  } else if (
    quality.descriptionState === 'source_backed' &&
    quality.leadState === 'lead_attached' &&
    !quality.repairFlags.includes('missing_source_url') &&
    hasActionEvidence &&
    !duplicateRisk
  ) {
    computedTier = 'student_ready';
  } else if (
    quality.descriptionState === 'source_backed' &&
    quality.leadState === 'lead_attached' &&
    !quality.repairFlags.includes('missing_source_url') &&
    !duplicateRisk
  ) {
    computedTier = 'limited_but_safe';
  } else if (
    quality.descriptionState === 'thin' &&
    quality.leadState === 'lead_attached' &&
    !quality.repairFlags.includes('missing_source_url') &&
    !duplicateRisk
  ) {
    computedTier = 'limited_but_safe';
  } else if (
    quality.descriptionState === 'profile_synthesis' &&
    quality.leadState === 'lead_attached' &&
    !quality.repairFlags.includes('missing_source_url') &&
    hasActionEvidence &&
    !duplicateRisk
  ) {
    computedTier = 'limited_but_safe';
  }

  return withOverride(entity, computedTier, Array.from(new Set(reasons)));
}

export function computeProgramStudentVisibility(
  program: ProgramStudentVisibilityInput,
): StudentVisibilityResult {
  const reasons: string[] = [];
  const title = textValue(program.title);
  const category = textValue(program.studentFacingCategory);
  const sourceUrl = textValue(program.sourceUrl);
  const routeUrls = [
    program.applicationLink,
    ...(Array.isArray(program.links) ? program.links.map((link) => link?.url) : []),
  ];
  const sourceUrls = [sourceUrl, ...routeUrls];
  const hasOfficialSource = hasHttpUrl(sourceUrl);
  const hasApplicationRoute = hasAnyHttpUrl(routeUrls);
  const sourceIsApplicationPortal = /^https:\/\/yale\.communityforce\.com\/Funds\/FundDetails\.aspx\?/i.test(
    sourceUrl,
  );
  const isArchiveReview = category === 'Archive / review';
  const graduateOnly = program.undergraduateOnly === false;
  const catalogOrAdmin =
    /\b(administering|alternative funding|find funding|student grants database|faculty staff)\b/i.test(
      title,
    );

  if (hasOfficialSource) reasons.push('official_source');
  else reasons.push('missing_official_source');
  if (sourceIsApplicationPortal) reasons.push('application_source_only');
  if (hasApplicationRoute) reasons.push('application_route');
  else reasons.push('missing_application_route');
  if (isArchiveReview) reasons.push('archive_review');
  if (graduateOnly || catalogOrAdmin) reasons.push('not_undergraduate_relevant');
  const undergraduateRelevant = program.undergraduateOnly === true || program.yaleCollegeOnly === true;
  if (undergraduateRelevant) {
    reasons.push('undergraduate_relevant');
  }

  let computedTier: StudentVisibilityTier = 'operator_review';
  if (graduateOnly || catalogOrAdmin) {
    computedTier = 'suppressed';
  } else if (
    !isArchiveReview &&
    undergraduateRelevant &&
    hasOfficialSource &&
    hasApplicationRoute &&
    !sourceIsApplicationPortal
  ) {
    computedTier = 'student_ready';
  } else if (!isArchiveReview && undergraduateRelevant && hasOfficialSource) {
    computedTier = 'limited_but_safe';
  }

  if (!hasAnyHttpUrl(sourceUrls)) reasons.push('missing_source_route');

  return withOverride(program, computedTier, Array.from(new Set(reasons)));
}
